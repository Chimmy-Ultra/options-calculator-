"use client";

import { useMemo } from "react";
import type { Leg } from "@/lib/types";
import { totalPayoff, probabilityCone } from "@/lib/options";

interface Props {
  legs: Leg[];
  spot: number;
  ivPct: number;
  dte: number;
  width?: number;
  height?: number;
  rangePct?: number;
  sliceFrac?: number;
  showCone?: boolean;
  showKeyNumbers?: boolean;
  breakevens?: number[];
}

const PROFIT = "#ef5350";
const LOSS = "#26a69a";
const BREAKEVEN = "#a78bfa";
const AXIS = "rgba(255,255,255,0.15)";
const TEXT = "rgba(255,255,255,0.55)";
const CONE_1 = "rgba(167,139,250,0.36)";
const CONE_2 = "rgba(167,139,250,0.18)";

export function PayoffChart({
  legs,
  spot,
  ivPct,
  dte,
  width = 560,
  height = 220,
  rangePct = 0.08,
  sliceFrac = 1,
  showCone = true,
  showKeyNumbers = true,
  breakevens = [],
}: Props) {
  const xs = useMemo(() => {
    const arr: number[] = [];
    const lo = spot * (1 - rangePct);
    const hi = spot * (1 + rangePct);
    for (let i = 0; i <= 100; i++) arr.push(lo + (i / 100) * (hi - lo));
    return arr;
  }, [spot, rangePct]);

  const ys = useMemo(
    () => xs.map((s) => totalPayoff(legs, s) * sliceFrac),
    [xs, legs, sliceFrac],
  );

  const pad = 16;
  const W = width;
  const H = height;
  const maxY = Math.max(...ys.map(Math.abs), 1);
  const x = (i: number) => pad + (i / (xs.length - 1)) * (W - pad * 2);
  const y = (v: number) => H / 2 - (v / maxY) * (H / 2 - pad);
  const xForSpot = (s: number) =>
    pad + ((s - xs[0]) / (xs[xs.length - 1] - xs[0])) * (W - pad * 2);

  const cone = useMemo(
    () => probabilityCone(spot, ivPct, dte),
    [spot, ivPct, dte],
  );

  const segments: { sign: number; pts: [number, number][] }[] = [];
  let cur: { sign: number; pts: [number, number][] } | null = null;
  ys.forEach((v, i) => {
    const sign = v >= 0 ? 1 : -1;
    if (!cur || cur.sign !== sign) {
      if (cur) segments.push(cur);
      cur = { sign, pts: [[x(i), y(v)]] };
    } else {
      cur.pts.push([x(i), y(v)]);
    }
  });
  if (cur) segments.push(cur);

  const linePath = ys
    .map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`)
    .join(" ");

  const maxProfit = Math.max(...ys);
  const maxLoss = Math.min(...ys);

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      style={{ display: "block", width: "100%", height: "auto" }}
    >
      {showCone && (
        <>
          <rect
            x={xForSpot(cone.twoSigDown)}
            y={pad}
            width={Math.max(0, xForSpot(cone.twoSigUp) - xForSpot(cone.twoSigDown))}
            height={H - pad * 2}
            fill={CONE_2}
          />
          <rect
            x={xForSpot(cone.oneSigDown)}
            y={pad}
            width={Math.max(0, xForSpot(cone.oneSigUp) - xForSpot(cone.oneSigDown))}
            height={H - pad * 2}
            fill={CONE_1}
          />
        </>
      )}

      <line x1={pad} y1={H / 2} x2={W - pad} y2={H / 2} stroke={AXIS} strokeWidth={1} />

      {segments.map((seg, idx) => {
        const fillColor = seg.sign > 0 ? PROFIT : LOSS;
        const opacity = 0.22;
        const path = `M${seg.pts[0][0]},${H / 2} ${seg.pts
          .map((p) => `L${p[0]},${p[1]}`)
          .join(" ")} L${seg.pts[seg.pts.length - 1][0]},${H / 2} Z`;
        return <path key={idx} d={path} fill={fillColor} fillOpacity={opacity} />;
      })}

      <path d={linePath} fill="none" stroke="#e8eaef" strokeWidth={1.5} />

      <line
        x1={xForSpot(spot)}
        y1={pad}
        x2={xForSpot(spot)}
        y2={H - pad}
        stroke="rgba(255,255,255,0.45)"
        strokeDasharray="2,3"
        strokeWidth={1}
      />
      <circle cx={xForSpot(spot)} cy={H / 2} r={3} fill="#e8eaef" />

      {breakevens.map((be, i) => (
        <g key={`be-${i}`}>
          <line
            x1={xForSpot(be)}
            y1={pad}
            x2={xForSpot(be)}
            y2={H - pad}
            stroke={BREAKEVEN}
            strokeDasharray="3,3"
            strokeWidth={1}
          />
          <text
            x={xForSpot(be)}
            y={pad + 10}
            fontSize={10}
            fill={BREAKEVEN}
            textAnchor="middle"
            fontFamily="var(--font-mono)"
          >
            BE {Math.round(be).toLocaleString()}
          </text>
        </g>
      ))}

      {showKeyNumbers && (
        <>
          <text
            x={W - pad}
            y={pad + 10}
            fontSize={11}
            fill={PROFIT}
            textAnchor="end"
            fontFamily="var(--font-mono)"
            fontWeight={600}
          >
            ↑ +{Math.round(maxProfit).toLocaleString()}
          </text>
          <text
            x={pad}
            y={H - pad / 2}
            fontSize={11}
            fill={LOSS}
            textAnchor="start"
            fontFamily="var(--font-mono)"
            fontWeight={600}
          >
            ↓ {Math.round(maxLoss).toLocaleString()}
          </text>
        </>
      )}

      <text
        x={pad}
        y={pad + 10}
        fontSize={9}
        fill={TEXT}
        fontFamily="var(--font-mono)"
        letterSpacing={0.5}
      >
        P&L · pts
      </text>
      <text
        x={W - pad}
        y={H - 4}
        fontSize={9}
        fill={TEXT}
        textAnchor="end"
        fontFamily="var(--font-mono)"
      >
        SPOT
      </text>
    </svg>
  );
}
