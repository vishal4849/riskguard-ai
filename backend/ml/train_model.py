import os
import json
import joblib
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.pipeline import Pipeline
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score, precision_score, recall_score, f1_score, roc_auc_score, confusion_matrix
)

# --------------------------------------------------------------------------
# SYNTHETIC DEMONSTRATION DATA GENERATOR
# --------------------------------------------------------------------------

def generate_synthetic_data(num_samples=20000, random_state=42):
    """
    Generates synthetic payment transaction dataset for prototype validation.
    Note: Synthetic demonstration dataset for prototype validation.
    """
    np.random.seed(random_state)

    payment_methods = ['UPI', 'Credit Card', 'Debit Card', 'Net Banking', 'Wallet']
    customer_types = ['Existing Customer', 'New Customer']
    device_statuses = ['Trusted Device', 'New Device', 'Suspicious Device']
    velocities = ['Normal', 'Multiple payments in 10 minutes', 'High-frequency attempts']
    location_behaviours = ['Normal Location', 'New Location', 'Location Mismatch']
    ip_reputations = ['Trusted', 'Unknown', 'Suspicious']
    merchant_categories = ['E-commerce', 'Travel', 'Electronics', 'Food', 'Fashion', 'Gaming', 'Digital Services', 'Other']

    amounts = np.random.exponential(scale=12000, size=num_samples) + 200
    amounts = np.clip(amounts, 100, 150000).round()

    p_methods = np.random.choice(payment_methods, size=num_samples, p=[0.40, 0.30, 0.15, 0.10, 0.05])
    c_types = np.random.choice(customer_types, size=num_samples, p=[0.65, 0.35])
    d_statuses = np.random.choice(device_statuses, size=num_samples, p=[0.70, 0.22, 0.08])
    vels = np.random.choice(velocities, size=num_samples, p=[0.75, 0.18, 0.07])
    locs = np.random.choice(location_behaviours, size=num_samples, p=[0.72, 0.20, 0.08])
    ips = np.random.choice(ip_reputations, size=num_samples, p=[0.68, 0.24, 0.08])
    cbs = np.random.poisson(lam=0.2, size=num_samples).clip(0, 5)
    fails = np.random.poisson(lam=0.4, size=num_samples).clip(0, 8)
    cats = np.random.choice(merchant_categories, size=num_samples, p=[0.30, 0.15, 0.15, 0.15, 0.10, 0.08, 0.05, 0.02])

    df = pd.DataFrame({
        'amount': amounts,
        'payment_method': p_methods,
        'customer_type': c_types,
        'device_status': d_statuses,
        'velocity': vels,
        'location_behaviour': locs,
        'ip_reputation': ips,
        'previous_chargebacks': cbs,
        'failed_attempts': fails,
        'merchant_category': cats
    })

    # Realistic Logit Risk Computation for Fraud Labeling
    logit = -3.5  # Base log-odds (~3% base rate)

    # Feature weights
    logit += (df['amount'] > 50000) * 1.2 + (df['amount'] > 20000) * 0.7
    logit += (df['customer_type'] == 'New Customer') * 0.6
    logit += (df['device_status'] == 'Suspicious Device') * 2.2 + (df['device_status'] == 'New Device') * 1.1
    logit += (df['velocity'] == 'High-frequency attempts') * 2.4 + (df['velocity'] == 'Multiple payments in 10 minutes') * 1.4
    logit += (df['location_behaviour'] == 'Location Mismatch') * 1.8 + (df['location_behaviour'] == 'New Location') * 0.7
    logit += (df['ip_reputation'] == 'Suspicious') * 2.0 + (df['ip_reputation'] == 'Unknown') * 0.5
    logit += df['previous_chargebacks'] * 0.8
    logit += df['failed_attempts'] * 0.4
    logit += (df['merchant_category'].isin(['Gaming', 'Electronics', 'Digital Services'])) * 0.6

    # Interaction effect: New Customer + New Device + Location Mismatch
    combo_risk = (df['customer_type'] == 'New Customer') & (df['device_status'] != 'Trusted Device') & (df['location_behaviour'] == 'Location Mismatch')
    logit += combo_risk * 1.5

    # Add Gaussian Noise for realistic non-perfect decision boundaries
    noise = np.random.normal(0, 0.8, size=num_samples)
    prob = 1 / (1 + np.exp(-(logit + noise)))
    df['fraud_label'] = (prob > 0.45).astype(int)

    return df

# --------------------------------------------------------------------------
# MAIN TRAINING PIPELINE
# --------------------------------------------------------------------------

