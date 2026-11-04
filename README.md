<div align="center">

# ⚡ LockStep

### Battle-tested guardrails for DeepSeek Harness agent swarms

**Two zero-dependency plugins that stop context rot, lost writes, and fake "Done" reports,<br>distilled from reverse-engineering 7 agent runtimes and 2.6M tokens of swarm stress tests.**

[![Zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen?style=flat-square)](#-quick-start)
[![Tested with DeepSeek](https://img.shields.io/badge/tested%20with-DeepSeek%20Harness-4D6BFE?style=flat-square)](#-the-numbers)
[![Tests](https://img.shields.io/badge/tests-31-brightgreen?style=flat-square)](#-quick-start)
[![Node](https://img.shields.io/badge/node-%E2%89%A5%2022.13-339933?style=flat-square&logo=node.js&logoColor=white)](#requirements)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)

**-99.8%** manager context &nbsp;·&nbsp; **0 / 500** failed parallel writes &nbsp;·&nbsp; **0 / 200** lessons lost &nbsp;·&nbsp; **0** wasted retries on outages

[The numbers](#-the-numbers) · [How it works](#%EF%B8%8F-how-it-works) · [Quick start](#-quick-start) · [Full findings](FINDINGS.md) · [Ready-made configs](presets/README.md)

</div>

---

## The problem

Most multi-agent frameworks look great in single-turn demos and fall apart once a real squad runs in parallel:

- 🧠 **Context rot.** One `read_task_report` dumps 316k tokens into the manager, which then starts hallucinating completions.
- 💥 **Lost work.** Agents saving at the same moment collide on Windows file locks and OneDrive sync, and **91% of writes fail**.
- 🎭 **Fake "Done".** Workers mark tasks complete while skipping criteria, and broken steps get saved as playbooks that poison later runs.
- 🔁 **Retry storms.** When the provider rate-limits, every agent burns its own retry loop against the same dead endpoint.

LockStep fixes all four with two drop-in plugins.

| Plugin | What it does |
|---|---|
| **`verdent-report`** | Strict report schema, auto-downgrades fake `done` to `partial`, "Record, Don't Refuse" trimming, atomic crash-safe writes, and a self-healing playbook library |
| **`model-fallback`** | Turn-boundary model switching with **fleet-wide outage memory**: once one agent hits a 429, every agent switches before wasting a call |

## 📊 The numbers

**426 test runs** · **5 parallel tester agents** · **3 review panels** · **~2.6M tokens** under stochastic swarm load, followed by multi-day live production runs.

| Failure vector | Naive harness | With LockStep | Improvement |
|---|---|---|---|
| Manager context per report | up to **316,000** tokens | ≤ **500** tokens (≤ 2,000 chars) | **-99.84%** |
| Playbook search blast | ~13,000 tokens (raw file dumps) | ~150 tokens (metadata only) | **-98.8%** |
| Tool error payloads | up to **1,000,000** chars echoed | ≤ **250** chars | **-99.97%** |
| Parallel task writes | **457 / 500 failed** (91.4%) | **0 / 500** failed | 100% write reliability |
| Institutional memory | **184 / 200** lessons lost (92%) | **0 / 200** lost | Zero knowledge loss |
| Provider 429/500 cascade | 15 wasted retries across 5 agents | **0** wasted retries | Instant failover |
| Mid-step model switch | 💀 Fatal host crash | Turn-boundary recovery | 100% run continuity |
| Playbook search (1k files) | Unindexed disk re-read | **24 ms** warm / 237 ms cold | Sub-second lookup |

> 👉 **[Read the full empirical report](FINDINGS.md)**: methodology, post-mortems and all 117 cataloged issues.

## 🔬 Where it came from

Before writing any code, we reverse-engineered the execution loops and failure modes of seven agent runtimes:

| Runtime | What we studied |
|---|---|
| **Hermes** & **Droid** | Tool dispatching and state isolation |
| **Pi**, **Omo** & **Jeve** | Context budgeting and multi-turn reminder mechanics |
| **LiveOS** & **Verdent** | Crash-resilient persistence and strict verification hierarchies |

Then we benchmarked DeepSeek Harness against those findings and packaged the best primitives from all seven runtimes as plugins that don't touch the harness itself.

## 🏗️ How it works

### 1. Record, don't refuse

Typical harnesses reject a slightly oversized or malformed report and force the model to rewrite all 2,000 tokens, which costs money and adds hallucinations. LockStep **trims and records** instead (summary to 300 chars, evidence to 1,000). It refuses only fatal schema breaks, and then with a one-line fix the agent can act on.

### 2. Atomic, crash-proof persistence

High-entropy temp file names, exponential backoff, and **inverted write order**: lessons go to disk *before* the report is finalized, so they survive even if the process dies mid-task.

### 3. Fleet outage memory

```
Agent 1 ──► 429 from deepseek-v4-pro ──► outage recorded (cooldown 5 min)
Agent 2 ──► next turn ──► sees outage ──► runs on deepseek-flash ✅  (no wasted call)
Agent 3 ──► next turn ──► sees outage ──► runs on deepseek-flash ✅
```

The switch happens only **at turn boundaries**. DeepSeek fixes the model during step preparation, so swapping mid-step crashes the host.

### 4. Verified playbooks only

A playbook is saved only when a Verifier passes **100%** of the worker's criteria. Any later FAIL retires it to `playbooks/.retired/`. Bad steps never make it into the library.

## 🚀 Quick start

### Requirements

- **Node.js** ≥ 22.13
- **DeepSeek Harness** ≥ v0.2.1-rc.3 (full fallback features need ≥ v0.2.2-alpha.2)

### 1. Build and test

```bash
git clone https://github.com/jlew23/LockStep-and-Two-smoking-LLMs.git
cd LockStep-and-Two-smoking-LLMs
node build.mjs   # zero external dependencies
node test.mjs
```

### 2. Mount in your harness presets

Add the plugins to your DeepSeek Harness config (for example `presets.patch.yml`). Replace `<you>` with your Windows username, and use a full path for `memoryDir`: the plugin does not expand `~`.

<details open>
<summary><b>Per-preset plugins</b> (Manager / Worker / Verifier)</summary>

```yaml
# Manager preset
- id: verdent-report
  name: '@jarvis/dsh-verdent-report'
  config:
    memoryDir: 'C:\Users\<you>\.dsh\manager-memory'
    role: manager
    requireReportPresets: [manager-verdent]

# Worker preset
- id: verdent-report
  name: '@jarvis/dsh-verdent-report'
  config:
    memoryDir: 'C:\Users\<you>\.dsh\manager-memory'
    role: worker
    requireReportPresets: [worker-verdent]

# Verifier preset
- id: verdent-report
  name: '@jarvis/dsh-verdent-report'
  config:
    memoryDir: 'C:\Users\<you>\.dsh\manager-memory'
    role: verifier
    requireReportPresets: [verifier-verdent]
```

</details>

<details open>
<summary><b>Global fallback plugin</b></summary>

```yaml
- insert:
    - id: model-fallback
      name: '@jarvis/dsh-model-fallback'
      config:
        chains:
          deepseek-v4-pro: [deepseek-flash]
          deepseek-flash: [deepseek-v4-pro]
        cooldownMs: 300000   # 5 min outage memory
```

</details>

> 💡 Not sure which setup you need? **[presets/README.md](presets/README.md)** has six ready-made configs (Solo, Team, Team cheap, Strict, Overnight, Test bench) with measured token costs for each.

### 3. Add the prompt directives

Put these short rules in your role prompts to get the most out of the guardrails:

| Role | Directive |
|---|---|
| **Manager** | Start tasks with `task_id: <unique_id>` and 3–7 verifiable criteria. Call `find_playbooks_v1` and `recent_lessons_v1` before planning. Read results via `read_task_report_v1`. |
| **Worker** | Read referenced guides with `read_playbook_v1`. Keep the criteria in your active checklist. Submit via `submit_worker_report_v1` with concrete evidence. |
| **Verifier** | Check every criterion. Grade all items with `submit_verdict_v1`. |

## 📁 Repo layout

```
verdent-report/   strict reports, stop check, lessons log, playbook library
model-fallback/   turn-boundary failover + fleet outage memory
presets/          six ready-made configs with measured costs
tests/            fake DeepSeek host + smoke tests
FINDINGS.md       full empirical report (426 runs, 117 issues)
```

## License

[MIT](LICENSE)

<div align="center">
<br>
<sub>If LockStep saved your swarm from itself, a ⭐ helps other people find it.</sub>
</div>
