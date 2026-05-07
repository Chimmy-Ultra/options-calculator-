"use client";

import { useEffect, useMemo, useState } from "react";
import { Glass, Eyebrow } from "./Glass";
import { TopBar } from "./TopBar";
import { ExpiryStrip } from "./ExpiryStrip";
import { LegEditor } from "./LegEditor";
import { GreeksPanel } from "./GreeksPanel";
import { PayoffChart } from "./PayoffChart";
import { PnlNowCard } from "./PnlNowCard";
import { SpotIvSlider } from "./SpotIvSlider";
import { StressTest, type StressDelta } from "./StressTest";
import type { Leg } from "@/lib/types";
import { aggregateGreeks, payoffStats, totalPayoff, TXO_MULTIPLIER } from "@/lib/options";
import { DEFAULT_LEGS, TXO_EXPIRIES, TXO_SPOT } from "@/lib/mock";

const COL_W_LEFT = 320;
const COL_W_RIGHT = 360;

export default function CalculatorWorkspace() {
  const [workspace, setWorkspace] = useState<"chain" | "calc" | "iv" | "compare">("calc");
  const [expiryId, setExpiryId] = useState("m");
  const [legs, setLegs] = useState<Leg[]>(DEFAULT_LEGS);
  const [spot, setSpot] = useState(TXO_SPOT);
  const [ivPct, setIvPct] = useState(24);
  const [sliceFrac, setSliceFrac] = useState(1);
  const [view, setView] = useState<"payoff" | "cross" | "theta" | "iv">("payoff");
  const [quoteSpot, setQuoteSpot] = useState(TXO_SPOT);
  const [quoteChange, setQuoteChange] = useState(0.84);

  const expiry = TXO_EXPIRIES.find((e) => e.id === expiryId) ?? TXO_EXPIRIES[2];

  useEffect(() => {
    let cancelled = false;
    fetch("/api/quotes")
      .then((r) => r.json())
      .then((q) => {
        if (cancelled) return;
        setQuoteSpot(q.spot);
        setQuoteChange(q.changePct);
        setSpot(q.spot);
      })
      .catch(() => {
        // mock fallback already in place
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const stats = useMemo(
    () => payoffStats(legs, spot, ivPct, expiry.dte),
    [legs, spot, ivPct, expiry.dte],
  );
  const greeks = useMemo(
    () => aggregateGreeks(legs, spot, ivPct, expiry.dte),
    [legs, spot, ivPct, expiry.dte],
  );
  const pnlNow = useMemo(() => totalPayoff(legs, spot) * sliceFrac, [legs, spot, sliceFrac]);

  function applyStress(d: StressDelta) {
    setSpot((s) => Math.round(s * (1 + d.spotPct)));
    setIvPct((v) => Math.max(5, Math.min(120, v + d.ivPct)));
  }
  function resetStress() {
    setSpot(quoteSpot);
    setIvPct(24);
  }

  return (
    <div style={{ position: "relative", minHeight: "100vh", paddingBottom: 100 }}>
      <BackgroundOrbs />
      <TopBar
        workspace={workspace}
        onWorkspaceChange={setWorkspace}
        spot={quoteSpot}
        changePct={quoteChange}
        settleIn={{ days: expiry.dte, time: "13:30" }}
      />
      <ExpiryStrip
        expiries={TXO_EXPIRIES}
        selectedId={expiryId}
        onSelect={setExpiryId}
        multiplier={TXO_MULTIPLIER}
      />

      <div
        style={{
          position: "absolute",
          top: 110,
          left: 24,
          width: COL_W_LEFT,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <LegEditor legs={legs} onChange={setLegs} spot={spot} />
        <StressTest onApply={applyStress} onReset={resetStress} />
        <SavedScenarios />
      </div>

      <div
        style={{
          position: "absolute",
          top: 110,
          left: COL_W_LEFT + 48,
          right: COL_W_RIGHT + 48,
        }}
      >
        <ChartCard
          legs={legs}
          spot={spot}
          ivPct={ivPct}
          dte={expiry.dte}
          sliceFrac={sliceFrac}
          onSliceChange={setSliceFrac}
          view={view}
          onViewChange={setView}
          breakevens={stats.breakevens}
        />
      </div>

      <div
        style={{
          position: "absolute",
          top: 110,
          right: 24,
          width: COL_W_RIGHT,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <PnlNowCard
          pnlPts={pnlNow}
          pop={stats.pop}
          maxProfit={stats.maxProfit}
          maxLoss={stats.maxLoss}
        />
        <GreeksPanel greeks={greeks} />
        <PnlRangeBar maxLoss={stats.maxLoss} maxProfit={stats.maxProfit} current={pnlNow} />
      </div>

      <div
        style={{
          position: "fixed",
          bottom: 16,
          left: 24,
          right: 24,
          zIndex: 6,
        }}
      >
        <SpotIvSlider
          spot={spot}
          onSpotChange={setSpot}
          ivPct={ivPct}
          onIvChange={setIvPct}
        />
      </div>
    </div>
  );
}

function ChartCard({
  legs,
  spot,
  ivPct,
  dte,
  sliceFrac,
  onSliceChange,
  view,
  onViewChange,
  breakevens,
}: {
  legs: Leg[];
  spot: number;
  ivPct: number;
  dte: number;
  sliceFrac: number;
  onSliceChange: (v: number) => void;
  view: "payoff" | "cross" | "theta" | "iv";
  onViewChange: (v: "payoff" | "cross" | "theta" | "iv") => void;
  breakevens: number[];
}) {
  const tabs = [
    { id: "payoff", label: "Payoff" },
    { id: "cross", label: "P&L" },
    { id: "theta", label: "Theta" },
    { id: "iv", label: "IV" },
  ] as const;
  return (
    <Glass tone="panel">
      <Eyebrow
        right={
          <Glass tone="chip" radius={999} padding={3}>
            <div style={{ display: "flex", gap: 0 }}>
              {tabs.map((t) => {
                const active = view === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => onViewChange(t.id)}
                    style={{
                      padding: "5px 12px",
                      borderRadius: 999,
                      border: "none",
                      background: active ? "var(--accent)" : "transparent",
                      color: active ? "#fff" : "rgba(255,255,255,0.55)",
                      fontSize: 10,
                      fontWeight: 600,
                      letterSpacing: 0.4,
                      cursor: "pointer",
                    }}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          </Glass>
        }
      >
        Strategy Payoff
      </Eyebrow>

      {view === "payoff" && (
        <>
          <PayoffChart
            legs={legs}
            spot={spot}
            ivPct={ivPct}
            dte={dte}
            sliceFrac={sliceFrac}
            breakevens={breakevens}
            height={260}
          />
          <div
            style={{
              marginTop: 14,
              display: "flex",
              alignItems: "center",
              gap: 12,
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              opacity: 0.7,
            }}
          >
            <span>NOW</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={sliceFrac}
              onChange={(e) => onSliceChange(Number(e.target.value))}
              style={{ flex: 1, accentColor: "var(--accent)" }}
            />
            <span>EXPIRY</span>
            <span style={{ marginLeft: 8, opacity: 0.5 }}>
              t = {(sliceFrac * dte).toFixed(0)}d
            </span>
          </div>
        </>
      )}

      {view !== "payoff" && (
        <div
          style={{
            height: 260,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "rgba(255,255,255,0.3)",
            fontSize: 11,
            letterSpacing: 0.5,
          }}
        >
          {view.toUpperCase()} chart · coming soon
        </div>
      )}
    </Glass>
  );
}

function SavedScenarios() {
  const items = [
    { t: "2w ago", pnl: 12250 },
    { t: "1w ago", pnl: -4000 },
    { t: "3d ago", pnl: 9000 },
    { t: "today", pnl: 19000, gold: true },
  ];
  return (
    <Glass tone="panel">
      <Eyebrow>Saved Scenarios</Eyebrow>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        {items.map((it, i) => (
          <div key={i} style={{ textAlign: "center" }}>
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: 999,
                background: it.gold ? "#f0c068" : "rgba(255,255,255,0.20)",
                margin: "0 auto 6px",
              }}
            />
            <div style={{ fontSize: 9, opacity: 0.5, letterSpacing: 0.4 }}>{it.t}</div>
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                marginTop: 3,
                color: it.pnl >= 0 ? "#ef5350" : "#26a69a",
                fontWeight: 600,
              }}
            >
              {it.pnl >= 0 ? "+" : ""}
              {(it.pnl / 1000).toFixed(1)}K
            </div>
          </div>
        ))}
      </div>
    </Glass>
  );
}

function PnlRangeBar({
  maxLoss,
  maxProfit,
  current,
}: {
  maxLoss: number;
  maxProfit: number;
  current: number;
}) {
  const span = Math.max(1, maxProfit - maxLoss);
  const pos = ((current - maxLoss) / span) * 100;
  return (
    <Glass tone="panel" padding={14}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: 10,
          fontFamily: "var(--font-mono)",
          marginBottom: 6,
          opacity: 0.6,
        }}
      >
        <span>{Math.round(maxLoss * TXO_MULTIPLIER / 1000)}K</span>
        <span style={{ letterSpacing: 0.6, fontWeight: 600 }}>P&L RANGE</span>
        <span>+{Math.round(maxProfit * TXO_MULTIPLIER / 1000)}K</span>
      </div>
      <div
        style={{
          position: "relative",
          height: 8,
          borderRadius: 999,
          background: "linear-gradient(90deg, #26a69a 0%, rgba(255,255,255,0.10) 50%, #ef5350 100%)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: `${Math.max(0, Math.min(100, pos))}%`,
            top: -2,
            width: 3,
            height: 12,
            borderRadius: 2,
            background: "#fff",
            transform: "translateX(-50%)",
            boxShadow: "0 0 8px rgba(255,255,255,0.6)",
          }}
        />
      </div>
    </Glass>
  );
}

function BackgroundOrbs() {
  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        pointerEvents: "none",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: "-10%",
          left: "-10%",
          width: 600,
          height: 600,
          borderRadius: 999,
          background: "radial-gradient(circle, rgba(124,92,240,0.20) 0%, transparent 60%)",
          filter: "blur(40px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: "-15%",
          right: "-10%",
          width: 700,
          height: 700,
          borderRadius: 999,
          background: "radial-gradient(circle, rgba(77,208,200,0.16) 0%, transparent 60%)",
          filter: "blur(40px)",
        }}
      />
    </div>
  );
}
