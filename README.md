# Preflight App

A web app for **Preflight**, a rule-based, on-chain review board built as a
GenLayer Intelligent Contract. Programs (a grant round, a bounty board, a
contribution track) define a weighted rubric, anyone submits a public URL, and
independent GenLayer validators judge it rule by rule. The verdict is stored
on-chain with the exact rubric version it was judged against.

**Try it:** https://oziman13.github.io/genlayer-preflight-app/ (reading needs no wallet)

The contract source, its 29 tests and the consensus design live in a separate
repository: https://github.com/Oziman13/genlayer-preflight

## What the app does

- Reads the program name, pass threshold, rubric and past submissions straight
  from the contract. There is no backend.
- Connects a browser wallet and switches it to GenLayer Studionet.
- Sends `submit_for_review`, estimates fees where the network supports it, and
  waits for the validators' decision.
- Checks that the contract call itself succeeded (an accepted transaction alone
  does not prove that), re-reads the submissions, and shows pending, success and
  failure states. A failed submission can be retried.

The app is a single static page (`index.html`) built on the official
`genlayer-js` SDK, loaded from jsDelivr.

## Network and contract

| | |
|---|---|
| Network | GenLayer Studionet |
| Chain ID | 61999 |
| RPC | https://studio.genlayer.com/api |
| Contract | `0x1B1838955D84b48d0b548C278759f58b0dD6ae83` |
| Explorer | https://explorer-studio.genlayer.com/address/0x1B1838955D84b48d0b548C278759f58b0dD6ae83 |

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

Open `index.html` in a browser. No build step.

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
