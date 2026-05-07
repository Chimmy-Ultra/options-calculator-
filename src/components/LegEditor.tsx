"use client";

import { useState } from "react";
import { Glass, Eyebrow } from "./Glass";
import type { Leg } from "@/lib/types";
import { netPremium, TXO_MULTIPLIER } from "@/lib/options";

interface Props {
  legs: Leg[];
  onChange: (legs: Leg[]) => void;
  spot: number;
}

const newLegId = () => `leg-${Math.random().toString(36).slice(2, 8)}`;

export function LegEditor({ legs, onChange, spot }: Props) {
  const [adding, setAdding] = useState(false);

  function update(id: string, patch: Partial<Leg>) {
    onChange(legs.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }
  function remove(id: string) {
    onChange(legs.filter((l) => l.id !== id));
  }
  function addLeg(side: Leg["side"], type: Leg["type"]) {
    const strike = Math.round(spot / 50) * 50;
    onChange([...legs, { id: newLegId(), side, type, strike, premium: 50, qty: 1 }]);
    setAdding(false);
  }

  const net = netPremium(legs);

  return (
    <Glass tone="panel">
      <Eyebrow>Legs</Eyebrow>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {legs.length === 0 && (
          <div style={{ fontSize: 12, opacity: 0.5, padding: "12px 0" }}>
            No legs yet. Add a leg to start.
          </div>
        )}
        {legs.map((l) => (
          <div
            key={l.id}
            style={{
              display: "grid",
              gridTemplateColumns: "auto auto 1fr auto auto",
              gap: 6,
              alignItems: "center",
              padding: "8px 10px",
              borderRadius: 10,
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <button
              onClick={() => update(l.id, { side: l.side === "long" ? "short" : "long" })}
              style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: 0.5,
                padding: "3px 8px",
                borderRadius: 6,
                border: "none",
                cursor: "pointer",
                background: l.side === "long" ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.06)",
                color: "#fff",
              }}
            >
              {l.side === "long" ? "+1" : "−1"}
            </button>
            <button
              onClick={() => update(l.id, { type: l.type === "call" ? "put" : "call" })}
              style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: 0.5,
                padding: "3px 8px",
                borderRadius: 6,
                border: "none",
                cursor: "pointer",
                background: l.type === "call" ? "rgba(239,83,80,0.20)" : "rgba(38,166,154,0.20)",
                color: l.type === "call" ? "#ef5350" : "#26a69a",
              }}
            >
              {l.type === "call" ? "C" : "P"}
            </button>
            <input
              type="number"
              value={l.strike}
              step={50}
              onChange={(e) => update(l.id, { strike: Number(e.target.value) })}
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 12,
                padding: "4px 6px",
                borderRadius: 6,
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(0,0,0,0.30)",
                color: "#fff",
                width: "100%",
                textAlign: "right",
              }}
            />
            <input
              type="number"
              value={l.premium}
              step={1}
              onChange={(e) => update(l.id, { premium: Number(e.target.value) })}
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                padding: "4px 6px",
                borderRadius: 6,
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(0,0,0,0.30)",
                color: "rgba(255,255,255,0.7)",
                width: 56,
                textAlign: "right",
              }}
            />
            <button
              onClick={() => remove(l.id)}
              style={{
                fontSize: 14,
                width: 22,
                height: 22,
                borderRadius: 6,
                border: "none",
                background: "transparent",
                color: "rgba(255,255,255,0.4)",
                cursor: "pointer",
              }}
              title="Remove"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 12,
          paddingTop: 10,
          borderTop: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <span style={{ fontSize: 10, opacity: 0.5, letterSpacing: 0.6 }}>NET PREMIUM</span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 13,
            fontWeight: 700,
            color: net >= 0 ? "#ef5350" : "rgba(255,255,255,0.85)",
          }}
        >
          {net >= 0 ? "+" : ""}NT${(net * TXO_MULTIPLIER).toLocaleString()}
        </span>
      </div>

      {adding ? (
        <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          <button onClick={() => addLeg("long", "call")} style={addBtnStyle("#ef5350")}>
            + Long Call
          </button>
          <button onClick={() => addLeg("short", "call")} style={addBtnStyle("#ef5350", true)}>
            − Short Call
          </button>
          <button onClick={() => addLeg("long", "put")} style={addBtnStyle("#26a69a")}>
            + Long Put
          </button>
          <button onClick={() => addLeg("short", "put")} style={addBtnStyle("#26a69a", true)}>
            − Short Put
          </button>
          <button
            onClick={() => setAdding(false)}
            style={{
              gridColumn: "1 / -1",
              padding: "6px",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.10)",
              background: "transparent",
              color: "rgba(255,255,255,0.55)",
              cursor: "pointer",
              fontSize: 11,
            }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          style={{
            marginTop: 10,
            width: "100%",
            padding: "8px",
            borderRadius: 10,
            border: "1px dashed rgba(255,255,255,0.15)",
            background: "transparent",
            color: "rgba(255,255,255,0.65)",
            cursor: "pointer",
            fontSize: 11,
            letterSpacing: 0.5,
            fontWeight: 600,
          }}
        >
          + LEG
        </button>
      )}
    </Glass>
  );
}

function addBtnStyle(color: string, dim = false): React.CSSProperties {
  return {
    padding: "6px 8px",
    borderRadius: 8,
    border: `1px solid ${color}40`,
    background: dim ? `${color}10` : `${color}22`,
    color,
    cursor: "pointer",
    fontSize: 11,
    fontWeight: 600,
  };
}
