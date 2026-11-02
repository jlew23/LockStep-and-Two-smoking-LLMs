⚡ LockStep: Battle-Tested Guardrails for DeepSeek Harness

Distilled from reverse-engineering 7 agent runtimes and stress-tested across 2.6M tokens under high-concurrency swarm load. Zero-dependency plugins that eliminate context rot, data loss, and fake "Done" states.

Zero Dependencies
Tested with DeepSeek
Tests
License

🔬 The Lineage: From Reverse Engineering to DeepSeek

Most multi-agent frameworks look great in single-turn demos but disintegrate when real agent squads run in parallel.

Before writing a single line of code, we reverse-engineered the execution loops and failure states of the most prominent agent runtimes:

Hermes & Droid: Tool dispatching and state-isolation models.
Pi, Omo & Jeve: Context budgeting and multi-turn reminder mechanics.
LiveOS & Verdent: Crash-resilient file persistence and strict verification hierarchies.

When DeepSeek Harness proved its speed and clean architecture, we benchmarked it against our findings, extracted the highest-performing architectural primitives across all 7 runtimes, and packaged them as two non-invasive, zero-dependency plugins:

verdent-report: Strict schema gating, auto-downgrading fake "done" reports, "Record, Don't Refuse" trimming, atomic Windows/OneDrive file sync, and self-healing playbook libraries.
model-fallback: Turn-boundary model switching with shared fleet outage memory (zero token waste when APIs rate-limit).
📊 The 2.6M Token Stress Test (The Numbers)

To find where real-world multi-agent harnesses fail, we subjected the architecture to 426 test runs across 5 parallel tester agents and 3 panel reviewers, burning ~2.6 million tokens under stochastic swarm conditions.

Here is what the harness did before vs. after our guardrails:

Vector	Stock / Naive Harness	With LockStep Guardrails	Measured Improvement
Manager Context Bloat	Up to 316,000 tokens per report	
≤
≤ 500 tokens (
≤
≤ 2,000 chars)	-99.84% token reduction
Playbook Search Blast	~13,000 tokens (raw file dumps)	~150 tokens (metadata only)	-98.8% token reduction
Tool Error Payloads	Up to 1,000,000 chars echoed	
≤
≤ 250 chars	-99.97% token reduction
Parallel Task Writes	457 of 500 failed (91.4% failure)	0 of 500 failed (0% failure)	100% write reliability
Institutional Memory Retention	184 of 200 lessons lost (92% loss)	0 of 200 lessons lost (0% loss)	Zero knowledge loss
Provider 429/500 Swarm Cascade	15 wasted retries across 5 agents	0 wasted retries (Fleet memory)	Instant failover
Mid-Step Model Switch	Fatal host crash	Turn-boundary recovery	100% run continuity
Playbook Search Latency (1k files)	Unindexed re-read of disk	24 ms warm / 237 ms cold	Instant sub-second lookup

👉 Read the Full Empirical Report (FINDINGS.md) for detailed post-mortems of all 117 cataloged issues.

🏗️ Architecture
1. "Record, Don't Refuse"

Traditional harnesses reject malformed or slightly oversized agent outputs, forcing the model to rewrite entire 2,000-token reports (burning cash and increasing hallucination rates). LockStep trims and records (summaries to 300 chars, evidence to 1,000 chars), saving everything that can be salvaged and refusing only fatal schema breaks with an actionable, one-line fix.

2. Atomic Crash-Proof Persistence

Windows filesystem locks, OneDrive sync, and high-concurrency swarms frequently collide when agents save simultaneously. LockStep uses randomized atomic temporary files and sequences writes so lessons are committed to disk before reports are finalized—ensuring hard-won insights survive even if the process dies.

3. Fleet Outage Memory

When an API provider rate-limits, typical agent swarms trigger separate retry loops on every active agent. LockStep tracks outage state across the entire process: when Agent 1 hits an outage, all other agents switch to the backup model on their very next step before burning tokens on failed retries.

📦 Quick Start
Requirements
Node.js 
≥
≥ 22.13
DeepSeek Harness 
≥
≥ v0.2.1-rc.3 (Full fallback features require v0.2.2-alpha.2+)
1. Build & Run Tests
bash
# Zero external dependencies
node build.mjs
node test.mjs
2. Mount in Your Harness Presets

Add the plugins to your DeepSeek Harness configuration (e.g., presets.patch.yml):

yaml
# Worker Preset Plugins
- id: verdent-report
  name: '@jarvis/dsh-verdent-report'
  config:
    memoryDir: '~/.dsh/manager-memory'
    role: worker
    requireReportPresets: [worker-verdent]
# Verifier Preset Plugins
- id: verdent-report
  name: '@jarvis/dsh-verdent-report'
  config:
    memoryDir: '~/.dsh/manager-memory'
    role: verifier
    requireReportPresets: [verifier-verdent]
# Manager Preset Plugins
- id: verdent-report
  name: '@jarvis/dsh-verdent-report'
  config:
    memoryDir: '~/.dsh/manager-memory'
    role: manager
    requireReportPresets: [manager-verdent]
# Global Fallback Plugin
- insert:
    - id: model-fallback
      name: '@jarvis/dsh-model-fallback'
      config:
        chains:
          deepseek-v4-pro: [deepseek-flash]
          deepseek-flash: [deepseek-v4-pro]
        cooldownMs: 300000
📜 Agent Prompt Directives

To get maximum performance out of the guardrails, inject these minimal rules into your role prompts:

Manager: Start tasks with task_id: <unique_id> and 3–7 verifiable criteria. Use find_playbooks_v1 and recent_lessons_v1 before planning work. Read results via read_task_report_v1.
Worker: Read referenced guides using read_playbook_v1. Keep criteria in your active checklist. Submit deliverables via submit_worker_report_v1 with concrete evidence.
Verifier: Validate every single criterion. Grade all items using submit_verdict_v1.
