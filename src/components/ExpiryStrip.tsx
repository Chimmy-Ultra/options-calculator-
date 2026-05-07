"use client";

import { Glass } from "./Glass";
import type { ExpiryDef } from "@/lib/types";

interface Props {
  expiries: ExpiryDef[];
  selectedId: string;
  onSelect: (id: string) => void;
  multiplier: number;
}

export function ExpiryStrip({ expiries, selectedId, onSelect, multiplier }: Props) {
  return (
    <div
      style={{
        position: "absolute",
        top: 64,
        left: 24,
        right: 24,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        zIndex: 4,
      }}
    >
      <div style={{ display: "flex", gap: 8 }}>
        {expiries.map((e) => {
          const active = e.id === selectedId;
          return (
            <button
              key={e.id}
              onClick={() => onSelect(e.id)}
              style={{
                position: "relative",
                padding: "8px 14px",
                borderRadius: 12,
                fontSize: 12,
                fontFamily: "var(--font-mono)",
                fontWeight: 600,
                cursor: "pointer",
                border: active ? "1px solid var(--accent)" : "1px solid rgba(255,255,255,0.10)",
                background: active ? "rgba(124,92,240,0.18)" : "rgba(255,255,255,0.03)",
                color: active ? "#fff" : "rgba(255,255,255,0.65)",
                transition: "all 0.15s ease",
              }}
            >
              <span style={{ marginRight: 6, opacity: 0.65 }}>{e.label}</span>
              <span>{e.date}</span>
              <span style={{ marginLeft: 6, opacity: 0.45, fontSize: 10 }}>{e.dte}d</span>
              {e.type === "monthly" && (
                <span
                  style={{
                    position: "absolute",
                    top: 4,
                    right: 4,
                    width: 5,
                    height: 5,
                    borderRadius: 999,
                    background: "#f0c068",
                  }}
                />
              )}
            </button>
          );
        })}
      </div>

      <Glass tone="chip" radius={999} padding="6px 12px">
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, opacity: 0.7 }}>
          ×{multiplier} NTD/pt
        </span>
      </Glass>
    </div>
  );
}
