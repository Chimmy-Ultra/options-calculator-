"use client";

import { Glass } from "./Glass";

type Workspace = "chain" | "calc" | "iv" | "compare";

interface Props {
  workspace: Workspace;
  onWorkspaceChange: (w: Workspace) => void;
  spot: number;
  changePct: number;
  settleIn: { days: number; time: string };
}

const TABS: { id: Workspace; label: string; icon: string; enabled: boolean }[] = [
  { id: "chain", label: "Chain", icon: "☷", enabled: false },
  { id: "calc", label: "Calculator", icon: "◈", enabled: true },
  { id: "iv", label: "IV Surface", icon: "◬", enabled: false },
  { id: "compare", label: "Compare", icon: "◫", enabled: false },
];

export function TopBar({ workspace, onWorkspaceChange, spot, changePct, settleIn }: Props) {
  return (
    <div
      style={{
        position: "absolute",
        top: 18,
        left: 24,
        right: 24,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
        zIndex: 5,
      }}
    >
      <Glass tone="chip" radius={999} padding="6px 12px" style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          style={{
            display: "inline-block",
            width: 16,
            height: 16,
            borderRadius: 4,
            background: "linear-gradient(135deg, #7c5cf0 0%, #4dd0c8 100%)",
          }}
        />
        <span style={{ fontWeight: 600, fontSize: 13, letterSpacing: 0.3 }}>Options Lab</span>
      </Glass>

      <Glass tone="chip" radius={999} padding={4} style={{ display: "flex", gap: 2 }}>
        {TABS.map((it) => {
          const active = workspace === it.id;
          return (
            <button
              key={it.id}
              onClick={() => it.enabled && onWorkspaceChange(it.id)}
              disabled={!it.enabled}
              title={!it.enabled ? "Coming soon" : it.label}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                whiteSpace: "nowrap",
                padding: "8px 16px",
                borderRadius: 999,
                border: "none",
                cursor: it.enabled ? "pointer" : "not-allowed",
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: 0.3,
                background: active ? "var(--accent)" : "transparent",
                color: active ? "#fff" : it.enabled ? "rgba(255,255,255,0.65)" : "rgba(255,255,255,0.30)",
                transition: "background 0.18s ease",
              }}
            >
              <span style={{ fontSize: 14 }}>{it.icon}</span>
              {it.label}
            </button>
          );
        })}
      </Glass>

      <div style={{ display: "flex", gap: 8 }}>
        <Glass tone="chip" radius={999} padding="6px 12px">
          <span style={{ fontSize: 11, opacity: 0.55, marginRight: 6 }}>TXO</span>
          <span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 13 }}>
            {spot.toLocaleString()}
          </span>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              marginLeft: 6,
              color: changePct >= 0 ? "#ef5350" : "#26a69a",
            }}
          >
            {changePct >= 0 ? "+" : ""}
            {changePct.toFixed(2)}%
          </span>
        </Glass>
        <Glass tone="chip" radius={999} padding="6px 12px">
          <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 999, background: "#f0c068", marginRight: 6 }} />
          <span style={{ fontSize: 11, opacity: 0.55 }}>SETTLE</span>
          <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: 12, marginLeft: 6 }}>
            {settleIn.days}d · {settleIn.time}
          </span>
        </Glass>
      </div>
    </div>
  );
}
