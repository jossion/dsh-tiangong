# 天工 · 需求到交付的自主闭环（设计 v1）

> 本文是 `packages/workbench` 下一版的目标形态与实现契约。它继承
> [agent-workflow-design.md](agent-workflow-design.md) 的「决策可审计、只信机器证据」
> 与 [workbench-workflow.md](workbench-workflow.md) 的现有数据模型，只改「谁来驱动闭环」。

## 1. 一句话

**插件当调度器，主 agent 当决策者，子 agent 当执行者。**

用户提交需求后，插件自动：建/绑交付会话 → 唤醒主 agent 用技能规划 → 把任务树写进账本 →
按依赖逐张唤醒派发 → 收子 agent 的机器证据 → 判定 done/blocked/重试 → 直到交付。
人只在 human 泳道出现时被打断。

## 2. 角色与边界

| 角色 | 身份 | 负责 | 不负责 |
|---|---|---|---|
| 用户 | 需求方 | 创建应用、提交/上传需求、处理 human 卡点 | 盯每一步 |
| 插件（host half） | 调度器 + 账本 | 状态机、任务树、唤醒、证据判定、面板投影 | 写业务代码、替 agent 思考 |
| 主 agent | 项目专属交付会话里的 Lead | 理解需求、调技能、出计划、派子 agent、回报 | 自己判断 done（必须机器证据） |
| 子 agent | 主 agent 派的 Agent Teams 成员 | 认领一张卡、拆子任务、调技能、改代码跑测试、report | 越权改别的卡 |

**绑定**：一个项目（应用）= 一个工作区 = 一个专属交付会话；项目内的多轮需求（job）共用它。
job 仍各自保留 `sessionId` 快照，兼容现有「任务↔会话绑定」。

## 3. 生命周期（插件视角的状态机）

```
用户点创建
  └─ project created ──► 分配工作区（appsRoot/<slug>）+ 注册 DSH workspace
       └─ 需求提交/上传 ──► requirement 事件
            └─ ensure-session（首次需求时创建交付会话 + agent，绑定 preset）
                 └─ 唤醒主 agent：规划指令（需求全文 + 项目上下文 + 技能提示）
                      ├─ 成功：workbench_submit_plan → task created 树
                      └─ 超时/失败：delivery.run 兜底，并记一条 decision（兜底不算 done）
                           └─ 调度循环（每次事件后求值一次）：
                                ready 卡 & agent 空闲  → wake(取卡指令)
                                agent 运行中            → wait
                                无 ready 但未完成       → 等依赖 / human 卡点
                                叶子卡全 done           → job done → project done → 交付报告
                                失败/重试超限/不可逆     → human 泳道，等用户
```

### 状态机入参（纯函数，见 `orchestrator.js`）

`{ job, tasks, gates, runtime, config, now }` → **一个** `action`：

| action | 触发条件 | 执行方 |
|---|---|---|
| `bind-session` | 有 job 但没有可用会话 | host：建会话/绑会话 |
| `start-planning` | 还没计划、不在规划中 | host：唤醒主 agent 规划 |
| `plan-timeout` | 规划超时 | host：兜底规划 + 记 decision |
| `wake` | 有 ready 卡、主 agent 空闲、冷却已过 | host：`agent.followup()` + 取卡指令 |
| `wait` | 主 agent 运行中 / 规划中 / 冷却中 | 调度器：等下一个事件 |
| `human-gate` | 阻塞型审批、失败、重试超限、预算耗尽 | 面板「等你决定」 |
| `complete` | 叶子卡全部 done | host：写交付报告 |
| `idle` | 暂停/终止/无卡可做 | — |

调度器由事件触发（`requirements` 提交、`tools/result`、`subagent/end`、`agent/status`、
定时兜底 tick），每次只推进一个 action，天然幂等。

## 4. 账本增量（append-only，kind 全部是插件私有）

现有：`project / job / task / decision / approval / artifact`。
新增：

