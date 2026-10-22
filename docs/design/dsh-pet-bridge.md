# 桌宠 × DSH 桥接设计（v0.3）

> 历史草案（保留骨架与原始研究记录）。2026-10-19 起，共同契约以 [pet-dsh/1](../DSH_BRIDGE_PROTOCOL.md) 为准；v4.2.2 使用通用 `net.local` / `context.localService`，不实现下文专用 dsh.link、自动读取配对文件或重建会话的方案。本文件及现有骨架不代表已完成 DSH 接入。

状态：设计中，已建骨架目录 [`dsh-pet-bridge/`](../../dsh-pet-bridge/README.md)。
宿主：Spine 桌宠工坊 v4.1.1 · DeepSeek Harness 0.2.0-rc.2（profile `web`）。

## 0. 一句话

桌宠面板里发的一句话，进的是 DSH 的一个**普通会话**：模型、工具、审批、历史都由 DSH 负责；桌宠只是这个会话的另一个前端。

## 1. 已定决策

| 决策 | 选择 |
| --- | --- |
| 传输 | HTTP + SSE（`ctx.webServer.register`），不用 WebSocket |
| 会话 | **共享**：桌宠会话 = DSH 普通 session，GUI 打开同一会话看到同一份历史 |
| 可见性 | 会话挂到专门工作区「桌宠」，DSH 侧栏与桌宠面板双向可见、双向可聊 |
| 权限 | **部分权限**：最小 preset + 只读工具白名单 + 交集式 `tools.restrict` |
| 模型 | 跟随 DSH 默认模型（`agentDefaultModel`），插件不单独维护模型列表 |
| 配对 | 插件写 `~/.dsh/pet-bridge.json`（url + token），桌宠主进程自动读 |
| 人格 | 桌宠侧按角色保存人格文件，连接时下发；DSH 侧作为该会话的 prompt 段 |
| 历史 | DSH session 是事实来源；桌宠侧只缓存最近 N 条用于本地展示 |
| 字幕 | 默认不推；只在"长回答结束/任务完成"时可选推一条 `ui.reminders` |

## 2. 为什么"两端都能看"能成立

我核对了 `@deepseek-ai/dsh-api-session-controller`：GUI 打开会话时走 `resolveAgent(sessionId)`，第一步是 `ctx.agents.get(sessionId)`——**只要该会话已有 live agent 就直接复用**，不会再建一个。所以：

- 插件用会话 API 建 session 并 `followup`，agent 就活在 Host 里；
- 用户在 GUI 打开这个 session，拿到的是同一个 agent，看到的是同一份流式对话，甚至可以直接在 GUI 里接着发消息；
- 反过来，GUI 里发起的对话，桌宠侧也能通过 `agent/assistant-stream` 收到并显示。

前提只有两个：会话要挂进工作区（否则侧栏找不到），以及任何时刻不要为同一 session 再建第二个 agent。

## 3. 架构

```text
桌宠渲染进程 (Pixi)
   │ 聊天页 / 连接页
   ▼
插件 Worker: provider.js（无网络、无 Node）
   │ context.dsh.start / cancel / subscribe / history  ← 窄接口
   ▼
桌宠主进程: DshBridge（新，electron/plugins/dsh-service.mjs）
   │ 读配对文件、SSE 客户端、断线退避、按插件分发
   ▼  HTTP + SSE（Bearer token）
DSH Host: dsh-pet-bridge（本仓库 dsh-pet-bridge/）
   │ sessionController.create / agents.get / followup / cancel
   │ on('agent/assistant-stream')
   ▼
会话 pet-<conversationId>（工作区「桌宠」）←→ DSH GUI 同一会话
```

## 4. 部分权限怎么实现

桌宠会话不是一个"什么都不能做"的傻聊会话，而是"像正常对话一样，但工具面收窄"：

1. **preset 起步**：`sessionController.create({ agentPreset: 'minimal' })`，避免标准 preset 的全套工具。
2. **白名单收窄**：拿到 agent 后，在 **agent 作用域**调用 `ctx.tools.restrict({ allow: [...] })`。
   - 语义（已核对契约）：只作用于该 agent 继承的**全局**工具；restriction 之间取交集；preset 通过 `agent.ctx` 注册的 scoped 工具仍然可见，所以白名单要和 preset 一起看。
3. **验收方式**：`ctx.tools.schemas(agent)` 必须正好等于预期白名单，多一个都不算通过。
4. **默认白名单**（只读、基本不需要审批）：

   | 工具 | 用途 |
   | --- | --- |
   | `read` / `glob` / `grep` | 读文件、找文件、搜内容 |
   | `web_search` / `web_fetch` | 查资料 |
   | `todo_write` | 多步任务的进度（桌宠页可展示） |

