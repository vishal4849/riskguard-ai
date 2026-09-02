import hmac
import hashlib
import json
import urllib.request
import urllib.error

def run_webhook_tests():
    backend_url = "http://localhost:8000"
    webhook_secret = "demo_webhook_secret_12345"

    print("=== Running Local Webhook Signature & Idempotency Verification Test ===")

    # Test 1: Valid Webhook Signature (RAW Body HMAC SHA256)
    event_id = "evt_test_demo_1001"
    raw_payload_dict = {
        "entity": "event",
        "account_id": "acc_demo123",
        "event": "payment.captured",
        "contains": ["payment"],
        "payload": {
            "payment": {
                "entity": {
                    "id": "pay_demo_test_999",
                    "order_id": "order_test_demo_888",
                    "amount": 4850000,
                    "currency": "INR",
                    "status": "captured"
                }
            }
        }
    }
    raw_body_bytes = json.dumps(raw_payload_dict).encode('utf-8')
    valid_sig = hmac.new(webhook_secret.encode('utf-8'), raw_body_bytes, hashlib.sha256).hexdigest()

    req = urllib.request.Request(
        f"{backend_url}/api/webhooks/razorpay",
        data=raw_body_bytes,
        headers={
            "Content-Type": "application/json",
            "X-Razorpay-Signature": valid_sig,
            "X-Razorpay-Event-Id": event_id
        }
    )

    try:
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            print("1. Valid Signature Test:", resp.status, data)
            assert resp.status == 200 and data.get("status") == "ok"
    except Exception as e:
        print("1. Valid Signature Test FAILED:", e)

    # Test 2: Invalid Webhook Signature (Should fail with 400)
    req_bad = urllib.request.Request(
        f"{backend_url}/api/webhooks/razorpay",
        data=raw_body_bytes,
        headers={
            "Content-Type": "application/json",
            "X-Razorpay-Signature": "invalid_signature_hash_12345",
            "X-Razorpay-Event-Id": "evt_test_demo_1002"
        }
    )
    try:
        with urllib.request.urlopen(req_bad) as resp:
            print("2. Invalid Signature Test (Unexpected Success):", resp.status)
    except urllib.error.HTTPError as e:
        print("2. Invalid Signature Test (Correctly Rejected):", e.code)
        assert e.code == 400

    # Test 3: Duplicate Webhook Event ID (Idempotency)
    req_dup = urllib.request.Request(
        f"{backend_url}/api/webhooks/razorpay",
        data=raw_body_bytes,
        headers={
            "Content-Type": "application/json",
            "X-Razorpay-Signature": valid_sig,
            "X-Razorpay-Event-Id": event_id  # Same event ID as Test 1
        }
    )
    try:
        with urllib.request.urlopen(req_dup) as resp:
            data_dup = json.loads(resp.read().decode('utf-8'))
            print("3. Idempotent Duplicate Event Test:", resp.status, data_dup)
            assert resp.status == 200 and "already processed" in data_dup.get("message", "").lower()
    except Exception as e:
        print("3. Idempotent Duplicate Event Test FAILED:", e)

    print("\nLocal Webhook Signature & Idempotency Tests Complete!")

if __name__ == '__main__':
    run_webhook_tests()
