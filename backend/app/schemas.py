from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any

class TransactionInput(BaseModel):
    amount: float = Field(..., gt=0, description="Transaction amount in INR, must be greater than 0")
    payment_method: str = Field(..., description="Payment method (e.g. UPI, Credit Card, Debit Card, Net Banking, Wallet)")
    customer_type: str = Field(..., description="Customer type (e.g. Existing Customer, New Customer)")
    device_status: str = Field(..., description="Device status (e.g. Trusted Device, New Device, Suspicious Device)")
    velocity: str = Field(..., description="Transaction velocity (e.g. Normal, Multiple payments in 10 minutes, High-frequency attempts)")
    location_behaviour: str = Field(..., description="Location behaviour (e.g. Normal Location, New Location, Location Mismatch)")
    ip_reputation: str = Field(..., description="IP reputation (e.g. Trusted, Unknown, Suspicious)")
    previous_chargebacks: int = Field(0, ge=0, description="Number of previous chargebacks (>= 0)")
    failed_attempts: int = Field(0, ge=0, description="Number of recent failed payment attempts (>= 0)")
    merchant_category: str = Field(..., description="Merchant category (e.g. Electronics, E-commerce, Travel, Gaming)")

class ExplanationItem(BaseModel):
    title: str
    points: int
    detail: str

class BreakdownItem(BaseModel):
    name: str
    points: int

class SafetyInfo(BaseModel):
    human_review_recommended: bool
    irreversible_auto_decline: bool = False

class RiskAnalysisResponse(BaseModel):
    transaction_id: str
    rule_score: int
    ml_probability: Optional[float] = None
    ml_risk_score: Optional[int] = None
    hybrid_score: int
    risk_level: str
    decision: str
    confidence: float
    recommended_action: str
    signals: List[str]
    explanations: List[ExplanationItem]
    rule_breakdown: List[BreakdownItem]
    model_available: bool
    analysis_mode: str  # "HYBRID", "RULE_FALLBACK", "LOCAL_RULE_FALLBACK"
    uncertainty_detected: bool = False
    disagreement_note: Optional[str] = None
    safety: SafetyInfo

# --------------------------------------------------------------------------
# RAZORPAY TEST PAYMENT SCHEMAS
# --------------------------------------------------------------------------

class CreateOrderRequest(BaseModel):
    risk_transaction_id: str = Field(..., description="Correlated RiskGuard transaction ID")
    amount: float = Field(..., gt=0, description="Amount in Rupees")
    currency: str = Field("INR", description="3-letter currency code")

class CreateOrderResponse(BaseModel):
    success: bool
    mode: str = "test"
    razorpay_key_id: str
    razorpay_order_id: str
    amount: int  # Amount in Paise
    amount_rupees: float
    currency: str
    risk_transaction_id: str

class VerifyPaymentRequest(BaseModel):
    risk_transaction_id: str
    razorpay_payment_id: str
    razorpay_order_id: str
    razorpay_signature: str

class VerifyPaymentResponse(BaseModel):
    verified: bool
    payment_id: Optional[str] = None
    order_id: Optional[str] = None
    risk_transaction_id: Optional[str] = None
    verification_source: str = "checkout_signature"

class PaymentStatusResponse(BaseModel):
    risk_transaction_id: str
    order_id: Optional[str] = None
    payment_id: Optional[str] = None
    payment_status: str
    signature_verified: bool
    risk_level: Optional[str] = None
    risk_decision: Optional[str] = None
    analysis_mode: Optional[str] = None
    last_webhook_event: Optional[str] = None
    last_updated: Optional[str] = None
