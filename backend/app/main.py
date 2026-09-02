import os
import json
import logging
from pathlib import Path
from typing import Optional, Dict, Any, List
from dotenv import load_dotenv

# Load backend/.env safely
env_path = Path(__file__).resolve().parent.parent / ".env"
if env_path.exists():
    load_dotenv(dotenv_path=env_path)
else:
    load_dotenv()

from fastapi import FastAPI, HTTPException, Request, Header, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError

from app.schemas import (
    TransactionInput, RiskAnalysisResponse, SafetyInfo, ExplanationItem, BreakdownItem,
    CreateOrderRequest, CreateOrderResponse, VerifyPaymentRequest, VerifyPaymentResponse,
    PaymentStatusResponse
)
from app.risk_engine import evaluate_rules
from app.ml_service import ml_service
from app.decision_engine import fuse_risk_and_decide
from app.payment_service import payment_service
from app import payment_repository

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("riskguard.api")

app = FastAPI(
    title="RiskGuard AI — Hybrid Risk & Razorpay Test Payment API",
    description="Explainable Payment Fraud Risk Intelligence & Razorpay Standard Checkout Integration (Test Mode).",
    version="1.0.0"
)

# CORS Configuration
frontend_url = os.getenv("FRONTEND_URL", "").strip()
public_backend_url = os.getenv("PUBLIC_BACKEND_URL", "").strip()

origins = [
    "http://localhost:3001",
    "http://127.0.0.1:3001",
    "http://localhost:8000",
    "http://127.0.0.1:8000"
]
if frontend_url and frontend_url not in origins:
    origins.append(frontend_url)
if public_backend_url and public_backend_url not in origins:
    origins.append(public_backend_url)

allow_all_cors = os.getenv("ALLOW_ALL_CORS", "true").lower() == "true"

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if allow_all_cors else origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

txn_counter = 186

# --------------------------------------------------------------------------
# HEALTH & CONFIG ENDPOINTS
# --------------------------------------------------------------------------

@app.api_route("/health", methods=["GET", "HEAD"], tags=["Health"])
def health_check():
    health_info = ml_service.model_health()
    pz_info = payment_service.get_config_status()
    return {
        "status": "ok",
        "service": "RiskGuard AI",
        "model_loaded": health_info["model_loaded"],
        "razorpay": {
            "configured": pz_info["configured"],
            "mode": pz_info["mode"]
        }
    }

@app.api_route("/api/payments/config", methods=["GET", "HEAD"], tags=["Payment Integration"])
def get_payment_config():
    """Returns non-sensitive public configuration for frontend checkout rendering."""
    return payment_service.get_config_status()

# --------------------------------------------------------------------------
# HYBRID RISK ANALYSIS ENDPOINT
# --------------------------------------------------------------------------

