# RiskGuard AI — Hybrid Risk Intelligence & Razorpay Test Payment Integration

RiskGuard AI is a hybrid risk intelligence platform designed for payment gateways and online merchants. It combines deterministic risk controls with machine-learning fraud classifiers to evaluate transactions in real time and orchestrates **Razorpay Standard Checkout in TEST MODE** without processing real money.

> [!IMPORTANT]
> **Razorpay Test Mode & Model Disclaimer Notice**:
> - This integration operates strictly in Razorpay TEST MODE (`RAZORPAY_MODE=test`). It processes simulated transactions and does not charge real money. API Key Secrets and Webhook Secrets are handled exclusively server-side in Python (`backend/app/payment_service.py`) and are NEVER exposed to the frontend browser.
> - The ML model is trained on synthetic demonstration data for prototype validation and is not intended for production payment decisions.
> - The dataset `backend/data/synthetic_transactions.csv` can be regenerated using `python backend/ml/train_model.py`.

---

## End-to-End System Architecture

```
Frontend (Vite / JS - localhost:3001)
  │
  ├──► 1. Risk Analysis Request (POST /api/risk/analyze)
  │      ├──► Deterministic Rule Engine (10 Parameter Vectors)
  │      ├──► Scikit-Learn Model Inference (joblib Pipeline)
  │      └──► Hybrid Risk Fusion & Decision Output
  │
  ├──► 2. Razorpay Order Creation (POST /api/payments/create-order)
  │      └──► Backend converts Rupees -> Paise & calls Razorpay Orders API
  │
  ├──► 3. Razorpay Standard Checkout (checkout.js Test Modal)
  │      └──► Customer completes simulated test payment
  │
  ├──► 4. Client Payment Handler -> Server Verification (POST /api/payments/verify)
  │      └──► Backend verifies Checkout Signature via HMAC SHA256 (order_id|payment_id)
  │
  └──► 5. Async Webhook Event Processing (POST /api/webhooks/razorpay)
         ├──► Cryptographic Signature Verification using RAW HTTP Request Body
         ├──► Idempotency Filter (X-Razorpay-Event-Id deduplication)
         └──► Status Priority Guardrail (ORDER_CREATED < VERIFIED < AUTHORIZED < CAPTURED)
```

---

## Directory Structure

```
ai-risk-manager-bg/
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py                    # FastAPI app & all API routes
│   │   ├── schemas.py                 # Pydantic models for Risk & Payments
│   │   ├── risk_engine.py             # Deterministic rule engine
│   │   ├── ml_service.py              # ML model inference singleton
│   │   ├── feature_engineering.py     # Feature vector transformer
│   │   ├── decision_engine.py         # Hybrid risk fusion & safety layer
│   │   ├── payment_service.py         # Razorpay Python SDK & HMAC verification
│   │   ├── payment_repository.py      # SQLite persistence & idempotency manager
│   │   └── database.py                # SQLite connection manager (riskguard.db)
│   ├── ml/
│   │   └── train_model.py             # Synthetic training dataset & ML pipeline
│   ├── models/
│   │   ├── riskguard_fraud_model.joblib # Trained Scikit-Learn model pipeline
│   │   └── model_metadata.json        # Model metadata & evaluation metrics
│   ├── data/
│   │   ├── synthetic_transactions.csv # Synthetic training dataset (20k rows)
│   │   └── riskguard.db               # SQLite database for payment correlations
│   ├── tests/
│   │   └── test_webhook_signature.py  # Local RAW body HMAC webhook verification test
│   ├── .env                           # Local test mode environment variables
│   ├── .env.example                   # Environment configuration template
│   └── requirements.txt               # Backend dependencies (fastapi, razorpay, etc.)
├── index.html                         # Enterprise Fintech UI with Razorpay Checkout Action
├── styles.css                         # Dark Crimson 3D Grid & Payment Status styles
├── main.js                            # Async API client & Razorpay Checkout handler
├── vite.config.js                     # Vite dev server configuration (port 3001)
├── package.json
└── README.md
```

---

## API Endpoints Reference

