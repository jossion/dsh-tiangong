# 工作台：从需求到完成的完整流程

> 文档类型：Explanation（理解机制）+ Reference（接口/状态速查）
> 读者：使用工作台的需求方；维护这个插件的开发者
> 范围：从「写入 / 导入一条需求」到「任务判定完成」的全部阶段、状态与数据
> 不包含：DSH 宿主自身实现、财务模块的数据清洗细节、员工 App 的业务字段设计

---

## 0. 一分钟总览

```
 你（需求方）                 工作台（host 插件）                 Agent（对话里的模型）
 ─────────                  ─────────────────                  ──────────────────
 卡片 / 新建任务 ──▶ POST /workbench/start
                          │
                          ▼
                    ① 规划 delivery.run
                       job created → 模型生成
                       角色/数据模型/API/任务树
                          │
                          ▼
                    账本 events.jsonl
                    任务树 + 决策 + 产物
                          │
                          ▼
                    ② 判定"谁可以干哪张卡"
                       workbench_next_work ──────────────▶ 取卡
                                                             │
                                                             ▼
                                                   ③ 每张卡派一个子 agent
                                                      在工作区真实改代码
                                                             │
                    ④ 记账 ◀──────────────── workbench_report_work
                       测试绿=done / 不绿=blocked
                          │
                          ▼
                    ⑤ 完成判定：叶子卡全 done
                       ⇒ job done ⇒ project done
                          │
                          ▼
                    ⑥ 交付物 / 驾驶舱 / 对话可见
```

**一句话**：工作台负责**计划、记账、判定、展示**；真正写代码的是被派出去的 agent。
工作台自己**不会**启动 agent（框架限制），这也是"开工 ≠ 执行"的原因。

---

## 1. 四个层级

| 层 | 含义 | 例子 | 存储 |
|---|---|---|---|
| 项目 project | 容器，一张卡片 | 公司管理 | `kind: project` 事件 |
| 任务 job | 一次需求 → 一份计划 → 一个驾驶舱 | 员工管理 / 财务管理 / 修改「员工管理」 | `kind: job` 事件 |
| 工作项 work item | 可派发的一张卡 | 创建员工表、修复员工编辑页 | `kind: task` 事件 |
| 决策 / 卡点 / 产物 | 过程证据 | is_done 0.98、待你决定、design.json | `kind: decision/approval/artifact` |

> 旧账本里没有 job 层的数据会自动归入一个**隐式任务**（id = projectId，标题 = 项目名），
> 所以升级前的项目不会因为缺字段而消失。

---

## 2. 需求进入（三种入口，行为一致）

| 入口 | 操作 | 实际请求 |
|---|---|---|
| 卡片 + 「新建任务」 | 在卡片里点「＋ 新建任务」，写一段需求 | `POST /workbench/start { requirement, projectId }` |
| 已完成任务 + 「修改/修复」 | 在驾驶舱点「＋ 修改/修复」，预填 `修改「X」：`，选类型 | `POST /workbench/start { requirement, projectId, parentJobId, kind }` |
| Agent 直接调用 | 对话里让 agent 用工具规划 | `workbench_plan_software { requirement, projectId?, jobId? }` |
| 命令行/脚本 | 直接打 HTTP（调试用） | 同上 |

要点：

- **没有"文件导入"入口**。目前需求只能是一段文本；Excel/CSV 导入属于财务模块自身的能力，不是需求入口。
- `parentJobId` + `kind(change|fix|feature)` 表示这是对某个已完成任务的**后续需求**，详见第 7 节。
- 提交后 host 立即返回 `202`，规划在后台跑；面板能看到 `planning: true`，随后出现 `job created`。

---

## 3. 规划阶段（host 自己完成，不需要 agent）

`delivery.run()` 依次做这些事，每一步都写入账本：

