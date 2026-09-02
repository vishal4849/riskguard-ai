import os
import joblib
import logging
from typing import Dict, Any, Tuple, Optional
from app.feature_engineering import prepare_features

logger = logging.getLogger("riskguard.ml_service")

class MLService:
    def __init__(self, model_path: Optional[str] = None):
        if model_path is None:
            base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            model_path = os.path.join(base_dir, 'models', 'riskguard_fraud_model.joblib')

        self.model_path = model_path
        self.model = None
        self.model_loaded = False
        self.load_model()

    def load_model(self) -> bool:
        """Loads joblib model artifact into memory once at startup."""
        if not os.path.exists(self.model_path):
            logging.warning(f"ML model artifact not found at {self.model_path}. Operating in Rule Fallback mode.")
            self.model = None
            self.model_loaded = False
            return False
        try:
            self.model = joblib.load(self.model_path)
            self.model_loaded = True
            logging.info(f"Successfully loaded RiskGuard ML model from {self.model_path}")
            return True
        except Exception as e:
            logging.error(f"Failed to load ML model artifact: {e}")
            self.model = None
            self.model_loaded = False
            return False

    def predict_probability(self, txn: Dict[str, Any]) -> Tuple[Optional[float], bool]:
        """
        Runs ML model inference on single transaction.
        Returns: (probability float [0.0 - 1.0], is_success bool)
        """
        if not self.model_loaded or self.model is None:
            return None, False

        try:
            df_features = prepare_features(txn)
            prob_array = self.model.predict_proba(df_features)
            fraud_prob = float(prob_array[0, 1])
            fraud_prob = max(0.0, min(1.0, fraud_prob))
            return fraud_prob, True
        except Exception as e:
            logging.error(f"ML inference failure: {e}")
            return None, False

    def model_health(self) -> Dict[str, Any]:
        return {
            "model_loaded": self.model_loaded,
            "model_path": self.model_path
        }

# Singleton instance
ml_service = MLService()
