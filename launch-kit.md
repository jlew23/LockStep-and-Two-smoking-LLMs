# Launch kit

Drafts and a checklist for telling people about LockStep. Nothing here has been posted yet.

**Positioning line**

> Make Verdent agents more reliable with validated task reports, reusable playbooks, and automatic model fallback for provider outages.

Everything below follows three rules: lead with the failure the reader has seen, show the demo, and never claim more than the repo can prove.

## Current state (check before posting)

| Item | State |
|---|---|
| Version | `0.1.0`, pre-release |
| Published? | **Not on npm.** Install from `main` with `dsh plugin add "file:..."` |
| Release / PR | none open; `main` is the target |
| Tests | 41 passing on the stand-in host |
| Live checks | fallback during a real outage: not recorded; Linux/macOS: untested; DSH 0.2.2+: API verified, live run not recorded |
| Demo | `node demo.mjs` (simulated host, scripted agents) + `docs/demo.gif` recorded from it |
| Benchmark | runner only, **no results committed** |

If any of that changes, update this table and the README before posting.

## Pre-launch checklist

- [ ] `node build.mjs && node test.mjs` passes on a fresh clone (expect 41).
- [ ] `node demo.mjs` runs in under ~5 seconds with no API key.
- [ ] `docs/demo.gif` is regenerated from the current `demo.mjs` (`python docs/make-demo-gif.py`).
- [ ] A clean profile can install both plugins with the README's `dsh plugin add "file:..."` commands.
- [ ] The README's compatibility table matches `dsh --version` on the machine you test with.
- [ ] The "not tested yet" table is current — do not delete rows to look better.
- [ ] Issue template `.github/ISSUE_TEMPLATE/try-report.md` is visible in the New Issue chooser.
- [ ] Repo description and topics are set (GitHub → About): description = "Two DeepSeek Harness plugins: disk-verified task reports and turn-boundary model fallback"; topics = `deepseek-harness`, `verdent`, `multi-agent`, `ai-agents`, `plugins`.
- [ ] Pick **one** link to track (repo URL, not a bit.ly) and watch it for the first week.

## Post 1 — DeepSeek Harness community

Where: the DeepSeek Harness Discord/forum or the GitHub Discussions for the harness, whichever you actually use. One place first; cross-post later only if the first gets real replies.

Title options:

- "Two plugins that stop fake `done` reports and provider-outage retry storms in DSH swarms"
- "I got tired of agents reporting done with skipped criteria, so I wrote a report plugin that checks files on disk"

Body:

> I run multi-agent swarms on DeepSeek Harness, and the failure that bit me was not bad plans — it was reports that were wrong.
>
> - A Worker says `done` while a criterion is unmet. The report plugin saves it as `partial` and names the miss.
> - A Worker claims `VERSION` says `1.4.1`; the file says `1.4.0`. Claims now carry `checks` (`exists`, `equals`, `contains`, `size`, `sha256`, `hex`) and the plugin reads the real file. Wrong claim → recorded as not met, report downgraded, lesson logged.
> - A Verifier says `PASS` after the file changed. The `PASS` is re-checked on disk and recorded as `FAIL`; the playbook is retired.
> - One provider outage makes every agent burn its own retries. The fallback plugin keeps fleet outage memory and moves agents at their next step boundary (the step that hit the outage still fails — DeepSeek fixes the model during step preparation).
>
> Two zero-dependency plugins: `verdent-report` and `model-fallback`. Status: pre-release, not on npm — install from `main` with `dsh plugin add "file:..."`.
>
> **Try it in 30 seconds without a harness:** `node demo.mjs` runs four scripted scenes on a stand-in host.
> `node test.mjs` runs 41 tests. `verdent-report` works on DSH 0.2.1-rc.3+; `model-fallback` needs 0.2.2-alpha.2+ (`agent.model.select()`), and on older builds it logs one warning and stays off.
>
> Repo: https://github.com/jlew23/LockStep-and-Two-smoking-LLMs
>
> If you try it: one real task with one file claim is enough. Tell me where setup or output is confusing — the issue template asks for `dsh --version` and your OS.

