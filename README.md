# dsh-workflow-jos

公司运营管理 + 需求驱动的软件交付工作流。DSH bundle（host 插件 + web 客户端面板）。

当前有一个可用面板：**@jos/workbench**，侧栏「工作台」入口 → 主面板。

## 目录

```
packages/workbench/          @jos/workbench 插件本体
├── index.js                 host：store、事件日志、只读状态路由、agent 工具
├── client.js                浏览器面板：决策 / 软件开发 / 人员管理 / 财务管理
├── delivery.js              需求驱动的交付规划（brief → roles → design → review → report）
├── router.js                10 个决策 + 证据规则 + 三泳道路由 + 不可逆白名单
├── events.js                追加式 JSONL 决策日志 + 投影
├── store.js                 本地 JSON 持久化（staff / ledger / deliveries）
├── tests/                   node --test，19 个用例
├── preview/                 静态面板预览 + seed 脚本
└── locale/                  插件卡片显示文案
docs/
└── agent-workflow-design.md 开发工作流智能体的架构设计
_dsh_ref/                    插件开发参考（host-plugin / ui-plugin / practices …）
```

## 跑起来

```bash
cd packages/workbench
npm test              # 19 个测试
npm run preview       # 生成 preview/out/data.js，然后打开 preview/dashboard.html
node --check client.js
```

## 装进 DSH

profile 里以 symlink 方式挂载：

```bash
ln -sfn "$PWD/packages/workbench" ~/.dsh/profiles/desktop/node_modules/@jos/workbench
```

`package.json` 的 `dsh.bundle.patch` 会把插件插进 profile，不需要手改 `cordis.patch.yml`。
客户端改动需要重新加载 web 产物（重启 DSH，或 `pnpm run dev:web` 开着才有热更新）。

## 现状

| 能力 | 状态 |
|---|---|
| 面板挂载（侧栏 + 主面板 + locale + 主题 token） | ✅ |
| 决策日志 `events.jsonl` + 投影 | ✅ 已完成 |
| 10 决策路由 / 三泳道 / 不可逆白名单 | ✅ 已完成（纯函数 + 测试） |
| `GET /workbench/state` 只读投影路由 | ✅ 已完成 |
| 面板「决策」页（计数 / 泳道分流 / 决策流 / 等你决定） | ✅ 已完成 |
| 规划流程发决策事件 | ✅ 已完成（4 个决策点） |
| code 泳道真执行（git / 测试 / diff） | ⬜ P1 |
| 面板内人工审批（点按钮批准） | ⬜ P1 |
| 真实成本记账（token → USD） | ⬜ P2 |
| 人员管理 / 财务管理 | ⚠️ 骨架，数据通道未接 |

设计与取舍见 [docs/agent-workflow-design.md](docs/agent-workflow-design.md)。
