"use client";

import { Glass, Eyebrow } from "./Glass";
import { TXO_MULTIPLIER } from "@/lib/options";

interface Props {
  pnlPts: number;
  pop: number;
  maxProfit: number;
  maxLoss: number;
}

function PopGauge({ value }: { value: number }) {
  const r = 28;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - value);
  return (
    <svg width={72} height={72} viewBox="0 0 72 72">
      <circle cx={36} cy={36} r={r} fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth={5} />
      <circle
        cx={36}
        cy={36}
        r={r}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={5}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
        transform="rotate(-90 36 36)"
        style={{ transition: "stroke-dashoffset 0.4s ease" }}
      />
      <text
        x={36}
        y={40}
        textAnchor="middle"
        fontSize={14}
        fontWeight={700}
        fill="#fff"
        fontFamily="var(--font-mono)"
      >
        {Math.round(value * 100)}%
      </text>
    </svg>
  );
}

export function PnlNowCard({ pnlPts, pop, maxProfit, maxLoss }: Props) {
  const ntd = pnlPts * TXO_MULTIPLIER;
  const negative = ntd < 0;
  return (
    <Glass tone="panel">
      <Eyebrow>P&L · Now</Eyebrow>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
        <div>
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 30,
              fontWeight: 800,
              color: negative ? "#26a69a" : "#fff",
              letterSpacing: -0.5,
            }}
          >
            {negative ? "−" : "+"}NT${Math.abs(Math.round(ntd)).toLocaleString()}
          </div>
          <div style={{ fontSize: 11, opacity: 0.5, marginTop: 4, fontFamily: "var(--font-mono)" }}>
            {pnlPts.toFixed(1)} pts × {TXO_MULTIPLIER} NTD
          </div>
        </div>
        <div style={{ textAlign: "center" }}>
          <PopGauge value={pop} />
          <div style={{ fontSize: 9, letterSpacing: 0.6, opacity: 0.5, marginTop: 4, fontWeight: 600 }}>
            POP
          </div>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginTop: 14,
          paddingTop: 12,
          borderTop: "1px solid rgba(255,255,255,0.06)",
          fontFamily: "var(--font-mono)",
          fontSize: 11,
        }}
      >
        <span style={{ color: "#ef5350" }}>
          Max profit +NT${Math.round(maxProfit * TXO_MULTIPLIER).toLocaleString()}
        </span>
        <span style={{ color: "#26a69a" }}>
          Max loss NT${Math.round(maxLoss * TXO_MULTIPLIER).toLocaleString()}
        </span>
      </div>
    </Glass>
  );
}