@app.post("/api/risk/analyze", response_model=RiskAnalysisResponse, tags=["Risk Analysis"])
def analyze_transaction(txn: TransactionInput):
    global txn_counter
    try:
        txn_dict = txn.model_dump()

        rule_score, signals, explanations, breakdown = evaluate_rules(txn_dict)
        ml_prob, model_available = ml_service.predict_probability(txn_dict)
        analysis_mode = "HYBRID" if model_available else "RULE_FALLBACK"

        (
            hybrid_score,
            ml_risk_score,
            risk_level,
            decision,
            confidence,
            recommended_action,
            uncertainty_detected,
            disagreement_note,
            safety_dict
        ) = fuse_risk_and_decide(rule_score, ml_prob, txn_dict)

        txn_counter += 1
        txn_id = f"RG-2026-{txn_counter:06d}"

        formatted_explanations = [
            ExplanationItem(title=e["title"], points=e["points"], detail=e["detail"])
            for e in explanations
        ]

        if model_available and ml_prob is not None:
            pct = round(ml_prob * 100)
            formatted_explanations.append(
                ExplanationItem(
                    title="Machine Learning Model Insight",
                    points=pct,
                    detail=f"Scikit-Learn Classifier evaluated a {pct}% fraud probability based on feature correlations."
                )
            )
        elif not model_available:
            formatted_explanations.append(
                ExplanationItem(
                    title="Model Failure Fallback Active",
                    points=0,
                    detail="ML inference unavailable. Deterministic risk controls were used as a safe fallback."
                )
            )

        formatted_breakdown = [
            BreakdownItem(name=b["name"], points=b["points"])
            for b in breakdown
        ]

        # Save risk baseline record to SQLite repository
        payment_repository.upsert_payment({
            "riskguard_transaction_id": txn_id,
            "amount": txn.amount,
            "currency": "INR",
            "risk_score": hybrid_score,
            "risk_level": risk_level,
            "risk_decision": decision,
            "analysis_mode": analysis_mode,
            "payment_status": "ANALYZED",
            "signature_verified": False
        })

        return RiskAnalysisResponse(
            transaction_id=txn_id,
            rule_score=rule_score,
            ml_probability=round(ml_prob, 4) if ml_prob is not None else None,
            ml_risk_score=ml_risk_score,
            hybrid_score=hybrid_score,
            risk_level=risk_level,
            decision=decision,
            confidence=confidence,
            recommended_action=recommended_action,
            signals=signals,
            explanations=formatted_explanations,
            rule_breakdown=formatted_breakdown,
            model_available=model_available,
            analysis_mode=analysis_mode,
            uncertainty_detected=uncertainty_detected,
            disagreement_note=disagreement_note,
            safety=SafetyInfo(
                human_review_recommended=safety_dict["human_review_recommended"],
                irreversible_auto_decline=safety_dict["irreversible_auto_decline"]
            )
        )

    except Exception as e:
        logger.error(f"Error analyzing transaction: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An error occurred while evaluating transaction risk."
        )

# --------------------------------------------------------------------------
# RAZORPAY TEST MODE PAYMENT ENDPOINTS
# --------------------------------------------------------------------------

@app.post("/api/payments/create-order", response_model=CreateOrderResponse, tags=["Payment Integration"])
def create_razorpay_order(req: CreateOrderRequest):
    """
    Creates a Razorpay Order server-side. Converts rupees to paise.
    """
    if req.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be greater than 0 rupees.")

    try:
        order_info, success = payment_service.create_order(
            amount_rupees=req.amount,
            currency=req.currency,
            receipt=f"riskguard_{req.risk_transaction_id}",
            notes={"riskguard_transaction_id": req.risk_transaction_id}
        )

        # Update SQLite correlation record
        payment_repository.upsert_payment({
            "riskguard_transaction_id": req.risk_transaction_id,
            "razorpay_order_id": order_info["razorpay_order_id"],
            "amount": req.amount,
            "currency": req.currency,
            "payment_status": "ORDER_CREATED"
        })

        return CreateOrderResponse(
            success=True,
            mode=payment_service.mode,
            razorpay_key_id=order_info["razorpay_key_id"],
            razorpay_order_id=order_info["razorpay_order_id"],
            amount=order_info["amount_paise"],
            amount_rupees=req.amount,
            currency=req.currency,
            risk_transaction_id=req.risk_transaction_id
        )
    except Exception as e:
        logger.error(f"Error creating order: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to create Razorpay Order: {str(e)}")

@app.post("/api/payments/verify", response_model=VerifyPaymentResponse, tags=["Payment Integration"])
def verify_payment(req: VerifyPaymentRequest):
    """
    Verifies Razorpay Checkout signature server-side using HMAC SHA256 (order_id|payment_id).
    """
    is_valid = payment_service.verify_checkout_signature(
        razorpay_order_id=req.razorpay_order_id,
        razorpay_payment_id=req.razorpay_payment_id,
        razorpay_signature=req.razorpay_signature
    )

    if not is_valid:
        logger.warning(f"Signature verification failed for payment {req.razorpay_payment_id}")
        return VerifyPaymentResponse(
            verified=False,
            payment_id=req.razorpay_payment_id,
            order_id=req.razorpay_order_id,
            risk_transaction_id=req.risk_transaction_id,
            verification_source="checkout_signature"
        )

    # Update SQLite record to SIGNATURE_VERIFIED
    payment_repository.update_payment_status(
        order_id=req.razorpay_order_id,
        new_status="SIGNATURE_VERIFIED",
        payment_id=req.razorpay_payment_id
    )

    return VerifyPaymentResponse(
        verified=True,
        payment_id=req.razorpay_payment_id,
        order_id=req.razorpay_order_id,
        risk_transaction_id=req.risk_transaction_id,
        verification_source="checkout_signature"
    )

