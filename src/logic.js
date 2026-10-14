// Pure, testable rules for the Preflight page: what may be submitted, and when the button is usable.
// The limits mirror the contract (`submit_for_review`): non-empty, at most 500 characters, http(s) only.
export const MAX_URL_LENGTH = 500;

export function validateUrl(text) {
  const url = String(text ?? "").trim();
  if (!url) return { ok: false, reason: "Enter a URL first.", url };
  if (url.length > MAX_URL_LENGTH) return { ok: false, reason: `The URL is too long (max ${MAX_URL_LENGTH} characters).`, url };
  if (!/^https?:\/\//i.test(url)) return { ok: false, reason: "The URL must start with http:// or https://.", url };
  let parsed;
  try { parsed = new URL(url); } catch { return { ok: false, reason: "That does not look like a valid URL.", url }; }
  if (!parsed.hostname || /^(localhost|127\.|10\.|192\.168\.|0\.0\.0\.0)/i.test(parsed.hostname)) {
    return { ok: false, reason: "Only public pages can be reviewed (not localhost or a private address).", url };
  }
  return { ok: true, reason: "", url };
}

// state: { rulesLoaded, ruleCount, hasWallet, address, busy, urlText }
export function computeSubmit(state) {
  if (state.busy) return { ok: false, reason: "A review is in progress. Wait for it to finish." };
  if (!state.rulesLoaded) return { ok: false, reason: "The program has not loaded yet." };
  if (!state.ruleCount) return { ok: false, reason: "The program has no rules yet, so nothing can be reviewed." };
  if (!state.hasWallet) return { ok: false, reason: "No browser wallet found. You can read everything; to submit you need MetaMask or another EIP-1193 wallet." };
  if (!state.address) return { ok: false, reason: "Connect a wallet to submit." };
  const v = validateUrl(state.urlText);
  if (!v.ok) return { ok: false, reason: v.reason };
  return { ok: true, reason: "" };
}
