// Browser tests with a mock EIP-1193 wallet and a mock Studio RPC. They check the page's behaviour
// (wallet, input checks, transaction lifecycle, resume). They do NOT prove real MetaMask or real Studionet behaviour.
// Run from a folder where playwright-core and genlayer-js are installed:  node wallet_flow.test.mjs
import { chromium } from "playwright-core";
import { abi } from "genlayer-js";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WEB = process.env.WEB || path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = 8772;
const ME = "0x" + "a1".repeat(20), OTHER = "0x" + "c3".repeat(20);
const CONTRACT = "0x1B1838955D84b48d0b548C278759f58b0dD6ae83";
const H = "0x" + "ab".repeat(32);

const srv = spawn("python3", ["-m", "http.server", String(PORT), "-d", WEB], { stdio: "ignore" });
await new Promise(r => setTimeout(r, 800));
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { cond ? pass++ : fail++; console.log((cond ? "PASS " : "FAIL ") + name + (cond ? "" : "  " + extra)); };

const rubric = { rules: [
  { id: 1, text: "Has a README", weight: 2, mandatory: true },
  { id: 2, text: "Mentions limitations", weight: 1, mandatory: false },
] };
const sub = (id, over = {}) => ({ id, url: "https://example.com/p" + id, submitter: ME, status: "READY", score: 100, rubric_version: 1, verdicts: [{ id: 1, result: "PASS" }, { id: 2, result: "PASS" }], ...over });

async function newCase({ subs = [], rules = rubric, txScripts = {}, wallet = {}, hasWallet = true, applyOnFinal = null }) {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", e => errs.push(String(e)));
  const rpc = { methods: [], subs: [...subs], rules, txScripts, nonce: 0, txIdx: {}, applyOnFinal };
  await p.exposeFunction("__bumpNonce", () => { rpc.nonce++; });
  await p.route("https://studio.genlayer.com/**", async r => {
    const req = r.request(); let body = {}; try { body = JSON.parse(req.postData() || "{}"); } catch {}
    if (req.method() === "OPTIONS") return r.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    const arr = Array.isArray(body) ? body : [body];
    const out = arr.map(x => {
      rpc.methods.push(x.method);
      if (x.method === "gen_call") {
        const txt = Buffer.from((x.params[0].data || "").replace(/^0x/, ""), "hex").toString("latin1");
        let s = "NONE";
        if (txt.includes("get_program_name")) s = "Landing page review";
        else if (txt.includes("get_pass_threshold")) s = "70";
        else if (txt.includes("get_submission_count")) s = String(rpc.subs.length);
        else if (txt.includes("get_rubric_json")) s = JSON.stringify(rpc.rules);
        else if (txt.includes("get_submission_json")) {
          const m = txt.match(/get_submission_json[\s\S]*?([0-9])/); // index is encoded after the name; fall back to newest
          const i = m ? Number(m[1]) : rpc.subs.length - 1;
          s = JSON.stringify(rpc.subs[i] || rpc.subs[rpc.subs.length - 1]);
        }
        return { jsonrpc: "2.0", id: x.id, result: Buffer.from(abi.calldata.encode(s)).toString("hex") };
      }
      if (x.method === "eth_getTransactionCount") return { jsonrpc: "2.0", id: x.id, result: "0x" + rpc.nonce.toString(16) };
      if (x.method === "eth_gasPrice") return { jsonrpc: "2.0", id: x.id, result: "0x1" };
      if (x.method === "eth_estimateGas") return { jsonrpc: "2.0", id: x.id, result: "0x30d40" };
      if (x.method === "eth_chainId") return { jsonrpc: "2.0", id: x.id, result: "0xf22f" };
      if (x.method === "eth_getTransactionByHash") {
        const h = x.params[0]; const seq = rpc.txScripts[h] || [];
        const i = Math.min(rpc.txIdx[h] || 0, seq.length - 1); rpc.txIdx[h] = (rpc.txIdx[h] || 0) + 1;
        if (!seq.length) return { jsonrpc: "2.0", id: x.id, result: null };
        const t = seq[i];
        if (t.status === "FINALIZED" && rpc.applyOnFinal && !rpc.applied) { rpc.applied = true; rpc.subs.push(rpc.applyOnFinal); }
        return { jsonrpc: "2.0", id: x.id, result: t };
      }
      return { jsonrpc: "2.0", id: x.id, error: { code: -32000, message: "mock: unsupported " + x.method } };
    });
    r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(Array.isArray(body) ? out : out[0]) });
  });
  if (hasWallet) {
    await p.addInitScript(cfg => {
      const listeners = {};
      window.__reqs = [];
      window.__w = { chainId: cfg.chainId, accounts: cfg.accounts, knownChain: cfg.knownChain, rejectConnect: cfg.rejectConnect, sendMode: cfg.sendMode || "ok", hash: cfg.hash || "0x" + "ab".repeat(32) };
      window.ethereum = {
        isMock: true,
        on: (e, f) => { (listeners[e] = listeners[e] || []).push(f); },
        emit: (e, v) => (listeners[e] || []).forEach(f => f(v)),
        request: async ({ method, params }) => {
          window.__reqs.push({ method, params });
          const w = window.__w;
          if (method === "eth_chainId") return w.chainId;
          if (method === "eth_requestAccounts" || method === "eth_accounts") {
            if (w.rejectConnect) throw Object.assign(new Error("User rejected the request."), { code: 4001 });
            return w.accounts;
          }
          if (method === "wallet_switchEthereumChain") {
            if (!w.knownChain && params[0].chainId !== w.chainId) throw Object.assign(new Error("Unrecognized chain ID"), { code: 4902 });
            w.chainId = params[0].chainId; return null;
          }
          if (method === "wallet_addEthereumChain") { w.knownChain = true; return null; }
          if (method === "eth_sendTransaction") {
            if (w.sendMode === "reject") throw Object.assign(new Error("User rejected the request."), { code: 4001 });
            if (w.sendMode === "errorButSent") { await window.__bumpNonce(); throw new Error("RPC timeout after broadcast"); }
            if (w.sendMode === "errorNotSent") throw new Error("insufficient funds");
            await window.__bumpNonce(); return w.hash;
          }
          throw new Error("mock wallet: unsupported " + method);
        },
      };
    }, { chainId: "0xf22f", accounts: [ME], knownChain: true, ...wallet });
  }
  const open = async (qs = "") => { await p.goto(`http://localhost:${PORT}/index.html?poll=50${qs}`); };
  return { p, ctx, rpc, errs, open };
}

