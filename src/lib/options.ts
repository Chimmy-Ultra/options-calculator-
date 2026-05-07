import type { Greeks, Leg } from "./types";

export const TXO_MULTIPLIER = 50;

export function legPayoff(leg: Leg, spotAtExpiry: number): number {
  const sign = leg.side === "long" ? 1 : -1;
  const intrinsic =
    leg.type === "call"
      ? Math.max(spotAtExpiry - leg.strike, 0)
      : Math.max(leg.strike - spotAtExpiry, 0);
  return sign * leg.qty * (intrinsic - leg.premium);
}

export function totalPayoff(legs: Leg[], spotAtExpiry: number): number {
  return legs.reduce((acc, l) => acc + legPayoff(l, spotAtExpiry), 0);
}

export function netPremium(legs: Leg[]): number {
  return legs.reduce((acc, l) => {
    const sign = l.side === "long" ? -1 : 1;
    return acc + sign * l.qty * l.premium;
  }, 0);
}

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * ax);
  const y =
    1 -
    ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return sign * y;
}

export function normCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

export function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

export interface BSInputs {
  s: number;
  k: number;
  t: number;
  sigma: number;
  r?: number;
}

export function blackScholesGreeks(input: BSInputs, type: "call" | "put"): Greeks {
  const { s, k, sigma } = input;
  const r = input.r ?? 0.015;
  const t = Math.max(input.t, 1 / 365);
  const sqrtT = Math.sqrt(t);
  const d1 = (Math.log(s / k) + (r + 0.5 * sigma * sigma) * t) / (sigma * sqrtT);
  const pdf = normPdf(d1);
  const callDelta = normCdf(d1);
  const delta = type === "call" ? callDelta : callDelta - 1;
  const gamma = pdf / (s * sigma * sqrtT);
  const theta = (-s * pdf * sigma) / (2 * sqrtT) / 365;
  const vega = (s * pdf * sqrtT) / 100;
  return { delta, gamma, theta, vega };
}

export function aggregateGreeks(legs: Leg[], spot: number, ivPct: number, dte: number): Greeks {
  const sigma = ivPct / 100;
  const t = dte / 365;
  return legs.reduce<Greeks>(
    (acc, l) => {
      const sign = l.side === "long" ? 1 : -1;
      const g = blackScholesGreeks({ s: spot, k: l.strike, t, sigma }, l.type);
      return {
        delta: acc.delta + sign * l.qty * g.delta,
        gamma: acc.gamma + sign * l.qty * g.gamma,
        theta: acc.theta + sign * l.qty * g.theta,
        vega: acc.vega + sign * l.qty * g.vega,
      };
    },
    { delta: 0, gamma: 0, theta: 0, vega: 0 },
  );
}

export interface PayoffStats {
  maxProfit: number;
  maxLoss: number;
  breakevens: number[];
  pop: number;
}

export function payoffStats(
  legs: Leg[],
  spot: number,
  ivPct: number,
  dte: number,
  rangePct = 0.4,
): PayoffStats {
  if (legs.length === 0) {
    return { maxProfit: 0, maxLoss: 0, breakevens: [], pop: 0 };
  }
  const lo = spot * (1 - rangePct);
  const hi = spot * (1 + rangePct);
  const steps = 400;
  const breakevens: number[] = [];
  let maxProfit = -Infinity;
  let maxLoss = Infinity;
  let prevP = totalPayoff(legs, lo);
  for (let i = 1; i <= steps; i++) {
    const s = lo + (i / steps) * (hi - lo);
    const p = totalPayoff(legs, s);
    if (p > maxProfit) maxProfit = p;
    if (p < maxLoss) maxLoss = p;
    if (Math.sign(p) !== Math.sign(prevP) && prevP !== 0) {
      const sPrev = lo + ((i - 1) / steps) * (hi - lo);
      const frac = Math.abs(prevP) / (Math.abs(prevP) + Math.abs(p));
      breakevens.push(sPrev + frac * (s - sPrev));
    }
    prevP = p;
  }

  const sigma = (ivPct / 100) * Math.sqrt(Math.max(dte, 1) / 365);
  let wins = 0;
  const samples = 2000;
  for (let i = 0; i < samples; i++) {
    const u1 = Math.random() || 1e-9;
    const u2 = Math.random();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const sT = spot * Math.exp(-0.5 * sigma * sigma + sigma * z);
    if (totalPayoff(legs, sT) > 0) wins++;
  }
  const pop = wins / samples;

  return { maxProfit, maxLoss, breakevens, pop };
}

export function probabilityCone(spot: number, ivPct: number, dte: number) {
  const sigma = (ivPct / 100) * Math.sqrt(Math.max(dte, 1) / 365);
  return {
    sigma,
    oneSigUp: spot * (1 + sigma),
    oneSigDown: spot * (1 - sigma),
    twoSigUp: spot * (1 + 2 * sigma),
    twoSigDown: spot * (1 - 2 * sigma),
  };
}
