import type { ChainRow, ExpiryDef, Leg, QuoteSnapshot } from "./types";
import { blackScholesGreeks, normCdf, normPdf } from "./options";

export const TXO_SPOT = 21850;
export const STRIKE_STEP = 50;

export const TXO_EXPIRIES: ExpiryDef[] = [
  { id: "w1", label: "W1", dte: 3, type: "weekly", date: "12/04" },
  { id: "w2", label: "W2", dte: 10, type: "weekly", date: "12/11" },
  { id: "m", label: "M", dte: 17, type: "monthly", date: "12/18" },
  { id: "w4", label: "W4", dte: 24, type: "weekly", date: "12/25" },
  { id: "m2", label: "M+1", dte: 45, type: "monthly", date: "01/22" },
];

export const DEFAULT_LEGS: Leg[] = [
  { id: "leg-1", side: "long", type: "call", strike: 21900, premium: 65, qty: 1 },
  { id: "leg-2", side: "short", type: "call", strike: 22100, premium: 18, qty: 1 },
];

export function bsPrice(s: number, k: number, t: number, sigma: number, type: "call" | "put", r = 0.015): number {
  if (t <= 0 || sigma <= 0) {
    const intrinsic = type === "call" ? Math.max(s - k, 0) : Math.max(k - s, 0);
    return intrinsic;
  }
  const sqrtT = Math.sqrt(t);
  const d1 = (Math.log(s / k) + (r + 0.5 * sigma * sigma) * t) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  if (type === "call") {
    return s * normCdf(d1) - k * Math.exp(-r * t) * normCdf(d2);
  }
  return k * Math.exp(-r * t) * normCdf(-d2) - s * normCdf(-d1);
}

function smileIv(strike: number, spot: number, atmIv = 0.24): number {
  const moneyness = Math.log(strike / spot);
  const skew = -0.6 * moneyness;
  const curve = 0.9 * moneyness * moneyness;
  return Math.max(0.08, atmIv + skew + curve);
}

function mockOiVol(strike: number, spot: number) {
  const dist = Math.abs(strike - spot) / 50;
  const oi = Math.round(8000 * Math.exp(-0.05 * dist) + 200);
  const vol = Math.round(2400 * Math.exp(-0.07 * dist) + 50);
  return { oi, vol };
}

export function buildChain(spot: number, dte: number, atmIv = 0.24): ChainRow[] {
  const t = Math.max(dte, 1) / 365;
  const offsets = [-500, -400, -300, -200, -150, -100, -50, 0, 50, 100, 150, 200, 300, 400, 500];
  return offsets.map((off) => {
    const k = Math.round((spot + off) / STRIKE_STEP) * STRIKE_STEP;
    const iv = smileIv(k, spot, atmIv);
    const callMid = bsPrice(spot, k, t, iv, "call");
    const putMid = bsPrice(spot, k, t, iv, "put");
    const half = Math.max(1, Math.round(callMid * 0.02));
    const halfP = Math.max(1, Math.round(putMid * 0.02));
    const callOiVol = mockOiVol(k, spot);
    const putOiVol = mockOiVol(k, spot);
    return {
      strike: k,
      call: {
        bid: Math.max(0, Math.round((callMid - half) * 10) / 10),
        ask: Math.round((callMid + half) * 10) / 10,
        iv: Math.round(iv * 1000) / 10,
        ...callOiVol,
      },
      put: {
        bid: Math.max(0, Math.round((putMid - halfP) * 10) / 10),
        ask: Math.round((putMid + halfP) * 10) / 10,
        iv: Math.round(iv * 1000) / 10,
        ...putOiVol,
      },
    };
  });
}

export function mockQuote(): QuoteSnapshot {
  return {
    symbol: "TXO",
    spot: TXO_SPOT,
    changePct: 0.84,
    ts: Date.now(),
  };
}

// Helper kept for tests / future probes
export function _smileTest(strike: number, spot: number) {
  return { iv: smileIv(strike, spot), pdf: normPdf(0), greeks: blackScholesGreeks({ s: spot, k: strike, t: 30 / 365, sigma: 0.24 }, "call") };
}
