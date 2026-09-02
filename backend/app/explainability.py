from typing import List, Dict, Any, Optional

def format_explanations(
    rule_explanations: List[Dict[str, Any]],
    ml_prob: Optional[float],
    model_available: bool
) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Formats rule explanations and model probability insights cleanly.
    """
    formatted_explanations = []
    for exp in rule_explanations:
        formatted_explanations.append({
            "title": exp["title"],
            "points": exp["points"],
            "detail": exp["detail"]
        })

    if model_available and ml_prob is not None:
        pct = round(ml_prob * 100)
        formatted_explanations.append({
            "title": "Machine Learning Model Insight",
            "points": pct,
            "detail": f"Scikit-Learn Classifier evaluated a {pct}% fraud probability based on historical feature correlations."
        })

    return formatted_explanations
