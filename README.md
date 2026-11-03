# dsh-workflow-jos

公司运营管理 + 需求驱动的软件交付工作流。DSH bundle（host 插件 + web 客户端面板）。

当前有一个可用面板：**@jos/workbench**（展示名「天工 / Tiangong」），侧栏「天工」入口 → 主面板。
需求提交后自动闭环：规划 → 派发子 agent → 测试证据判定 → 交付。

## 目录

```
packages/workbench/          @jos/workbench 插件本体
├── index.js                 host：store、事件日志、只读状态路由、agent 工具
├── excel.js                 零依赖 xlsx 读取（zip + XML + 日期序列）
├── ledgerdb.js              只读读取公司账本 SQLite（finance 表 + 公司/部门/人维度）
├── client.js                浏览器面板：工作流 / 财务管理
├── delivery.js              需求驱动的交付规划（brief → roles → design → review → report）
├── router.js                10 个决策 + 证据规则 + 三泳道路由 + 不可逆白名单
├── events.js                追加式 JSONL 日志（决策 / 任务 / 产物 / 审批）+ 决策投影
├── projects.js              看板投影：任务树 / agent 泳道 / 阶段轨 / 依赖 / 人工卡点
├── executor.js              执行器：可派发工作包 + 儿童 prompt + 报告回写与判定
├── orchestrator.js          闭环调度状态机（纯函数）：bind/plan/wake/wait/gate/complete
├── planner.js               计划协议：DAG 校验 + 任务树写入
├── requirements.js          需求入口：文本/文档解析 + 规划指令
├── skillfind.js             技能发现：会话目录 + 插件市场打分
├── sessions.js              交付会话：建工作区/会话/agent、followup 唤醒
├── dispatch.js              调度循环：事件驱动 tick、冷却、预算、交付去重
├── store.js                 本地 JSON 持久化（staff / ledger / deliveries）
├── tests/                   node --test，260 个用例
├── preview/                 静态面板预览 + seed 脚本
└── locale/                  插件卡片显示文案
docs/
└── agent-workflow-design.md 开发工作流智能体的架构设计
_dsh_ref/                    插件开发参考（host-plugin / ui-plugin / practices …）
```

## 跑起来

```bash
cd packages/workbench
npm test              # 260 个测试
npm run preview       # 生成 preview/out/data.js，然后打开 preview/dashboard.html
node --check client.js
```

## 装进 DSH

官方路径是 `plugin_manager` 的 `install_bundle`（它会同时写入依赖、lock 与 bundle 列表）：

```
plugin_manager action=install_bundle target=/Users/jossion/codes/dsh-workflow-jos/packages/workbench
```

开发期 profile 用 `"@jos/workbench": "link:…/packages/workbench"` 挂载（`dsh.bundle.patch` 会把插件插进 profile），
不要手改 profile 的 `package.json` / `cordis.patch.yml`。host 改动需完全退出 DSH 再启动；客户端改动刷新页面即可。

## 现状

