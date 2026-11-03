# 项目约定

## UI/UX：动样式和布局前必须先调用技能

任何**样式、布局、视觉设计**相关的改动（颜色、间距、排版、组件外观、响应式、交互状态），
动手前必须先调用 UI/UX 技能，禁止凭感觉直接改：

- `web-design-reviewer` — 视觉检查清单（对比度、溢出、对齐、触控目标、响应式）与修复流程
- `taste-skill` — 设计品味（密度、动效、层级、避免通用感）
- `information-architecture` — 信息层级/导航结构
- `premium-frontend-ui` — 高级前端视觉（落地页/动效，按需）

流程：调用技能 → 按清单列出问题（P1/P2/P3）→ 修复 → **截图复验** → 再看是否还有 P1/P2。

## 其他约定

- 数据库只用 SQLite（`node:sqlite`），不用 PostgreSQL（详见 README「技术约定」）
- 账本 `~/.dsh/workbench/events.jsonl` 是唯一真相，视图状态放 localStorage
- 改完必须 `cd packages/workbench && npm test`（当前 261 个用例）

## 故障排查：桌面版启动失败

**症状**：DSH 桌面版启动失败，日志出现 `desktop welcome: Web authentication failed`，host 返回非 2xx。

**根因**：`~/Library/Application Support/@deepseek-ai/dsh-desktop/Cookies` 里堆积了过期会话 cookie
（`dsh-auth-*`，全部挂在 127.0.0.1 上），host 启动校验证书时被挡住；每次启动失败还会再写一条新 cookie，
所以会越积越多、最终彻底起不来。

**处置**（先备份再删）：

```bash
BACKUP=/tmp/dsh-cookie-backup-$(date +%Y%m%d-%H%M%S)
mkdir -p "$BACKUP"
cp -p ~/Library/Application\ Support/@deepseek-ai/dsh-desktop/Cookies* "$BACKUP"/ 2>/dev/null
rm -f ~/Library/Application\ Support/@deepseek-ai/dsh-desktop/Cookies
rm -f ~/Library/Application\ Support/@deepseek-ai/dsh-desktop/Cookies-journal
```

然后重启桌面版。认证会走 URL token 的正常路径，Cookie 库重新为空即可。

**不要**为此去禁用第三方插件、改端口、删 node_modules——都与它无关。

**同类事故**：如果某次操作「禁用插件」或「修复启动」，检查
`~/.dsh/profiles/desktop/package.json` 的 `dsh.profile.bundles` 是否被清空
（正常应有 17 条左右，含 `@jos/workbench`），以及 `cordis.patch.yml` 是否被覆盖成几百字节。
备份在同一个目录（`package.json.bak-*`、`cordis.patch.yml.bak-*`）。

## 故障排查：工作台入口从侧边栏消失

host 路由正常（`/workbench/state` 200）但侧边栏没有「工作台」时，先看 client 插件是否 apply：

1. **不要**把 `sessions / conversation / workspaces` 写进返回对象的必选 `inject`。
   这些是客户端会话服务，某个宿主版本没就绪就会让整个插件挂起等待 → 入口消失。
   必选只保留 `['slots','locale']`，会话服务用可选注入：

```js
ctx.inject(['sessions', 'conversation', 'workspaces'], sub => {
  serviceCtx = sub
  return () => { if (serviceCtx === sub) serviceCtx = null }
})
```

2. bridge 用 `() => serviceCtx || hostCtx` 的取上下文函数，避免在服务就绪前闭包住旧 ctx
3. 检查 `~/.dsh/profiles/desktop/package.json` 的 bundles 是否还有 `@jos/workbench`
4. 改完 client 需要**完全退出 DSH（⌘Q）再启动**，仅关窗口不重载插件
