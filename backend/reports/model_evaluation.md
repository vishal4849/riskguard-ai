# RiskGuard AI — Machine Learning Model Evaluation Report

> [!NOTE]
> **Dataset Type**: Synthetic demonstration data for prototype validation.
> This model is trained on synthetic transaction data with plausible fraud correlations for technical prototype evaluation. It is not real merchant payment data.

## Executive Summary
- **Selected Model Architecture**: Logistic Regression
- **Dataset Size**: 20,000 transactions
- **Target Fraud Prevalence**: 25.16%
- **Train/Test Split**: 80% Train (16,000) / 20% Test (4,000)
- **Random Seed**: 42 (Reproducible)

---

## Candidate Model Performance Comparison

| Model Architecture | ROC-AUC | Recall (Sensitivity) | Precision | F1-Score | Accuracy |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Logistic Regression** | 0.9484 | 0.8867 | 0.6752 | 0.7667 | 0.8642 |
| **Random Forest** | 0.9349 | 0.8141 | 0.6994 | 0.7524 | 0.8652 |

---

## Confusion Matrix (Logistic Regression)

- **True Negatives (TN)**: 2,565 (Legitimate payments correctly approved)
- **False Positives (FP)**: 429 (Legitimate payments routed to step-up verification / review)
- **False Negatives (FN)**: 114 (Suspicious payments that passed ML filter)
- **True Positives (TP)**: 892 (Suspicious payments correctly flagged)

---

## Cost Trade-Off Analysis in Payment Fraud

### False Positive Cost
A false positive occurs when a legitimate customer is flagged by the ML model. Rather than automatically declining the transaction, RiskGuard routes borderline transactions to **Step-Up Verification (OTP)** or **Human Review**. This prevents lost merchant revenue while protecting payment flow.

### False Negative Cost
A false negative occurs when a high-risk transaction bypasses the ML filter. RiskGuard guards against false negatives by running a **Hybrid Fusion Engine** combining deterministic rules with ML inference. If explicit risk signals exist (e.g. Suspicious Device + Location Mismatch), the rule engine overrides low ML scores.

---

## Deployment Artifacts
- **Pipeline Model**: `backend/models/riskguard_fraud_model.joblib`
- **Metadata**: `backend/models/model_metadata.json`
- **Synthetic Data**: `backend/data/synthetic_transactions.csv`