| 能力 | 状态 |
|---|---|
| 面板挂载（侧栏 + 主面板 + locale + 主题 token） | ✅ |
| 决策日志 `events.jsonl` + 投影 | ✅ 已完成 |
| 10 决策路由 / 三泳道 / 不可逆白名单 | ✅ 已完成（纯函数 + 测试） |
| `GET /workbench/state` 只读投影路由 | ✅ 已完成 |
| `POST /workbench/start` 任务入口（一句需求 → 挂到卡片/新建项目） | ✅ 已完成（同源校验 + 16KB 上限 + 单并发） |
| `POST /workbench/projects` 创建命名卡片 | ✅ 已完成（201 + projectId） |
| 面板首页卡片网格 + 创建对话框 + 点卡进详情 | ✅ 已完成 |
| 面板「新建任务」入口（详情页右上按钮 → 对话框） | ✅ 已完成 |
| 暂停 / 继续 / 终止（`POST /workbench/control`） | ✅ 已完成 |
| 面板「决策」页（计数 / 泳道分流 / 决策流 / 等你决定） | ✅ 已完成 |
| 规划流程发决策事件 | ✅ 已完成（4 个决策点） |
| 任务 / 产物 / 审批事件 schema（含 owner / taskId / blockedBy） | ✅ 已完成 |
| 看板投影（任务树 / agent 泳道 / 阶段轨 / 阻塞 / 卡点） | ✅ 纯函数 + 15 个用例 |
| `GET /workbench/state` 携带 `board` | ✅ 已完成 |
| 面板单页：卡片网格 → 项目画布（团队图 + 浮动 HUD 面板） | ✅ 已接 |
| 规划产物 → 任务树（工作项按 scope 分给前后端 / QA，dependsOn → 阻塞边） | ✅ 已完成 |
| 规划并行度体检 + 过度串行自动返工一次 | ✅ 纯函数 + 4 个用例 |
| 执行编排（agent 拉起子 agent 干活，插件只记账） | ✅ 机制已通（见「执行器怎么用」） |
| 端到端首跑（真模型调用） | ✅ 4 条决策 / 4 角色 / 19 工作项 |
| 执行器：依赖就绪判定 + 工作包 prompt + 报告回写 | ✅ 纯函数 + 7 个用例 |
| 工具 `workbench_next_work` / `workbench_report_work` | ✅ 已注册（重启后可用） |
| 工具 `workbench_add_task`（实施中发现的活进看板） | ✅ 已注册（重启后可用） |
| code 泳道真执行（子 agent 由 DSH 拉起，写目标工作区） | 🟡 机制已通，待跑真任务 |
| 面板内人工审批（点按钮批准） | ⬜ P1 |
| 真实成本记账（token → USD） | ⬜ P2 |
| 财务管理：宿主读指定目录流水文件（CSV 编码/分隔符/表头识别） | ✅ 纯函数 + 12 个用例 |
| 财务管理：Excel 读取（.xlsx/.xlsm，零依赖 zip+xml、多 sheet 选表、日期序列、共享/内联字符串） | ✅ 纯函数 + 6 个用例 |
| 财务管理：旧版 .xls 明确拒绝并提示另存为 .xlsx | ✅ 已完成 |
| 财务管理：导入批次 / 流水行 / 去重（文件指纹 + 行哈希） | ✅ 已完成 |
| 财务管理：看板（KPI / 月度 / 分类 / 明细 / 时段·分类·方向·搜索筛选） | ✅ 项目内模块（员工管理 / 组织架构 / 财务管理），数据按项目隔离 |
| 财务管理：SQLite 数据源（只读直连 `finance` 表，分类组/公司/部门/人/交易后余额） | ✅ 纯函数 + 路由用例 |
| 财务管理：两种数据源切换（流水目录 / SQLite 数据库），按库实时读取不落副本 | ✅ 面板「数据源」 |
| 财务管理：数据源路径选择——点「选择…」直接打开面板内置路径浏览器（不依赖系统对话框，任何宿主都可用） | ✅ `POST /workbench/browse-path`（原生框 `pick-path` 仅作可选增强） |
| 人员管理 | ⚠️ 骨架，数据通道未接 |
| 任务汇报 HTTP 口 `POST /workbench/task`（同「done 需绿测试」门槛） | ✅ 已完成 |

设计与取舍见 [docs/agent-workflow-design.md](docs/agent-workflow-design.md)。

## 已经踩过的坑（别再踩）

这四个都是「代码看着对、但从没被执行过」类型的 bug，全部在第一次真正激活/运行时才暴露：

1. **`ctx.tools.register` 必须声明 `output`**
   缺了它直接抛 `TypeError`，而抛错会**掀掉整个插件 fiber**——不是局部失败，是激活失败。
   最小写法：`output: { schema: { type: 'string' }, render: (_a, v) => [{ type: 'text', text: String(v) }] }`
   本插件正是因此从安装到 2026-11-01 一直没激活过。

2. **`webServer` 要用 `ctx.inject(['webServer'], cb)` 子 fiber**
   在 `apply` 里一次性 `ctx.get('webServer')` 拿到的是 `undefined`（loader 条目并发收敛），
   于是路由被**静默跳过**：面板能渲染，fetch 全 404。

3. **`ctx.llm.stream` 的 messages 是块数组**
   `content: [{ type: 'text', text }]`，不是字符串；`system` 不是 stream 的选项。
   模型路由也别硬编码 `deepseek/deepseek-chat`——用 `resolveRoute()`：配置的路由 → profile 默认 → 第一个可用模型。

4. **变量遮蔽**
   `const record = await store.add(...)` 会和同名的 `record()` 函数冲突，
   报 `record is not a function`。决策出口统一叫 `emitDecision()`。

## 数据落在哪

```
~/.dsh/workbench/
├── events.jsonl            决策日志，一行一个决策（唯一真相）
└── deliveries/<runId>/     每次规划的产物
    ├── roles.json
    ├── design.json
    └── review.json
```

## 事件与看板数据契约

`events.jsonl` 一个文件、四种行，靠 `kind` 区分；**没有 `kind` 的老行仍然按决策读**，所以旧日志不需要迁移：

| kind | 谁写 | 关键字段 |
|---|---|---|
| `project` | 编排器 | `projectId`、`title`、`event`(created/started/done/failed) |
| `task` | 编排器 / 子 agent | `taskId`、`parentId`、`projectId`、`stage`、`owner`、`role`、`event`(created…done)、`blockedBy[]` |
| `decision` | router（10 个决策） | 原有字段 + `projectId` / `taskId` / `stage` / `owner` 归属 |
| `artifact` | 执行器 | `taskId`、`path` |
| `approval` | 执行器 / 人工 | `taskId`、`action`、`status`(requested/approved/rejected)、`irreversible` |

投影规则（`projects.js`，全部纯函数）：

