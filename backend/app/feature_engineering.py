import pandas as pd
from typing import Dict, Any

def prepare_features(txn: Dict[str, Any]) -> pd.DataFrame:
    """
    Transforms transaction dict into single-row DataFrame matching model pipeline columns.
    """
    data = {
        'amount': [float(txn.get('amount', 0))],
        'payment_method': [str(txn.get('payment_method', 'Credit Card'))],
        'customer_type': [str(txn.get('customer_type', 'New Customer'))],
        'device_status': [str(txn.get('device_status', 'New Device'))],
        'velocity': [str(txn.get('velocity', 'Normal'))],
        'location_behaviour': [str(txn.get('location_behaviour', 'Normal Location'))],
        'ip_reputation': [str(txn.get('ip_reputation', 'Unknown'))],
        'previous_chargebacks': [int(txn.get('previous_chargebacks', 0))],
        'failed_attempts': [int(txn.get('failed_attempts', 0))],
        'merchant_category': [str(txn.get('merchant_category', 'Electronics'))]
    }
    return pd.DataFrame(data)
