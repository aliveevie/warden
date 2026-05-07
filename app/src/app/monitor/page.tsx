"use client";

/**
 * Live agent + proposal status read from Solana devnet.
 *
 * Reads the warden-core program's PDAs directly via @solana/web3.js,
 * decodes Anchor account layouts in-process, and refreshes every 5s.
 * No mock data — what you see is whatever is on devnet right now.
 */

import { useEffect, useMemo, useState } from "react";
import { Connection } from "@solana/web3.js";
import {
  DEVNET_RPC,
  WARDEN_PROGRAM_ID,
  ENCRYPT_PROGRAM_ID,
  fetchAllProposals,
  type Proposal,
  type ProposalStatus,
} from "../../lib/wardenClient";

const STATUS_COLOR: Record<ProposalStatus, string> = {
  PendingDecryption: "#5599FF",
  Decrypting:        "#f59e0b",
  Authorised:        "#22c55e",
  Rejected:          "#ef4444",
};

export default function MonitorPage() {
  const conn = useMemo(() => new Connection(DEVNET_RPC, "confirmed"), []);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [tick, setTick]           = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 5_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const props = await fetchAllProposals(conn);
        if (cancelled) return;
        setProposals(props);
        setError(null);
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message ?? String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [conn, tick]);

  return (
    <main style={s.main}>
      <a href="/" style={s.back}>← Back</a>
      <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "1rem 0 1.5rem" }}>
        <h1 style={{ ...s.h1, margin: 0 }}>Monitor</h1>
        <span style={{ ...s.chip, background: "#9945FF" }}>devnet</span>
      </div>

      <div style={s.card}>
        <h2 style={s.h2}>Programs</h2>
        <table style={s.table}><tbody>
          <Row label="warden-core"   value={WARDEN_PROGRAM_ID.toBase58()}  mono />
          <Row label="Encrypt"       value={ENCRYPT_PROGRAM_ID.toBase58()} mono />
          <Row label="RPC"           value={DEVNET_RPC} mono />
        </tbody></table>
      </div>

      <div style={{ ...s.card, marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ ...s.h2, margin: 0 }}>Proposals</h2>
          <span style={{ fontSize: 12, color: "#555" }}>auto-refreshes every 5s</span>
        </div>
        {error && <p style={{ color: "#ef4444", marginTop: 12 }}>RPC error: {error}</p>}
        {loading && proposals.length === 0 && (
          <p style={{ color: "#666", marginTop: 12 }}>Reading on-chain state…</p>
        )}
        {!loading && proposals.length === 0 && (
          <p style={{ color: "#666", marginTop: 12 }}>
            No proposals on devnet yet — run <code>bun scripts/devnet/e2e-demo.ts</code>.
          </p>
        )}
        {proposals.length > 0 && (
          <div style={{ marginTop: 12 }}>
            {proposals.map((p) => <ProposalRow key={p.pda} proposal={p} />)}
          </div>
        )}
      </div>
    </main>
  );
}

function ProposalRow({ proposal: p }: { proposal: Proposal }) {
  return (
    <div style={s.proposalRow}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ ...s.chip, background: STATUS_COLOR[p.status], fontSize: 11 }}>
            {p.status}
          </span>
          <code style={{ fontSize: 13, color: "#ccc", overflow: "hidden", textOverflow: "ellipsis" }}>
            {p.proposalId.slice(0, 12)}…{p.proposalId.slice(-6)}
          </code>
        </div>
        <div style={{ marginTop: 4, fontSize: 11, color: "#666", fontFamily: "monospace" }}>
          PDA {short(p.pda)} · agent {short(p.agent)}
        </div>
      </div>
      <div style={{ textAlign: "right" as const, fontSize: 11, color: "#555" }}>
        <div>commit: <code>{p.resultCommitment.slice(0, 10)}…</code></div>
        <div style={{ marginTop: 2 }}>{fmtTime(p.createdAt * 1000)}</div>
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <tr>
      <td style={s.tdL}>{label}</td>
      <td style={{ ...s.tdV, fontFamily: mono ? "monospace" : "inherit", fontSize: 12 }}>{value}</td>
    </tr>
  );
}

function short(s: string): string {
  return s.length > 16 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
}

function fmtTime(ms: number): string {
  if (!ms) return "—";
  const diff = Math.round((Date.now() - ms) / 1000);
  if (diff < 60)   return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return new Date(ms).toLocaleTimeString();
}

const s: Record<string, React.CSSProperties> = {
  main:        { maxWidth: 720, margin: "0 auto", padding: "2rem 1rem", fontFamily: "system-ui, sans-serif", color: "#f0f0f0", background: "#0d0d0d", minHeight: "100vh" },
  back:        { color: "#888", textDecoration: "none", fontSize: 14 },
  h1:          { fontSize: 26, fontWeight: 700, color: "#9945FF" },
  h2:          { fontSize: 16, fontWeight: 600, marginBottom: "0.75rem" },
  card:        { background: "#1a1a2e", borderRadius: 12, padding: "1.25rem", border: "1px solid #222" },
  chip:        { padding: "2px 8px", borderRadius: 99, fontSize: 12, fontWeight: 700, color: "#fff", display: "inline-block" },
  table:       { width: "100%", borderCollapse: "collapse" },
  tdL:         { padding: "0.3rem 0", color: "#666", fontSize: 13, width: "30%" },
  tdV:         { padding: "0.3rem 0", color: "#f0f0f0" },
  proposalRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.7rem 0", borderBottom: "1px solid #222", gap: 12 },
};