```json
{"kind":"requirement","projectId":"prj_…","jobId":"deliveries_…","text":"…","file":"requirements/xxx.md","source":"text|upload","ts":"…"}
{"kind":"plan","jobId":"…","by":"agent|fallback","roles":true,"design":true,"tasks":12,"ts":"…"}
{"kind":"dispatch","jobId":"…","taskId":"…","round":3,"mode":"agent|autopilot","ts":"…"}
{"kind":"skill","jobId":"…","taskId":"…","query":"…","hit":"tdd|market:foo|none","ts":"…"}
{"kind":"delivery","projectId":"…","jobId":"…","summary":"…","evidence":{"tests":…},"ts":"…"}
```

投影侧（`buildBoard` / `summarize`）只做加法：job 增加 `requirement`、`planBy`、`dispatch` 计数；
project 增加 `appRoot`、`sessionId`。旧账本不需要迁移。

## 5. 规划协议（`workbench_submit_plan`）

主 agent 必须通过工具提交计划，而不是靠自由文本：

```
workbench_submit_plan {
  jobId,
  brief: string,
  roles?: [{role, permissions}],
  design?: { entities, api },
  tasks: [{ id, title, owner, stage, blockedBy?, skill?, acceptance? }]
}
```

校验：`tasks` 非空、`id` 唯一、`blockedBy` 必须指向同批 id、无环；`owner ∈ {backend, frontend, qa, workbench}`；
`stage ∈ {build, verify}`（可派发）或 `{brief, roles, design, report}`（阶段卡）。
校验通过后一次写入整棵树；失败返回错误清单让 agent 修正（最多 N 次，超限走兜底）。

## 6. 派发循环（闭环核心）

```
事件 → orchestrator.nextStep()
  wake  → 主 agent 收到：「就绪卡：… 用 workbench_next_work 取卡，按 prompt 派子 agent；
                            子 agent 回报用 workbench_report_work；不要自评 done」
  report → 账本追加 → 再求值
  subagent/end → 若子 agent 没回报就结束，记 failed 并把卡退回 blocked（不猜成功）
```

- 子 agent 的 prompt 由 `executor.js` 现有 `readyWork()` 生成（已含：工作项说明、计划文件、
  兄弟卡禁改、验收标准），新增 **技能提示** 段。
- 主 agent 每次只拿到「就绪卡 + 指令」，不拿整棵树，避免上下文膨胀。
- **autopilot 兜底**（可配，默认关）：主 agent 连续两轮不响应或预算耗尽时，插件用
  `subagents.startActivation({ parent: 交付会话 agent, prompt: 卡 prompt })` 直接派发，
  仍然只认 `report_work` 的机器证据。

## 7. 技能发现（`workbench_find_skill`）

```
findskill { query, taskId? }
  1. ctx.skills.snapshot() 的会话技能目录 → 关键词/描述打分
  2. 未命中 → ctx.pluginMarket.listIndexes() + search(index, {query}) → 市场候选
  3. 返回 [{name, source: 'session'|'market', why, installHint?}]
```

子 agent 的 prompt 固定包含：「开工前先 `workbench_find_skill`，命中就用对应技能；
市场候选先用 `plugin_manager` 安装（需用户确认）再继续；都没有就按任务自觉完成并回报缺技能。」
子 agent 的查找结果记 `kind:"skill"` 事件，用于后续 `which_skill` 决策的规则积累。

## 8. 人工卡点（三泳道落地）

| 情况 | 处理 |
|---|---|
| `conf ≥ 0.8` 的机械决策 / 正常卡 | 自动 |
| `0.5 ≤ conf < 0.8` | frontier：只把不确定性写进 decision，不打断 |
| `conf < 0.5`、测试红、重试超限、预算耗尽 | human 泳道：卡住该卡及下游，面板「等你决定」 |
| 任何不可逆动作（merge/删分支/轮换密钥/发客户） | 永远 human |

「全自动」= code 泳道自动；「异常打断」= human 泳道。与设计文档第 2.2 节一致。

## 9. 接口增量

### HTTP

| 路径 | 方法 | 用途 |
|---|---|---|
| `/workbench/apps` | POST | 创建应用：项目 + 工作区 + 交付会话（一次返回 projectId/appRoot/sessionId） |
| `/workbench/requirements` | POST | 提交需求：`{projectId, text?, file?:{name, base64}}`，202 |
| `/workbench/state` | GET | 追加 `appRoot`、`sessionId`、`requirement`、`dispatch` 进度、`autopilot` 状态 |

