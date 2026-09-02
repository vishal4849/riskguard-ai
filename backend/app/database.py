import os
import sqlite3
import logging
from typing import Optional

logger = logging.getLogger("riskguard.database")

DB_PATH = os.getenv(
    "DATABASE_PATH",
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "riskguard.db")
)

def get_db_connection():
    db_dir = os.path.dirname(DB_PATH)
    if db_dir:
        os.makedirs(db_dir, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()

    # Payments Correlation Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS payments (
        riskguard_transaction_id TEXT PRIMARY KEY,
        razorpay_order_id TEXT,
        razorpay_payment_id TEXT,
        amount REAL NOT NULL,
        currency TEXT DEFAULT 'INR',
        risk_score INTEGER,
        risk_level TEXT,
        risk_decision TEXT,
        analysis_mode TEXT,
        payment_status TEXT DEFAULT 'ORDER_CREATED',
        signature_verified INTEGER DEFAULT 0,
        last_webhook_event TEXT,
        last_webhook_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    """)

    # Webhook Idempotency Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS webhook_events (
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        razorpay_payment_id TEXT,
        razorpay_order_id TEXT,
        received_at TEXT NOT NULL,
        processed_at TEXT NOT NULL
    );
    """)

    conn.commit()
    conn.close()
    logger.info(f"SQLite database initialized at {DB_PATH}")

# Initialize database schema at module load time
init_db()
