from typing import Dict, Any, List, Tuple

def evaluate_rules(txn: Dict[str, Any]) -> Tuple[int, List[str], List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Deterministic rule scoring engine matching the frontend risk engine logic.
    Base Risk = 10
    Max Score = 100
    Returns: (rule_score, signals, explanations, breakdown)
    """
    score = 10
    breakdown = [{"name": "Base Risk", "points": 10}]
    signals = []
    explanations = []

    # 1. Amount
    amount = float(txn.get("amount", 0))
    if amount > 50000:
        score += 15
        signals.append("High-value transaction")
        explanations.append({
            "title": "Transaction Amount",
            "points": 15,
            "detail": f"Payment value ₹{amount:,.0f} exceeds ₹50,000 threshold."
        })
        breakdown.append({"name": "Transaction Amount (>₹50,000)", "points": 15})
    elif amount > 20000:
        score += 10
        signals.append("High-value transaction")
        explanations.append({
            "title": "Transaction Amount",
            "points": 10,
            "detail": f"Payment value ₹{amount:,.0f} falls in the ₹20,001–₹50,000 risk band."
        })
        breakdown.append({"name": "Transaction Amount (₹20k–₹50k)", "points": 10})
    elif amount > 5000:
        score += 5
        signals.append("Moderate-value transaction")
        explanations.append({
            "title": "Transaction Amount",
            "points": 5,
            "detail": f"Payment value ₹{amount:,.0f} falls in the ₹5,001–₹20,000 risk band."
        })
        breakdown.append({"name": "Transaction Amount (₹5k–₹20k)", "points": 5})

    # 2. Customer Type
    customer_type = str(txn.get("customer_type", ""))
    if customer_type == "New Customer":
        score += 8
        signals.append("New customer")
        explanations.append({
            "title": "Customer Type",
            "points": 8,
            "detail": "Account has no established payment history."
        })
        breakdown.append({"name": "New Customer", "points": 8})

    # 3. Device Status
    device_status = str(txn.get("device_status", ""))
    if device_status == "Suspicious Device":
        score += 22
        signals.append("Suspicious device detected")
        explanations.append({
            "title": "Suspicious Device",
            "points": 22,
            "detail": "Hardware fingerprint matches previously flagged fraudulent devices."
        })
        breakdown.append({"name": "Suspicious Device", "points": 22})
    elif device_status == "New Device":
        score += 12
        signals.append("New device detected")
        explanations.append({
            "title": "New Device",
            "points": 12,
            "detail": "Device has not previously been associated with this customer."
        })
        breakdown.append({"name": "New Device", "points": 12})

    # 4. Velocity
    velocity = str(txn.get("velocity", ""))
    if velocity == "High-frequency attempts":
        score += 25
        signals.append("High-frequency payment attempts")
        explanations.append({
            "title": "Transaction Velocity",
            "points": 25,
            "detail": "Rapid burst payment attempts detected within a very short timeframe."
        })
        breakdown.append({"name": "High-Frequency Attempts", "points": 25})
    elif velocity == "Multiple payments in 10 minutes":
        score += 15
        signals.append("Unusual transaction velocity")
        explanations.append({
            "title": "Transaction Velocity",
            "points": 15,
            "detail": "Multiple payment attempts occurred within a short 10-minute window."
        })
        breakdown.append({"name": "Transaction Velocity (10m)", "points": 15})

    # 5. Location
    loc = str(txn.get("location_behaviour", txn.get("location", "")))
    if loc == "Location Mismatch":
        score += 18
        signals.append("Location mismatch")
        explanations.append({
            "title": "Location Mismatch",
            "points": 18,
            "detail": "Current transaction location differs from expected customer behaviour."
        })
        breakdown.append({"name": "Location Mismatch", "points": 18})
    elif loc == "New Location":
        score += 8
        signals.append("New transaction location")
        explanations.append({
            "title": "New Location",
            "points": 8,
            "detail": "Payment initiated from a geographic region not seen on this account."
        })
        breakdown.append({"name": "New Transaction Location", "points": 8})

    # 6. IP Reputation
    ip_rep = str(txn.get("ip_reputation", ""))
    if ip_rep == "Suspicious":
        score += 20
        signals.append("Suspicious IP reputation")
        explanations.append({
            "title": "Suspicious IP Reputation",
            "points": 20,
            "detail": "IP address is associated with proxy, VPN, or known malicious subnets."
        })
        breakdown.append({"name": "Suspicious IP Reputation", "points": 20})
    elif ip_rep == "Unknown":
        score += 5
        signals.append("Unknown IP reputation")
        explanations.append({
            "title": "Unknown IP Reputation",
            "points": 5,
            "detail": "Subnet reputation is unverified across global threat databases."
        })
        breakdown.append({"name": "Unknown IP Reputation", "points": 5})

    # 7. Previous Chargebacks (max 3 -> +21)
    cbs = min(int(txn.get("previous_chargebacks", 0)), 3)
    if cbs > 0:
        cb_pts = cbs * 7
        score += cb_pts
        signals.append("Previous chargeback history")
        explanations.append({
            "title": "Chargeback History",
            "points": cb_pts,
            "detail": f"Customer profile has {cbs} recorded payment dispute{'s' if cbs > 1 else ''}."
        })
        breakdown.append({"name": f"Chargeback History ({cbs})", "points": cb_pts})

    # 8. Failed Payment Attempts (max 5 -> +20)
    fails = min(int(txn.get("failed_attempts", 0)), 5)
    if fails > 0:
        fail_pts = fails * 4
        score += fail_pts
        signals.append("Multiple failed payment attempts")
        explanations.append({
            "title": "Failed Payment Attempts",
            "points": fail_pts,
            "detail": f"{fails} recent payment attempt{'s' if fails > 1 else ''} failed prior to this transaction."
        })
        breakdown.append({"name": f"Failed Attempts ({fails})", "points": fail_pts})

    # 9. Merchant Category
    cat = str(txn.get("merchant_category", ""))
    cat_pts = 0
    if cat == "Gaming":
        cat_pts = 7
        signals.append("High-risk merchant category")
        explanations.append({
            "title": "Merchant Category",
            "points": 7,
            "detail": "Gaming merchant category carries elevated digital liquidity risk."
        })
    elif cat in ["Electronics", "Digital Services"]:
        cat_pts = 5
        signals.append("High-risk merchant category")
        explanations.append({
            "title": "Merchant Category",
            "points": 5,
            "detail": f"{cat} merchant category carries high resale liquidity."
        })
    elif cat == "Travel":
        cat_pts = 4
        signals.append("High-risk merchant category")
        explanations.append({
            "title": "Merchant Category",
            "points": 4,
            "detail": "Travel category carries high ticket size cancellation risk."
        })
    elif cat in ["E-commerce", "Fashion"]:
        cat_pts = 2
    elif cat == "Other":
        cat_pts = 1

    if cat_pts > 0:
        score += cat_pts
        breakdown.append({"name": f"Merchant Category ({cat})", "points": cat_pts})

    final_rule_score = min(max(score, 0), 100)
    return final_rule_score, signals, explanations, breakdown
