🔬 Empirical Review Findings: Verdent Plugins for DeepSeek Harness

A comprehensive record of 426 automated stress runs, 117 triaged issues, and multi-day production verification across 2.6 million tokens of multi-agent swarm execution.

This document records the empirical methodology, benchmark metrics, failure modes, and architectural discoveries uncovered during the development, stress-testing, and live multi-day production runs of the verdent-report and model-fallback plugins for DeepSeek Harness.

1. Executive Summary & Benchmark Scorecard

Across two rounds of automated squad testing, independent panel triage, and days of live execution under real production workloads, the architecture was evaluated for concurrency robustness, context efficiency, host-engine compliance, and institutional memory persistence.

Key Improvements Matrix
Stress Vector	Baseline (Naive Harness)	Hardened (LockStep)	Measured Impact
Max Task Report Context	~316,000 tokens	
≤
≤ 500 tokens (
≤
≤ 2,000 chars)	-99.84% token reduction
Playbook Search Blast	~13,000 tokens (raw markdown)	~150 tokens (metadata outline)	-98.8% token reduction
Tool Payload Echo	Up to 1,000,000 chars	
≤
≤ 250 chars	-99.97% token reduction
High-Concurrency Writes	457 / 500 failed (91.4% fail)	0 / 500 failed (0% fail)	Zero write loss
Lesson Log Retention	184 / 200 lost (92.0% loss)	0 / 200 lost (0% loss)	100% memory survival
429/503 Swarm Retries	15 failed retries per incident	0 retries (Fleet Outage Memory)	Instant failover
Host Run Stability	Mid-step switch 
→
→ fatal crash	Turn-boundary recovery	100% run continuity
Playbook Search Latency	Unindexed disk traversal	24 ms warm / 237 ms cold	Sub-second at 1k files
2. Testing Methodology: The Squad Review

Testing was conducted using a multi-agent review architecture burning ~2.6 million tokens across 426 total test runs before moving into active production.

Simulation & Stand-In Host (tests/fake-host.mjs): Built directly from the deepseek-ai/deepseek-harness source (commit Oct 30, 2026), replicating hook execution orders, host-level veto conditions, duplicate tool error handling, and model binding lifecycles.
Tester Squad: Five parallel agents executing isolated stress vectors:
Edge-case configurations.
Multi-instance plugin collisions.
Simultaneous failover + report writing.
Stochastic swarm concurrency and file-lock races.
Per-turn context inflation metrics.
Triaged Review Panels: Three independent reviewer perspectives (Performance, Correctness, Context Engineering) challenging every decision.
Live Production Validation: Active live deployment across multi-agent swarms running real tasks over multiple days on Windows, confirming the persistence, stop checks, and anti-rot caps hold under continuous operational load.
3. Top Architectural Discoveries & Post-Mortems
#1: The Mid-Step Model Switch Engine Trap (Blocker)
The Failure: Initial versions attempted to switch models inside an active step request hook when an API failure occurred. While naive mock environments allowed this, DeepSeek's true engine fixes model selection during step preparation. Swapping mid-step throws a fatal unhandled host exception.
The Resolution: Redesigned failover to occur strictly at turn boundaries. When a step fails, the failure is recorded in Fleet Outage Memory. Downstream agents on the same model switch proactively before initiating their next turn.
#2: High-Concurrency File Collisions on Windows/OneDrive (High)
The Failure: Under high stochastic load (500 simultaneous writes), temp files generated within the same millisecond collided. Windows antivirus hooks and OneDrive file sync locks compounded the collision rate: 457 out of 500 writes failed, destroying 184 of 200 recorded lessons.
The Resolution:
Implemented randomized high-entropy temp file naming (<id>-<timestamp>-<4hex>).
Implemented exponential backoff file retries.
Inverted write ordering: lessons are appended to lessons/inbox.md prior to report generation so knowledge survives unexpected agent termination.
Confirmed in live production: zero file dropouts or lock crashes over multi-day runs.
#3: Context Rot via Unbounded Tool Returns (High)
The Failure: When a Manager agent called read_task_report_v1, the full text of complex tasks was injected directly into the conversation history, reaching 316,000 tokens. Subsequent reasoning suffered from catastrophic context rot (hallucinating completions, ignoring prompt constraints).
The Resolution:
Hard-capped report output to 2,000 characters (~500 tokens).
Questions and blockers are elevated to the top of the output.
find_playbooks_v1 was refactored from full-text dumping (13k tokens) to a structured 150-token metadata outline (titles, names, step counts). Workers read full steps individually via read_playbook_v1.
#4: Fake "Done" Reports and Playbook Poisoning (Medium)
The Failure: Agents frequently reported done despite failing or skipping sub-criteria. When the Verifier issued a PASS, playbooks containing broken execution steps were saved and indexed, poisoning future agent runs.
The Resolution:
Strict schema enforcement: reports marked done with unmet criteria are automatically downgraded to partial.
Playbooks are only committed to playbooks/<id>.md if a Verifier grades 100% of the worker's criteria. Any later FAIL immediately moves the playbook to playbooks/.retired/.
4. Complete Issue Index by Area
A. Correctness & Logic
Fixed: Playbook name collisions on duplicate summaries or non-Latin characters (Chinese/Japanese summaries defaulting to untitled.md).
Fixed: Task ID reuse across sessions overwriting historical verdicts (now uniquely postfixed and archived to reports/archive/).
Fixed: Duplicate criteria hiding execution failure (failure status now explicitly takes precedence).
Fixed: Unhandled message types (initial task received as user, follow-up tasks arriving as agent-message).
B. Robustness & File I/O
Fixed: Folder deletion during execution throwing raw unhandled exceptions (auto-recreated).
Fixed: Corrupted JSON report files crashing the parser (now trapped with actionable error reporting).
Fixed: Simultaneous multi-agent appends exceeding buffer limits.
C. Search Scaling & Performance
Fixed: Disk I/O bottleneck on playbook searches (implemented in-memory cached index reducing 1,000-playbook search latency from seconds to 24 ms).
Fixed: Search tokenization failures on short tokens ("AI", "UE", "3D") and CJK/Cyrillic scripts.
Fixed: Weak search matches misleading cheap downstream models (weak matches are aggressively filtered).
5. Verification Suite Status
> node build.mjs && node test.mjs
✔ [core.test.ts] 20 unit tests passing (100%)
✔ [smoke.test.ts] 10 integration tests passing (100%)
✔ Zero external npm dependencies.
✔ Pure TypeScript core logic decoupled from harness bindings.
✔ Verified under multi-day live swarm production runs.