- **任务树**：`parentId` 是「谁拆的」；子任务没写 `projectId`/`stage` 就继承父任务的。
- **阻塞**：`blockedBy` 指向的任务没 done 就算 blocked——**声明了依赖就是依赖，沉默不等于放行**；指向不存在的任务同样算阻塞。
- **依赖边**是数据，不是靠时间戳猜的：前端联调等后端 API，就写 `blockedBy: ['api']`。
- **进度**只数叶子任务，父任务不计入分母，否则父子会重复计数。
- **卡点**只有一个来源：任务节点上的 gate；人工等待的决策和 approval 都落在那里，两类不会互相矛盾。
- **成本**按 `costUsd` 累加到任务、泳道、阶段、项目四级，配置见 `summary` 与 `board`。

`GET /workbench/state` 现在同时返回 `summary`（决策面板）、`board`（项目看板）和最新 30 条事件——两个视图读同一个文件，host 重启后显示会「变少」而不是「撒谎」。

## 看板接线时修掉的两个显示问题

1. **`task` 字段是卡片标题，不是文本框。** 之前每条决策都把整段需求塞进 `task`，
   面板于是在「决策流 / 等你决定」里印了一整段话。现在统一走 `taskLabel()`：取第一句、截断到 28 字。
2. **工作项不能分给业务角色。** 计划里的角色是「销售 / 财务」（谁能用系统），
   工作项是工程活。按 scope 映射到开发 agent（database/api → backend，frontend → frontend，tests → qa），
   映射函数 `ownerForScope()`，未知 scope 兜底到规划智能体 —— 不会因为角色表长得不一样就把任务丢地上。

## 执行器怎么用（P1）

插件**不是 agent**，所以它不自己拉子 agent —— DSH 的 `ctx.subagents.startActivation` 需要一个父 Agent，
而插件上下文不是 Agent。执行器因此拆成一半一半：

```
workbench_next_work          →  返回"现在可以开工"的工作项 + 每个的完整 prompt
    │                            （只有依赖全部 done 的叶子卡才算就绪）
    ▼
agent 用 subagent 工具拉起子 agent（后端/前端/QA 各领一张卡）
    │
    ▼
workbench_report_work        →  把子 agent 的结果写回同一本账：
                                task 状态 + 产物文件 + which_file / is_done / diff_risk
```

写回时**两条硬规则由代码执行，不靠汇报方自觉**：

1. **`done` 必须有绿测试。** 报告说 done 但测试没跑/没过 → 卡片落成 `blocked`，
   并写一条 `is_done` 决策（证据：真实退出码/通过数/失败数），置信度落在 human 泳道 →
   自动变成「等你决定」。这就是「模型说 done 不算 done」在代码里的落点。
2. **就绪只看依赖图。** 只有 `blockedBy` 全部 done 的叶子卡才会被派发。
   派发顺序固定为 backend → frontend → qa（API 解锁 UI）。

子 agent 的 prompt 不粘贴整份设计，只给**产物路径**（`design.json` / `roles.json`），
并要求它回一个 JSON：`{status, files, tests:{exitCode,passed,failed}, notes}`。
报告里的 `files` 会生成 `which_file` 决策（1 个文件 = 0.94，多个文件 = 更不精确），
`tests` 进 `is_done`，文件数与改动行数进 `diff_risk` —— 全部是机器证据。

## 依赖规划：并行度是测出来的，不是信的

`dependsOn` 决定团队能并行到什么程度，所以规划完先量一遍：

```
planHealth(workItems) → { total, ready, blocked, maxChain }
```

- `ready` = 没有任何依赖、可以立刻开工的工作项数
- `maxChain` = 最长依赖链，也就是"全部并行时"的最短墙钟时间

如果 `total ≥ 6` 且 `ready < max(2, ⌈total/4⌉)`，就判定为**过度串行**，
追加一次返工调用（要求只保留"数据契约上真的必须先有"的依赖），
返工结果只有在新计划 `ready` 更多时才采纳 —— 否则保留第一版。
返工的性价比：一次模型调用 vs 一条严格串行的交付。

实测：同一份需求，第一版 `ready 1/6, chain 6`；返工后 `ready 3/6, chain 3`。
返工后的并行度会写进 `is_done` 决策的 `evidence.parallel`，事后可查。

DSH 的既有计划里如果已经写死了串行依赖，**重跑一次规划**才会用上这套规则。

## 任务入口（面板上的那一个）

```
GET  /workbench/state  读：summary + board + 最近事件
POST /workbench/start  写：{"requirement": "..."} → 202 {"status":"planning"}
```

POST 是这个路由**唯一的写操作**，规则写死在三处：

1. **同源**：带 `Origin` 且 host 不匹配 → 403；没有 `Origin` 的本地请求（curl/测试）放行。
2. **有界**：请求体上限 16KB（需求是一段话，不是上传）。
3. **单并发**：已有运行中的规划 → 409 `already-running`。

响应是 `202 accepted` 而不是等结果：规划要跑好几次模型调用，HTTP 请求不该挂那么久。
**面板就是进度条**——第一条 `project` 事件落账后，任务树就出现在看板上（前端本来就在 3 秒轮询）。

