from typing import Dict, Any, Tuple, Optional

def fuse_risk_and_decide(
    rule_score: int,
    ml_prob: Optional[float],
    txn: Dict[str, Any]
) -> Tuple[int, Optional[int], str, str, float, str, bool, Optional[str], Dict[str, bool]]:
    """
    Hybrid Risk Fusion & Decision Safety Layer.
    Combines rule_score and ML fraud probability with guardrails and disagreement detection.
    """
    model_available = ml_prob is not None
    ml_risk_score = round(ml_prob * 100) if model_available else None

    uncertainty_detected = False
    disagreement_note = None

    if model_available and ml_risk_score is not None:
        # Hybrid Fusion Calculation
        raw_hybrid = 0.45 * rule_score + 0.55 * ml_risk_score
        hybrid_score = round(raw_hybrid)

        # Guardrail: Strong explicit risk signal override
        is_suspicious_device = txn.get("device_status") == "Suspicious Device"
        is_suspicious_ip = txn.get("ip_reputation") == "Suspicious"
        is_high_velocity = txn.get("velocity") == "High-frequency attempts"

        if is_suspicious_device and is_suspicious_ip and is_high_velocity:
            hybrid_score = max(hybrid_score, rule_score, 80)

        # Disagreement Detection
        score_diff = abs(rule_score - ml_risk_score)
        if score_diff >= 30:
            uncertainty_detected = True
            disagreement_note = "The machine-learning model and deterministic risk engine disagree significantly. The transaction has been routed to additional verification."
    else:
        hybrid_score = rule_score

    hybrid_score = min(max(hybrid_score, 0), 100)

    # Risk Level Classification
    if hybrid_score >= 80:
        risk_level = "CRITICAL RISK"
        decision = "STEP-UP VERIFICATION"
    elif hybrid_score >= 60:
        risk_level = "HIGH RISK"
        decision = "MANUAL REVIEW"
    elif hybrid_score >= 30:
        risk_level = "MEDIUM RISK"
        decision = "APPROVE WITH MONITORING"
    else:
        risk_level = "LOW RISK"
        decision = "APPROVE"

    # Recommended Action
    if hybrid_score >= 95:
        recommended_action = "Temporarily Hold Payment"
    elif hybrid_score >= 80:
        recommended_action = "Request OTP / Step-Up Verification"
    elif hybrid_score >= 60:
        recommended_action = "Send to Human Review"
    elif hybrid_score >= 30:
        recommended_action = "Monitor Transaction"
    else:
        recommended_action = "Approve Payment"

    # Confidence Rating
    if hybrid_score >= 80:
        confidence = round(0.91 + min((hybrid_score - 80) / 300, 0.07), 2)
    elif hybrid_score >= 60:
        confidence = round(0.88 + min((hybrid_score - 60) / 250, 0.08), 2)
    elif hybrid_score >= 30:
        confidence = round(0.82 + min((hybrid_score - 30) / 300, 0.10), 2)
    else:
        confidence = 0.92

    safety = {
        "human_review_recommended": hybrid_score >= 60,
        "irreversible_auto_decline": False
    }

    return (
        hybrid_score,
        ml_risk_score,
        risk_level,
        decision,
        confidence,
        recommended_action,
        uncertainty_detected,
        disagreement_note,
        safety
    )
