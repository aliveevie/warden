"use client";

/**
 * Agent deployment wizard.
 *
 * Step 1 — configure guardrails (thresholds)
 * Step 2 — review + deploy (initialize_policy + createDwallet + bind_dwallet)
 * Step 3 — success screen with dWallet address and policy PDA
 */

import { useState } from "react";

interface GuardrailForm {
  maxTradeSizeBps:   string;
  dailyLossLimitBps: string;
  maxOpenPositions:  string;
  cooldownSeconds:   string;
}

const DEFAULT_GUARDRAILS: GuardrailForm = {
  maxTradeSizeBps:   "500",
  dailyLossLimitBps: "200",
  maxOpenPositions:  "5",
  cooldownSeconds:   "60",
};

type Step = "configure" | "review" | "deploying" | "success";

interface DeployResult {
  policyPda:      string;
  dwalletId:      string;
  dwalletAddress: string;
}

export default function DeployPage() {
  const [step, setStep]               = useState<Step>("configure");
  const [form, setForm]               = useState<GuardrailForm>(DEFAULT_GUARDRAILS);
  const [errors, setErrors]           = useState<Partial<GuardrailForm>>({});
  const [result, setResult]           = useState<DeployResult | null>(null);
  const [deployError, setDeployError] = useState<string | null>(null);

  function validate(): boolean {
    const errs: Partial<GuardrailForm> = {};
    const maxTrade = parseInt(form.maxTradeSizeBps, 10);
    const maxLoss  = parseInt(form.dailyLossLimitBps, 10);
    const maxPos   = parseInt(form.maxOpenPositions, 10);
    const cooldown = parseInt(form.cooldownSeconds, 10);

    if (isNaN(maxTrade) || maxTrade < 1 || maxTrade > 10_000)
      errs.maxTradeSizeBps = "Must be 1–10000 bps";
    if (isNaN(maxLoss) || maxLoss < 1 || maxLoss > 10_000)
      errs.dailyLossLimitBps = "Must be 1–10000 bps";
    if (isNaN(maxPos) || maxPos < 1 || maxPos > 100)
      errs.maxOpenPositions = "Must be 1–100";
    if (isNaN(cooldown) || cooldown < 0)
      errs.cooldownSeconds = "Must be ≥ 0";

    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleDeploy() {
    setStep("deploying");
    setDeployError(null);
    try {
      // Simulates the 3-tx deploy flow (initialize_policy + Ika gRPC + bind_dwallet).
      // Production: call WardenAgent.deploy() with a connected wallet.
      await new Promise((r) => setTimeout(r, 2_000));
      setResult({
        policyPda:      "WPo1" + Math.random().toString(36).slice(2, 10).toUpperCase(),
        dwalletId:      Array.from({ length: 8 }, () =>
          Math.floor(Math.random() * 256).toString(16).padStart(2, "0")).join(""),
        dwalletAddress: "bc1q" + Math.random().toString(36).slice(2, 14),
      });
      setStep("success");
    } catch (e) {
      setDeployError(e instanceof Error ? e.message : String(e));
      setStep("review");
    }
  }

  return (
    <main style={s.main}>
      <a href="/" style={s.back}>← Back</a>
      <h1 style={s.h1}>Deploy Agent</h1>

      <div style={s.stepper}>
        {(["configure", "review", "deploying", "success"] as Step[]).map((st, i) => (
          <span key={st} style={{ ...s.dot, background: step === st ? "#9945FF" : "#333" }}>
            {i + 1}
          </span>
        ))}
      </div>

      {step === "configure" && (
        <form style={s.form} onSubmit={(e) => { e.preventDefault(); if (validate()) setStep("review"); }}>
          <h2 style={s.h2}>Guardrail Configuration</h2>
          <Field label="Max trade size (bps)"   hint="Single trade cap as % of AUM × 100. 500 = 5%."        value={form.maxTradeSizeBps}   error={errors.maxTradeSizeBps}   onChange={(v) => setForm({ ...form, maxTradeSizeBps: v })} />
          <Field label="Daily loss limit (bps)" hint="Agent auto-pauses above this daily drawdown."          value={form.dailyLossLimitBps} error={errors.dailyLossLimitBps} onChange={(v) => setForm({ ...form, dailyLossLimitBps: v })} />
          <Field label="Max open positions"     hint="Hard cap on concurrent positions (1–100)."             value={form.maxOpenPositions}  error={errors.maxOpenPositions}  onChange={(v) => setForm({ ...form, maxOpenPositions: v })} />
          <Field label="Cooldown (seconds)"     hint="Minimum interval between consecutive authorisations."  value={form.cooldownSeconds}   error={errors.cooldownSeconds}   onChange={(v) => setForm({ ...form, cooldownSeconds: v })} />
          <button type="submit" style={s.btn}>Continue →</button>
        </form>
      )}

      {step === "review" && (
        <div style={s.card}>
          <h2 style={s.h2}>Review</h2>
          <table style={s.table}><tbody>
            <Row label="Max trade size"   value={`${form.maxTradeSizeBps} bps`} />
            <Row label="Daily loss limit" value={`${form.dailyLossLimitBps} bps`} />
            <Row label="Max positions"    value={form.maxOpenPositions} />
            <Row label="Cooldown"         value={`${form.cooldownSeconds}s`} />
          </tbody></table>
          <p style={s.hint}>
            Deploying sends 3 transactions to Solana devnet:<br />
            1. <code>initialize_policy</code> (warden-policy)<br />
            2. Ika dWallet creation (gRPC)<br />
            3. <code>bind_dwallet</code> (warden-policy)
          </p>
          {deployError && <p style={s.err}>Error: {deployError}</p>}
          <div style={s.row}>
            <button style={s.btnSec} onClick={() => setStep("configure")}>← Back</button>
            <button style={s.btn}    onClick={handleDeploy}>Deploy</button>
          </div>
        </div>
      )}

      {step === "deploying" && (
        <div style={{ ...s.card, textAlign: "center" as const }}>
          <p style={{ fontSize: 48, margin: "1rem 0" }}>⏳</p>
          <p>Initialising policy and provisioning Ika dWallet…</p>
        </div>
      )}

      {step === "success" && result && (
        <div style={s.card}>
          <h2 style={s.h2}>Agent deployed</h2>
          <table style={s.table}><tbody>
            <Row label="Policy PDA"     value={result.policyPda}      mono />
            <Row label="Ika dWallet ID" value={result.dwalletId}      mono />
            <Row label="BTC address"    value={result.dwalletAddress}  mono />
          </tbody></table>
          <p style={s.hint}>
            Save the dWallet local key share displayed in the terminal — it is
            shown once and not stored anywhere.
          </p>
          <a href="/monitor" style={s.btn}>Go to Monitor →</a>
        </div>
      )}
    </main>
  );
}

function Field({ label, hint, value, error, onChange }: {
  label: string; hint: string; value: string; error?: string; onChange: (v: string) => void;
}) {
  return (
    <div style={s.field}>
      <label style={s.label}>{label}</label>
      <input style={{ ...s.input, borderColor: error ? "#ff4444" : "#444" }}
        value={value} onChange={(e) => onChange(e.target.value)} type="number" min="0" />
      <span style={error ? s.err : s.hint}>{error ?? hint}</span>
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

const s: Record<string, React.CSSProperties> = {
  main:   { maxWidth: 600, margin: "0 auto", padding: "2rem 1rem", fontFamily: "system-ui, sans-serif", color: "#f0f0f0", background: "#0d0d0d", minHeight: "100vh" },
  back:   { color: "#888", textDecoration: "none", fontSize: 14 },
  h1:     { fontSize: 26, fontWeight: 700, margin: "1rem 0 1.5rem", color: "#9945FF" },
  h2:     { fontSize: 18, fontWeight: 600, marginBottom: "1rem" },
  stepper:{ display: "flex", gap: 8, marginBottom: "2rem" },
  dot:    { width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, color: "#fff" },
  form:   { display: "flex", flexDirection: "column", gap: "1.25rem" },
  card:   { background: "#1a1a2e", borderRadius: 12, padding: "1.5rem", border: "1px solid #333" },
  field:  { display: "flex", flexDirection: "column", gap: 4 },
  label:  { fontSize: 14, fontWeight: 600, color: "#ccc" },
  input:  { background: "#111", color: "#f0f0f0", border: "1px solid #444", borderRadius: 6, padding: "0.5rem 0.75rem", fontSize: 15, outline: "none" },
  hint:   { fontSize: 12, color: "#666" },
  err:    { fontSize: 12, color: "#ff4444" },
  btn:    { background: "#9945FF", color: "#fff", border: "none", borderRadius: 8, padding: "0.65rem 1.5rem", fontWeight: 700, fontSize: 15, cursor: "pointer", textDecoration: "none", display: "inline-block" },
  btnSec: { background: "#333", color: "#ccc", border: "none", borderRadius: 8, padding: "0.65rem 1.5rem", fontWeight: 600, fontSize: 15, cursor: "pointer" },
  table:  { width: "100%", borderCollapse: "collapse", marginBottom: "1rem" },
  tdL:    { padding: "0.4rem 0", color: "#888", fontSize: 14, width: "45%" },
  tdV:    { padding: "0.4rem 0", color: "#f0f0f0", fontSize: 14 },
  row:    { display: "flex", gap: 12, justifyContent: "flex-end" },
};
