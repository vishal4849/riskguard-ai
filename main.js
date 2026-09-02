// RiskGuard AI — Hybrid Risk Engine & Razorpay Standard Checkout Test Integration

const STORAGE_KEY = 'riskguard_transactions';
const BACKEND_URL = (typeof window !== 'undefined' && (window.PUBLIC_BACKEND_URL || window.BACKEND_URL))
  ? (window.PUBLIC_BACKEND_URL || window.BACKEND_URL)
  : 'http://localhost:8000';

// --------------------------------------------------------------------------
// LOCALSTORAGE PERSISTENCE MANAGEMENT
// --------------------------------------------------------------------------

export function getTransactions() {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('Failed to parse riskguard_transactions:', err);
    return [];
  }
}

export function saveTransaction(record) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const current = getTransactions();
    const idx = current.findIndex(t => t.transactionId === record.transactionId);
    if (idx >= 0) {
      current[idx] = { ...current[idx], ...record };
    } else {
      current.unshift(record);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch (err) {
    console.error('Failed to save transaction:', err);
  }
}

export function clearTransactions() {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (err) {
    console.error('Failed to clear riskguard_transactions:', err);
  }
}

// --------------------------------------------------------------------------
// DETERMINISTIC LOCAL RULE ENGINE (SAFETY FALLBACK)
// --------------------------------------------------------------------------

export function getRiskLevel(score) {
  if (score >= 80) return 'CRITICAL RISK';
  if (score >= 60) return 'HIGH RISK';
  if (score >= 30) return 'MEDIUM RISK';
  return 'LOW RISK';
}

export function getDecision(score) {
  if (score >= 80) return 'STEP-UP VERIFICATION';
  if (score >= 60) return 'MANUAL REVIEW';
  if (score >= 30) return 'APPROVE WITH MONITORING';
  return 'APPROVE';
}

export function getRecommendedAction(score) {
  if (score >= 95) return 'Temporarily Hold Payment';
  if (score >= 80) return 'Request OTP / Step-Up Verification';
  if (score >= 60) return 'Send to Human Review';
  if (score >= 30) return 'Monitor Transaction';
  return 'Approve Payment';
}

export function getConfidence(score, signalCount) {
  if (score >= 80) {
    const val = 91 + Math.min(Math.floor((score - 80) / 3), 7);
    return `${val}%`;
  }
  if (score >= 60) {
    const val = 88 + Math.min(Math.floor((score - 60) / 2), 8);
    return `${val}%`;
  }
  if (score >= 30) {
    const val = 82 + Math.min(Math.floor((score - 30) / 3), 10);
    return `${val}%`;
  }
  const val = 90 + Math.min(signalCount, 7);
  return `${val}%`;
}

export function calculateLocalRisk(txn) {
  let score = 10;
  const breakdown = [{ name: 'Base Risk', points: 10 }];
  const signals = [];
  const explanations = [];

  const amount = Number(txn.amount) || 0;
  if (amount > 50000) {
    score += 15;
    signals.push('High-value transaction');
    explanations.push({ title: 'Transaction Amount', points: 15, detail: `Payment value ₹${amount.toLocaleString('en-IN')} exceeds ₹50,000 threshold.` });
    breakdown.push({ name: 'Transaction Amount (>₹50,000)', points: 15 });
  } else if (amount > 20000) {
    score += 10;
    signals.push('High-value transaction');
    explanations.push({ title: 'Transaction Amount', points: 10, detail: `Payment value ₹${amount.toLocaleString('en-IN')} falls in the ₹20,001–₹50,000 risk band.` });
    breakdown.push({ name: 'Transaction Amount (₹20k–₹50k)', points: 10 });
  } else if (amount > 5000) {
    score += 5;
    signals.push('Moderate-value transaction');
    explanations.push({ title: 'Transaction Amount', points: 5, detail: `Payment value ₹${amount.toLocaleString('en-IN')} falls in the ₹5,001–₹20,000 risk band.` });
    breakdown.push({ name: 'Transaction Amount (₹5k–₹20k)', points: 5 });
  }

  if (txn.customerType === 'New Customer') {
    score += 8;
    signals.push('New customer');
    explanations.push({ title: 'Customer Type', points: 8, detail: 'Account has no established payment history.' });
    breakdown.push({ name: 'New Customer', points: 8 });
  }

  if (txn.deviceStatus === 'Suspicious Device') {
    score += 22;
    signals.push('Suspicious device detected');
    explanations.push({ title: 'Suspicious Device', points: 22, detail: 'Hardware fingerprint matches previously flagged fraudulent devices.' });
    breakdown.push({ name: 'Suspicious Device', points: 22 });
  } else if (txn.deviceStatus === 'New Device') {
    score += 12;
    signals.push('New device detected');
    explanations.push({ title: 'New Device', points: 12, detail: 'Device has not previously been associated with this customer.' });
    breakdown.push({ name: 'New Device', points: 12 });
  }

  if (txn.velocity === 'High-frequency attempts') {
    score += 25;
    signals.push('High-frequency payment attempts');
    explanations.push({ title: 'Transaction Velocity', points: 25, detail: 'Rapid burst payment attempts detected within a very short timeframe.' });
    breakdown.push({ name: 'High-Frequency Attempts', points: 25 });
  } else if (txn.velocity === 'Multiple payments in 10 minutes') {
    score += 15;
    signals.push('Unusual transaction velocity');
    explanations.push({ title: 'Transaction Velocity', points: 15, detail: 'Multiple payment attempts occurred within a short 10-minute window.' });
    breakdown.push({ name: 'Transaction Velocity (10m)', points: 15 });
  }

  const loc = txn.locationBehaviour || txn.location;
  if (loc === 'Location Mismatch') {
    score += 18;
    signals.push('Location mismatch');
    explanations.push({ title: 'Location Mismatch', points: 18, detail: 'Current transaction location differs from expected customer behaviour.' });
    breakdown.push({ name: 'Location Mismatch', points: 18 });
  } else if (loc === 'New Location') {
    score += 8;
    signals.push('New transaction location');
    explanations.push({ title: 'New Location', points: 8, detail: 'Payment initiated from a geographic region not seen on this account.' });
    breakdown.push({ name: 'New Transaction Location', points: 8 });
  }

  if (txn.ipReputation === 'Suspicious') {
    score += 20;
    signals.push('Suspicious IP reputation');
    explanations.push({ title: 'Suspicious IP Reputation', points: 20, detail: 'IP address is associated with proxy, VPN, or known malicious subnets.' });
    breakdown.push({ name: 'Suspicious IP Reputation', points: 20 });
  } else if (txn.ipReputation === 'Unknown') {
    score += 5;
    signals.push('Unknown IP reputation');
    explanations.push({ title: 'Unknown IP Reputation', points: 5, detail: 'Subnet reputation is unverified across global threat databases.' });
    breakdown.push({ name: 'Unknown IP Reputation', points: 5 });
  }

  const cbs = Math.min(Number(txn.previousChargebacks ?? txn.chargebacks) || 0, 3);
  if (cbs > 0) {
    const cbPoints = cbs * 7;
    score += cbPoints;
    signals.push('Previous chargeback history');
    explanations.push({ title: 'Chargeback History', points: cbPoints, detail: `Customer profile has ${cbs} recorded payment dispute${cbs > 1 ? 's' : ''}.` });
    breakdown.push({ name: `Chargeback History (${cbs})`, points: cbPoints });
  }

  const failed = Math.min(Number(txn.failedAttempts) || 0, 5);
  if (failed > 0) {
    const failPoints = failed * 4;
    score += failPoints;
    signals.push('Multiple failed payment attempts');
    explanations.push({ title: 'Failed Payment Attempts', points: failPoints, detail: `${failed} recent payment attempt${failed > 1 ? 's' : ''} failed prior to this transaction.` });
    breakdown.push({ name: `Failed Attempts (${failed})`, points: failPoints });
  }

  const cat = txn.merchantCategory;
  if (cat === 'Gaming') {
    score += 7;
    signals.push('High-risk merchant category');
    explanations.push({ title: 'Merchant Category', points: 7, detail: 'Gaming merchant category carries elevated digital liquidity risk.' });
    breakdown.push({ name: 'Merchant Category (Gaming)', points: 7 });
  } else if (cat === 'Electronics' || cat === 'Digital Services') {
    score += 5;
    signals.push('High-risk merchant category');
    explanations.push({ title: 'Merchant Category', points: 5, detail: `${cat} merchant category carries high resale liquidity.` });
    breakdown.push({ name: 'Merchant Category', points: 5 });
  } else if (cat === 'Travel') {
    score += 4;
    signals.push('High-risk merchant category');
    explanations.push({ title: 'Merchant Category', points: 4, detail: 'Travel category carries high ticket size cancellation risk.' });
    breakdown.push({ name: 'Merchant Category (Travel)', points: 4 });
  } else if (cat === 'E-commerce' || cat === 'Fashion') {
    score += 2;
    breakdown.push({ name: `Merchant Category (${cat})`, points: 2 });
  } else if (cat === 'Other') {
    score += 1;
    breakdown.push({ name: 'Merchant Category (Other)', points: 1 });
  }

  const finalScore = Math.min(Math.max(score, 0), 100);
  const level = getRiskLevel(finalScore);
  const decision = getDecision(finalScore);
  const recommendedAction = getRecommendedAction(finalScore);
  const confidence = getConfidence(finalScore, signals.length);

  return {
    rule_score: finalScore,
    ml_probability: null,
    ml_risk_score: null,
    hybrid_score: finalScore,
    risk_level: level,
    decision: decision,
    confidence: confidence,
    recommended_action: recommendedAction,
    signals: signals,
    explanations: explanations,
    rule_breakdown: breakdown,
    model_available: false,
    analysis_mode: 'LOCAL_RULE_FALLBACK',
    uncertainty_detected: false,
    disagreement_note: null,
    safety: {
      human_review_recommended: finalScore >= 60,
      irreversible_auto_decline: false
    }
  };
}

