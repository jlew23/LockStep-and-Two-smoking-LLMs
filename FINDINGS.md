# 🔬 Empirical Review Findings: Verdent Plugins for DeepSeek Harness

> **426** automated stress runs · **117** triaged issues · **~2.6M** tokens of multi-agent swarm execution · multi-day production verification

This document records the methodology, benchmark metrics, failure modes, and architectural discoveries from developing, stress-testing and running the `verdent-report` and `model-fallback` plugins for DeepSeek Harness in live multi-day production.

**Contents:** [1. Scorecard](#1-executive-summary--benchmark-scorecard) · [2. Methodology](#2-testing-methodology-the-squad-review) · [3. Post-mortems](#3-top-architectural-discoveries--post-mortems) · [4. Issue index](#4-complete-issue-index-by-area) · [5. Test status](#5-verification-suite-status)

---

## 1. Executive summary & benchmark scorecard

Across two rounds of automated squad testing, independent panel triage, and days of live execution under real production workloads, we evaluated the architecture for concurrency robustness, context efficiency, host-engine compliance and institutional-memory persistence.

| Stress vector | Baseline (naive harness) | Hardened (LockStep) | Measured impact |
|---|---|---|---|
| Max task report context | ~316,000 tokens | ≤ 500 tokens (≤ 2,000 chars) | **-99.84%** tokens |
| Playbook search blast | ~13,000 tokens (raw markdown) | ~150 tokens (metadata outline) | **-98.8%** tokens |
| Tool payload echo | Up to 1,000,000 chars | ≤ 250 chars | **-99.97%** tokens |
| High-concurrency writes | 457 / 500 failed (91.4%) | 0 / 500 failed (0%) | **Zero write loss** |
| Lesson log retention | 184 / 200 lost (92.0%) | 0 / 200 lost (0%) | **100% memory survival** |
| 429/503 swarm retries | 15 failed retries per incident | 0 retries (fleet outage memory) | **Instant failover** |
| Host run stability | Mid-step switch → fatal crash | Turn-boundary recovery | **100% run continuity** |
| Playbook search latency | Unindexed disk traversal | 24 ms warm / 237 ms cold | **Sub-second at 1k files** |

## 2. Testing methodology: the squad review

Testing used a multi-agent review setup that burned ~2.6 million tokens across 426 test runs before moving into production.

- **Simulation & stand-in host** ([`tests/fake-host.mjs`](tests/fake-host.mjs)). Built directly from the `deepseek-ai/deepseek-harness` source (commit Oct 30, 2026). It replicates hook execution order, host-level veto conditions, duplicate tool error handling and model binding lifecycles.
- **Tester squad.** Five parallel agents, each on its own stress vector:
  1. Edge-case configurations
  2. Multi-instance plugin collisions
  3. Simultaneous failover + report writing
  4. Stochastic swarm concurrency and file-lock races
  5. Per-turn context inflation metrics
- **Triaged review panels.** Three independent reviewer perspectives (Performance, Correctness, Context Engineering) challenged every decision.
- **Live production validation.** Multi-agent swarms ran real tasks for several days on Windows, confirming that persistence, stop checks and anti-rot caps hold under continuous load.

## 3. Top architectural discoveries & post-mortems

### #1: The mid-step model switch engine trap `BLOCKER`

**The failure.** Early versions switched models inside an active step request hook when an API call failed. Naive mock environments allowed this, but DeepSeek's real engine fixes model selection during step preparation. Swapping mid-step throws a fatal unhandled host exception.

**The resolution.** Failover now happens strictly at turn boundaries. When a step fails, the failure goes into **fleet outage memory**, and other agents on the same model switch before starting their next turn.

### #2: High-concurrency file collisions on Windows/OneDrive `HIGH`

**The failure.** Under heavy stochastic load (500 simultaneous writes), temp files created in the same millisecond collided. Windows antivirus hooks and OneDrive sync locks made it worse: **457 of 500 writes failed**, destroying **184 of 200** recorded lessons.

**The resolution.**
- Randomized high-entropy temp file names (`<id>-<timestamp>-<4hex>`).
- Exponential backoff on file retries.
- Inverted write order: lessons are appended to `lessons/inbox.md` *before* report generation, so knowledge survives unexpected agent termination.
- Confirmed in live production: zero file dropouts or lock crashes over multi-day runs.

### #3: Context rot via unbounded tool returns `HIGH`

**The failure.** When a Manager called `read_task_report_v1`, the full text of complex tasks went straight into the conversation history, reaching **316,000 tokens**. Later reasoning suffered catastrophic context rot: hallucinated completions and ignored prompt constraints.

**The resolution.**
- Report output hard-capped at 2,000 characters (~500 tokens).
- Questions and blockers moved to the top of the output.
- `find_playbooks_v1` changed from full-text dumps (13k tokens) to a 150-token metadata outline (titles, names, step counts). Workers read full steps one at a time via `read_playbook_v1`.

### #4: Fake "Done" reports and playbook poisoning `MEDIUM`

**The failure.** Agents often reported `done` despite failing or skipping sub-criteria. When the Verifier issued a PASS, playbooks with broken steps were saved and indexed, poisoning future runs.

**The resolution.**
- Strict schema enforcement: `done` reports with unmet criteria are automatically downgraded to `partial`.
- Playbooks are committed to `playbooks/<id>.md` only if a Verifier grades **100%** of the worker's criteria. Any later FAIL moves the playbook to `playbooks/.retired/` immediately.

## 4. Complete issue index by area

### A. Correctness & logic

- ✅ Playbook name collisions on duplicate summaries or non-Latin characters (Chinese/Japanese summaries defaulting to `untitled.md`).
- ✅ Task ID reuse across sessions overwriting past verdicts (IDs now get a unique suffix and are archived to `reports/archive/`).
- ✅ Duplicate criteria hiding execution failure (failure status now takes precedence explicitly).
- ✅ Unhandled message types (initial task arriving as `user`, follow-up tasks arriving as `agent-message`).

### B. Robustness & file I/O

- ✅ Folder deletion during execution throwing raw unhandled exceptions (folders are now recreated automatically).
- ✅ Corrupted JSON report files crashing the parser (now caught, with an error message the agent can act on).
- ✅ Simultaneous multi-agent appends exceeding buffer limits.

### C. Search scaling & performance

- ✅ Disk I/O bottleneck on playbook searches (an in-memory cached index cut 1,000-playbook search latency from seconds to **24 ms**).
- ✅ Search tokenization failures on short tokens (`AI`, `UE`, `3D`) and CJK/Cyrillic scripts.
- ✅ Weak search matches misleading cheap downstream models (weak matches are now filtered aggressively).

## 5. Verification suite status

```console
$ node build.mjs && node test.mjs
✔ [core.test.ts]    25 unit tests passing (100%)
✔ [smoke.test.ts]   11 integration tests passing (100%)
✔ [checks.test.ts]   5 evidence-check tests passing (100%)
```

- ✔ Zero external npm dependencies
- ✔ Pure TypeScript core logic, decoupled from harness bindings
- ✔ Verified under multi-day live swarm production runs