5. **要写要跑怎么办**：不放进白名单，改为在 GUI 里操作。若以后要放开 `pwsh`/`write`，必须同时说明"审批弹窗出现在 DSH GUI"，否则用户在桌宠前会看不到审批而卡住。
6. **cwd**：桌宠会话的 cwd 指向 `%APPDATA%\spine-pet-workshop\pet-workspace`（或用户配置的目录），工具能看到的范围天然受限。

## 5. 人格与历史

人格（桌宠侧的文件，DSH 侧的效果）：

- 桌宠侧按角色保存：`persona`（性格/说话风格）、`memory`（手工记忆）、`greeting`，走 `storage.own`（512 KB，够用）。
- 连接或切换角色时下发 `act {op:'bind', persona, memory}`；插件按 conversationId 保存，并在建 agent 时把人格注册成该 agent 的 prompt 段（优先 `agent.ctx.systemPrompt` 的 scoped section，签名以 `cordis_inspect` 为准；不可用时退化为每轮首条 developer 消息注入）。
- 人格变了要**重建**该会话的 agent（或换 conversationId），不能在运行中热改 system prompt——否则模型看到的历史前缀会不一致。

历史（两层，各司其职）：

| 层 | 存什么 | 大小 | 谁是事实来源 |
| --- | --- | --- | --- |
| DSH session | 完整对话、工具调用、token 用量 | 无上限（有 compaction） | **是** |
| 桌宠 `storage.own` | 最近 20 条用于打开面板立刻显示 | ≤512 KB | 否，仅缓存 |

断线/重开桌宠时用 `act {op:'history', limit: 20}` 从 DSH 拉最近若干条补齐缓存。

## 6. 协议 v1

所有请求带 `Authorization: Bearer <token>`；非浏览器客户端，不实现 CORS。

### `GET /dsh-pet/events`（`text/event-stream`）

| event | 载荷 |
| --- | --- |
| `hello` | `{serverVersion, conversations:[{id,status}]}` |
| `state` | `{conversationId, requestId?, status:'idle'\|'thinking'\|'streaming'\|'error'}` |
| `delta` | `{conversationId, requestId, text}` — 累积文本 |
| `done` | `{conversationId, requestId, finishReason:'stop'\|'aborted'\|'max-tokens'\|'error'}` |
| `error` | `{conversationId, requestId?, code, message}` |
| `tool` | `{conversationId, callId, name, args}` — v1 只做"正在用某工具"的展示，不回调 |
| `ping` | `{t}`，15 s |

### `POST /dsh-pet/act`

| op | 载荷 | 说明 |
| --- | --- | --- |
| `send` | `{conversationId, requestId, text}` | 202 立即返回，结果走 SSE；text 1–4000 |
| `cancel` | `{conversationId}` | 取消当前轮 |
| `reset` | `{conversationId}` | dispose 旧 agent，换新 sessionId |
| `bind` | `{conversationId, persona?, memory?, characterId?}` | 建/改人格，必要时重建 agent |
| `history` | `{conversationId, limit}` | 从 DSH 会话读最近 N 条（用于桌宠缓存补齐） |
| `ping` | `{}` | 连通性 |

### `GET /dsh-pet/status`

`{ok, version, conversations:[{id, sessionId, status}], allowedTools, workspace}`。不含 token。

## 7. DSH 端插件

目录：[`dsh-pet-bridge/`](../../dsh-pet-bridge/README.md)（`package.json` + `cordis.patch.yml` + `index.js` + `README.md`）。

主体要点：

- `export const inject = ['webServer', 'sessionController', 'agents', 'workspaceRegistry', 'tools']`（阶段 1 补齐）。
- 路由与清理全部 `ctx.effect(...)`；停用/卸载时关闭 SSE、删配对文件、dispose 由本插件创建的 agent。
- 会话创建（首次 send 或 bind）：
  1. 找/建工作区：`workspaceRegistry.resolveByPath(petWorkspaceDir)` → 没有则 `workspaceRegistry.create(dir, '桌宠')`；
  2. `sessionController.create({ workspaceId, sessionId: 'pet-' + conversationId, agentPreset })`；
  3. `ctx.agents.get(sessionId)` 取 agent，`agent.ctx.tools.restrict({ allow })`，登记 disposer。