## 首页：卡片网格

```
[＋ 创建]  [公司管理]  [报价单系统]  …
```

- 每张卡 = 一个 `project` 事件（`projectId` + `title`），不需要独立存储
- 「创建」弹对话框填名字 → `POST /workbench/projects` → 201 + projectId → 立刻出现在网格
- 点卡片 → **项目概览**（使用面）：进度/阻塞/待决定、应用预览、交付物清单，右上角「进入开发」
- 「进入开发」→ 开发页（新建任务 / 阶段轨 / 团队图 / 待你决定 / 决策流），左上角「← 概览」返回
- 在详情页「开工」时提交会带上 `projectId`，规划产物**挂到这张卡上**，而不是另开一个项目

至此 `projectId` 贯穿整条链：卡片 → 规划事件 → 任务树 → 子 agent → 决策/卡点。

## 三层导航：卡片 → 概览 → 开发

```
卡片网格            项目概览（使用面）                  开发（改造面）
┌────────┐  点卡片   ┌──────────────┐  「进入开发」  ┌──────────────┐
│ 公司管理 │ ───────▶ │ 预览 / 交付物  │ ───────────▶ │ 流水线 / 团队  │
└────────┘          │ 状态 / 一键入口 │              │ 决策 / 待你决定 │
                    └──────────────┘ ◀─────────────  └──────────────┘
                                    ← 概览
```

- **概览是使用面**：项目现在能跑成什么样、有哪些产物、还剩什么没做完
- **开发是改造面**：只有要改它的时候才进去，避免"看项目"就掉进任务树
- 预览只在项目记录了 `previewUrl` 时渲染 iframe；没有就明确说"还没有可运行的产物"，不假装
- 交付物来自 `artifact` 事件的聚合（`project.artifacts`），不是另存一份清单

## 团队画布（可拖拽）

- **卡片是 DOM 浮动节点**，不是画在图里的矩形：能拖、能选中文字、hover 正常
- **连线在底层 SVG**，拖动时按新坐标实时重画（按泳道着色，运行中流动虚线）
- **单卡拖动**：吸附 8px 网格；**整组拖动**：拖泳道标签（`⋮⋮ backend`）移动整列，组内相对位置不变
- **位置是视图状态**：存 `localStorage`（按项目 id 分开），不进账本——账本记事实，不记卡片摆在哪
- **重排**按钮清掉手放的位置并重新 fit；视口 80% 宽、420px 高，超出靠缩放/平移

## 暂停与终止

```
POST /workbench/control  {"projectId": "prj_x", "action": "pause" | "resume" | "cancel"}
```

三条语义，落在账本上都是 `project` 事件：

| action | 事件 | 效果 |
|---|---|---|
| `pause` | `paused` | `readyWork` 不再派发任何任务（闸门在调度器里，不在 UI） |
| `resume` | `resumed` | 队列重新开放（状态读作 `started`） |
| `cancel` | `cancelled` | 队列永久关闭；若规划正在跑，同时 `AbortController.abort()` 掐掉那几次模型调用 |

- 面板：开发页右上「暂停/继续」「终止」（终止要二次确认）
- 终止**不会**删除已完成的卡与产物：账本是事实，停止只改变"还要不要继续派活"
- 正在运行的子 agent 由 agent 侧 interrupt（插件不拥有子进程）；终止后它不会再被派新任务

## 项目页 = 画布 + 浮动面板

页面宽度 **80%（自适应视口）**，画布里是团队图，其他所有区块都变成可拖拽的 HUD 面板浮在上面：

| 面板 | 默认位置 | 默认状态 | 优先级理由 |
|---|---|---|---|
| 待你决定 | 右上 | 展开 | 唯一需要人动手的，第一眼 |
| 进度（完成/任务/阻塞/待决定） | 左上 | 展开 | 回答"现在到哪了" |
| 阶段 / 任务树 / 决策流 / 交付物 | 左/右列 | **折叠** | 细节，点开再看，不挡画布 |

- 面板可拖、可折叠；位置与折叠状态存 `localStorage`（`workbench:panel:<projectId>:<panelId>`），不进账本
- 面板是**屏幕空间**的：缩放画布不会把数字一起缩小
- 右侧面板按测量到的画布宽度停靠（未测量时用窗口宽度兜底），窄窗口不会跑出画布
- 折叠按钮在面板头右侧；Header 同时是拖拽把手

## 驾驶舱视图（项目画布）

- **点阵属于视口**，不属于内容：`background-size` 随缩放变、`background-position` 随平移变——所以永远铺满显示区，而不是只铺到图结束的地方
- **HUD 面板**：状态 LED + 大写标题 + 四角刻线 + 顶边强调色（待你决定=琥珀、进度=绿）
- **双列停靠**：左列 进度 / 阶段 / 任务，右列 待你决定 / 决策流 / 交付物
- **场景避开面板**：fit 时左右各留出面板宽度，主代理卡片不会被面板压住
- **缩放控件**悬浮在画布右下角（半透明胶囊），不再是标题栏里的按钮
- 面板仍可拖、可折叠，位置存 localStorage

