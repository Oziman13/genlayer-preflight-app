# Preflight App

A web app for **Preflight**, a rule-based, on-chain review board built as a
GenLayer Intelligent Contract. Programs (a grant round, a bounty board, a
contribution track) define a weighted rubric, anyone submits a public URL, and
independent GenLayer validators judge it rule by rule. The verdict is stored
on-chain with the exact rubric version it was judged against.

**Try it:** https://oziman13.github.io/genlayer-preflight-app/ (reading needs no wallet)

The contract source and its 29 tests are in this repository (see below). The
same contract is also published, with a longer design write-up, in
https://github.com/Oziman13/genlayer-preflight

## What the app does

- Reads the program name, pass threshold, rubric and past submissions straight
  from the contract. There is no backend.
- Connects a browser wallet and switches it to GenLayer Studionet.
- Checks the URL before sending (non-empty, http(s), at most 500 characters,
  no localhost) and says why the button is locked when it is.
- Sends `submit_for_review` (with a fee estimate where the network supports it)
  and follows the transaction to the end. A review counts as applied only when
  the network status is **FINALIZED** and the contract call itself succeeded.
  ACCEPTED is shown as "still in progress", a contract refusal and an
  UNDETERMINED/timeout result are reported as "not applied", and after a
  success the app confirms a new entry really exists before saying so.
- Handles the wallet explicitly: rejected connection or signature, wrong or
  unknown network (it is switched back before every send), a send error that
  may still have gone out (flagged, resend discouraged), and a locked button
  while a review is open so it cannot be sent twice.
- Remembers an open review in the browser. If the page is closed or reloaded
  before the result is final, it keeps watching that transaction on return.

The app is a static page (`index.html` plus the bundled `app.js`). The source of
`app.js` is in `src/` and is built on the official `genlayer-js` SDK.

## Network and contract

| | |
|---|---|
| Network | GenLayer Studionet |
| Chain ID | 61999 |
| RPC | https://studio.genlayer.com/api |
| Contract | `0x1B1838955D84b48d0b548C278759f58b0dD6ae83` |
| Explorer | https://explorer-studio.genlayer.com/address/0x1B1838955D84b48d0b548C278759f58b0dD6ae83 |

## Contract source (in this repository)

- `contracts/preflight.py`: the Intelligent Contract the app talks to.
- `tests/direct/`: 29 tests, run in-memory with `genlayer-test` direct mode
  (`pip install genlayer-test`, then `python -m pytest tests/direct -v`).

### Where to verify each claim

| Claim | Where to look in `contracts/preflight.py` |
|---|---|
| Contract methods (owner-only rubric, submit, reads) | `add_rule`, `update_rule`, `transfer_ownership`, `set_pass_threshold`, `submit_for_review`, and the `get_*` view methods |
| URL fetching | `_fetch_and_judge`, which calls `gl.nondet.web.render` |
| Prompt-injection defense | `_fetch_and_judge`, where the page content is wrapped in an `UNTRUSTED DATA` block |
| Validator consensus | `submit_for_review`: `leader_fn`, `validator_fn` and `gl.vm.run_nondet_unsafe`. A validator accepts the leader only if it agrees on every rule with weight above zero |
| Scoring and verdict | `submit_for_review`, under "Deterministic aggregation": weights, mandatory rules and the pass threshold |
| Stored review state | the `submission_*` `TreeMap`s declared in `class Preflight`, read back through `get_submission_json` |
| Consensus behaviour tested | `tests/direct/test_preflight_review.py`, the validator tests |

## How to use it

1. Open the app. Without a wallet you can already read the program, the rubric
   and the past submissions.
2. Click **Connect Wallet** and approve MetaMask. The page switches it to
   GenLayer Studionet.
3. Paste a public GitHub repository URL, or click one of the samples.
4. Click **Submit for Review** and confirm in your wallet. Validators fetch the
   page and judge every rule. This takes a minute or more.
5. A new card appears with READY or NEEDS_WORK, the score and PASS/FAIL for each
   rule.

## Sample results already on-chain

| Submitted URL | Verdict | Score | Rule 0 (source public) | Rule 1 (README explains consensus) | Rule 2 (has tests) |
|---|---|---|---|---|---|
| `genlayer-preflight` | READY | 100 | PASS | PASS | PASS |
| `genlayer-community-pulse` | NEEDS_WORK | 40 | PASS | FAIL | FAIL |

Repeated runs on the same URL gave identical verdicts: the same rubric that
approves a repository with a README and tests rejects one without them.

## Run it locally

Serve the folder with any static server (for example `python3 -m http.server`)
and open `index.html`. `app.js` is already built. To rebuild it from `src/`:
`npm i genlayer-js esbuild` and `npx esbuild src/main.js --bundle --format=iife --minify --outfile=app.js`.

## Tests of the page

`tests/browser/wallet_flow.test.mjs` drives the real page in headless Chromium
with a mock EIP-1193 wallet and a mock Studio RPC: 41 checks, last run in
`evidence/browser-tests.txt`. They cover no wallet, empty rubric, input checks,
connecting, the full ACCEPTED -> FINALIZED lifecycle, contract refusal,
UNDETERMINED, rejected and failed sends, wrong network, double-send lock,
resuming after reload and safe rendering of hostile text. They prove the page's
behaviour, **not** real MetaMask or real Studionet behaviour.

## Known limitations

- Studionet is a hosted development network and can be reset, which would clear
  the on-chain history shown in the app.
- Verdicts are LLM judgments against the rubric. They are not proof that the
  work is correct.
- A review takes a minute or more, because the page is fetched and judged by
  several validators. Only public pages can be reviewed.
- The app does not yet let the program owner edit the rubric; that is done
  through the contract methods directly.

## Roadmap

Deploy on Bradbury, add rubric editing for the owner, show a fee quote before
signing.