let txnCounter = 186;

export const SAMPLES = {
  low: {
    amount: 1200,
    paymentMethod: 'UPI',
    customerType: 'Existing Customer',
    deviceStatus: 'Trusted Device',
    velocity: 'Normal',
    locationBehaviour: 'Normal Location',
    ipReputation: 'Trusted',
    previousChargebacks: 0,
    failedAttempts: 0,
    merchantCategory: 'Food'
  },
  medium: {
    amount: 15000,
    paymentMethod: 'Credit Card',
    customerType: 'New Customer',
    deviceStatus: 'New Device',
    velocity: 'Normal',
    locationBehaviour: 'New Location',
    ipReputation: 'Unknown',
    previousChargebacks: 0,
    failedAttempts: 1,
    merchantCategory: 'Fashion'
  },
  high: {
    amount: 48500,
    paymentMethod: 'Credit Card',
    customerType: 'New Customer',
    deviceStatus: 'New Device',
    velocity: 'Multiple payments in 10 minutes',
    locationBehaviour: 'Location Mismatch',
    ipReputation: 'Unknown',
    previousChargebacks: 1,
    failedAttempts: 3,
    merchantCategory: 'Electronics'
  }
};

export function getFormValues() {
  return {
    amount: Number(document.getElementById('input-amount').value) || 0,
    payment_method: document.getElementById('select-payment-method').value,
    customer_type: document.getElementById('select-customer-type').value,
    device_status: document.getElementById('select-device-status').value,
    velocity: document.getElementById('select-velocity').value,
    location_behaviour: document.getElementById('select-location').value,
    ip_reputation: document.getElementById('select-ip-reputation').value,
    previous_chargebacks: Number(document.getElementById('input-chargebacks').value) || 0,
    failed_attempts: Number(document.getElementById('input-failed-attempts').value) || 0,
    merchant_category: document.getElementById('select-merchant-category').value
  };
}

export function setFormValues(data) {
  document.getElementById('input-amount').value = data.amount;
  document.getElementById('select-payment-method').value = data.paymentMethod || data.payment_method;
  document.getElementById('select-customer-type').value = data.customerType || data.customer_type;
  document.getElementById('select-device-status').value = data.deviceStatus || data.device_status;
  document.getElementById('select-velocity').value = data.velocity;
  document.getElementById('select-location').value = data.locationBehaviour || data.location_behaviour || data.location;
  document.getElementById('select-ip-reputation').value = data.ipReputation || data.ip_reputation;
  document.getElementById('input-chargebacks').value = data.previousChargebacks ?? data.previous_chargebacks ?? data.chargebacks;
  document.getElementById('input-failed-attempts').value = data.failedAttempts ?? data.failed_attempts;
  document.getElementById('select-merchant-category').value = data.merchantCategory || data.merchant_category;
}

export function loadSample(type) {
  if (SAMPLES[type]) {
    setFormValues(SAMPLES[type]);
    runAnalysis();
  }
}

// Global reference for active transaction
let currentActiveTransaction = null;

// --------------------------------------------------------------------------
// ASYNC HYBRID ANALYSIS & RESULT RENDERING
// --------------------------------------------------------------------------

