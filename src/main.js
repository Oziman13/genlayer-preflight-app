import {
  hasWallet, readClient, writeClient, connectWallet, ensureNetwork, currentNetworkOk, watchWallet,
  sendAndConfirm, watchTx, loadPending, clearPending, EXPLORER,
} from "./wallet.js";
import { computeSubmit, validateUrl } from "./logic.js";

const CONTRACT_ADDRESS = "0x1B1838955D84b48d0b548C278759f58b0dD6ae83";
const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const short = a => a ? String(a).slice(0, 6) + "…" + String(a).slice(-4) : "";
const POLL = Number(new URLSearchParams(location.search).get("poll")) || undefined; // test hook: faster polling

const reader = readClient();
let wallet = null;        // write client for the connected account
let address = null;       // connected account
let busy = false;
let rulesLoaded = false, ruleCount = 0, submissionCount = null;

$("contractAddr").textContent = CONTRACT_ADDRESS;
$("explorerLink").href = "https://explorer-studio.genlayer.com/address/" + CONTRACT_ADDRESS;

function say(text, err = false) { const m = $("txmsg"); m.className = "status-line" + (err ? " err" : ""); m.textContent = text; }
const txLink = h => EXPLORER ? `\nExplorer: ${EXPLORER}/tx/${h}` : "";

// ---------- reading (no wallet needed) ----------
// Reads can fail briefly on the public Studio RPC (rate limit, hiccup), so retry a few times before giving up.
async function readText(fn, args = []) {
  let last;
  for (let i = 0; i < 4; i++) {
    try { return await reader.readContract({ address: CONTRACT_ADDRESS, functionName: fn, args }); }
    catch (e) { last = e; await new Promise(r => setTimeout(r, (POLL ? 50 : 1000) * (i + 1))); }
  }
  throw last;
}
async function readJSON(fn, args = []) { const r = await readText(fn, args); return typeof r === "string" ? JSON.parse(r) : r; }

async function loadProgram() {
  try {
    const [name, threshold, count] = await Promise.all([readText("get_program_name"), readText("get_pass_threshold"), readText("get_submission_count")]);
    $("programName").textContent = name;
    $("threshold").textContent = Number(threshold) + "%";
    $("subCount").textContent = Number(count);
    submissionCount = Number(count);
  } catch (e) { console.error(e); }
}

async function loadRubric() {
  try {
    const rubric = await readJSON("get_rubric_json");
    ruleCount = rubric.rules.length;
    rulesLoaded = true;
    $("rubric").innerHTML = ruleCount ? rubric.rules.map(r => `
      <div class="rule">
        <div class="rule-text">${esc(r.text)} <span style="color:var(--muted)">· weight ${esc(r.weight)}</span></div>
        <span class="badge ${r.mandatory ? "mand" : "adv"}">${r.mandatory ? "MANDATORY" : "ADVISORY"}</span>
      </div>`).join("") : '<div class="empty">No rules yet.</div>';
  } catch (e) { $("rubric").innerHTML = '<div class="empty">Could not load rubric.</div>'; console.error(e); }
  renderSubmit();
}