@app.get("/api/payments/status/{risk_transaction_id}", response_model=PaymentStatusResponse, tags=["Payment Integration"])
def get_payment_status(risk_transaction_id: str):
    """Returns current payment verification status and audit state from SQLite."""
    record = payment_repository.get_payment_by_risk_id(risk_transaction_id)
    if not record:
        raise HTTPException(status_code=404, detail="Risk transaction payment record not found.")

    return PaymentStatusResponse(
        risk_transaction_id=record["riskguard_transaction_id"],
        order_id=record.get("razorpay_order_id"),
        payment_id=record.get("razorpay_payment_id"),
        payment_status=record.get("payment_status", "NOT_STARTED"),
        signature_verified=bool(record.get("signature_verified")),
        risk_level=record.get("risk_level"),
        risk_decision=record.get("risk_decision"),
        analysis_mode=record.get("analysis_mode"),
        last_webhook_event=record.get("last_webhook_event"),
        last_updated=record.get("updated_at")
    )

# --------------------------------------------------------------------------
# WEBHOOK PROCESSING ENDPOINT (Cryptographic RAW Body Signature & Idempotency)
# --------------------------------------------------------------------------

@app.post("/api/webhooks/razorpay", tags=["Webhooks"])
async def razorpay_webhook_handler(
    request: Request,
    x_razorpay_signature: Optional[str] = Header(None),
    x_razorpay_event_id: Optional[str] = Header(None)
):
    """
    Asynchronous Razorpay Webhook Handler.
    Verifies signature using RAW HTTP request body bytes.
    Enforces idempotency and status hierarchy.
    """
    raw_body = await request.body()

    if not x_razorpay_signature:
        raise HTTPException(status_code=400, detail="Missing X-Razorpay-Signature header.")

    # Cryptographic Signature Verification using RAW bytes
    is_valid = payment_service.verify_webhook_signature(raw_body, x_razorpay_signature)
    if not is_valid:
        logger.warning("Razorpay Webhook signature verification failed.")
        raise HTTPException(status_code=400, detail="Invalid webhook signature.")

    # Check Webhook Event Idempotency
    if x_razorpay_event_id and payment_repository.is_webhook_event_processed(x_razorpay_event_id):
        logger.info(f"Webhook event {x_razorpay_event_id} already processed. Skipping.")
        return {"status": "ok", "message": "Event already processed (idempotent)"}

    try:
        event_data = json.loads(raw_body.decode('utf-8'))
        event_type = event_data.get("event")
        payload = event_data.get("payload", {})

        payment_obj = payload.get("payment", {}).get("entity", {})
        order_obj = payload.get("order", {}).get("entity", {})

        payment_id = payment_obj.get("id")
        order_id = payment_obj.get("order_id") or order_obj.get("id")

        if order_id:
            if event_type == "payment.authorized":
                payment_repository.update_payment_status(order_id, "AUTHORIZED", payment_id, webhook_event=event_type)
            elif event_type in ["payment.captured", "order.paid"]:
                payment_repository.update_payment_status(order_id, "CAPTURED", payment_id, webhook_event=event_type)
            elif event_type == "payment.failed":
                payment_repository.update_payment_status(order_id, "FAILED", payment_id, webhook_event=event_type)

        if x_razorpay_event_id:
            payment_repository.record_webhook_event(x_razorpay_event_id, event_type, payment_id, order_id)

        return {"status": "ok", "event": event_type}

    except Exception as e:
        logger.error(f"Error processing webhook payload: {e}")
        raise HTTPException(status_code=400, detail="Malformed JSON webhook body.")

# --------------------------------------------------------------------------
# EXCEPTION HANDLERS
# --------------------------------------------------------------------------

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "error": "Unprocessable Entity",
            "message": "Invalid payload parameters.",
            "details": exc.errors()
        }
    )