## 暂停 / 继续 / 终止的边界

- `pause` → 界面出现「继续」，队列停止派发；`resume` → 队列恢复（状态读作 `started`）
- `cancel` → **单向**：队列永久关闭、正在跑的规划被 abort；已完成的卡与产物保留
- 终止后要重开，只能在该卡片上「新建任务」发起新一轮规划（历史不会被改写）

## 三层：项目 / 任务（job）/ 工作项

```
项目 project        公司管理（容器）
  └ 任务 job        员工管理（一次需求 → 一份计划 → 一个驾驶舱）
       └ 工作项     创建员工表 / 实现接口 / 编写测试 …
```

| 层 | 事件 | id 约定 |
|---|---|---|
| 项目 | `kind: project`（卡片本身） | `prj_xxx` |
| 任务 | `kind: job`（created/started/done/failed/paused/resumed/cancelled） | 每次规划运行一个 jobId（= 运行 id） |
| 工作项 | `kind: task` | `<jobId>:wi:<key>`，阶段卡 `<jobId>:build` 等 |

- 决策带 `jobId`：同一项目两个任务的判断不会混在一起
- `readyWork({ jobId })` 只派发该任务的卡；任务暂停/终止只停它自己的队列
- `POST /workbench/control` 带 `jobId` 控制单个任务，不带则作用于整个项目
- **向后兼容**：没有 `jobId` 的旧事件全部归入隐式任务（`id = projectId`，标题=项目名），
  旧账本渲染结果与之前完全一致（已用真实 35 行账本验证）

## 技术约定

- **数据库只用 SQLite，不用 PostgreSQL。** 需要索引/查询时优先用 Node 内置的 `node:sqlite`
  （零依赖，`DatabaseSync` + `prepare` 已验证可用，含 UNIQUE 约束与事务）。
- 现状：**工作台还没有数据库**。账本仍是 append-only 的 `events.jsonl`，面板投影每次从文件折叠；
  `store.js` 负责 `staff / ledger / deliveries` 三个 JSON 集合。
- 账本是唯一真相，SQLite 若引入只作为**索引/缓存层**（按 job 查询、事件全文检索、统计），
  不替代账本文件——这样日志永远可 diff、可 grep、可手工修复。

## 四个面：卡片 → 项目成品 → 任务列表 → 驾驶舱

```
卡片网格          项目成品页                    任务列表                 任务驾驶舱
[公司管理]  ──▶  预览 / 交付物 / [任务·2]  ──▶  员工管理 5/14 进行中 ──▶  团队图 + 待你决定
                                         └──▶  报销流程 1/8 已暂停      阶段 / 任务 / 决策流
```

- **项目成品页**：这个项目现在能产出什么（应用预览 + 交付物汇总），只有要改动时才进任务
- **任务列表**：每个 job 一张卡（进度/状态/阻塞/待决定），点开进入它的驾驶舱
- **驾驶舱按 job 过滤**：任务树、阶段轨、卡点、决策流都只显示这个任务的东西；右侧控制按钮作用于该任务
- 旧数据（没有 jobId）读作一个隐式任务，标题=项目名，行为与之前一致

## 「正在工作」是怎么被看见的

之前只有终态（todo/done），过程是黑盒。现在有三层可见性：

1. **活动投影**：任务 `progress` 事件可带 `notes`，投影出 `job.activity[]`（谁、哪张卡、最近一句在干什么、开始/最近活跃时间）和 `running` 计数
2. **驾驶舱 LIVE**：进度面板顶部一块实时区（LED + 任务 + 最近动作 + 已跑时长），头部在有活时显示 `● LIVE n`
3. **自适应轮询**：有任务在跑时前端 1.2s 拉一次，空闲时 3s——工作中的看板不会像冻住

子 agent 只需要在干活途中调用：

```
workbench_report_work { taskId, event: "progress", notes: "正在跑迁移" }
```

卡就会亮成「进行中」，驾驶舱立刻显示这句话。

## 审批：谁会卡住，谁不会

两类「等你决定」在账本里长得像，但语义不同：

| 类型 | 来源 | 阻塞队列？ | 处理 |
|---|---|---|---|
| **approval** | 不可逆动作（合并/删分支/轮换密钥）或人工放行 | ✅ 卡住**这张卡**（及其下游依赖） | 批准 → 放行；驳回 → 卡片落成 `blocked` |
| **decision** | 低置信度判断（`which_file` 0.5、`diff_risk` 6.2 等） | ❌ 仅建议，不影响推进 | 批准 = 已知悉；驳回 = 表达异议 |

- **只卡一张卡，不卡整个任务**：同一 job 里其他独立卡片继续跑，不会因为一张卡等人而全体停摆
- 批准/驳回都写入账本（`kind: approval`，`approved|rejected`），后来的决议覆盖之前的请求
- 面板上每条卡点直接带「批准 / 驳回」按钮，并标注「会卡住这张卡 / 仅建议，不阻塞」
- 整个 scope 完成后，仍挂着的建议性卡点自动退出待办列表（决策流里保留历史）