def run_training():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    models_dir = os.path.join(base_dir, 'models')
    data_dir = os.path.join(base_dir, 'data')
    reports_dir = os.path.join(base_dir, 'reports')

    os.makedirs(models_dir, exist_ok=True)
    os.makedirs(data_dir, exist_ok=True)
    os.makedirs(reports_dir, exist_ok=True)

    print("Generating synthetic demonstration dataset (20,000 transactions)...")
    df = generate_synthetic_data(num_samples=20000, random_state=42)

    data_csv_path = os.path.join(data_dir, 'synthetic_transactions.csv')
    df.to_csv(data_csv_path, index=False)
    print(f"Saved dataset to {data_csv_path}")

    X = df.drop(columns=['fraud_label'])
    y = df['fraud_label']

    fraud_rate = float(y.mean())
    print(f"Dataset fraud rate: {fraud_rate:.2%}")

    # Train / Test Split (Stratified 80/20)
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.20, random_state=42, stratify=y
    )

    categorical_cols = ['payment_method', 'customer_type', 'device_status', 'velocity', 'location_behaviour', 'ip_reputation', 'merchant_category']
    numeric_cols = ['amount', 'previous_chargebacks', 'failed_attempts']

    preprocessor = ColumnTransformer(
        transformers=[
            ('num', StandardScaler(), numeric_cols),
            ('cat', OneHotEncoder(handle_unknown='ignore', sparse_output=False), categorical_cols)
        ]
    )

    # Candidate Models
    candidates = {
        'Logistic Regression': Pipeline([
            ('preprocessor', preprocessor),
            ('classifier', LogisticRegression(class_weight='balanced', max_iter=1000, random_state=42))
        ]),
        'Random Forest': Pipeline([
            ('preprocessor', preprocessor),
            ('classifier', RandomForestClassifier(n_estimators=100, class_weight='balanced', max_depth=12, random_state=42))
        ])
    }

    best_model_name = None
    best_pipeline = None
    best_metrics = None
    best_roc_auc = -1.0

    eval_summary = []

    for name, pipeline in candidates.items():
        pipeline.fit(X_train, y_train)
        y_pred = pipeline.predict(X_test)
        y_prob = pipeline.predict_proba(X_test)[:, 1]

        acc = accuracy_score(y_test, y_pred)
        prec = precision_score(y_test, y_pred)
        rec = recall_score(y_test, y_pred)
        f1 = f1_score(y_test, y_pred)
        roc = roc_auc_score(y_test, y_prob)
        cm = confusion_matrix(y_test, y_pred)

        metrics_dict = {
            'accuracy': round(acc, 4),
            'precision': round(prec, 4),
            'recall': round(rec, 4),
            'f1_score': round(f1, 4),
            'roc_auc': round(roc, 4),
            'confusion_matrix': {
                'tn': int(cm[0, 0]),
                'fp': int(cm[0, 1]),
                'fn': int(cm[1, 0]),
                'tp': int(cm[1, 1])
            }
        }

        print(f"\nCandidate [{name}]:")
        print(f"  ROC-AUC: {roc:.4f} | Recall: {rec:.4f} | Precision: {prec:.4f} | F1: {f1:.4f}")

        eval_summary.append((name, metrics_dict))

        # Select model prioritizing ROC-AUC & Recall
        if roc > best_roc_auc:
            best_roc_auc = roc
            best_model_name = name
            best_pipeline = pipeline
            best_metrics = metrics_dict

    print(f"\nSelected Model: {best_model_name} (ROC-AUC: {best_roc_auc:.4f})")

    # Save Model Artifact
    model_path = os.path.join(models_dir, 'riskguard_fraud_model.joblib')
    joblib.dump(best_pipeline, model_path)
    print(f"Saved model pipeline artifact to {model_path}")

    # Save Metadata
    metadata = {
        "model_name": f"RiskGuard Fraud Classifier ({best_model_name})",
        "model_version": "1.0.0",
        "dataset_type": "synthetic_demo",
        "dataset_note": "Synthetic demonstration dataset for prototype validation.",
        "training_rows": len(df),
        "train_rows": len(X_train),
        "test_rows": len(X_test),
        "fraud_rate": round(fraud_rate, 4),
        "features": list(X.columns),
        "random_seed": 42,
        "metrics": best_metrics
    }

    metadata_path = os.path.join(models_dir, 'model_metadata.json')
    with open(metadata_path, 'w') as f:
        json.dump(metadata, f, indent=2)
    print(f"Saved metadata to {metadata_path}")

    # Write Model Evaluation Report (Markdown)
    report_content = f"""# RiskGuard AI — Machine Learning Model Evaluation Report

> [!NOTE]
> **Dataset Type**: Synthetic demonstration data for prototype validation.
> This model is trained on synthetic transaction data with plausible fraud correlations for technical prototype evaluation. It is not real merchant payment data.

## Executive Summary
- **Selected Model Architecture**: {best_model_name}
- **Dataset Size**: {len(df):,} transactions
- **Target Fraud Prevalence**: {fraud_rate:.2%}
- **Train/Test Split**: 80% Train ({len(X_train):,}) / 20% Test ({len(X_test):,})
- **Random Seed**: 42 (Reproducible)

---

## Candidate Model Performance Comparison

| Model Architecture | ROC-AUC | Recall (Sensitivity) | Precision | F1-Score | Accuracy |
| :--- | :---: | :---: | :---: | :---: | :---: |
"""
    for name, m in eval_summary:
        report_content += f"| **{name}** | {m['roc_auc']} | {m['recall']} | {m['precision']} | {m['f1_score']} | {m['accuracy']} |\n"

    cm = best_metrics['confusion_matrix']
    report_content += f"""
---

## Confusion Matrix ({best_model_name})

- **True Negatives (TN)**: {cm['tn']:,} (Legitimate payments correctly approved)
- **False Positives (FP)**: {cm['fp']:,} (Legitimate payments routed to step-up verification / review)
- **False Negatives (FN)**: {cm['fn']:,} (Suspicious payments that passed ML filter)
- **True Positives (TP)**: {cm['tp']:,} (Suspicious payments correctly flagged)

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
"""

    report_path = os.path.join(reports_dir, 'model_evaluation.md')
    with open(report_path, 'w') as f:
        f.write(report_content)
    print(f"Saved evaluation report to {report_path}")

if __name__ == '__main__':
    run_training()