const tx = (status, exec, extra = {}) => ({ hash: H, status, data: {}, consensus_data: exec ? { leader_receipt: [{ execution_result: exec }] } : undefined, recipient: CONTRACT, ...extra });
const text = (p, sel) => p.textContent(sel);
const waitText = (p, sel, re, t = 8000) => p.waitForFunction(([s, r]) => new RegExp(r).test(document.querySelector(s).textContent), [sel, re.source], { timeout: t }).then(() => true).catch(() => false);
const ready = async c => { await c.p.waitForFunction(() => document.getElementById("programName").textContent.length > 3 && document.querySelectorAll("#rubric .rule").length > 0, null, { timeout: 8000 }); };
const connect = async c => { await c.p.click("#connectBtn"); await c.p.waitForFunction(() => document.getElementById("addrLine").textContent.includes("…"), null, { timeout: 8000 }); };

// 1. No wallet: reading works, submit locked with a clear reason
{
  const c = await newCase({ subs: [sub(0)], hasWallet: false });
  await c.open(); await ready(c);
  ok("no wallet: program and rubric readable", (await text(c.p, "#programName")) === "Landing page review" && (await c.p.locator("#rubric .rule").count()) === 2);
  ok("no wallet: past submissions readable", (await c.p.locator("#submissions .sub").count()) === 1);
  ok("no wallet: submit disabled with reason", (await c.p.locator("#submitBtn").isDisabled()) && /No browser wallet/.test(await text(c.p, "#submitReason")));
  ok("no wallet: explanation shown", /No browser wallet detected/.test(await text(c.p, "#wmsg")));
  ok("no key material or password inputs", (await c.p.locator("input[type=password]").count()) === 0);
  await c.ctx.close();
}

// 2. Empty rubric: nothing can be reviewed
{
  const c = await newCase({ rules: { rules: [] } });
  await c.open(); await c.p.waitForFunction(() => /No rules yet/.test(document.getElementById("rubric").textContent));
  await connect(c); await c.p.fill("#urlInput", "https://example.com/x");
  ok("empty rubric: submit locked with reason", (await c.p.locator("#submitBtn").isDisabled()) && /no rules/.test(await text(c.p, "#submitReason")));
  await c.ctx.close();
}

