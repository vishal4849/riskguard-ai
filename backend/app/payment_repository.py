from datetime import datetime
from typing import Dict, Any, Optional
from app.database import get_db_connection

# Status Priority Hierarchy to prevent out-of-order status downgrade
STATUS_PRIORITY = {
    'ORDER_CREATED': 1,
    'CHECKOUT_COMPLETED': 2,
    'SIGNATURE_VERIFIED': 3,
    'AUTHORIZED': 4,
    'CAPTURED': 5,
    'FAILED': 99
}

def upsert_payment(record: Dict[str, Any]):
    conn = get_db_connection()
    cursor = conn.cursor()
    now = datetime.utcnow().isoformat()

    cursor.execute("SELECT payment_status FROM payments WHERE riskguard_transaction_id = ?", (record['riskguard_transaction_id'],))
    row = cursor.fetchone()

    if row is None:
        cursor.execute("""
        INSERT INTO payments (
            riskguard_transaction_id, razorpay_order_id, razorpay_payment_id,
            amount, currency, risk_score, risk_level, risk_decision,
            analysis_mode, payment_status, signature_verified,
            created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
        """, (
            record['riskguard_transaction_id'],
            record.get('razorpay_order_id'),
            record.get('razorpay_payment_id'),
            record['amount'],
            record.get('currency', 'INR'),
            record.get('risk_score'),
            record.get('risk_level'),
            record.get('risk_decision'),
            record.get('analysis_mode'),
            record.get('payment_status', 'ORDER_CREATED'),
            1 if record.get('signature_verified') else 0,
            now,
            now
        ))
    else:
        cursor.execute("""
        UPDATE payments SET
            razorpay_order_id = COALESCE(?, razorpay_order_id),
            razorpay_payment_id = COALESCE(?, razorpay_payment_id),
            payment_status = COALESCE(?, payment_status),
            signature_verified = CASE WHEN ? = 1 THEN 1 ELSE signature_verified END,
            updated_at = ?
        WHERE riskguard_transaction_id = ?;
        """, (
            record.get('razorpay_order_id'),
            record.get('razorpay_payment_id'),
            record.get('payment_status'),
            1 if record.get('signature_verified') else 0,
            now,
            record['riskguard_transaction_id']
        ))

    conn.commit()
    conn.close()

def get_payment_by_risk_id(risk_id: str) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM payments WHERE riskguard_transaction_id = ?", (risk_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None

def get_payment_by_order_id(order_id: str) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM payments WHERE razorpay_order_id = ?", (order_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None

def update_payment_status(
    order_id: str,
    new_status: str,
    payment_id: Optional[str] = None,
    webhook_event: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    now = datetime.utcnow().isoformat()

    cursor.execute("SELECT * FROM payments WHERE razorpay_order_id = ?", (order_id,))
    row = cursor.fetchone()

    if not row:
        conn.close()
        return None

    current_status = row['payment_status']
    current_prio = STATUS_PRIORITY.get(current_status, 0)
    new_prio = STATUS_PRIORITY.get(new_status, 0)

    # Protect status from downgrading (e.g. CAPTURED -> AUTHORIZED)
    final_status = new_status if (new_prio >= current_prio or new_status == 'FAILED') else current_status
    sig_verified = 1 if (row['signature_verified'] == 1 or new_status in ['SIGNATURE_VERIFIED', 'AUTHORIZED', 'CAPTURED']) else 0

    cursor.execute("""
    UPDATE payments SET
        payment_status = ?,
        razorpay_payment_id = COALESCE(?, razorpay_payment_id),
        signature_verified = ?,
        last_webhook_event = COALESCE(?, last_webhook_event),
        last_webhook_at = CASE WHEN ? IS NOT NULL THEN ? ELSE last_webhook_at END,
        updated_at = ?
    WHERE razorpay_order_id = ?;
    """, (
        final_status,
        payment_id,
        sig_verified,
        webhook_event,
        webhook_event,
        now,
        now,
        order_id
    ))

    conn.commit()
    cursor.execute("SELECT * FROM payments WHERE razorpay_order_id = ?", (order_id,))
    updated_row = dict(cursor.fetchone())
    conn.close()
    return updated_row

def is_webhook_event_processed(event_id: str) -> bool:
    if not event_id:
        return False
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT event_id FROM webhook_events WHERE event_id = ?", (event_id,))
    row = cursor.fetchone()
    conn.close()
    return row is not None

def record_webhook_event(event_id: str, event_type: str, payment_id: Optional[str], order_id: Optional[str]):
    if not event_id:
        return
    conn = get_db_connection()
    cursor = conn.cursor()
    now = datetime.utcnow().isoformat()
    try:
        cursor.execute("""
        INSERT INTO webhook_events (event_id, event_type, razorpay_payment_id, razorpay_order_id, received_at, processed_at)
        VALUES (?, ?, ?, ?, ?, ?);
        """, (event_id, event_type, payment_id, order_id, now, now))
        conn.commit()
    except Exception:
        pass
    finally:
        conn.close()

def get_payment_metrics() -> Dict[str, int]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT
        COUNT(*) as total_started,
        SUM(CASE WHEN signature_verified = 1 THEN 1 ELSE 0 END) as verified_count,
        SUM(CASE WHEN payment_status = 'CAPTURED' THEN 1 ELSE 0 END) as captured_count,
        SUM(CASE WHEN payment_status = 'FAILED' THEN 1 ELSE 0 END) as failed_count,
        SUM(CASE WHEN risk_level IN ('HIGH RISK', 'CRITICAL RISK') THEN 1 ELSE 0 END) as high_risk_sent
    FROM payments;
    """)
    row = cursor.fetchone()
    conn.close()

    if not row:
        return {"total_started": 0, "verified_count": 0, "captured_count": 0, "failed_count": 0, "high_risk_sent": 0}

    return {
        "total_started": row["total_started"] or 0,
        "verified_count": row["verified_count"] or 0,
        "captured_count": row["captured_count"] or 0,
        "failed_count": row["failed_count"] or 0,
        "high_risk_sent": row["high_risk_sent"] or 0
    }
