"use client";

import { Glass } from "./Glass";

interface Props {
  spot: number;
  onSpotChange: (v: number) => void;
  ivPct: number;
  onIvChange: (v: number) => void;
  spotMin?: number;
  spotMax?: number;
  ivMin?: number;
  ivMax?: number;
}

export function SpotIvSlider({
  spot,
  onSpotChange,
  ivPct,
  onIvChange,
  spotMin = 19000,
  spotMax = 24500,
  ivMin = 8,
  ivMax = 80,
}: Props) {
  return (
    <Glass tone="panel" radius={16} padding={14}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        <SliderRow
          label="SPOT"
          value={spot}
          min={spotMin}
          max={spotMax}
          step={5}
          onChange={onSpotChange}
          format={(v) => v.toLocaleString()}
        />
        <SliderRow
          label="IV"
          value={ivPct}
          min={ivMin}
          max={ivMax}
          step={0.5}
          onChange={onIvChange}
          format={(v) => `${v.toFixed(1)}%`}
        />
      </div>
    </Glass>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <span
        style={{
          fontSize: 9,
          letterSpacing: 0.7,
          opacity: 0.5,
          fontWeight: 600,
          width: 36,
        }}
      >
        {label}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ flex: 1, accentColor: "#7c5cf0" }}
      />
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontWeight: 700,
          fontSize: 13,
          width: 76,
          textAlign: "right",
        }}
      >
        {format(value)}
      </span>
    </div>
  );
}