- 不应答任何"外部进程可以随便建 agent"的行为：请求必须带 token，且 conversationId 只允许 `^[A-Za-z0-9_-]{1,64}$`。
- 模型：不自带列表，交给 `agentDefaultModel`；`config.model` 仅作调试覆盖。

## 8. 桌宠端改动（阶段 4）

新增受控能力 `dsh.link`（宿主维护者改动，共 8 处）：

| 文件 | 改动 |
| --- | --- |
| [contracts.mjs:3](../../electron/plugins/contracts.mjs) | `PERMISSIONS` 加 `dsh.link` |
| [packages.mjs:7](../../electron/plugins/packages.mjs) | `EXTERNAL_PERMISSIONS` 加 `dsh.link` |
| `electron/plugins/dsh-service.mjs`（新） | 配对文件、SSE 客户端、重连、start/cancel/history、按插件订阅 |
| [capabilities.mjs:21](../../electron/plugins/capabilities.mjs) | `scope()` 暴露 `dsh` 对象 |
| [sandbox-runtime.mjs:47](../../electron/plugins/sandbox-runtime.mjs) | `dsh.start / cancel / subscribe / unsubscribe / history` 分支 |
| [worker-code.mjs:27](../../electron/plugins/runtime/worker-code.mjs) | 授权时注入 `context.dsh` |
| [main.mjs:1143](../../electron/main.mjs) | 实例化 `DshBridge` 并注入 `ExtensionService` |
| [main.mjs:1171](../../electron/main.mjs) | 权限文案："把消息转发给本机 DeepSeek Harness（使用其会话与工具），并接收回复" |

插件（`examples/dsh-pet-plugin/`）：

- 权限 `["dsh.link","storage.own","ui.reminders"]`；命令 `send / stop / reset / bind / history / ping`。
- 页 1「对话」：`chat` 块（`requestId:u` / `requestId:a`，streaming/partial 状态）+ composer 页脚 + `stopAction`。
- 页 2「连接」：连接状态、DSH 版本、当前会话、最近错误 + 「重试连接」。
- 页 3「人格」：`textarea` 表单编辑 persona/memory（存 `storage.own`），保存后 `bind`。
- 节流：`delta` ≥100 ms 一次 `publish`；`start` 立即返回，绝不占满 7 s RPC 超时。

## 9. 开发步骤

| 阶段 | 内容 | 验收 | 依赖 |
| --- | --- | --- | --- |
| 0 骨架（已建目录） | 安装 bundle；`/status`、`/act ping`、401、配对文件 | `application: applied`；curl 通；停用后配对文件消失 | 无 |
| 1 打通对话 | `sessionController.create` + `agents.get` + `followup` + `assistant-stream` + `cancel`；会话挂工作区 | 脚本模拟桌宠跑通一轮；GUI 打开同一会话可见、可续聊；cancel 2 s 内生效；重启 DSH 后 resume | 0 |
| 2 权限收敛 | 打印 preset 与 `tools.schemas(agent)`；定 `agentPreset` + 白名单；确认审批行为 | 会话可见工具 = 白名单；让模型写文件被拒；只读工具可用 | 1 |
| 3 人格与历史 | `bind` / `history` / `reset`；prompt 段注册 | 改人格后风格变化；重连补回 20 条；reset 后上下文清空 | 1 |
| 4 桌宠宿主 | `dsh.link` 能力 8 处 + `examples/dsh-pet-plugin` | 真实宿主导入 ZIP；聊天流式；停止；连接页状态正确 | 1（可与 2/3 并行） |
| 5 收尾 | 权限表、插件 README、`scripts/test-dsh-plugin.mjs`、本设计定稿 | `pnpm test:release` 通过；文档与实现一致 | 2、3、4 |

顺序说明：先做 DSH 端（阶段 0–3），因为桌宠端依赖一个能跑的服务端；桌宠宿主改动（阶段 4）风险最高，放在协议稳定之后。

## 10. 风险

| 风险 | 缓解 |
| --- | --- |
| 无鉴权路由 | 强 token、loopback、输入校验、并发上限 |
| 同一会话两个 agent | 只用 `sessionController` 建会话，不在别处 `create` 同一 id |
| preset 自带 scoped 工具绕过白名单 | 用 `minimal`，并以 `tools.schemas(agent)` 实测为验收 |
| 审批弹窗在 GUI | 白名单只放免审批工具；放开危险工具必须在文档里写明 |
| 会话在侧栏堆积 | 固定工作区「桌宠」，`reset` 复用同一 id 或按角色区分 |
| 插件改为共享会话后的会话污染 | 桌宠会话独立 `pet-*` 前缀，不碰用户自己的会话 |
