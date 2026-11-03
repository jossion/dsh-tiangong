# 天工 / Tiangong Workbench

A **requirement-to-delivery workbench** for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`).

Create an app (or a project), describe what you need or attach a requirement document, and the
workbench runs the loop: it understands the requirement, plans a task graph, dispatches child
agents, verifies their test evidence, and records the delivery — with as little manual
intervention as possible. Every task stays bound to its own DSH session.

![Task board](docs/assets/board.png)

## What it does

- **Requirement intake** — paste text or attach a `.md` / `.markdown` / `.txt` document (≤512 KiB) right in the panel.
- **Planning as a contract** — the agent submits a validated DAG (owners, stages, dependencies, acceptance criteria); invalid plans are rejected with the exact reason.
- **Dispatch loop** — one ready work item at a time goes to a child agent, gets woken when it stalls, and its result is reported back with test evidence.
- **Evidence-gated completion** — a work item is done only with a real exit code, a positive pass count and zero failures; otherwise it becomes a person's decision.
- **Per-project delivery session** — each project gets a durable DSH session; the ledger records the binding, the model and the agent preset.
- **Task cockpit** — team graph, task list, decisions, usage and delivery artifacts for every job.
- **Automatic accounting** — token usage and cost per job, budgets, stall watchdog and round trip-breakers, with human gates on the exceptions.

| Requirement upload | Team flow |
|---|---|
| ![New task with an attached requirement document](docs/assets/task.png) | ![Team flow graph](docs/assets/flow.png) |

![Task session chat](docs/assets/chat.png)

## Install

Requires DSH **0.2.1-rc.0 or newer** (`engines.dsh` in the manifest).

This package is part of the [`jossion/dsh-tiangong`](https://github.com/jossion/dsh-tiangong) monorepo
(`packages/workbench`), so install it from a checkout:

```bash
git clone https://github.com/jossion/dsh-tiangong.git
```

Then add the package directory to a profile with DSH's Plugin Manager (`install_bundle`) — or, for a
CLI profile:

```bash
dsh plugin --profile <profile> add /path/to/dsh-tiangong/packages/workbench
```

Restart DSH after installing, then open **Plugins → Installed** to confirm `@jos/workbench` is active
and the **工作台 / Tiangong** entry appears in the sidebar.

The package resolves `@deepseek-ai/schemastery` from the DSH host for its `Config` schema; the
manifest declares it as a peer dependency.

## Configuration

The plugin exports a Schemastery `Config`, so every option is validated when the row activates and is
visible in Plugin Manager:

| Field | Default | Meaning |
|---|---|---|
| `dataDir` | `""` | Ledger and deliveries location; empty means `~/.dsh/workbench` |
| `appsRoot` | `""` | Root for app workspaces created by the closed loop; empty means `<dataDir>/apps` |
| `agentPreset` | `""` | Agent preset for delivery sessions; empty uses the deployment default |
| `provider` / `model` | `""` | Legacy host-side planner route; empty uses the deployment default |
| `autoRun` | `true` | Drive intake-created jobs automatically |
| `wakeCooldownMs` | `4000` | Minimum gap between two wakes of the same agent |
| `planTimeoutMs` | `900000` | A planning turn without a plan becomes a human gate after this |
| `planNudgeMs` | `120000` | Send one planning reminder after this |
| `maxRounds` | `60` | Wake-round trip-breaker per job |
| `budgetUsd` | `0` | USD budget; `0` disables the gate |
| `budgetTokens` | `0` | Token budget; `0` disables the gate |
| `priceInputPerMTok` / `priceOutputPerMTok` | `0` | USD per 1M tokens for cost accounting |
| `loopTickMs` | `10000` | Safety-net loop interval |
| `stallAfterWakes` | `6` | Wakes without board progress before the stall gate fires |

## Data

The append-only ledger `~/.dsh/workbench/events.jsonl` is the single source of truth; every panel
view is a projection of it. Delivered apps keep their SQLite databases under the project workspace
the panel reads directly.

## Development

```bash
cd packages/workbench
npm test          # node:test suite
```

## License

Apache-2.0. See [LICENSE](LICENSE).