### 1. Health & Config Checks
- `GET /health`: Returns service status, ML model loaded status, and Razorpay configuration state.
- `GET /api/payments/config`: Returns non-sensitive public info (`configured: true`, `mode: "test"`, `key_id: "rzp_test_..."`).

### 2. Hybrid Risk Analysis
- `POST /api/risk/analyze`: Evaluates 10 transaction parameters using Rule Engine + Scikit-Learn Model and returns Hybrid Score, Risk Level, and Decision.

### 3. Razorpay Order Creation
- `POST /api/payments/create-order`:
  ```json
  // Request
  {
    "risk_transaction_id": "RG-2026-000186",
    "amount": 48500,
    "currency": "INR"
  }
  // Response (Amount automatically converted to paise: 4,850,000)
  {
    "success": true,
    "mode": "test",
    "razorpay_key_id": "rzp_test_...",
    "razorpay_order_id": "order_test_...",
    "amount": 4850000,
    "amount_rupees": 48500.0,
    "currency": "INR",
    "risk_transaction_id": "RG-2026-000186"
  }
  ```

### 4. Server-Side Signature Verification
- `POST /api/payments/verify`:
  Verifies `order_id|payment_id` signature via HMAC SHA256 using `RAZORPAY_KEY_SECRET`.
  ```json
  // Request
  {
    "risk_transaction_id": "RG-2026-000186",
    "razorpay_payment_id": "pay_test_...",
    "razorpay_order_id": "order_test_...",
    "razorpay_signature": "..."
  }
  // Response
  {
    "verified": true,
    "payment_id": "pay_test_...",
    "order_id": "order_test_...",
    "risk_transaction_id": "RG-2026-000186",
    "verification_source": "checkout_signature"
  }
  ```

### 5. Webhook Event Processing
- `POST /api/webhooks/razorpay`:
  Verifies `X-Razorpay-Signature` using **RAW HTTP request body bytes** against `RAZORPAY_WEBHOOK_SECRET`. Enforces idempotency via `X-Razorpay-Event-Id` and updates status in SQLite (`payment.authorized`, `payment.captured`, `payment.failed`, `order.paid`).

### 6. Payment Status Correlation
- `GET /api/payments/status/{risk_transaction_id}`:
  Returns current payment verification state and audit details.

---

## Running the Application

### 1. Environment Configuration
Create `backend/.env` based on `backend/.env.example`:
```env
RAZORPAY_KEY_ID=rzp_test_YOUR_KEY_ID
RAZORPAY_KEY_SECRET=YOUR_KEY_SECRET
RAZORPAY_WEBHOOK_SECRET=YOUR_WEBHOOK_SECRET
RAZORPAY_MODE=test
FRONTEND_URL=http://localhost:3001
BACKEND_URL=http://localhost:8000
PUBLIC_BACKEND_URL=
```

### 2. Start FastAPI Backend (Port 8000)
```bash
cd backend
python -m uvicorn app.main:app --reload --port 8000
```

### 3. Start Frontend Dev Server (Port 3001)
```bash
npm run dev
```
Open `http://localhost:3001/` in your browser.

---

## Local Webhook Signature Verification Test
Run the automated local test script to verify cryptographic RAW body HMAC SHA256 signature verification and idempotency handling:
```bash
python backend/tests/test_webhook_signature.py
```

---

## Security Guidelines

1. **Secrets Protection**: Never commit or expose `RAZORPAY_KEY_SECRET` or `RAZORPAY_WEBHOOK_SECRET` in frontend JavaScript.
2. **Server-Side Verification**: Signature verification is strictly enforced on the backend before marking payments as verified.
3. **RAW Body Webhook Verification**: Webhook signatures are calculated directly from raw request bytes to prevent JSON re-serialization hash mismatches.
4. **Idempotency**: Duplicate webhook event deliveries (`X-Razorpay-Event-Id`) return HTTP 200 without duplicating database records.
5. **Status Hierarchy**: Protects payment records from out-of-order status downgrades (e.g. `CAPTURED` will not be overwritten by delayed `AUTHORIZED` events).

---

## Author & Project Attribution

**RiskGuard AI** • Developed by **Vishal Jagtap**