// 3. Connect flows and input checks
{
  const c = await newCase({ wallet: { chainId: "0x1", knownChain: false } });
  await c.open(); await ready(c); await connect(c);
  const reqs = await c.p.evaluate(() => window.__reqs.map(r => r.method));
  ok("connect: wrong chain -> add chain then switch", reqs.includes("wallet_addEthereumChain") && reqs.filter(m => m === "wallet_switchEthereumChain").length === 2);
  ok("connect: ends on Studio chain", (await c.p.evaluate(() => window.__w.chainId)) === "0xf22f");
  ok("connect: address shown", (await text(c.p, "#addrLine")).startsWith("0xa1a1"));
  ok("connected but empty URL: reason asks for a URL", (await c.p.locator("#submitBtn").isDisabled()) && /Enter a URL/.test(await text(c.p, "#submitReason")));
  for (const [v, re, label] of [["ftp://x.com/a", /http/, "non-http scheme"], ["http://localhost:8000/a", /public pages/, "localhost"], ["https://" + "a".repeat(600) + ".com", /too long/, "over 500 chars"], ["not a url", /http/, "plain text"]]) {
    await c.p.fill("#urlInput", v);
    ok("input check: " + label + " blocks submit", (await c.p.locator("#submitBtn").isDisabled()) && re.test(await text(c.p, "#submitReason")));
  }
  await c.p.fill("#urlInput", "https://example.com/ok");
  ok("valid URL enables submit", !(await c.p.locator("#submitBtn").isDisabled()));
  await c.p.click("[data-url]");
  ok("sample link fills the box", /^https?:\/\//.test(await c.p.inputValue("#urlInput")));
  await c.ctx.close();
}
{
  const c = await newCase({ wallet: { rejectConnect: true } });
  await c.open(); await ready(c); await c.p.click("#connectBtn");
  ok("connect rejection explained", await waitText(c.p, "#wmsg", /declined/) && (await c.p.locator("#submitBtn").isDisabled()));
  await c.ctx.close();
}

// 4. Transaction lifecycle
{
  const c = await newCase({ subs: [sub(0)], wallet: { hash: H }, applyOnFinal: sub(1, { score: 50, status: "NEEDS_WORK", verdicts: [{ id: 1, result: "PASS" }, { id: 2, result: "FAIL" }] }),
    txScripts: { [H]: [tx("PENDING"), tx("ACCEPTED", "SUCCESS"), tx("FINALIZED", "SUCCESS")] } });
  await c.open(); await ready(c); await connect(c);
  await c.p.fill("#urlInput", "  https://example.com/new  ");
  await c.p.click("#submitBtn");
  ok("lifecycle: ACCEPTED shown as in progress, not applied", await waitText(c.p, "#txmsg", /Network status ACCEPTED/));
  ok("lifecycle: FINALIZED+SUCCESS reported as applied", await waitText(c.p, "#txmsg", /review was applied/));
  const sent = await c.p.evaluate(() => window.__reqs.find(r => r.method === "eth_sendTransaction"));
  ok("lifecycle: sent through wallet from connected account", sent && sent.params[0].from.toLowerCase() === ME);
  ok("lifecycle: new entry confirmed by count and shown", await waitText(c.p, "#txmsg", /Stored as submission #1: NEEDS_WORK 50%/));
  ok("lifecycle: list now has two entries", (await c.p.locator("#submissions .sub").count()) === 2);
  ok("lifecycle: input cleared and button usable again", (await c.p.inputValue("#urlInput")) === "");
  ok("lifecycle: pending record cleared", (await c.p.evaluate(() => localStorage.getItem("pf_pending_tx"))) === null);
  await c.ctx.close();
}
{
  // FINALIZED+SUCCESS but no new entry visible: must not claim a stored submission
  const c = await newCase({ subs: [sub(0)], wallet: { hash: H }, txScripts: { [H]: [tx("FINALIZED", "SUCCESS")] } });
  await c.open(); await ready(c); await connect(c);
  await c.p.fill("#urlInput", "https://example.com/new"); await c.p.click("#submitBtn");
  ok("success but count unchanged: no false 'stored' claim", await waitText(c.p, "#txmsg", /no new submission is visible yet/) && !/Stored as/.test(await text(c.p, "#txmsg")));
  await c.ctx.close();
}
{
  const c = await newCase({ wallet: { hash: H }, txScripts: { [H]: [tx("ACCEPTED", "ERROR"), tx("FINALIZED", "ERROR")] } });
  await c.open(); await ready(c); await connect(c);
  await c.p.fill("#urlInput", "https://example.com/new"); await c.p.click("#submitBtn");
  ok("contract error: FINALIZED+ERROR reported as refused", await waitText(c.p, "#txmsg", /contract refused the call/) && !/was applied/.test(await text(c.p, "#txmsg")));
  await c.ctx.close();
}
{
  const c = await newCase({ wallet: { hash: H }, txScripts: { [H]: [tx("PENDING"), tx("UNDETERMINED")] } });
  await c.open(); await ready(c); await connect(c);
  await c.p.fill("#urlInput", "https://example.com/new"); await c.p.click("#submitBtn");
  ok("undetermined: reported as not applied", await waitText(c.p, "#txmsg", /not applied \(network status UNDETERMINED/));
  await c.ctx.close();
}
{
  const c = await newCase({ wallet: { sendMode: "reject" } });
  await c.open(); await ready(c); await connect(c);
  await c.p.fill("#urlInput", "https://example.com/new"); await c.p.click("#submitBtn");
  ok("user rejects signature: clear message, no polling", await waitText(c.p, "#txmsg", /declined the request in the wallet. Nothing was sent/) && !c.rpc.methods.includes("eth_getTransactionByHash"));
  ok("user rejects: button usable again", !(await c.p.locator("#submitBtn").isDisabled()));
  await c.ctx.close();
}
{
  const c = await newCase({ wallet: { sendMode: "errorNotSent" } });
  await c.open(); await ready(c); await connect(c);
  await c.p.fill("#urlInput", "https://example.com/new"); await c.p.click("#submitBtn");
  ok("send error with unchanged nonce: not sent", await waitText(c.p, "#txmsg", /was not sent/));
  await c.ctx.close();
}
{
  const c = await newCase({ wallet: { sendMode: "errorButSent" } });
  await c.open(); await ready(c); await connect(c);
  await c.p.fill("#urlInput", "https://example.com/new"); await c.p.click("#submitBtn");
  ok("send error but nonce moved: ambiguous, resend discouraged", await waitText(c.p, "#txmsg", /may have been sent/));
  await c.ctx.close();
}
{
  const c = await newCase({ wallet: { hash: H }, txScripts: { [H]: [tx("FINALIZED", "SUCCESS")] } });
  await c.open(); await ready(c); await connect(c);
  await c.p.evaluate(() => { window.__w.chainId = "0x1"; window.ethereum.emit("chainChanged", "0x1"); });
  ok("network switched away: warning shown", await waitText(c.p, "#wmsg", /Wrong network/));
  await c.p.fill("#urlInput", "https://example.com/new"); await c.p.click("#submitBtn");
  ok("wrong network at send time: switched back before sending", await waitText(c.p, "#txmsg", /review was applied|no new submission/) && (await c.p.evaluate(() => window.__reqs.filter(r => r.method === "wallet_switchEthereumChain").length)) >= 1 && (await c.p.evaluate(() => window.__w.chainId)) === "0xf22f");
  await c.ctx.close();
}
{
  // the button must be locked while a review is running (no double send)
  const c = await newCase({ wallet: { hash: H }, txScripts: { [H]: [tx("PENDING")] } });
  await c.open(); await ready(c); await connect(c);
  await c.p.fill("#urlInput", "https://example.com/new"); await c.p.click("#submitBtn");
  await waitText(c.p, "#txmsg", /Review sent/);
  ok("busy: submit locked while the review is open", (await c.p.locator("#submitBtn").isDisabled()) && /in progress/.test(await text(c.p, "#submitReason")));
  await new Promise(r => setTimeout(r, 600));
  ok("busy: still locked and still waiting after several polls", (await c.p.locator("#submitBtn").isDisabled()) && !/applied/.test(await text(c.p, "#txmsg")));
  ok("only one transaction was sent", (await c.p.evaluate(() => window.__reqs.filter(r => r.method === "eth_sendTransaction").length)) === 1);
  await c.ctx.close();
}

// 5. Resume an interrupted transaction after reload
{
  const c = await newCase({ subs: [sub(0)], applyOnFinal: sub(1), txScripts: { [H]: [tx("ACCEPTED", "SUCCESS"), tx("FINALIZED", "SUCCESS")] } });
  await c.p.addInitScript(([h]) => { if (!sessionStorage.getItem("seeded")) { localStorage.setItem("pf_pending_tx", JSON.stringify({ hash: h, label: "submit_for_review", address: "x", url: "https://example.com/p1", before: 1, at: Date.now() })); sessionStorage.setItem("seeded", "1"); } }, [H]);
  await c.open();
  ok("resume: reports the final result of the earlier review", await waitText(c.p, "#txmsg", /review was applied|Stored as submission/));
  ok("resume: record cleared", (await c.p.evaluate(() => localStorage.getItem("pf_pending_tx"))) === null);
  ok("resume: works without a connected wallet and refreshes the list", await c.p.waitForFunction(() => document.querySelectorAll("#submissions .sub").length === 2, null, { timeout: 5000 }).then(() => true).catch(() => false));
  await c.ctx.close();
}

// 6. Safety of rendering
{
  const c = await newCase({ subs: [sub(0, { url: "https://example.com/<img src=x onerror=alert(1)>", submitter: "<b>x</b>" })], rules: { rules: [{ id: 1, text: "<img src=x onerror=alert(2)>", weight: 1, mandatory: true }] } });
  const dialogs = []; c.p.on("dialog", d => { dialogs.push(d.message()); d.dismiss(); });
  await c.open(); await c.p.waitForSelector("#submissions .sub");
  ok("hostile url/rule/submitter rendered as text, no script ran", dialogs.length === 0 && (await text(c.p, "#rubric")).includes("<img"));
  ok("no page errors in the whole run", c.errs.length === 0, c.errs.join("|"));
  await c.ctx.close();
}

await browser.close(); srv.kill();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
