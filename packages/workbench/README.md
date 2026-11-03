# 天工 / Tiangong Workbench

A DSH bundle (Host + Web Client) for requirement-driven autonomous delivery:
create an app, submit or upload a requirement, and the loop plans, dispatches
child agents, verifies their test evidence, and records the delivery.

- Host half: `index.js` — HTTP state routes, agent tools, the delivery loop,
  planning protocol and requirement intake.
- Client half: `client.js` — the Tiangong panel (projects, task cockpit,
  finance, employees, organization), loaded through the DSH web module table.
- Ledger: `~/.dsh/workbench/events.jsonl` is the single source of truth; the
  panel is a projection of it.
- Tunables: `export const Config` (data dir, app root, auto-run, budgets,
  session preset, loop timings).

Install through DSH Plugin Manager (`install_bundle` with this package
directory) rather than editing the profile by hand.

`npm test` runs the node:test suite.