| 步骤 | 写入 | 说明 |
|---|---|---|
| 1. 开任务 | `job created { title, brief }` | jobId = 本次运行 id（如 `deliveries_mvzyodic_r7pkmi`） |
| 2. 挂项目 | 新卡片：`project created`；已有卡片：`project started` | 已有卡片保留你起的名字，只追加 brief 与产物目录 |
| 3. 路由决策 | `decision which_skill` | 机械判断：只有一条候选，不询问模型 |
| 4. 角色 / 权限 | `task roles` + `roles.json` | 业务角色与权限矩阵 |
| 5. 数据模型 / API | `task design` + `design.json` | 实体、字段、接口面 |
| 6. 计划评审 | `task design(review)` + `review.json` | 风险与保留意见；高风险会进 human 泳道 |
| 7. 任务树 | `task build` + 每个工作项一张 `task created` | 父卡「实现（N 个工作项）」+ N 张可派发子卡 |
| 8. 验收 / 报告 | `task verify`、`task report` | 阶段轨补齐，交付报告落盘 |
| 9. 规划收尾 | `job started` | **注意：不是 done**——工作项还没人执行 |

规划产物落在：

```
~/.dsh/workbench/events.jsonl                          ← 账本（唯一真相）
~/.dsh/workbench/deliveries/<jobId>/design.json        ← 数据模型/API/工作项
~/.dsh/workbench/deliveries/<jobId>/roles.json         ← 角色权限
~/.dsh/workbench/deliveries/<jobId>/review.json        ← 计划评审
```

阶段轨（固定顺序）：`brief → roles → design → build → verify → report`。

---

## 4. 派发执行（这一步需要 agent）

### 4.1 谁能取卡：`workbench_next_work`

取卡判定（全部满足才派发）：

| 规则 | 原因 |
|---|---|
| 叶子卡（无 children） | 父卡是容器，不是工作 |
| 状态不是 done / failed | 已完成的卡不再派 |
| 阶段是 `build` 或 `verify` | brief/roles/design/report 是规划产物 |
| 没有未完成的 `blockedBy` | 依赖没完成就不能开始 |
| owner 不是 `workbench`/空 | 规划代理自己不做实现 |
| 没有**阻塞型**审批在等 | 见第 6 节 |
| 所在 job / project 不是 paused/cancelled | 停就是停，不是"礼貌地避开" |

返回内容 = 卡片信息 + **可直接交给子 agent 的 prompt**（含工作项说明、计划文件路径、不许做的兄弟卡）。

### 4.2 执行循环（Lead 的标准动作）

```
循环：
  1. workbench_next_work { jobId, limit }
  2. 对每张卡：
       workbench_report_work { taskId, event:"progress", notes }   ← claim，卡片变蓝、LIVE 出现
       按需派 subagent（cwd = 任务工作区）
  3. 子 agent 返回后：
       workbench_report_work { taskId, event:"done", files, tests:{exitCode,passed,failed}, ... }
  4. 若返回"no work"：全部完成 / 被依赖或卡点挡住 / 队列被暂停
```

### 4.3 证据规则（这套系统的核心约束）

- `event:"done"` 必须带**真实的测试证据**；`testsGreen()` 判定不绿时，host 会把它降级为 **`blocked`**，不会假装完成。
- `progress` 只记"领取/正在做"，**不产生决策**（避免半成品污染 is_done）。
- 终态报告会同时写 `artifact` 事件与决策：`which_file`（改了哪些文件）、`diff_risk`（改动风险）、`is_done`。
- 置信度来自机器证据，不是模型自评：文件数、测试退出码、静态分析分数。

---

## 5. 完成判定（派生，不是某人喊一声）

```
叶子卡全部 done
  ⇒ job.status = done
    ⇒ 该项目的所有 job 都 done
      ⇒ project.status = done
```

判定细节：

- 统计只看**叶子卡**，父卡不重复计入（否则分母翻倍）。
- `failed` 卡存在时，job 判 `failed`。
- `paused` / `cancelled` 是显式状态，不会被"done 派生"覆盖。
- **规划结束不等于完成**：早期账本在规划末尾写过 `job done`，投影会把"还有 todo 卡"的旧 job 纠正回 `started`。

---

## 6. 审批与卡点

两类"等你决定"，语义完全不同：

| 类型 | 来源 | 会挡执行吗 | 处理 |
|---|---|---|---|
| **approval（审批）** | 不可逆动作、需要人放行 | ✅ 只挡**这一张卡**及其下游 | 批准→放行；驳回→卡片变 blocked |
| **decision（建议）** | 低置信度判断（which_file 0.50、diff_risk 6.2） | ❌ 只是提示 | 知悉 / 表达异议 |