## 点卡片就是进应用（原生，不套 iframe）

项目有工作区/已上线的 app 时，**点卡片直接落在应用里**（全屏 iframe，进入即自动启动，无需先点「启动预览」）：

- 工具栏保留 ← 卡片 / 任务 / 交付物 / 关闭应用
- 启动是幂等的：已经在跑就复用，不会抢端口
- 没有工作区时退回交付物页，并明确说"没有可以启动的东西"

`previewUrl` 以前只是个字段，没人写它——所以成品页永远是空框。现在：

1. `POST /workbench/project-config {projectId, workspace}` — 把项目指向它的工作区（必须是已存在的绝对路径）
2. `POST /workbench/preview {projectId, action: "start"|"stop"}` — 在 `<workspace>/web`（有则用）里 `npm run start`，
   轮询到端口有响应后把 `previewUrl` 写进账本；停止时杀进程并清掉 URL
3. 成品页有「启动预览 / 停止预览」按钮，地址可点开新窗口；没设工作区时明确说「没有可以启动的东西」，不造假框
4. 端口上已经有服务在跑（dev server / 上一次的进程）时直接复用，不抢端口

## 坑：账本里的 previewUrl 可能是尸体

白屏事故：`previewUrl` 已落账，但那个进程早没了。前端若"看到 URL 就挂 iframe"，
浏览器会先渲染错误页，之后服务起来了 iframe 也不会自己重试——用户看到的就是全白。

规则：**先让 host 探测/拉起，等到真的能应答再挂 iframe**。
- 挂载前一律处于 `starting` 状态（哪怕账本里有 URL）
- 只有 `POST /workbench/preview` 返回 200 才设置 `src`
- 失败显示原因 + 重试；停止后显示「应用已关闭」而不是留着死框

## 员工管理是工作台的原生模块

不再 iframe 嵌入生成的 Next.js 应用。分工：

| 层 | 谁负责 |
|---|---|
| 数据 | 生成的 app 拥有 `web/data/app.sqlite`；工作台 host 用 `node:sqlite` 直接读写同一个文件（`appdb.js`） |
| 接口 | `GET/POST /workbench/employees`（list/create/update/delete），契约与 app 的 `/api/employees` 一致 |
| 界面 | 工作台自己的 React 组件（搜索、表格、新增/编辑弹窗、删除确认、空/加载/错误态），不依赖 app 的 HTTP 服务 |

卡片网格里每张卡是**应用入口**（标题 + 状态灯 + 打开），不显示任务数；
进去默认就是应用本体，任务/交付物在工具栏里。

## 依赖服务：可见、可控、可回收

工作台不再偷偷起服务。每个项目在员工管理页顶部有一条**依赖服务**状态：

| 服务 | 状态 | 控制 |
|---|---|---|
| 数据库 | 就绪 / 缺失（SQLite 文件是否存在） | — |
| 应用服务 | 运行中 / 未启动（探测 `http://127.0.0.1:4321`） | 启动 / 停止 |

- `GET /workbench/services?projectId=` 返回状态；`POST /workbench/services {projectId, serviceId, action: start|stop}`
- 启动是幂等的：端口上已经有服务就复用；`npm run start` 失败会把日志尾部当错误返回，而不是给个白屏
- **子进程登记在托管表里**，插件 dispose 时统一 `SIGTERM`，重启不会留下孤儿端口（之前 `/workbench/preview` 的问题）
- 状态每 5 秒刷新；没有服务时明确显示"未启动"，不假装在线

## 任务级：工作区 + DSH 对话绑定

每个任务（job）现在有自己的 `workspace` 和 `sessionId`，存在账本的 job `config` 事件里
（`POST /workbench/job-config { projectId, jobId, title? workspace? sessionId? }`，不影响任务状态）。

### 流程：先选 DSH 工作区，再对话

```
任务 → [工作区] 弹窗：列出 DSH 左侧栏的已有工作区（单选）
       └─ 或「新建工作区」→ workspaces.create({path, title}) → 出现在 DSH 左侧栏
     → 存 workspaceId + path 到 job config
     → 列出该 workspace 的会话 / 在该 workspace 新建会话 → 绑定
```

工作区不是手输路径：列表来自 `ctx.workspaces.list.getSnapshot().items`；
新建走 `ctx.workspaces.create({path, title})`，创建后左侧栏与工作台看到的是同一份宿主状态。

没有工作区时，对话抽屉只说「先设置工作区」，不会列出**全局**会话糊弄人。
宿主若没有给会话打 `workspaceId`（旧快照），列表会退回全部并如实说明，而不是假装过滤成功。

### 对话放在哪：驾驶舱右侧的独立栏（不覆盖画布）

