# 天工 / Tiangong Workbench

A requirement-to-delivery workbench for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`).

Create an app or a project, paste a requirement or attach a document, and the workbench
plans a task graph, dispatches child agents, verifies their test evidence and records the
delivery — with every task bound to its own DSH session.

![Task board](packages/workbench/docs/assets/board.png)

## Install

```bash
git clone https://github.com/jossion/dsh-tiangong.git
dsh plugin --profile <profile> add /path/to/dsh-tiangong/packages/workbench
```

Restart DSH, then open the **天工 / Tiangong** entry in the sidebar. The plugin requires
DSH `>=0.2.1-rc.0 <0.3.0-0`.

## Repository layout

```
packages/workbench/     the plugin package (host + web client + tests)
```

## Documentation

Features, the configuration table, data/ledger behaviour and development instructions live
in the package README: [`packages/workbench/README.md`](packages/workbench/README.md).

## License

Apache-2.0. See [LICENSE](LICENSE).