- 批准/驳回写 `kind: approval` 事件；同一 `taskId+action` 后来者覆盖先前请求。
- 面板里每条卡点都带「批准 / 驳回」，并标注"会卡住这张卡 / 仅建议，不阻塞"。
- 整张 job 完成后，挂着的建议性卡点自动退出待办（决策流里仍保留历史）。

### 暂停 / 继续 / 终止

| 动作 | 效果 | 可逆 |
|---|---|---|
| `pause` | 队列停止派发；已完成的不受影响 | ✅ `resume` 恢复 |
| `resume` | 解除暂停；若项目级被暂停，也会一并解除 | — |
| `cancel` | 队列永久关闭、在跑的规划被 abort；已完成与产物保留 | ❌ 单向 |

恢复只打开闸门，**不会自动开始执行**——执行仍然需要 agent 取卡。

---

## 7. 需求变更：新任务，不回开旧任务

```
员工管理（done） ──「修改/修复」──▶ 修改「员工管理」：…（新 job，parentJobId=员工管理）
                                        │
                                        └─ jobKind: change | fix | feature
```

- 任务列表里：子卡显示 `来自 员工管理`，父卡显示 `N 个后续任务`。
- 旧的 job 保持不可变：它的产物、决策、14/14 完成度都是历史事实；新改动有自己的计划/验收/驾驶舱。
- 允许直接改原任务的情况只有元数据：标题、工作区、绑定会话（`POST /workbench/job-config`），这些不影响"交付过什么"。

---

## 8. 工作区、会话与"开始执行"

### 8.1 工作区（必须先有）

1. 驾驶舱点「工作区」→ 弹窗列出 **DSH 左侧栏已有工作区**（单选）
2. 或「新建工作区」→ `workspaces.create({ path, title })`，创建后左侧栏立即可见
3. 选中后写入 `job config`：`workspace`（路径）+ `workspaceId`（宿主 id）

### 8.2 绑定对话

- 对话抽屉列出该 workspace 下的会话（`sessions.list.getSnapshot()`），可新建（`sessions.create({workspaceId})`）或绑定已有
- 绑定关系写 `job config { sessionId }`
- 抽屉支持读 transcript（3s 刷新、自动滚到最新）与发消息（图片走 `createDrafts` + 附件 id）

### 8.3 「开始执行」按钮做了什么

```
点击 ▶ 开始执行
  → 目标会话 = 本任务 sessionId，缺省回退父任务的 sessionId
  → 向该会话发送一段指令：用 workbench_next_work 逐张取卡…
  → 那个会话里的 agent 收到后开始派活（执行才真正开始）
```

没有绑定会话时按钮只会提示「先绑定对话」，不会静默失败。

---

## 9. 界面上能看到什么

| 视图 | 内容 | 判定来源 |
|---|---|---|
| 卡片网格 | 项目 = 应用入口（标题 + 状态灯 + 打开应用） | project + workspace |
| 项目应用页 | 员工管理（原生表格 CRUD）/ 财务管理（另一个 Tab） | 插件自己的 SQLite / 财务 store |
| 任务列表 | 每 job 一张卡：进行中/待执行/已暂停/已终止/已完成 + 血缘 | job 状态派生 |
| 驾驶舱 | 团队图（主代理 + workbench/backend/frontend/qa 泳道）、阶段轨、进度、卡点、决策流、交付物 | 账本投影 |
| LIVE | `running` 数量 + 每张 active 卡的最近一句 `notes` + 已跑时长 | `task progress` 事件 |
| 顶部状态 | 已完成 / 进行中 / 已暂停 / 已终止 / 待执行 | project/job 状态 |

刷新策略：有任务在跑时前端 **1.2s** 拉一次状态；空闲 **3s**。

驾驶舱布局（响应式）：

- 宽 ≥1200：左栏（进度/阶段/任务）+ 画布 + 右栏（待你决定/决策流/交付物）
- 宽 <1200：左右栏折叠成「▤ 面板」抽屉
- 有绑定会话时默认展开右侧对话栏（≥760 侧栏，<760 底部堆叠）

---

