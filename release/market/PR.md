# 提交到 awesome-dsh-plugin（DSH 插件市场收录）

准备时间：2026-11-03。仓库 `jossion/dsh-tiangong` 创建于 2026-11-03 15:07（本地时间）。

## 0. 时间门槛

目录要求仓库**创建满 24 小时**才能提 PR。所以最早提交时间：

> **2026-11-04 15:07（本地时间）之后**

之前提交会被 CI 的「repo age」检查挡掉。

## 1. 准备的东西

同目录下的条目文件（内容已按 contributing.md 校验过 YAML）：

```
release/market/jossion__dsh-tiangong--packages-workbench.yml
```

它对应目标仓库里的路径：

```
data/plugins/jossion__dsh-tiangong--packages-workbench.yml
```

字段说明：

| 字段 | 值 | 说明 |
|---|---|---|
| `url` | `https://github.com/jossion/dsh-tiangong/tree/main/packages/workbench` | monorepo 子包，指向包目录 |
| `name` | `jossion/dsh-tiangong#workbench` | 列表里显示的链接文字（`#子包名`） |
| `category` | `workflow` | Workflow & Automation |
| `description.en` | 一行英文（含 `: `，已加引号） | 必填 |
| `description.zh` | 一行中文 | 可选（维护者会补） |
| `icon` | GitHub raw 位图 URL | 180×180 PNG，已验证 HTTP 200 |

> 文件名规则来自 contributing.md：monorepo 子包用 `owner__repo--packages-<subname>.yml`；
> 列表链接文字用 `owner/repo#<subname>`。**不要**手工编辑生成出来的两个 README。

## 2. 提 PR 的步骤（在浏览器里）

1. 打开 https://github.com/awesome-dsh-plugin/awesome-dsh-plugin
2. 点 **Fork**（fork 到你自己的账号）
3. 在你 fork 的仓库里进入 `data/plugins/`，点 **Add file → Create new file**
4. 文件名填：`jossion__dsh-tiangong--packages-workbench.yml`
5. 内容粘贴 `release/market/jossion__dsh-tiangong--packages-workbench.yml` 的全部内容
6. 提交（commit message 例如 `Add Tiangong Workbench (dsh-tiangong)`）
7. 回到上游仓库点 **New pull request**，选择你的 fork 分支
8. **PR 标题**：
   ```
   Add Tiangong Workbench (dsh-tiangong) to Workflow & Automation
   ```
9. **PR 内容**（直接复制）：

```markdown
## What this adds

Tiangong Workbench (`@jos/workbench`) — a requirement-to-delivery workbench for DeepSeek Harness.
Create an app/project, paste a requirement or attach a document, and the plugin plans a task graph,
dispatches child agents, verifies their test evidence and records the delivery. Every task stays
bound to its own DSH session.

- Package directory: https://github.com/jossion/dsh-tiangong/tree/main/packages/workbench
- Install (from the checkout):
  `dsh plugin --profile <profile> add /path/to/dsh-tiangong/packages/workbench`
  (or add the same directory through DSH's Plugin Manager `install_bundle`)
- Manifest: `packages/workbench/package.json` declares `dsh.bundle` (bundle patch) **and**
  `dsh.client` (web client module)
- Host requirement: `engines.dsh` = `>=0.2.1-rc.0 <0.3.0-0`
- Category: `workflow`
- Not on npm yet; it installs from the GitHub checkout, as the README documents.
- Ledger data lives outside the repo (`~/.dsh/workbench/events.jsonl`), so the repo is code only.

## Checklist

- [x] One YAML file under `data/plugins/`, generated READMEs untouched
- [x] `dsh.bundle` manifest present (installable with `dsh plugin add`)
- [x] Description is one accurate line (no marketing claims)
- [x] Repository is public and contains real, runnable code
- [x] Panels/screenshots are in `packages/workbench/docs/assets/`
```

## 3. CI 会检查什么

按 contributing.md，PR 会依次检查：

1. 每个 PR ≤ **3** 条条目
2. 条目 YAML 合法（引号、字段、category 取值）
3. 仓库里能取到 `dsh.bundle` manifest（根或 `packages/` 等子包的 package.json）
4. 仓库创建满 24 小时、公开、可访问
5. awesome-lint / 站点构建

通过后维护者会人工读代码并核对描述（例如说“有 5 个工具”就会去数），合并后：

- `awesome-dsh-plugin.com` 与 `dshmarket` 自动收录（通常 1 天内）
- DSH「插件 → 发现」索引（`dsh-plugin-catalog`，jsDelivr）随目录重建更新

## 4. 如果被要求改结构

最可能的意见是“仓库根没有 `dsh.bundle`，希望把包放根”——我们的结构是 monorepo 子包，
contributing.md 明确支持（`url` 指子目录、`name` 用 `#workbench`）。如果维护者仍要求根清单，
两个选择：

- 在仓库根加一个只含 `dsh.bundle` + 重导出 `packages/workbench` 的 package.json（不推荐，容易漂移）
- 把 `packages/workbench` 拆成独立仓库 `dsh-tiangong`（干净，但公开提交要重建）

## 5. 合并后（可选）

- npm 发布：`packages/workbench/package.json` 的 `name` 目前是 `@jos/workbench`，需要先定
  `dsh-tiangong` 或 `@jossion/dsh-tiangong`；发布前先 `sudo chown -R 501:20 ~/.npm`
- 发布后可在条目里加 `tarball`（非 npm 安装时才需要）
