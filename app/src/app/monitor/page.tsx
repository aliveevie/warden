"use client";

/**
 * Live agent status and execution log.
 *
 * Shows:
 *   - Agent status (active / paused / no agent)
 *   - Guardrail thresholds
 *   - Live proposal feed (polled every 5 s)
 *   - Per-proposal status chip and result commitment
 */

import { useEffect, useState } from "react";

// ─── Mock data (production: fetch from @warden/sdk via RPC) ──────────────────

interface AgentStatus {
  policyPda:      string;
  dwalletId:      string;
  paused:         boolean;
  nonce:          number;
  lastExecution:  string;
  guardrails: {
    maxTradeSizeBps:   number;
    dailyLossLimitBps: number;
    maxOpenPositions:  number;
    cooldownSeconds:   number;
  };
}

interface Proposal {
  id:               string;
  status:           "Pending" | "GraphExecuted" | "VerifiedCompliant" | "VerifiedNonCompliant" | "Executed" | "Expired";
  resultCommitment: string;
  createdAt:        string;
  expiresAt:        string;
}

const MOCK_AGENT: AgentStatus = {
  policyPda:     "WPo1A2B3C4D5E6F7G8H9",
  dwalletId:     "a1b2c3d4e5f6a7b8",
  paused:        false,
  nonce:         7,
  lastExecution: new Date(Date.now() - 4 * 60_000).toISOString(),
  guardrails: {
    maxTradeSizeBps:   500,
    dailyLossLimitBps: 200,
    maxOpenPositions:  5,
    cooldownSeconds:   60,
  },
};

const MOCK_PROPOSALS: Proposal[] = [
  {
    id:               "prop_9f2a…c4d8",
    status:           "VerifiedCompliant",
    resultCommitment: "0x3d8f…a12b",
    createdAt:        new Date(Date.now() - 3 * 60_000).toISOString(),
    expiresAt:        new Date(Date.now() + 7 * 60_000).toISOString(),
  },
  {
    id:               "prop_1e7b…88a1",
    status:           "GraphExecuted",
    resultCommitment: "0x7c1d…f332",
    createdAt:        new Date(Date.now() - 1 * 60_000).toISOString(),
    expiresAt:        new Date(Date.now() + 9 * 60_000).toISOString(),
  },
  {
    id:               "prop_a04c…3321",
    status:           "VerifiedNonCompliant",
    resultCommitment: "0x00…0000",
    createdAt:        new Date(Date.now() - 12 * 60_000).toISOString(),
    expiresAt:        new Date(Date.now() - 2 * 60_000).toISOString(),
  },
];

// ─── Status chip colours ──────────────────────────────────────────────────────

const STATUS_COLOR: Record<Proposal["status"], string> = {
  Pending:              "#888",
  GraphExecuted:        "#5599FF",
  VerifiedCompliant:    "#22c55e",
  VerifiedNonCompliant: "#ef4444",
  Executed:             "#9945FF",
  Expired:              "#555",
};

