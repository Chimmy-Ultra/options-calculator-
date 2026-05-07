"use client";

import { Glass, Eyebrow } from "./Glass";

export interface StressDelta {
  spotPct: number;
  ivPct: number;
  label: string;
}

const PRESETS: StressDelta[] = [
  { label: "−5% & IV+30%", spotPct: -0.05, ivPct: 30 },
  { label: "+3% & IV−10%", spotPct: 0.03, ivPct: -10 },
  { label: "−10% crash", spotPct: -0.1, ivPct: 60 },
];

interface Props {
  onApply: (d: StressDelta) => void;
  onReset: () => void;
}

export function StressTest({ onApply, onReset }: Props) {
  return (
    <Glass tone="panel">
      <Eyebrow>Stress Test</Eyebrow>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        {PRESETS.map((p) => (
          <button
            key={p.label}
            onClick={() => onApply(p)}
            style={{
              padding: "8px 6px",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "rgba(255,255,255,0.04)",
              color: "rgba(255,255,255,0.85)",
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={onReset}
          style={{
            padding: "8px 6px",
            borderRadius: 8,
            border: "1px solid rgba(124,92,240,0.40)",
            background: "rgba(124,92,240,0.18)",
            color: "#fff",
            fontSize: 11,
            fontFamily: "var(--font-mono)",
            cursor: "pointer",
            fontWeight: 600,
          }}
        >
          Reset
        </button>
      </div>
    </Glass>
  );
}