```
┌───────────────── 工作台 ──────────────────┐
│ ← 卡片  公司管理 · 员工管理    [💬 对话] [📁 工作区] │
│ ┌────────── 驾驶舱（自适应收窄）──────────┐ ┌─ 对话栏 380px ─┐
│ │  主代理 → 泳道卡片 / HUD 面板             │ │ 消息记录       │
│ │                                          │ │ [输入] [发送] │
│ └──────────────────────────────────────────┘ └───────────────┘
```

- 对话是驾驶舱的**同级区块**，不是浮层；两种响应式形态（Wireframing：桌面并排 / 窄屏堆叠）
  - **≥1024px**：右列 380px，画布 `flex:1` 向左收窄
  - **＜1024px**：对话停靠在驾驶舱**下方**（约占一半高度），画布在上方收缩，**永不覆盖**
- 已绑定会话时默认展开；点 `×` 或工具栏 `💬` 折叠，画布恢复全宽
- 堆叠模式下 transcript 可压缩到 0 高度，输入框始终可见
- 选工作区 / 绑定会话 / 新建会话仍在对话栏内部完成（先工作区，再对话）

### 能力与降级

| 动作 | 走什么 |
|---|---|
| 列出会话 | `sessions.getSnapshot().byId` |
| 新建会话 | `sessions.create({ workspaceId })`，「工作区」先用 `workspaces.create({path})` 注册 |
| 读对话 | `sessions.using(id).ready.eventSource.getSnapshot().entries` → 只取 user/assistant 文本 |
| 发送 | `conversation.sendSession(...)`，退路 `session.prompt(...)` |
| 跳转 | `uiWorkspace.openSession(id)`，退路 `sessions.open(id)` |

全部能力探测：宿主没有会话 API 时抽屉直接说「当前宿主版本没有暴露会话接口」，不会假装能聊。

### 为什么必须先声明 inject

DSH 的宿主服务**不会**出现在 `ctx` 上，除非插件在 `inject` 里声明：

```js
inject: ['slots', 'locale', 'sessions', 'conversation', 'workspaces']
```

之前只声明了 `slots`/`locale`，于是 `ctx.get('sessions')` 永远是 undefined，
抽屉只能显示「当前宿主版本没有暴露会话接口」。现在：

- `sessions.list.getSnapshot()` 拿会话快照（byId）
- `sessions.create(...)`、`sessions.using(...)` 走会话生命周期
- `conversation.sendSession(...)` 发送，`session.prompt(...)` 兜底
- `workspaces.create({path})` 在新建对话前注册任务工作区
- `uiWorkspace.openSession(id)` 跳转原生会话视图

组件层通过 apply 时保存的模块级 `hostCtx` 取这些服务（slot 组件不会收到 `ctx` prop）。

## 分栏后的两个必修

- **HUD 面板跟随停靠位**：只有用户拖动过的面板才记住坐标；其它面板每次按测量宽度重新停靠，
  所以打开对话栏（画布变窄）时右侧面板会跟着移进画布，而不是留在外面
- **fit 的留白按宽度决定**：画布 ≥1100px 才给面板留 300/340 的左右空位；更窄时贴边布局，
  避免场景被推到面板底下导致卡片"消失"
- **对话跟随最新消息**：transcript 每次刷新后滚到底部（`scrollTop = scrollHeight`），
  打开时看到的是最新进展，不是陈旧的开头

## 对话里粘贴图片

工作台自己的输入框支持图片：

- **粘贴**（⌘V 截图）、**拖入**、**选择文件**（🖼 按钮）三种方式
- 最多 4 张、单张 ≤ 8MB；非图片会被拒绝并提示
- 附件按 DSH 的契约发送：`sendSession(session, text, attachments, 'queue')`，
  每个附件是 `{ name, mediaType, size, load() }`，字节按需读取（不在账本/日志里塞 base64）
- 宿主会话通道不接受图片时**明确报错**，不会假装发出去

## 驾驶舱：两侧仪器栏，而不是浮层卡片

旧的 HUD 面板是绝对定位浮层，默认位置会互相压叠、也压住画布。现在改成固定两栏：

```
┌ 左栏 248px ─┐ ┌──── 画布 flex:1 ────┐ ┌ 右栏 300px ─┐
│ 进度        │ │ 主代理 → 泳道卡片   │ │ 待你决定     │
│ 阶段 (折叠) │ │ 拖拽 / 缩放 / fit   │ │ 决策流(折叠) │
│ 任务 (折叠) │ │                     │ │ 交付物(折叠) │
└─────────────┘ └─────────────────────┘ └─────────────┘
```

- **左栏 = 正在发生什么**（进度 / 阶段 / 任务），**右栏 = 需要人做什么 + 产出**（待你决定 / 决策流 / 交付物）
- 面板是正常块级元素：**不再重叠、不再压画布**，高度用 `overflow-y:auto` 兜底
- 每个面板可折叠（点击标题栏），标题栏带数量摘要，收起后仍可读
- 工具栏「▤ 面板」一键隐藏两栏，画布独占；布局在 localStorage 记住
- 容器宽度 < 1000px 时自动隐藏两栏，避免把画布压没