## 10. 数据存在哪

### 10.1 账本（唯一真相）

`~/.dsh/workbench/events.jsonl`，每行一个事件，append-only：

```json
{"kind":"job","projectId":"prj_…","jobId":"deliveries_…","event":"created","title":"员工管理","ts":"…"}
{"kind":"task","taskId":"deliveries_…:wi:db","projectId":"prj_…","jobId":"deliveries_…","event":"created","owner":"backend","stage":"build","blockedBy":["…"],"ts":"…"}
{"kind":"task","taskId":"deliveries_…:wi:db","event":"progress","notes":"正在写 schema","ts":"…"}
{"kind":"task","taskId":"deliveries_…:wi:db","event":"done","notes":"迁移通过","ts":"…"}
{"kind":"artifact","taskId":"…","path":"packages/workbench/finance.js","ts":"…"}
{"kind":"decision","decision":"is_done","lane":"code","confidence":0.98,"rule":"tests:green","value":"done","projectId":"…","jobId":"…","taskId":"…"}
{"kind":"approval","taskId":"…","action":"merge_pull_request","status":"requested","irreversible":true,"ts":"…"}
```

两种投影：

| 投影 | 产物 | 用途 |
|---|---|---|
| `buildBoard()` | 项目 → jobs → 阶段/泳道/任务树/卡点/产物/进度 | 看板与驾驶舱 |
| `summarize()` | 决策数、泳道分布、置信度序列、待决定列表 | 决策面板 |

### 10.2 视图状态（永远不进账本）

| key | 内容 |
|---|---|
| `workbench:positions:v2:<projectId>` | 画布卡片坐标 |
| `workbench:panel:<projectId>:<panelId>` | 旧浮动面板位置（兼容保留） |
| `workbench:rails:<projectId>` | 两侧栏开/关 |
| `workbench:chat:<projectId>` | 对话栏开/关 |
| `workbench:tab` | 顶层 Tab（工作台 / 财务管理） |

### 10.3 业务数据（不是工作台账本）

| 模块 | 存储 |
|---|---|
| 员工管理 | 交付的 Next.js App 的 SQLite：`projects/<prj>/web/data/app.sqlite`，工作台通过 `node:sqlite` 直读/直写（无 iframe） |
| 财务管理 | 插件本地 JSON store（`financeConfig / financeImports / financeTransactions`），银行流水 CSV/XLSX 导入 |
| 服务状态 | 内存托管表 + 探测（`/workbench/services`），插件 dispose 时回收子进程 |

---

## 11. HTTP 接口参考

| 路径 | 方法 | 用途 |
|---|---|---|
| `/workbench/state` | GET | 只读投影：board + summary + events + planning |
| `/workbench/start` | POST | 提交需求（规划），202 |
| `/workbench/projects` | POST | 新建项目卡片（不规划） |
| `/workbench/control` | POST | pause / resume / cancel（可带 jobId 只作用于单任务） |
| `/workbench/decide` | POST | 批准 / 驳回某个卡点 |
| `/workbench/job-config` | POST | 任务的标题 / 工作区 / workspaceId / sessionId |
| `/workbench/project-config` | POST | 项目工作区路径（旧） |
| `/workbench/task` | POST | 与 `workbench_report_work` 等价的 HTTP 记账入口（给无法用工具的调用方） |
| `/workbench/employees` | GET/POST | 员工 CRUD（面板原生 UI 用） |
| `/workbench/services` | GET/POST | 依赖服务状态与启停 |
| `/workbench/organization` | GET/POST | 面板原生组织架构：多公司 / 公司内部门树 / 职级，增删改（与交付 App 共库） |
| `/workbench/pick-path` | POST | 打开系统原生文件/文件夹选择框，返回绝对路径（只返回路径，不执行任何用户命令） |
| `/workbench/browse-path` | POST | 列目录（内置路径浏览器用）：目录优先、隐藏 dotfile、返回 parent/home |
| `/workbench/finance` | GET/POST | 项目财务看板 / 导入 / 配置目录（必须带 `projectId`，数据按项目隔离） |

错误信封统一：`{ error: { code, message, details? } }`。

---

## 12. Agent 工具参考