export async function runAnalysis() {
  const btn = document.getElementById('btn-analyze-risk');
  const resultCard = document.getElementById('risk-result-card');
  const readyCard = document.getElementById('risk-ready-card');

  if (!btn || !resultCard) return;

  btn.classList.add('loading');
  btn.disabled = true;
  btn.innerHTML = `
    <span class="spinner"></span>
    <span>Analyzing transaction...</span>
  `;

  const inputData = getFormValues();

  let apiResult = null;
  let analysisMode = 'HYBRID';

  try {
    const response = await fetch(`${BACKEND_URL}/api/risk/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(inputData)
    });

    if (response.ok) {
      apiResult = await response.json();
      analysisMode = apiResult.analysis_mode;
    } else {
      console.warn('Backend API returned non-200 status. Falling back to local rule engine.');
      apiResult = calculateLocalRisk(inputData);
      analysisMode = 'LOCAL_RULE_FALLBACK';
    }
  } catch (err) {
    console.warn('Backend API connection failed. Falling back to local rule engine.', err);
    apiResult = calculateLocalRisk(inputData);
    analysisMode = 'LOCAL_RULE_FALLBACK';
  }

  txnCounter += 1;
  const txnId = apiResult.transaction_id || `RG-2026-${String(txnCounter).padStart(6, '0')}`;
  const now = new Date();
  const formattedTime = now.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' });

  const txnRecord = {
    transactionId: txnId,
    timestamp: now.toISOString(),
    displayTime: formattedTime,
    amount: inputData.amount,
    paymentMethod: inputData.payment_method,
    customerType: inputData.customer_type,
    deviceStatus: inputData.device_status,
    velocity: inputData.velocity,
    locationBehaviour: inputData.location_behaviour,
    ipReputation: inputData.ip_reputation,
    previousChargebacks: inputData.previous_chargebacks,
    failedAttempts: inputData.failed_attempts,
    merchantCategory: inputData.merchant_category,

    ruleScore: apiResult.rule_score,
    mlProbability: apiResult.ml_probability,
    mlRiskScore: apiResult.ml_risk_score,
    hybridScore: apiResult.hybrid_score,
    riskScore: apiResult.hybrid_score,
    riskLevel: apiResult.risk_level,
    decision: apiResult.decision,
    confidence: typeof apiResult.confidence === 'number' ? `${Math.round(apiResult.confidence * 100)}%` : apiResult.confidence,

    signals: apiResult.signals,
    explanations: apiResult.explanations,
    breakdown: apiResult.rule_breakdown,
    recommendedAction: apiResult.recommended_action,
    modelAvailable: apiResult.model_available,
    analysisMode: analysisMode,
    uncertaintyDetected: apiResult.uncertainty_detected || false,
    disagreementNote: apiResult.disagreement_note || null,
    paymentStatus: 'NOT_STARTED'
  };

  currentActiveTransaction = txnRecord;

  btn.classList.remove('loading');
  btn.disabled = false;
  btn.innerHTML = `
    <svg class="btn-spark" viewBox="0 0 20 20" fill="currentColor">
      <path d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.57l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.57l7-10a1 1 0 011.12-.384z"/>
    </svg>
    <span>Analyze Risk</span>
  `;

  if (readyCard) readyCard.style.display = 'none';
  resultCard.style.display = 'block';

  renderRiskResult(txnRecord);
  saveTransaction(txnRecord);
  updateDashboardAndHistory();
}

export function renderRiskResult(res) {
  document.getElementById('res-txn-id').textContent = res.transactionId;

  const scoreNum = document.getElementById('res-score-number');
  const levelBadge = document.getElementById('res-level-badge');
  const decisionVal = document.getElementById('res-decision-val');
  const confidenceVal = document.getElementById('res-confidence-val');
  const ringFill = document.getElementById('res-ring-fill');
  const gaugeBox = document.getElementById('res-gauge-box');

  let currentScore = 0;
  const duration = 500;
  const stepTime = 15;
  const steps = duration / stepTime;
  const increment = res.hybridScore / steps;

  const timer = setInterval(() => {
    currentScore += increment;
    if (currentScore >= res.hybridScore) {
      currentScore = res.hybridScore;
      clearInterval(timer);
    }
    scoreNum.textContent = Math.round(currentScore);
  }, stepTime);

  const dashOffset = 264 - (264 * res.hybridScore) / 100;
  ringFill.style.strokeDashoffset = dashOffset;

  levelBadge.className = 'res-level-badge';
  gaugeBox.className = 'res-gauge-box';
  decisionVal.className = 'res-decision-val';

  if (res.riskLevel === 'CRITICAL RISK' || res.riskLevel === 'HIGH RISK') {
    const badgeClass = res.riskLevel === 'CRITICAL RISK' ? 'critical' : 'high';
    levelBadge.classList.add(badgeClass);
    levelBadge.textContent = res.riskLevel;
    gaugeBox.classList.add('high');
    decisionVal.classList.add('high');
  } else if (res.riskLevel === 'MEDIUM RISK') {
    levelBadge.classList.add('medium');
    levelBadge.textContent = res.riskLevel;
    gaugeBox.classList.add('medium');
    decisionVal.classList.add('medium');
  } else {
    levelBadge.classList.add('low');
    levelBadge.textContent = res.riskLevel;
    gaugeBox.classList.add('low');
    decisionVal.classList.add('low');
  }

  decisionVal.textContent = res.decision;
  confidenceVal.textContent = res.confidence;

  // DECISION INPUTS PANEL
  const inputsPanel = document.getElementById('res-decision-inputs');
  if (inputsPanel) {
    const ruleVal = document.getElementById('res-rule-score-val');
    const mlVal = document.getElementById('res-ml-prob-val');
    const hybridVal = document.getElementById('res-hybrid-score-val');
    const modeBadge = document.getElementById('res-mode-badge');

    if (ruleVal) ruleVal.textContent = res.ruleScore !== undefined ? `${res.ruleScore} / 100` : '—';
    if (mlVal) mlVal.textContent = res.mlProbability !== null && res.mlProbability !== undefined ? `${Math.round(res.mlProbability * 100)}%` : 'Unavailable';
    if (hybridVal) hybridVal.textContent = `${res.hybridScore} / 100`;

    if (modeBadge) {
      if (res.analysisMode === 'HYBRID') {
        modeBadge.className = 'mode-tag hybrid';
        modeBadge.textContent = 'HYBRID AI';
      } else if (res.analysisMode === 'RULE_FALLBACK') {
        modeBadge.className = 'mode-tag fallback';
        modeBadge.textContent = 'RULE FALLBACK';
      } else {
        modeBadge.className = 'mode-tag local';
        modeBadge.textContent = 'LOCAL FALLBACK';
      }
    }
  }

  // DISAGREEMENT BANNER
  const noteBanner = document.getElementById('res-disagreement-banner');
  if (noteBanner) {
    if (res.uncertaintyDetected && res.disagreementNote) {
      noteBanner.style.display = 'block';
      noteBanner.textContent = res.disagreementNote;
    } else {
      noteBanner.style.display = 'none';
    }
  }

  // SIGNALS
  const signalsList = document.getElementById('res-signals-list');
  signalsList.innerHTML = '';
  if (!res.signals || res.signals.length === 0) {
    signalsList.innerHTML = '<li class="signal-item safe">• Baseline payment signals verified</li>';
  } else {
    const uniqueSignals = [...new Set(res.signals)];
    uniqueSignals.forEach(sig => {
      const li = document.createElement('li');
      li.className = 'signal-item alert';
      li.innerHTML = `<span class="signal-bullet">•</span> ${sig}`;
      signalsList.appendChild(li);
    });
  }

  // EXPLANATIONS
  const expList = document.getElementById('res-explanations-list');
  expList.innerHTML = '';
  if (!res.explanations || res.explanations.length === 0) {
    expList.innerHTML = '<p class="exp-text safe">Customer profile matches baseline trusted transaction history.</p>';
  } else {
    res.explanations.forEach(exp => {
      const item = document.createElement('div');
      item.className = 'exp-row-item';
      item.innerHTML = `
        <div class="exp-row-header">
          <span class="exp-row-title">${exp.title}</span>
          <span class="exp-row-pts">${exp.points > 0 ? '+' + exp.points : exp.points}</span>
        </div>
        <div class="exp-row-detail">${exp.detail}</div>
      `;
      expList.appendChild(item);
    });
  }

  // BREAKDOWN
  const breakdownList = document.getElementById('res-breakdown-list');
  breakdownList.innerHTML = '';
  if (res.breakdown) {
    res.breakdown.forEach(item => {
      const row = document.createElement('div');
      row.className = 'breakdown-row';
      row.innerHTML = `
        <span class="breakdown-name">${item.name}</span>
        <span class="breakdown-pts">+${item.points}</span>
      `;
      breakdownList.appendChild(row);
    });
  }

  const totalRow = document.createElement('div');
  totalRow.className = 'breakdown-row total';
  totalRow.innerHTML = `
    <span class="breakdown-name">Final Hybrid Risk Score</span>
    <span class="breakdown-pts">${res.hybridScore} / 100</span>
  `;
  breakdownList.appendChild(totalRow);

  const actionText = document.getElementById('res-action-text');
  const safetyNote = document.getElementById('res-safety-note');
  actionText.textContent = res.recommendedAction;

  if (res.analysisMode === 'LOCAL_RULE_FALLBACK') {
    safetyNote.style.display = 'block';
    safetyNote.textContent = 'RiskGuard backend is temporarily unavailable. The transaction was analyzed using the deterministic safety engine.';
  } else if (res.hybridScore >= 60 && res.hybridScore <= 85) {
    safetyNote.style.display = 'block';
    safetyNote.textContent = 'AI confidence is not sufficient for an irreversible action. Escalating to human review.';
  } else if (res.hybridScore > 85) {
    safetyNote.style.display = 'block';
    safetyNote.textContent = 'RiskGuard avoids irreversible automated decisions when transaction context is uncertain. High-risk payments can be escalated to step-up verification or human review.';
  } else {
    safetyNote.style.display = 'none';
  }

  // RENDER RAZORPAY TEST PAYMENT CTA SECTION
  renderRazorpayPaymentAction(res);
}

// --------------------------------------------------------------------------
// RAZORPAY STANDARD CHECKOUT INTEGRATION (TEST MODE ONLY)
// --------------------------------------------------------------------------

export function renderRazorpayPaymentAction(res) {
  const pzSection = document.getElementById('res-payment-action-block');
  if (!pzSection) return;

  pzSection.style.display = 'block';

  const btnText = document.getElementById('btn-razorpay-text');
  const demoSub = document.getElementById('payment-demo-sub');
  const statusBox = document.getElementById('payment-verification-box');

  if (res.riskLevel === 'HIGH RISK' || res.riskLevel === 'CRITICAL RISK') {
    if (btnText) btnText.textContent = 'Continue Test Payment Demo';
    if (demoSub) demoSub.textContent = 'Buildathon Demo Flow — Additional verification recommended before payment settlement.';
  } else {
    if (btnText) btnText.textContent = 'Proceed to Razorpay Test Checkout';
    if (demoSub) demoSub.textContent = 'Simulated payment — no real money is charged.';
  }

  // Reset Payment Status Box if not yet started
  if (statusBox && (!res.paymentStatus || res.paymentStatus === 'NOT_STARTED')) {
    statusBox.style.display = 'none';
  } else if (statusBox && res.paymentStatus) {
    statusBox.style.display = 'block';
    updatePaymentVerificationBox(res);
  }
}

/**
 * Dynamically loads Razorpay Standard Checkout JS Script
 */
function loadRazorpayScript() {
  return new Promise((resolve) => {
    if (window.Razorpay) {
      resolve(true);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

/**
 * Handles Razorpay Test Payment Button Click
 */
export async function initiateRazorpayPayment() {
  const btn = document.getElementById('btn-razorpay-checkout');
  const errorMsg = document.getElementById('payment-error-msg');
  if (!btn || !currentActiveTransaction) return;

  if (errorMsg) errorMsg.style.display = 'none';

  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span> <span>Creating Razorpay Test Order...</span>`;

  try {
    // 1. Request Order Creation from Backend API
    const response = await fetch(`${BACKEND_URL}/api/payments/create-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        risk_transaction_id: currentActiveTransaction.transactionId,
        amount: currentActiveTransaction.amount,
        currency: 'INR'
      })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.detail || 'Razorpay order creation failed.');
    }

    const orderData = await response.json();

    // 2. Update local transaction state
    currentActiveTransaction.razorpayOrderId = orderData.razorpay_order_id;
    currentActiveTransaction.paymentStatus = 'ORDER_CREATED';
    saveTransaction(currentActiveTransaction);
    updateDashboardAndHistory();

    // 3. Load Razorpay Checkout JS
    const scriptLoaded = await loadRazorpayScript();
    if (!scriptLoaded && !window.Razorpay) {
      console.warn('Razorpay checkout.js could not be loaded from CDN. Using test handler verification.');
    }

    btn.disabled = false;
    btn.innerHTML = `<svg viewBox="0 0 20 20" fill="currentColor" style="width:16px;height:16px;"><path fill-rule="evenodd" d="M10 2a8 8 0 100 16 8 8 0 000-16zm3.707 6.707a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg> <span id="btn-razorpay-text">Proceed to Razorpay Test Checkout</span>`;

    // 4. Razorpay Standard Checkout Options
    const options = {
      key: orderData.razorpay_key_id,
      amount: orderData.amount, // Amount in Paise
      currency: orderData.currency,
      name: "RiskGuard AI Demo Merchant",
      description: "AI Risk-Analyzed Test Payment",
      order_id: orderData.razorpay_order_id,
      handler: async function (checkoutResponse) {
        await handlePaymentSuccess(checkoutResponse, orderData);
      },
      modal: {
        ondismiss: function () {
          console.log('Razorpay Test Checkout dismissed by user.');
          if (currentActiveTransaction) {
            currentActiveTransaction.paymentStatus = 'CHECKOUT_CANCELLED';
            saveTransaction(currentActiveTransaction);
            updateDashboardAndHistory();
            updatePaymentVerificationBox(currentActiveTransaction);
          }
        }
      },
      prefill: {
        name: "Demo Customer",
        email: "customer@riskguard.ai",
        contact: "9999999999"
      },
      theme: { color: "#B31217" }
    };

    if (window.Razorpay) {
      const rzpInstance = new window.Razorpay(options);
      rzpInstance.open();
    } else {
      // Fallback demo simulation for offline/CDN-blocked testing
      const simPaymentId = `pay_sim_${Date.now()}`;
      const simSig = `sig_sim_${Date.now()}`;
      await handlePaymentSuccess({
        razorpay_payment_id: simPaymentId,
        razorpay_order_id: orderData.razorpay_order_id,
        razorpay_signature: simSig
      }, orderData);
    }

  } catch (err) {
    console.error('Razorpay payment initiation error:', err);
    btn.disabled = false;
    btn.innerHTML = `<svg viewBox="0 0 20 20" fill="currentColor" style="width:16px;height:16px;"><path fill-rule="evenodd" d="M10 2a8 8 0 100 16 8 8 0 000-16zm3.707 6.707a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg> <span>Proceed to Razorpay Test Checkout</span>`;

    if (errorMsg) {
      errorMsg.style.display = 'block';
      errorMsg.textContent = `Payment Order Error: ${err.message || 'Razorpay Test Mode credentials not configured on backend.'}`;
    }
  }
}

/**
 * Handles Client-side Checkout Callback & Calls Backend Signature Verification
 */
async function handlePaymentSuccess(checkoutResponse, orderData) {
  const statusBox = document.getElementById('payment-verification-box');
  if (statusBox) statusBox.style.display = 'block';

  if (currentActiveTransaction) {
    currentActiveTransaction.paymentStatus = 'CHECKOUT_COMPLETED';
    currentActiveTransaction.razorpayPaymentId = checkoutResponse.razorpay_payment_id;
    currentActiveTransaction.razorpayOrderId = checkoutResponse.razorpay_order_id;
    updatePaymentVerificationBox(currentActiveTransaction);
  }

  try {
    // POST to Backend Server-side Signature Verification Endpoint
    const verifyResp = await fetch(`${BACKEND_URL}/api/payments/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        risk_transaction_id: orderData.risk_transaction_id,
        razorpay_payment_id: checkoutResponse.razorpay_payment_id,
        razorpay_order_id: checkoutResponse.razorpay_order_id,
        razorpay_signature: checkoutResponse.razorpay_signature
      })
    });

    if (verifyResp.ok) {
      const vData = await verifyResp.json();
      if (vData.verified) {
        currentActiveTransaction.signatureVerified = true;
        currentActiveTransaction.paymentStatus = 'SIGNATURE_VERIFIED';
        saveTransaction(currentActiveTransaction);
        updateDashboardAndHistory();
        updatePaymentVerificationBox(currentActiveTransaction);

        // Start brief background polling for Webhook status update
        pollPaymentStatus(orderData.risk_transaction_id);
      } else {
        currentActiveTransaction.signatureVerified = false;
        currentActiveTransaction.paymentStatus = 'VERIFICATION_FAILED';
        saveTransaction(currentActiveTransaction);
        updateDashboardAndHistory();
        updatePaymentVerificationBox(currentActiveTransaction);
      }
    }
  } catch (err) {
    console.error('Server signature verification call failed:', err);
  }
}

/**
 * Updates UI Box for Payment Verification
 */
function updatePaymentVerificationBox(t) {
  const orderIdEl = document.getElementById('pz-order-id');
  const payIdEl = document.getElementById('pz-pay-id');
  const checkStatusEl = document.getElementById('pz-checkout-status');
  const sigStatusEl = document.getElementById('pz-sig-status');
  const decisionEl = document.getElementById('pz-risk-decision');
  const finalStatusEl = document.getElementById('pz-final-status');

  if (orderIdEl) orderIdEl.textContent = t.razorpayOrderId || 'order_created';
  if (payIdEl) payIdEl.textContent = t.razorpayPaymentId || 'pay_processing';

  if (checkStatusEl) {
    checkStatusEl.textContent = t.paymentStatus === 'NOT_STARTED' ? 'Not Started' : 'Completed';
    checkStatusEl.className = 'pz-val ' + (t.paymentStatus !== 'NOT_STARTED' ? 'safe' : '');
  }

  if (sigStatusEl) {
    sigStatusEl.textContent = t.signatureVerified ? 'Verified' : t.paymentStatus === 'VERIFICATION_FAILED' ? 'Failed' : 'Pending';
    sigStatusEl.className = 'pz-val ' + (t.signatureVerified ? 'safe' : t.paymentStatus === 'VERIFICATION_FAILED' ? 'alert' : '');
  }

  if (decisionEl) decisionEl.textContent = t.decision;

  if (finalStatusEl) {
    if (t.paymentStatus === 'CAPTURED') {
      finalStatusEl.textContent = 'CAPTURED (Webhook Confirmed)';
      finalStatusEl.className = 'pz-val safe font-bold';
    } else if (t.paymentStatus === 'AUTHORIZED') {
      finalStatusEl.textContent = 'AUTHORIZED (Webhook Confirmed)';
      finalStatusEl.className = 'pz-val safe font-bold';
    } else if (t.paymentStatus === 'SIGNATURE_VERIFIED') {
      finalStatusEl.textContent = 'SIGNATURE VERIFIED (Awaiting webhook)';
      finalStatusEl.className = 'pz-val safe font-bold';
    } else if (t.paymentStatus === 'FAILED') {
      finalStatusEl.textContent = 'FAILED';
      finalStatusEl.className = 'pz-val alert font-bold';
    } else if (t.paymentStatus === 'CHECKOUT_CANCELLED') {
      finalStatusEl.textContent = 'Checkout Cancelled';
      finalStatusEl.className = 'pz-val text-muted';
    } else {
      finalStatusEl.textContent = t.paymentStatus || 'ORDER_CREATED';
      finalStatusEl.className = 'pz-val';
    }
  }
}

/**
 * Polls GET /api/payments/status/{risk_id} briefly after checkout
 */
async function pollPaymentStatus(riskTxnId) {
  let polls = 0;
  const maxPolls = 10;

  const interval = setInterval(async () => {
    polls++;
    try {
      const res = await fetch(`${BACKEND_URL}/api/payments/status/${riskTxnId}`);
      if (res.ok) {
        const data = await res.json();
        if (currentActiveTransaction && currentActiveTransaction.transactionId === riskTxnId) {
          if (data.payment_status && data.payment_status !== currentActiveTransaction.paymentStatus) {
            currentActiveTransaction.paymentStatus = data.payment_status;
            currentActiveTransaction.signatureVerified = data.signature_verified;
            saveTransaction(currentActiveTransaction);
            updateDashboardAndHistory();
            updatePaymentVerificationBox(currentActiveTransaction);
          }
        }
      }
    } catch (err) {}

    if (polls >= maxPolls) clearInterval(interval);
  }, 2000);
}

// --------------------------------------------------------------------------
// DASHBOARD & TRANSACTION TABLE
// --------------------------------------------------------------------------

export function calculateDashboardMetrics(txns) {
  const totalCount = txns.length;
  if (totalCount === 0) {
    return {
      totalCount: 0,
      totalVolume: 0,
      highRiskCount: 0,
      highRiskPct: '0%',
      interventionCount: 0,
      highRiskValue: 0,
      approvalRate: '0%',
      manualReviewRate: '0%',
      stepUpRate: '0%',
      avgScore: '0',
      criticalRate: '0%',
      escalatedCount: 0,
      hybridCoveragePct: '0%',
      fallbackCount: 0,
      testStartedCount: 0,
      verifiedCount: 0,
      capturedCount: 0
    };
  }

  let totalVolume = 0;
  let highRiskCount = 0;
  let interventionCount = 0;
  let highRiskValue = 0;
  let approvedCount = 0;
  let manualReviewCount = 0;
  let stepUpCount = 0;
  let criticalCount = 0;
  let totalScoreSum = 0;
  let escalatedCount = 0;
  let hybridCount = 0;
  let testStartedCount = 0;
  let verifiedCount = 0;
  let capturedCount = 0;

  txns.forEach(t => {
    const amt = Number(t.amount) || 0;
    const score = Number(t.hybridScore ?? t.riskScore) || 0;
    totalVolume += amt;
    totalScoreSum += score;

    if (t.riskLevel === 'HIGH RISK' || t.riskLevel === 'CRITICAL RISK') {
      highRiskCount++;
      highRiskValue += amt;
    }

    if (t.riskLevel === 'CRITICAL RISK') criticalCount++;

    if (t.decision === 'MANUAL REVIEW' || t.decision === 'STEP-UP VERIFICATION') {
      interventionCount++;
      if (t.riskLevel === 'HIGH RISK' || t.riskLevel === 'CRITICAL RISK') escalatedCount++;
    }

    if (t.decision === 'APPROVE') approvedCount++;
    if (t.decision === 'MANUAL REVIEW') manualReviewCount++;
    if (t.decision === 'STEP-UP VERIFICATION') stepUpCount++;

    if (t.analysisMode === 'HYBRID') hybridCount++;

    if (t.paymentStatus && t.paymentStatus !== 'NOT_STARTED') testStartedCount++;
    if (t.signatureVerified) verifiedCount++;
    if (t.paymentStatus === 'CAPTURED') capturedCount++;
  });

  return {
    totalCount,
    totalVolume,
    highRiskCount,
    highRiskPct: `${((highRiskCount / totalCount) * 100).toFixed(1)}%`,
    interventionCount,
    highRiskValue,
    approvalRate: `${((approvedCount / totalCount) * 100).toFixed(1)}%`,
    manualReviewRate: `${((manualReviewCount / totalCount) * 100).toFixed(1)}%`,
    stepUpRate: `${((stepUpCount / totalCount) * 100).toFixed(1)}%`,
    avgScore: Math.round(totalScoreSum / totalCount),
    criticalRate: `${((criticalCount / totalCount) * 100).toFixed(1)}%`,
    escalatedCount,
    hybridCoveragePct: `${((hybridCount / totalCount) * 100).toFixed(0)}%`,
    fallbackCount: totalCount - hybridCount,
    testStartedCount,
    verifiedCount,
    capturedCount
  };
}

export function updateDashboardAndHistory() {
  const txns = getTransactions();
  const metrics = calculateDashboardMetrics(txns);

  const kpiCount = document.getElementById('kpi-count');
  const kpiVol = document.getElementById('kpi-volume');
  const kpiHighCount = document.getElementById('kpi-high-count');
  const kpiHighPct = document.getElementById('kpi-high-pct');
  const kpiIntervention = document.getElementById('kpi-intervention');
  const kpiHighValue = document.getElementById('kpi-high-value');

  if (kpiCount) kpiCount.textContent = metrics.totalCount;
  if (kpiVol) kpiVol.textContent = metrics.totalCount > 0 ? `₹${metrics.totalVolume.toLocaleString('en-IN')}` : '₹0';
  if (kpiHighCount) kpiHighCount.textContent = metrics.highRiskCount;
  if (kpiHighPct) kpiHighPct.textContent = `${metrics.highRiskPct} of analyzed payments`;
  if (kpiIntervention) kpiIntervention.textContent = metrics.interventionCount;
  if (kpiHighValue) kpiHighValue.textContent = metrics.totalCount > 0 ? `₹${metrics.highRiskValue.toLocaleString('en-IN')}` : '₹0';

  const mApprove = document.getElementById('metric-approval-rate');
  const mManual = document.getElementById('metric-manual-rate');
  const mStepUp = document.getElementById('metric-stepup-rate');
  const mAvgScore = document.getElementById('metric-avg-score');
  const mCritical = document.getElementById('metric-critical-rate');
  const mCoverage = document.getElementById('metric-hybrid-coverage');

  if (mApprove) mApprove.textContent = metrics.totalCount > 0 ? metrics.approvalRate : '—';
  if (mManual) mManual.textContent = metrics.totalCount > 0 ? metrics.manualReviewRate : '—';
  if (mStepUp) mStepUp.textContent = metrics.totalCount > 0 ? metrics.stepUpRate : '—';
  if (mAvgScore) mAvgScore.textContent = metrics.totalCount > 0 ? `${metrics.avgScore} / 100` : '—';
  if (mCritical) mCritical.textContent = metrics.totalCount > 0 ? metrics.criticalRate : '—';
  if (mCoverage) mCoverage.textContent = metrics.totalCount > 0 ? `${metrics.hybridCoveragePct} (${metrics.fallbackCount} Fallback)` : '—';

  // Razorpay Test Payment Operations Group
  const mPzStarted = document.getElementById('metric-pz-started');
  const mPzVerified = document.getElementById('metric-pz-verified');
  if (mPzStarted) mPzStarted.textContent = metrics.testStartedCount;
  if (mPzVerified) mPzVerified.textContent = metrics.verifiedCount;

  renderRiskDistributionChart(txns);
  renderDecisionDistributionChart(txns);
  renderRiskTrendChart(txns);
  renderTransactionTable();
  renderLatestExplanationSection(txns);

  const fpCountEl = document.getElementById('fp-escalated-count');
  if (fpCountEl) fpCountEl.textContent = metrics.escalatedCount;
}

// --------------------------------------------------------------------------
// CHARTS & VISUALIZATIONS
// --------------------------------------------------------------------------

function renderRiskDistributionChart(txns) {
  const container = document.getElementById('chart-risk-dist');
  if (!container) return;

  if (txns.length === 0) {
    container.innerHTML = `<div class="chart-empty-state"><p>No transaction data available yet.</p></div>`;
    return;
  }

  let low = 0, med = 0, high = 0, crit = 0;
  txns.forEach(t => {
    if (t.riskLevel === 'LOW RISK') low++;
    else if (t.riskLevel === 'MEDIUM RISK') med++;
    else if (t.riskLevel === 'HIGH RISK') high++;
    else if (t.riskLevel === 'CRITICAL RISK') crit++;
  });

  const total = txns.length;
  const pLow = ((low / total) * 100).toFixed(1);
  const pMed = ((med / total) * 100).toFixed(1);
  const pHigh = ((high / total) * 100).toFixed(1);
  const pCrit = ((crit / total) * 100).toFixed(1);

  container.innerHTML = `
    <div class="dist-bar-list">
      <div class="dist-row">
        <div class="dist-info"><span class="dist-label low">Low Risk (0–29)</span><span class="dist-val">${low} (${pLow}%)</span></div>
        <div class="dist-track"><div class="dist-fill low" style="width: ${pLow}%"></div></div>
      </div>
      <div class="dist-row">
        <div class="dist-info"><span class="dist-label medium">Medium Risk (30–59)</span><span class="dist-val">${med} (${pMed}%)</span></div>
        <div class="dist-track"><div class="dist-fill medium" style="width: ${pMed}%"></div></div>
      </div>
      <div class="dist-row">
        <div class="dist-info"><span class="dist-label high">High Risk (60–79)</span><span class="dist-val">${high} (${pHigh}%)</span></div>
        <div class="dist-track"><div class="dist-fill high" style="width: ${pHigh}%"></div></div>
      </div>
      <div class="dist-row">
        <div class="dist-info"><span class="dist-label critical">Critical Risk (80–100)</span><span class="dist-val">${crit} (${pCrit}%)</span></div>
        <div class="dist-track"><div class="dist-fill critical" style="width: ${pCrit}%"></div></div>
      </div>
    </div>
  `;
}

function renderDecisionDistributionChart(txns) {
  const container = document.getElementById('chart-decision-dist');
  if (!container) return;

  if (txns.length === 0) {
    container.innerHTML = `<div class="chart-empty-state"><p>No decision data available yet.</p></div>`;
    return;
  }

  let approve = 0, monitor = 0, review = 0, stepup = 0;
  txns.forEach(t => {
    if (t.decision === 'APPROVE') approve++;
    else if (t.decision === 'APPROVE WITH MONITORING') monitor++;
    else if (t.decision === 'MANUAL REVIEW') review++;
    else if (t.decision === 'STEP-UP VERIFICATION') stepup++;
  });

  const total = txns.length;
  const pApprove = ((approve / total) * 100).toFixed(1);
  const pMonitor = ((monitor / total) * 100).toFixed(1);
  const pReview = ((review / total) * 100).toFixed(1);
  const pStepup = ((stepup / total) * 100).toFixed(1);

  container.innerHTML = `
    <div class="dist-bar-list">
      <div class="dist-row">
        <div class="dist-info"><span class="dist-label low">Approve</span><span class="dist-val">${approve} (${pApprove}%)</span></div>
        <div class="dist-track"><div class="dist-fill low" style="width: ${pApprove}%"></div></div>
      </div>
      <div class="dist-row">
        <div class="dist-info"><span class="dist-label medium">Approve w/ Monitoring</span><span class="dist-val">${monitor} (${pMonitor}%)</span></div>
        <div class="dist-track"><div class="dist-fill medium" style="width: ${pMonitor}%"></div></div>
      </div>
      <div class="dist-row">
        <div class="dist-info"><span class="dist-label high">Manual Review</span><span class="dist-val">${review} (${pReview}%)</span></div>
        <div class="dist-track"><div class="dist-fill high" style="width: ${pReview}%"></div></div>
      </div>
      <div class="dist-row">
        <div class="dist-info"><span class="dist-label critical">Step-Up Verification</span><span class="dist-val">${stepup} (${pStepup}%)</span></div>
        <div class="dist-track"><div class="dist-fill critical" style="width: ${pStepup}%"></div></div>
      </div>
    </div>
  `;
}

function renderRiskTrendChart(txns) {
  const container = document.getElementById('chart-risk-trend');
  if (!container) return;

  if (txns.length < 2) {
    container.innerHTML = `<div class="chart-empty-state"><p>Run at least 2 transactions through the Risk Engine to generate risk trend sequence analysis.</p></div>`;
    return;
  }

  const chrono = [...txns].reverse().slice(-10);
  const points = chrono.map((t, idx) => {
    const score = t.hybridScore ?? t.riskScore;
    const x = (idx / (chrono.length - 1)) * 300 + 30;
    const y = 140 - (score / 100) * 110;
    return { x, y, score, id: t.transactionId };
  });

  const pathD = points.reduce((acc, p, i) => i === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`, '');

  let dotsSvg = '';
  points.forEach(p => {
    const color = p.score >= 80 ? '#B31217' : p.score >= 60 ? '#EF4444' : p.score >= 30 ? '#F59E0B' : '#10B981';
    dotsSvg += `<circle cx="${p.x}" cy="${p.y}" r="4" fill="${color}" stroke="#0A0101" stroke-width="2"><title>${p.id}: ${p.score}/100</title></circle>`;
  });

  container.innerHTML = `
    <div class="trend-chart-wrapper">
      <svg class="trend-svg" viewBox="0 0 360 160">
        <line x1="30" y1="30" x2="330" y2="30" stroke="rgba(255,255,255,0.06)" stroke-dasharray="4"/>
        <line x1="30" y1="85" x2="330" y2="85" stroke="rgba(255,255,255,0.06)" stroke-dasharray="4"/>
        <line x1="30" y1="140" x2="330" y2="140" stroke="rgba(255,255,255,0.08)"/>

        <text x="20" y="34" fill="#8B8B95" font-size="9" text-anchor="end">100</text>
        <text x="20" y="89" fill="#8B8B95" font-size="9" text-anchor="end">50</text>
        <text x="20" y="144" fill="#8B8B95" font-size="9" text-anchor="end">0</text>

        <path d="${pathD}" fill="none" stroke="#EF4444" stroke-width="2" stroke-linecap="round"/>
        ${dotsSvg}
      </svg>
    </div>
  `;
}

// --------------------------------------------------------------------------
// TRANSACTION HISTORY TABLE
// --------------------------------------------------------------------------

export function renderTransactionTable() {
  const tableBody = document.getElementById('table-txn-body');
  const emptyState = document.getElementById('table-empty-state');
  const tableContainer = document.getElementById('table-wrapper');

  if (!tableBody) return;

  let txns = getTransactions();

  if (txns.length === 0) {
    if (tableContainer) tableContainer.style.display = 'none';
    if (emptyState) emptyState.style.display = 'flex';
    return;
  }

  if (emptyState) emptyState.style.display = 'none';
  if (tableContainer) tableContainer.style.display = 'block';

  const searchVal = (document.getElementById('filter-search')?.value || '').toLowerCase();
  const levelVal = document.getElementById('filter-level')?.value || 'ALL';
  const decisionVal = document.getElementById('filter-decision')?.value || 'ALL';
  const methodVal = document.getElementById('filter-method')?.value || 'ALL';
  const sortVal = document.getElementById('filter-sort')?.value || 'NEWEST';

  txns = txns.filter(t => {
    if (searchVal && !t.transactionId.toLowerCase().includes(searchVal)) return false;
    if (levelVal !== 'ALL' && t.riskLevel !== levelVal) return false;
    if (decisionVal !== 'ALL' && t.decision !== decisionVal) return false;
    if (methodVal !== 'ALL' && t.paymentMethod !== methodVal) return false;
    return true;
  });

  txns.sort((a, b) => {
    const scoreA = a.hybridScore ?? a.riskScore;
    const scoreB = b.hybridScore ?? b.riskScore;
    if (sortVal === 'OLDEST') return new Date(a.timestamp) - new Date(b.timestamp);
    if (sortVal === 'HIGHEST_RISK') return scoreB - scoreA;
    if (sortVal === 'LOWEST_RISK') return scoreA - scoreB;
    if (sortVal === 'HIGHEST_AMOUNT') return b.amount - a.amount;
    if (sortVal === 'LOWEST_AMOUNT') return a.amount - b.amount;
    return new Date(b.timestamp) - new Date(a.timestamp);
  });

  tableBody.innerHTML = '';

  if (txns.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="10" class="text-center text-muted" style="padding: 24px;">No matching transactions found for applied filters.</td></tr>`;
    return;
  }

  txns.forEach(t => {
    const tr = document.createElement('tr');
    const badgeClass = t.riskLevel === 'CRITICAL RISK' ? 'critical' : t.riskLevel === 'HIGH RISK' ? 'high' : t.riskLevel === 'MEDIUM RISK' ? 'medium' : 'low';
    const score = t.hybridScore ?? t.riskScore;
    const modeTag = t.analysisMode === 'HYBRID' ? 'Hybrid AI' : t.analysisMode === 'RULE_FALLBACK' ? 'Rule Fallback' : 'Local Fallback';
    const pzStatus = t.signatureVerified ? 'Verified' : t.paymentStatus === 'CAPTURED' ? 'Captured' : t.paymentStatus === 'ORDER_CREATED' ? 'Order Created' : 'Not Started';

    tr.innerHTML = `
      <td class="font-mono font-bold">${t.transactionId}</td>
      <td class="text-muted">${t.displayTime || t.timestamp.substring(11, 16)}</td>
      <td class="font-bold">₹${t.amount.toLocaleString('en-IN')}</td>
      <td>${t.paymentMethod}</td>
      <td class="font-bold">${score}</td>
      <td><span class="res-level-badge ${badgeClass}">${t.riskLevel}</span></td>
      <td class="decision-cell ${badgeClass}">${t.decision}</td>
      <td><span class="mode-pill">${modeTag}</span></td>
      <td><span class="pz-status-pill ${t.signatureVerified ? 'verified' : ''}">${pzStatus}</span></td>
      <td>
        <button type="button" class="btn-table-view" data-id="${t.transactionId}">View Details</button>
      </td>
    `;
    tableBody.appendChild(tr);
  });

  document.querySelectorAll('.btn-table-view').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.currentTarget.getAttribute('data-id');
      openTransactionModal(id);
    });
  });
}

// --------------------------------------------------------------------------
// TRANSACTION DETAIL & AUDIT TRAIL MODAL
// --------------------------------------------------------------------------

export function openTransactionModal(txnId) {
  const modal = document.getElementById('txn-modal');
  if (!modal) return;

  const txns = getTransactions();
  const t = txns.find(item => item.transactionId === txnId);
  if (!t) return;

  const score = t.hybridScore ?? t.riskScore;

  document.getElementById('modal-txn-id').textContent = t.transactionId;
  document.getElementById('modal-time').textContent = t.timestamp ? new Date(t.timestamp).toLocaleString('en-IN') : '—';
  document.getElementById('modal-amount').textContent = `₹${t.amount.toLocaleString('en-IN')}`;
  document.getElementById('modal-method').textContent = t.paymentMethod;
  document.getElementById('modal-category').textContent = t.merchantCategory;

  document.getElementById('modal-score').textContent = `${score} / 100`;
  document.getElementById('modal-level').textContent = t.riskLevel;
  document.getElementById('modal-decision').textContent = t.decision;
  document.getElementById('modal-confidence').textContent = t.confidence;

  const badgeClass = t.riskLevel === 'CRITICAL RISK' ? 'critical' : t.riskLevel === 'HIGH RISK' ? 'high' : t.riskLevel === 'MEDIUM RISK' ? 'medium' : 'low';
  document.getElementById('modal-level').className = `res-level-badge ${badgeClass}`;

  // Signals
  const sigList = document.getElementById('modal-signals');
  sigList.innerHTML = '';
  if (!t.signals || t.signals.length === 0) {
    sigList.innerHTML = '<li class="signal-item safe">• Baseline payment signals verified</li>';
  } else {
    t.signals.forEach(sig => {
      const li = document.createElement('li');
      li.className = 'signal-item alert';
      li.innerHTML = `<span class="signal-bullet">•</span> ${sig}`;
      sigList.appendChild(li);
    });
  }

  // Explanations
  const expBox = document.getElementById('modal-explanations');
  expBox.innerHTML = '';
  if (!t.explanations || t.explanations.length === 0) {
    expBox.innerHTML = '<p class="exp-text safe">Customer profile matches baseline trusted transaction history.</p>';
  } else {
    t.explanations.forEach(exp => {
      const item = document.createElement('div');
      item.className = 'exp-row-item';
      if (typeof exp === 'object') {
        item.innerHTML = `
          <div class="exp-row-header">
            <span class="exp-row-title">${exp.title}</span>
            <span class="exp-row-pts">${exp.points > 0 ? '+' + exp.points : exp.points}</span>
          </div>
          <div class="exp-row-detail">${exp.detail}</div>
        `;
      } else {
        item.innerHTML = `<div class="exp-row-detail">"${exp}"</div>`;
      }
      expBox.appendChild(item);
    });
  }

  // Breakdown
  const bList = document.getElementById('modal-breakdown');
  bList.innerHTML = '';
  if (t.breakdown) {
    t.breakdown.forEach(item => {
      const row = document.createElement('div');
      row.className = 'breakdown-row';
      row.innerHTML = `<span class="breakdown-name">${item.name}</span><span class="breakdown-pts">+${item.points}</span>`;
      bList.appendChild(row);
    });
  }

  document.getElementById('modal-action').textContent = t.recommendedAction || 'Monitor Transaction';

  // EXTENDED DECISION & PAYMENT AUDIT TRAIL TIMELINE
  const auditList = document.getElementById('modal-audit-trail');
  const mlStageText = t.mlProbability !== null && t.mlProbability !== undefined
    ? `Scikit-Learn ML Classifier evaluated ${Math.round(t.mlProbability * 100)}% fraud probability.`
    : 'ML Inference unavailable. Deterministic rule fallback activated.';

  const orderStepText = t.razorpayOrderId ? `Razorpay Order Created (${t.razorpayOrderId})` : 'Razorpay Order Not Created';
  const payStepText = t.razorpayPaymentId ? `Checkout Completed (${t.razorpayPaymentId})` : 'Checkout Not Initiated';
  const sigStepText = t.signatureVerified ? 'HMAC SHA256 Verification: VERIFIED' : 'Signature Verification: Pending / Not Attempted';
  const finalStateText = t.paymentStatus || 'ANALYZED';

  auditList.innerHTML = `
    <div class="audit-step">
      <div class="audit-badge">1</div>
      <div class="audit-content">
        <span class="audit-title">Transaction Received</span>
        <span class="audit-desc">Payment of ₹${t.amount.toLocaleString('en-IN')} via ${t.paymentMethod} initiated at ${t.displayTime || 'real-time'}.</span>
      </div>
    </div>
    <div class="audit-step">
      <div class="audit-badge">2</div>
      <div class="audit-content">
        <span class="audit-title">Deterministic Rule Evaluation</span>
        <span class="audit-desc">Rule Score: ${t.ruleScore !== undefined ? t.ruleScore : score} / 100 across 10 parameter vectors.</span>
      </div>
    </div>
    <div class="audit-step">
      <div class="audit-badge">3</div>
      <div class="audit-content">
        <span class="audit-title">Machine Learning Model Inference</span>
        <span class="audit-desc">${mlStageText}</span>
      </div>
    </div>
    <div class="audit-step">
      <div class="audit-badge">4</div>
      <div class="audit-content">
        <span class="audit-title">Hybrid Risk Fusion</span>
        <span class="audit-desc">Final Hybrid Risk Score: ${score} / 100 (${t.riskLevel}).</span>
      </div>
    </div>
    <div class="audit-step">
      <div class="audit-badge">5</div>
      <div class="audit-content">
        <span class="audit-title">Safety Check & Decision Assignment</span>
        <span class="audit-desc">Assigned Decision: ${t.decision} (Confidence: ${t.confidence}).</span>
      </div>
    </div>
    <div class="audit-step">
      <div class="audit-badge">6</div>
      <div class="audit-content">
        <span class="audit-title">Razorpay Order Creation</span>
        <span class="audit-desc">${orderStepText}.</span>
      </div>
    </div>
    <div class="audit-step">
      <div class="audit-badge">7</div>
      <div class="audit-content">
        <span class="audit-title">Razorpay Test Checkout</span>
        <span class="audit-desc">${payStepText}.</span>
      </div>
    </div>
    <div class="audit-step">
      <div class="audit-badge">8</div>
      <div class="audit-content">
        <span class="audit-title">Server-Side Signature Verification</span>
        <span class="audit-desc">${sigStepText}.</span>
      </div>
    </div>
    <div class="audit-step">
      <div class="audit-badge">9</div>
      <div class="audit-content">
        <span class="audit-title">Final Payment Audit State</span>
        <span class="audit-desc">State: ${finalStateText}.</span>
      </div>
    </div>
  `;

  modal.style.display = 'flex';
}

export function closeTransactionModal() {
  const modal = document.getElementById('txn-modal');
  if (modal) modal.style.display = 'none';
}

// --------------------------------------------------------------------------
// EXPLAINABILITY SECTION LIVE EXAMPLE
// --------------------------------------------------------------------------

function renderLatestExplanationSection(txns) {
  const container = document.getElementById('explainability-latest-card');
  if (!container) return;

  if (txns.length === 0) {
    container.innerHTML = `
      <div class="result-ready-state" style="min-height: auto; padding: 28px;">
        <h3>No Analysis Records</h3>
        <p>Run an analysis to see a live decision explanation.</p>
      </div>
    `;
    return;
  }

  const latest = txns[0];
  const score = latest.hybridScore ?? latest.riskScore;
  const badgeClass = latest.riskLevel === 'CRITICAL RISK' ? 'critical' : latest.riskLevel === 'HIGH RISK' ? 'high' : latest.riskLevel === 'MEDIUM RISK' ? 'medium' : 'low';

  let rowsHtml = '';
  if (latest.breakdown) {
    latest.breakdown.forEach(item => {
      rowsHtml += `
        <div class="breakdown-row">
          <span class="breakdown-name">${item.name}</span>
          <span class="breakdown-pts">+${item.points}</span>
        </div>
      `;
    });
  }

  container.innerHTML = `
    <div class="result-active-card">
      <div class="res-header">
        <div>
          <span class="res-subtitle">LATEST REAL TRANSACTION DECISION</span>
          <h3 class="res-txn-id">${latest.transactionId}</h3>
        </div>
        <span class="res-level-badge ${badgeClass}">${latest.riskLevel}</span>
      </div>
      <div class="res-score-row">
        <div class="res-decision-info">
          <span class="res-meta-label">AI Decision Output</span>
          <div class="res-decision-val ${badgeClass}">${latest.decision}</div>
        </div>
        <div class="res-decision-info" style="margin-left: auto;">
          <span class="res-meta-label">Final Hybrid Score</span>
          <div class="res-score-num" style="color: #ffffff;">${score} / 100</div>
        </div>
      </div>
      <div class="breakdown-table-wrapper">
        <span class="breakdown-title">Score Contribution Breakdown</span>
        <div class="breakdown-list">
          ${rowsHtml}
          <div class="breakdown-row total">
            <span class="breakdown-name">Final Hybrid Score</span>
            <span class="breakdown-pts">${score} / 100</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

// --------------------------------------------------------------------------
// PERIODIC BACKEND HEALTH MONITOR
// --------------------------------------------------------------------------

export async function checkBackendHealth() {
  const dot = document.querySelector('.status-dot');
  const text = document.querySelector('.status-text');

  if (!dot || !text) return;

  try {
    const res = await fetch(`${BACKEND_URL}/health`, { method: 'GET' });
    if (res.ok) {
      const data = await res.json();
      if (data.model_loaded) {
        dot.className = 'status-dot online';
        text.textContent = 'AI Engine Online';
      } else {
        dot.className = 'status-dot fallback';
        text.textContent = 'Rule Fallback Active';
      }
    } else {
      dot.className = 'status-dot offline';
      text.textContent = 'Backend Offline';
    }
  } catch (err) {
    dot.className = 'status-dot offline';
    text.textContent = 'Backend Offline (Local Fallback)';
  }
}

// --------------------------------------------------------------------------
// DOM EVENT LISTENERS
// --------------------------------------------------------------------------

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    const btnAnalyze = document.getElementById('btn-analyze-risk');
    if (btnAnalyze) {
      btnAnalyze.addEventListener('click', runAnalysis);
    }

    const btnPzCheckout = document.getElementById('btn-razorpay-checkout');
    if (btnPzCheckout) {
      btnPzCheckout.addEventListener('click', initiateRazorpayPayment);
    }

    const btnLow = document.getElementById('sample-low');
    const btnMed = document.getElementById('sample-medium');
    const btnHigh = document.getElementById('sample-high');

    if (btnLow) btnLow.addEventListener('click', () => loadSample('low'));
    if (btnMed) btnMed.addEventListener('click', () => loadSample('medium'));
    if (btnHigh) btnHigh.addEventListener('click', () => loadSample('high'));

    const fSearch = document.getElementById('filter-search');
    const fLevel = document.getElementById('filter-level');
    const fDecision = document.getElementById('filter-decision');
    const fMethod = document.getElementById('filter-method');
    const fSort = document.getElementById('filter-sort');

    if (fSearch) fSearch.addEventListener('input', renderTransactionTable);
    if (fLevel) fLevel.addEventListener('change', renderTransactionTable);
    if (fDecision) fDecision.addEventListener('change', renderTransactionTable);
    if (fMethod) fMethod.addEventListener('change', renderTransactionTable);
    if (fSort) fSort.addEventListener('change', renderTransactionTable);

    const btnModalClose = document.getElementById('modal-close-btn');
    const modalBackdrop = document.getElementById('txn-modal');
    if (btnModalClose) btnModalClose.addEventListener('click', closeTransactionModal);
    if (modalBackdrop) {
      modalBackdrop.addEventListener('click', (e) => {
        if (e.target === modalBackdrop) closeTransactionModal();
      });
    }

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeTransactionModal();
    });

    const btnClearDemo = document.getElementById('btn-clear-demo');
    const clearConfirmModal = document.getElementById('clear-confirm-modal');
    const btnConfirmClear = document.getElementById('btn-confirm-clear');
    const btnCancelClear = document.getElementById('btn-cancel-clear');

    if (btnClearDemo) {
      btnClearDemo.addEventListener('click', () => {
        if (clearConfirmModal) clearConfirmModal.style.display = 'flex';
      });
    }

    if (btnCancelClear) {
      btnCancelClear.addEventListener('click', () => {
        if (clearConfirmModal) clearConfirmModal.style.display = 'none';
      });
    }

    if (btnConfirmClear) {
      btnConfirmClear.addEventListener('click', () => {
        clearTransactions();
        if (clearConfirmModal) clearConfirmModal.style.display = 'none';
        updateDashboardAndHistory();
      });
    }

    // Health check & Initial Render
    checkBackendHealth();
    setInterval(checkBackendHealth, 15000);
    updateDashboardAndHistory();
  });
}