export default function MonitorPage() {
  const [agent, setAgent]         = useState<AgentStatus | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading]     = useState(true);
  const [tick, setTick]           = useState(0);

  // Poll every 5 s (production: useEffect with RPC subscription or WebSocket)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 5_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    // Simulate network fetch
    setTimeout(() => {
      setAgent(MOCK_AGENT);
      setProposals(MOCK_PROPOSALS);
      setLoading(false);
    }, 600);
  }, [tick]);

  if (loading) {
    return (
      <main style={s.main}>
        <p style={{ color: "#666" }}>Connecting to devnet…</p>
      </main>
    );
  }

  if (!agent) {
    return (
      <main style={s.main}>
        <h1 style={s.h1}>Monitor</h1>
        <p style={{ color: "#888" }}>No agent found. <a href="/deploy" style={s.link}>Deploy one →</a></p>
      </main>
    );
  }

  return (
    <main style={s.main}>
      <a href="/" style={s.back}>← Back</a>
      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "1rem 0 1.5rem" }}>
        <h1 style={{ ...s.h1, margin: 0 }}>Monitor</h1>
        <span style={{ ...s.chip, background: agent.paused ? "#ef4444" : "#22c55e" }}>
          {agent.paused ? "PAUSED" : "ACTIVE"}
        </span>
      </div>

      {/* Agent card */}
      <div style={s.card}>
        <h2 style={s.h2}>Agent</h2>
        <table style={s.table}><tbody>
          <Row label="Policy PDA"     value={agent.policyPda}      mono />
          <Row label="Ika dWallet"    value={agent.dwalletId}       mono />
          <Row label="Nonce"          value={String(agent.nonce)} />
          <Row label="Last execution" value={fmtTime(agent.lastExecution)} />
        </tbody></table>
      </div>

      {/* Guardrails card */}
      <div style={{ ...s.card, marginTop: 12 }}>
        <h2 style={s.h2}>Guardrails</h2>
        <div style={s.guardrailGrid}>
          <Gauge label="Max trade" value={agent.guardrails.maxTradeSizeBps}   max={10_000} unit="bps" />
          <Gauge label="Loss limit" value={agent.guardrails.dailyLossLimitBps} max={10_000} unit="bps" />
          <Gauge label="Max positions" value={agent.guardrails.maxOpenPositions} max={100} unit="" />
          <Gauge label="Cooldown" value={agent.guardrails.cooldownSeconds} max={3600} unit="s" />
        </div>
      </div>

      {/* Proposal feed */}
      <div style={{ ...s.card, marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ ...s.h2, margin: 0 }}>Proposals</h2>
          <span style={{ fontSize: 12, color: "#555" }}>auto-refreshes every 5 s</span>
        </div>
        {proposals.length === 0 ? (
          <p style={{ color: "#666", marginTop: 12 }}>No proposals yet.</p>
        ) : (
          <div style={{ marginTop: 12 }}>
            {proposals.map((p) => (
              <ProposalRow key={p.id} proposal={p} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ProposalRow({ proposal: p }: { proposal: Proposal }) {
  return (
    <div style={s.proposalRow}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
        <span style={{ ...s.chip, background: STATUS_COLOR[p.status], fontSize: 11 }}>
          {p.status}
        </span>
        <code style={{ fontSize: 13, color: "#ccc" }}>{p.id}</code>
      </div>
      <div style={{ textAlign: "right" as const, fontSize: 12, color: "#555" }}>
        <div>commitment: <code>{p.resultCommitment}</code></div>
        <div style={{ marginTop: 2 }}>{fmtTime(p.createdAt)}</div>
      </div>
    </div>
  );
}

function Gauge({ label, value, max, unit }: { label: string; value: number; max: number; unit: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div style={s.gauge}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: "#888" }}>{label}</span>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{value}{unit}</span>
      </div>
      <div style={s.gaugeTrack}>
        <div style={{ ...s.gaugeFill, width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <tr>
      <td style={s.tdL}>{label}</td>
      <td style={{ ...s.tdV, fontFamily: mono ? "monospace" : "inherit" }}>{value}</td>
    </tr>
  );
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const diff = Math.round((Date.now() - d.getTime()) / 1000);
  if (diff < 60)   return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return d.toLocaleTimeString();
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  main:         { maxWidth: 680, margin: "0 auto", padding: "2rem 1rem", fontFamily: "system-ui, sans-serif", color: "#f0f0f0", background: "#0d0d0d", minHeight: "100vh" },
  back:         { color: "#888", textDecoration: "none", fontSize: 14 },
  h1:           { fontSize: 26, fontWeight: 700, color: "#9945FF" },
  h2:           { fontSize: 16, fontWeight: 600, marginBottom: "0.75rem" },
  link:         { color: "#9945FF" },
  card:         { background: "#1a1a2e", borderRadius: 12, padding: "1.25rem", border: "1px solid #222" },
  chip:         { padding: "2px 8px", borderRadius: 99, fontSize: 12, fontWeight: 700, color: "#fff", display: "inline-block" },
  table:        { width: "100%", borderCollapse: "collapse" },
  tdL:          { padding: "0.3rem 0", color: "#666", fontSize: 13, width: "40%" },
  tdV:          { padding: "0.3rem 0", color: "#f0f0f0", fontSize: 13 },
  guardrailGrid:{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 },
  gauge:        { },
  gaugeTrack:   { height: 6, background: "#2a2a3e", borderRadius: 3, overflow: "hidden" },
  gaugeFill:    { height: "100%", background: "#9945FF", borderRadius: 3, transition: "width 0.4s ease" },
  proposalRow:  { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.7rem 0", borderBottom: "1px solid #222" },
};