## Post 2 — Verdent community

Where: Verdent's Discord / community channel, or a Verdent-focused thread. Keep it shorter and lead with the oversight problem, because that is the pain Verdent users already describe.

> Verdent-style Manager/Worker/Verifier swarms are good at splitting work and bad at proving it. I built two DeepSeek Harness plugins for that gap: Workers submit reports with file `checks` that are verified against disk, Verifiers can't save a playbook while skipping a criterion (and a later `FAIL` retires it), and `model-fallback` moves agents to a backup model at the next step after a provider outage.
>
> `node demo.mjs` shows it in about two seconds with no Harness or API key. Pre-release, not on npm; setup is in the README. One ask: run `verdent-report` on one real task and tell me what confused you.

## Post 3 — Show HN (only after the checklist is green)

Only post once a stranger can install it from the README without asking a question. HN is unforgiving about unverified numbers; the README already separates tested from unverified — keep it that way in the post.

Title: `Show HN: Two plugins that verify agent task reports against the real disk`

Body:

> I run multi-agent swarms on DeepSeek Harness. The failures that cost me runs were reports that said "done" while a criterion was unmet, and a provider outage where every agent burned its own retry loop against the same dead endpoint.
>
> LockStep is two zero-dependency plugins:
> - `verdent-report` — strict report schema, `done` downgraded to `partial` when a criterion is unmet, file claims verified on disk (`exists`/`equals`/`contains`/`size`/`sha256`/`hex`), a Verifier's `PASS` re-checked at grading time, playbooks saved only on a full PASS and retired on a later FAIL.
> - `model-fallback` — turn-boundary switching with fleet outage memory. The step that hits the outage still fails; the next step starts on the backup, and other agents follow at their next step boundary.
>
> `node demo.mjs` runs four scripted scenes on a stand-in host in about two seconds, no API key. `node test.mjs` is 41 tests. It is pre-release, not on npm, and I have not recorded a live provider outage yet — the README lists exactly what is tested and what is not.
>
> Repo: https://github.com/jlew23/LockStep-and-Two-smoking-LLMs
>
> I would most value one real task with one file claim: where did setup or output confuse you?

First comment (post immediately, from the same account):

> Two caveats so nobody has to dig them out: the stress numbers in the README compare the plugins' early builds to their hardened builds, not stock DeepSeek Harness; and `model-fallback` is inert on DSH 0.2.1-rc.x because those builds have no `agent.model.select()` — it logs one warning and stays off. The benchmark in the repo is a runner with no published results yet.

## What not to do

- Don't post the same text in more than two places; reply to comments instead.
- Don't say "industry first" or "first ever" unless you can link a comparison.
- Don't quote the `-99.8%` or "0 wasted retries" numbers without the caveats next to them.
- Don't ask for stars; ask for one real task and one confusing detail.
- Don't link a branch or draft PR — link `main`, which is what the README describes.

## Tracking (fill weekly)

| Week | Repo visits | Clones / downloads | Installs reported | Issues opened | Try-it reports | Notes |
|---|---|---|---|---|---|---|
| 2026-11-09 | | | | | | first post: DSH community |
| 2026-11-16 | | | | | | |
| 2026-11-23 | | | | | | Show HN if checklist green |
| 2026-11-30 | | | | | | |

Where the numbers come from: GitHub → Insights → Traffic (visits/clones, 14-day window), `npm` n/a until published, issues, and the "Tried it" template.

Read it like this:

- **Visits but no clones** → the README's first screen or demo is not convincing; fix the GIF/quick start.
- **Clones but no issues** → people tried and bounced (setup friction) or are quietly using it; add a one-line "did it work?" ask.
- **Install issues** → compatibility table and `dsh --version` check need to be earlier.
- **Issues that repeat** → fix the docs before posting anywhere else.
