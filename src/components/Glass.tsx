"use client";

import { CSSProperties, ReactNode } from "react";

type Tone = "panel" | "chip" | "raised";

const TONE_STYLES: Record<Tone, CSSProperties> = {
  panel: {
    background:
      "linear-gradient(155deg, rgba(60,68,88,0.42) 0%, rgba(28,34,48,0.32) 60%, rgba(18,22,32,0.28) 100%)",
    border: "1px solid rgba(255,255,255,0.08)",
    boxShadow:
      "0 1px 0 rgba(255,255,255,0.10) inset, 0 -1px 0 rgba(0,0,0,0.30) inset, 0 20px 40px -20px rgba(0,0,0,0.55), 0 1px 2px rgba(0,0,0,0.30)",
  },
  chip: {
    background:
      "linear-gradient(150deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.04) 100%)",
    border: "1px solid rgba(255,255,255,0.10)",
    boxShadow:
      "0 1px 0 rgba(255,255,255,0.10) inset, 0 4px 12px -6px rgba(0,0,0,0.40)",
  },
  raised: {
    background:
      "linear-gradient(155deg, rgba(80,90,115,0.50) 0%, rgba(36,42,58,0.42) 100%)",
    border: "1px solid rgba(255,255,255,0.14)",
    boxShadow:
      "0 1px 0 rgba(255,255,255,0.18) inset, 0 -1px 0 rgba(0,0,0,0.30) inset, 0 28px 56px -24px rgba(0,0,0,0.7)",
  },
};

interface GlassProps {
  tone?: Tone;
  radius?: number;
  padding?: number | string;
  style?: CSSProperties;
  className?: string;
  children?: ReactNode;
  onClick?: () => void;
}

export function Glass({
  tone = "panel",
  radius = 16,
  padding = 16,
  style,
  className,
  children,
  onClick,
}: GlassProps) {
  return (
    <div
      onClick={onClick}
      className={className}
      style={{
        borderRadius: radius,
        padding,
        position: "relative",
        overflow: "hidden",
        backdropFilter: "blur(28px) saturate(140%)",
        WebkitBackdropFilter: "blur(28px) saturate(140%)",
        color: "var(--ink)",
        ...TONE_STYLES[tone],
        ...style,
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "inherit",
          pointerEvents: "none",
          background:
            "linear-gradient(155deg, rgba(255,255,255,0.06) 0%, transparent 30%, transparent 70%, rgba(255,255,255,0.03) 100%)",
        }}
      />
      <div style={{ position: "relative", zIndex: 1 }}>{children}</div>
    </div>
  );
}

export function Eyebrow({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 10,
      }}
    >
      <span className="eyebrow">{children}</span>
      {right}
    </div>
  );
}
