"use client";

import { Glass, Eyebrow } from "./Glass";
import type { Greeks } from "@/lib/types";

interface Props {
  greeks: Greeks;
}

const ITEMS: { key: keyof Greeks; label: string; symbol: string; digits: number }[] = [
  { key: "delta", label: "DELTA", symbol: "Δ", digits: 3 },
  { key: "gamma", label: "GAMMA", symbol: "Γ", digits: 4 },
  { key: "theta", label: "THETA", symbol: "θ", digits: 2 },
  { key: "vega", label: "VEGA", symbol: "V", digits: 2 },
];

export function GreeksPanel({ greeks }: Props) {
  return (
    <Glass tone="panel">
      <Eyebrow>Greeks</Eyebrow>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {ITEMS.map((it) => {
          const v = greeks[it.key];
          const negative = v < 0;
          return (
            <div
              key={it.key}
              style={{
                padding: "10px 12px",
                borderRadius: 10,
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  marginBottom: 4,
                }}
              >
                <span style={{ fontSize: 9, letterSpacing: 0.7, opacity: 0.5, fontWeight: 600 }}>
                  {it.label}
                </span>
                <span style={{ fontSize: 11, opacity: 0.4, fontFamily: "var(--font-mono)" }}>
                  {it.symbol}
                </span>
              </div>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 17,
                  fontWeight: 700,
                  color: negative ? "#26a69a" : "#fff",
                  letterSpacing: -0.2,
                }}
              >
                {v.toFixed(it.digits)}
              </div>
            </div>
          );
        })}
      </div>
    </Glass>
  );
}