async function loadSubmissions() {
  try {
    const count = Number(await readText("get_submission_count"));
    if (!count) { $("submissions").innerHTML = '<div class="empty">No submissions yet — be the first.</div>'; return; }
    let html = "";
    for (let i = count - 1; i >= 0; i--) {
      const s = await readJSON("get_submission_json", [i]);
      const badgeClass = s.status === "READY" ? "ready" : "needs";
      html += `
        <div class="sub">
          <div class="sub-top">
            <span class="badge ${badgeClass}">${esc(s.status)} · ${esc(s.score)}%</span>
            <span style="font-size:12px;color:var(--muted)">#${esc(s.id)} · rubric v${esc(s.rubric_version)}</span>
          </div>
          <div class="sub-url"><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer" style="color:inherit">${esc(s.url)}</a></div>
          <div class="sub-meta">by ${esc(short(s.submitter))}</div>
          <div class="verdicts">${(s.verdicts || []).map(v => `<span class="v ${v.result === "PASS" ? "pass" : "fail"}">#${esc(v.id)} ${esc(v.result)}</span>`).join("")}</div>
        </div>`;
    }
    $("submissions").innerHTML = html;
  } catch (e) { $("submissions").innerHTML = '<div class="empty">Could not load submissions. Press Refresh to try again.</div>'; console.error(e); }
}

async function refreshAll() { await Promise.all([loadProgram(), loadRubric(), loadSubmissions()]); }

// ---------- wallet ----------
function renderWallet() {
  $("addrLine").textContent = address ? short(address) : (hasWallet() ? "" : "No browser wallet found");
  $("connectBtn").textContent = address ? "Reconnect" : "Connect Wallet";
  renderSubmit();
}

async function doConnect() {
  const w = $("wmsg"); w.className = "status-line"; w.textContent = "";
  $("connectBtn").disabled = true;
  try {
    address = await connectWallet();
    wallet = writeClient(address);
  } catch (e) {
    w.className = "status-line err"; w.textContent = e.message || String(e);
  } finally {
    $("connectBtn").disabled = false;
    renderWallet();
  }
}
$("connectBtn").onclick = doConnect;
watchWallet({
  onAccounts: a => { address = a && a[0] ? a[0] : null; wallet = address ? writeClient(address) : null; renderWallet(); },
  onChain: async () => {
    const ok = await currentNetworkOk();
    $("wmsg").className = ok ? "status-line" : "status-line err";
    $("wmsg").textContent = ok ? "" : "Wrong network: switch the wallet to GenLayer Studio before submitting (the page will also ask).";
  },
});

// ---------- submit button state ----------
function renderSubmit() {
  const s = computeSubmit({ rulesLoaded, ruleCount, hasWallet: hasWallet(), address, busy, urlText: $("urlInput").value });
  $("submitBtn").disabled = !s.ok;
  $("submitReason").textContent = s.ok ? "" : s.reason;
}
$("urlInput").addEventListener("input", renderSubmit);
document.querySelectorAll("[data-url]").forEach(a => a.addEventListener("click", e => { e.preventDefault(); $("urlInput").value = a.dataset.url; renderSubmit(); }));

// ---------- sending ----------
function describe(o, hash) {
  const t = hash ? txLink(hash) : "";
  switch (o.kind) {
    case "APPLIED": return { text: `The review was applied: the transaction is FINALIZED and the contract call succeeded.${t}`, err: false };
    case "REJECTED_BY_CONTRACT": return { text: `The transaction is FINALIZED but the contract refused the call (for example an invalid URL or an empty rubric). Nothing was stored.${t}`, err: true };
    case "NOT_APPLIED": return { text: `The review was not applied (network status ${o.status}${o.vote ? ", vote " + o.vote : ""}). Validators did not reach a usable decision, so nothing was stored. You can submit again.${t}`, err: true };
    case "UNCLEAR": return { text: `The transaction is FINALIZED but its execution result is unreadable (${o.exec || "empty"}). Check the explorer before submitting again.${t}`, err: true };
    case "STILL_PENDING": return { text: `The review is still not final after waiting. It may yet apply. Reload this page to keep watching and do not resend yet.${t}`, err: true };
    case "REJECTED_BY_USER": return { text: o.message, err: false };
    case "AMBIGUOUS": return { text: o.message, err: true };
    case "NOT_SENT": return { text: o.message, err: true };
    default: return { text: `submit_for_review: ${o.kind}`, err: true };
  }
}

function progress() {
  return u => {
    if (u.stage === "submitted") say(`Review sent. Tx ${u.hash}\nValidators fetch the page and judge every rule; the network must finalize it (can take several minutes)...${txLink(u.hash)}`);
    else if (u.stage === "status") say(`Network status ${u.status || "pending"}${u.exec ? ", execution " + u.exec : ""}. Only FINALIZED counts as done.\nTx ${u.hash}`);
    else if (u.stage === "network-hiccup") say(`Lost contact with the network (${u.failures}x), still trying.\nTx ${u.hash}`);
  };
}

// After a successful call, check the contract really holds a new entry before saying so.
async function afterApplied(before) {
  await refreshAll();
  if (before !== null && submissionCount !== null && submissionCount > before) {
    try {
      const s = await readJSON("get_submission_json", [submissionCount - 1]);
      say(`Stored as submission #${s.id}: ${s.status} ${s.score}%. See it in Past submissions below.`);
    } catch { say("Stored as a new submission. See Past submissions below."); }
  } else {
    say("The transaction succeeded but no new submission is visible yet. Use Refresh in a moment; do not resend yet.", true);
  }
}

async function submitForReview() {
  const v = validateUrl($("urlInput").value);
  if (!v.ok || !wallet || !address) { renderSubmit(); return; }
  busy = true; renderSubmit();
  try {
    await ensureNetwork();
    const before = submissionCount;
    say("Confirm the review in your wallet...");
    const build = async () => {
      const call = { address: CONTRACT_ADDRESS, functionName: "submit_for_review", args: [v.url], value: 0n };
      if (typeof wallet.estimateTransactionFeesForWrite === "function") { // fee-charging networks only; ignored when unsupported
        try { const est = await wallet.estimateTransactionFeesForWrite(call); call.fees = { distribution: est.distribution, feeValue: est.feeValue }; } catch (e) { console.warn("Fee estimate skipped:", e); }
      }
      return await wallet.writeContract(call);
    };
    const o = await sendAndConfirm({ client: wallet, address, build, onUpdate: progress(), label: "submit_for_review", remember: { address: CONTRACT_ADDRESS, url: v.url, before }, pollMs: POLL });
    const d = describe(o, o.hash);
    say(d.text, d.err);
    if (o.kind === "APPLIED") { $("urlInput").value = ""; await afterApplied(before); }
    else if (["REJECTED_BY_CONTRACT", "NOT_APPLIED", "UNCLEAR"].includes(o.kind)) await refreshAll();
  } catch (e) {
    say("The review did not start: " + (e.message || e), true);
  } finally {
    busy = false; renderSubmit();
  }
}
$("submitBtn").onclick = submitForReview;
$("refreshBtn").onclick = async () => { await refreshAll(); };

// ---------- resume an interrupted transaction ----------
async function resume() {
  const p = loadPending();
  if (!p || !p.hash) return;
  busy = true; renderSubmit();
  say(`Found an earlier review (${p.url || "URL unknown"}) that was still open when this page closed.\nTx ${p.hash}\nWatching it now...`);
  const o = await watchTx(reader, p.hash, { onUpdate: progress(), pollMs: POLL });
  if (o.kind !== "STILL_PENDING") clearPending();
  const d = describe(o, p.hash);
  say(d.text, d.err);
  busy = false;
  if (o.kind === "APPLIED") await afterApplied(typeof p.before === "number" ? p.before : null);
  else await refreshAll();
  renderSubmit();
}

renderWallet();
if (!hasWallet()) { $("wmsg").className = "status-line"; $("wmsg").textContent = "No browser wallet detected. You can still read the program, the rubric and past submissions; to submit you need MetaMask or another EIP-1193 wallet."; }
(async () => { await refreshAll(); await resume(); })();