## 任务卡的状态表达

任务卡按状态区分「进行中的过程」和「完成后的结果」，不重复播报同一个事实：

| 状态 | 卡的表达 |
|---|---|
| **已完成** | 绿色 ✓ + 「已完成」→ 一行结果摘要（`14 个工作项 · 44 个交付物`）→ 绿色动作「查看结果 →」；**不显示 100% 进度条** |
| 进行中 | 蓝色 ● + 「进行中」→ `3/9 完成 · 2 阻塞 · 1 待决定` + 进度条 → 「打开驾驶舱 →」 |
| 已暂停 | 琥珀 ❚❚ + 「已暂停」→ 进度 + 琥珀进度条 |
| 已终止 | 红色 ✕ + 「已终止」→ 进度 + 红色进度条 |

左侧 3px 状态色边条让一列卡片可以只凭颜色扫出状态。

## 已完成的任务怎么改？——新建关联任务，不回改

原则：**完成的 job 是交付事实，不可回开**。改动、修 bug、加功能都作为**新 job**，用
`parentJobId + jobKind` 关联到原任务。

理由：
1. 回开已完成任务会让「14/14 完成」变成谎言，进度/阶段/交付物被新改动污染
2. 每次改动应该有独立的计划、验收测试、决策流和驾驶舱（审计链）
3. 项目本来就容纳多个任务（job 层），天然支持"一个交付 + 若干后续"

实现：
- 驾驶舱在 `done` 状态下，主按钮从「新建任务」变成 **「＋ 修改/修复」**
- 弹窗预填 `修改「员工管理」：`，并可选类型：**修改 / 修复 bug / 新增功能**（`jobKind`）
- 子任务卡显示 `来自 员工管理`，父任务卡显示 `2 个后续任务`
- 账本：`job created` 事件带 `parentJobId`、`jobKind`（`kind` 字段留给账本行类型）
- 接口：`POST /workbench/start { requirement, projectId, parentJobId, kind }`

注意：**不要**直接编辑已完成的 job 的 title/workspace 以外的执行结果；产物目录按 run id 隔离，
新任务写新目录，旧任务的交付物保持原样。

## 高度：按实测视口填满，底部 8px 对齐侧栏

不再用 `calc(100vh - 210px)` 这类猜出来的数：

1. `useFillHeight(8)` 测量页面顶部到窗口底部的可用高度（`window.innerHeight - rect.top - 8`），
   监听 resize 并每 2s 复测（DSH 侧栏折叠/窗口缩放都会变）
2. 页面根节点使用该高度、`overflow:hidden`；内容列 `flex:1 minHeight:0`
3. 驾驶舱主体 `flex:1`（不再写死 100vh 运算），画布和对话列都撑到页面底部
4. 对话栏底边 = 窗口底部 - 8px，与 DSH 左侧栏内容底边同一基线

代价：极小窗口下内容可能被裁切（页面不可滚动）；如果需要滚动可以把 `overflow:hidden` 换成 `auto`。

## 项目应用页：模块切换（员工管理 / 组织架构）

公司管理项目的应用页现在是**模块化**的，模块切换在标题右侧：

- **员工管理**：原生表格 CRUD（读交付 App 的 SQLite，不依赖 App 服务器）
  - 员工可关联 **公司** 和该公司下的 **部门**（`company_id` / `department_id`，自动补列迁移，旧数据不受影响）
  - 表单联动：选公司 → 部门下拉只列该公司的部门；换公司清空部门
  - 保存时把所选部门名同步回契约字段 `department`，App 侧读到的文本与组织架构一致
  - 列表支持按公司筛选，并显示公司 / 部门名称
- **组织架构**：多公司 + 公司内的部门树与职级，全部可增删改
  - 公司：下拉选择、新建、重命名、删除（有部门/职级时拒绝并说明原因）
  - 部门：树形缩进、新建根/子部门、改名、改父级、删除（有子部门时拒绝）、环检测
  - 职级：排序值（空=未设置）、新建、改名/改排序、删除
  - 数据直读/直写 `web/data/app.sqlite` 的 `company / departments / job_levels`，
    三者都带 `company_id`；`employee` 表暂不区分公司
  - Host 路由：`GET/POST /workbench/organization`，GET 带 `companyId` 选中公司；
    POST 用 `op`：`company.create|rename|delete`、`department.create|update|delete`、
    `joblevel.create|update|delete`
  - 不需要启动应用服务；与 Next.js 应用的 `/org` 页共享数据库（该页面仍是单公司视图）
- **财务管理**：项目内模块（与员工管理 / 组织架构并列），数据按 `projectId` 隔离
  - 每个项目有独立的流水目录 / SQLite 数据源配置、导入批次与流水行
  - `GET/POST /workbench/finance` 必须带 `projectId`（缺失 → 400）
  - 已移除顶层「财务管理」Tab：财务属于某个项目，不属于整个工作台

部署后需要**⌘Q 完全退出 DSH 再启动**才会看到新模块与路由。
