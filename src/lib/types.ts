export type LegSide = "long" | "short";
export type OptionType = "call" | "put";

export interface Leg {
  id: string;
  side: LegSide;
  type: OptionType;
  strike: number;
  premium: number;
  qty: number;
}

export interface ExpiryDef {
  id: string;
  label: string;
  dte: number;
  type: "weekly" | "monthly";
  date: string;
}

export interface ChainRow {
  strike: number;
  call: { bid: number; ask: number; iv: number; vol: number; oi: number };
  put: { bid: number; ask: number; iv: number; vol: number; oi: number };
}

export interface Greeks {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
}

export interface QuoteSnapshot {
  symbol: string;
  spot: number;
  changePct: number;
  ts: number;
}
