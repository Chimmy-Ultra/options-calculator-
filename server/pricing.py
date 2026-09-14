"""Shared option math for the proxy's data sources.

Both the IB path (futures options, Black-76) and the SinoPac path (TXO index
options, Black-Scholes) invert implied vol from quoted premiums, so the models
live here and stay identical across sources.
"""

import math


def norm_cdf(x: float) -> float:
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def _d1_d2(f: float, k: float, sigma: float, t: float, b: float):
    """b = cost of carry: 0 for Black-76 on futures, r for Black-Scholes on spot."""
    srt = sigma * math.sqrt(t)
    d1 = (math.log(f / k) + (b + sigma * sigma / 2.0) * t) / srt
    return d1, d1 - srt


def price(right: str, s: float, k: float, sigma: float, t: float, r: float, model: str = "b76") -> float:
    """Theoretical premium. Mirrors the frontend's bsPrice() exactly.

    model='b76' → s is the futures price (carry 0, whole payoff discounted).
    model='bs'  → s is the spot/index level (carry r, strike discounted).
    """
    t = max(t, 1e-6)
    sigma = max(sigma, 1e-6)
    b = 0.0 if model == "b76" else r
    df = math.exp(-r * t)
    d1, d2 = _d1_d2(s, k, sigma, t, b)
    fs = s * df if model == "b76" else s
    if right == "C":
        return fs * norm_cdf(d1) - k * df * norm_cdf(d2)
    return k * df * norm_cdf(-d2) - fs * norm_cdf(-d1)


def delta(right: str, s: float, k: float, sigma: float, t: float, r: float, model: str = "b76") -> float:
    t = max(t, 1e-6)
    sigma = max(sigma, 1e-6)
    b = 0.0 if model == "b76" else r
    df = math.exp(-r * t) if model == "b76" else 1.0
    d1, _ = _d1_d2(s, k, sigma, t, b)
    return df * norm_cdf(d1) if right == "C" else -df * norm_cdf(-d1)


def implied_vol(right: str, s: float, k: float, premium: float, t: float, r: float, model: str = "b76"):
    """Invert the premium to a vol by bisection. Returns None when out of bounds."""
    if not premium or premium <= 0 or s <= 0 or k <= 0:
        return None
    lo, hi = 0.01, 3.0
    if not (price(right, s, k, lo, t, r, model) <= premium <= price(right, s, k, hi, t, r, model)):
        return None
    for _ in range(60):
        mid = (lo + hi) / 2.0
        if price(right, s, k, mid, t, r, model) < premium:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2.0