### Agent 工具

| 工具 | 用途 |
|---|---|
| `workbench_submit_plan` | 主 agent 提交计划（唯一合法入口） |
| `workbench_find_skill` | 子 agent 技能发现（会话目录 + 市场） |
| 现有 4 个 | 保留（`plan_software` 降级为兜底入口） |

## 10. 模块划分

| 文件 | 职责 | 依赖 |
|---|---|---|
| `orchestrator.js` | 纯状态机：`nextStep(snapshot)`、就绪/进度/卡点判定 | 无（可单测） |
| `requirements.js` | 需求解析（md/txt 先，docx 后续）、落盘、规划指令拼装 | node:fs |
| `skillfind.js` | 技能匹配打分、findskill 结果格式化 | 无（market 通过注入） |
| `planner.js` | `submit_plan` 校验（DAG/owner/stage）、计划落账 | 无（可单测） |
| `sessions.js` | 交付会话的创建/绑定/唤醒、按 agent 注册 prompt section | ctx（agents/sessions/systemPrompt） |
| `dispatch.js` | 事件驱动的调度循环装配（tick/cooldown/预算） | orchestrator + 账本 |
| `index.js` | 路由/工具/配置接线 | 以上全部 |

## 11. 分期

| 阶段 | 内容 | 验收 |
|---|---|---|
| **A** ✅ | 契约文档 + `orchestrator.js` 状态机 + 单测 | `npm test` 全绿 |
| **B** ✅ | `planner.js` + `workbench_submit_plan` 工具 + `plan` 投影 | 非法计划被拒、合法计划成树、一 job 一计划 |
| **C** ✅ | `requirements.js` + `POST /workbench/requirements`（文本/md/txt 上传）+ 规划指令 | 需求落账、可读文件、指令含 jobId 与技能提示 |
| **F** ✅ | `skillfind.js` + `workbench_find_skill`（会话目录 + 插件市场 + 审计行） | 无宿主服务时干净降级；命中带理由 |
| **D** ✅ | `sessions.js`：项目专属会话 + 工作区、agent 创建/恢复、`followup` 唤醒、消息形状对齐宿主的 `user/message` | 无宿主服务时干净降级并落 human 卡点 |
| **E** ✅ | `dispatch.js`：事件驱动 tick（tool/result、subagent/end、agent/status）+ 冷却/轮数/预算 + 交付去重 | 假 sessions 单测覆盖绑定→规划→派发→完成→卡点 |
| G | 面板：创建应用、需求上传、自动运行状态、卡点 | 截图复验（先过 UI 技能） |
| H | 审计遗留 P1：connection fence / 路径沙箱 / store 损坏保护 | 测试 + 手工验证 |

## 12. 风险与待验证（实现时用实时契约确认）

> **D/E 已落地但尚未真机验证**：`agent.followup`、`sessions.create`、`agents.create`
> 在插件上下文里的确切行为只用假 ctx 单测过；真正跑通需要重启 DSH（宿主模块不热更）。
> 重启后先看 `~/.dsh/workbench/events.jsonl` 里有没有 `kind:"dispatch"` 与 `kind:"delivery"`。

1. **唤醒契约**：`agent.followup()` / `agent.inject()` 在插件侧的确切签名与状态含义（idle/running）。
2. **建 agent**：`agents.create({ sessionId, meta: { cwd, agentPreset } })` 需要先 `sessions.create`；
   preset 必须带 Agent Teams（否则主 agent 没有 `spawn_teammate`）。
3. **直接派发**：`subagents.startActivation({ provider, request: { parent, prompt, cwd } })` 的 provider 名与能力。
4. **上传**：`fileUploads` 是 agent-scoped Remote；工作台要落项目目录，可能自建上传路由。
5. **成本**：`tokenMeter`/`assistant/message.usage` 汇总到 job，作为预算熔断依据（H 阶段）。

## 13. 命名

展示名：**天工（Tiangong）**，标语「天工 · 需求成物」。
包名暂留 `@jos/workbench`（避免重装 profile），只改 locale `meta.title` 与面板文案。