| 工具 | 入参要点 | 返回 |
|---|---|---|
| `workbench_plan_software` | `requirement`，可选 `projectId/jobId/parentJobId/kind` | 运行 id、jobId、规划结果摘要 |
| `workbench_next_work` | `projectId? jobId? limit?` | 就绪卡 + 可直接用的 prompt；被停时 `stopped: paused/cancelled` |
| `workbench_add_task` | `title`，可选 `owner/stage/jobId` | 新增一张"执行中发现"的卡 |
| `workbench_report_work` | `taskId`、`event(progress/done/failed/blocked)`、`files`、`tests`、`notes`、`linesChanged` | 记账结果、`readyAfter` |

---

## 13. 失败与恢复

| 现象 | 含义 | 处理 |
|---|---|---|
| 卡片变 `blocked` | 报告 done 但测试不绿，或审批被驳回 | 修代码/修测试 → 重新 report done；驳回的需人工解锁 |
| 「no work」但任务没收尾 | 依赖未完成 / 卡点阻塞 / 队列暂停 | 看卡点面板；`resume`；或补完依赖 |
| `running` 有值但文件没变化 | **账本是"已领取"，但没人真正执行** | 检查是否忘了 spawn agent（真实踩过） |
| 崩溃提示 `.next` 相关 500 | 多个 agent 并发 `next dev/build` 抢构建目录 | 停 dev → 删 `.next` → 串行 build，再验收 |
| 侧边栏入口消失 | client 插件 apply 被可选服务依赖卡住 | 必选 inject 只留 `slots/locale`，会话服务走 `ctx.inject([...])` 可选注入 |
| 桌面版启动失败 `Web authentication failed` | 过期 cookie 堆积 | 备份后删 `…/dsh-desktop/Cookies*`（详见 AGENTS.md） |

---

## 14. 真实案例时间线（公司管理）

### 14.1 员工管理（14/14 已完成）

```
需求：为公司管理项目添加一个卡片叫员工管理
规划：5 个阶段卡 + 9 个工作项
执行：8 张卡由子 agent 完成（契约→骨架→表→API→UI→QA），1 张被跳过
证据：10/10 契约测试 → 7/7 骨架 → … → 83/83 全量；两次 blocked 均因测试红被拦
收尾：job done → project done；交付物 44 个文件
```

### 14.2 修改「员工管理」（17 项）

```
需求：员工信息修改报错 + 组织架构（公司/部门/职级）
规划：17 项（含 4 张表、4 个 API、2 个前端、1 张 QA）
执行：表/权限/API 依次完成，前端编辑修复独立完成
      本轮 8 张卡：company 表 → 权限守卫 → departments 表 → job_levels 表
                    → company API → departments API → job_levels API → 组织架构页
收尾：QA 卡覆盖 PATCH 部分更新 / 空值 / 部门环 / 权限 401
```

---

## 15. 已知边界与待办

| 项 | 现状 |
|---|---|
| 成本记账 | 所有 `costUsd` 仍是 0（未接真实 token 计费） |
| 需求导入 | 只支持文本；文件导入不在工作台层 |
| 财务模块 | ✅ 已按项目隔离（每个项目独立流水目录 / 导入批次 / 流水行），顶层 Tab 已移除 |
| 组织架构 | 面板原生模块支持多公司（公司/部门/职级增删改）；交付 App 的 `/org` 页仍是单公司视图，待对齐 |
| 执行自动化 | 平台限制：插件不能起 agent；必须由某个对话里的 agent 取卡 |
| 员工 App 与原生面板 | 员工管理有独立 Next.js App，面板同时有原生 UI（读同一 SQLite）；两套入口并存是有意为之 |

---

## 16. 术语表

| 术语 | 含义 |
|---|---|
| job | 一次需求对应的一次规划运行，驾驶舱的单位 |
| work item / 卡 | 可派发的最小执行单位 |
| lane（泳道） | 按 owner 分列：workbench / backend / frontend / qa |
| gate（卡点） | 需要人处理的审批或建议 |
| evidence | 机器证据：测试退出码、文件数、静态分析分数 |
| blocked | "报告完成但证据不成立"的诚实状态 |
| LIVE | 正在执行中的卡片与它们最近一句进度 |
