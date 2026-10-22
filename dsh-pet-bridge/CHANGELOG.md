# 变更记录

## 1.0.0 — 2026-10-21

首个实现 `pet-dsh/1`（修订 1.0.0）的 DSH 端插件版本。按
`docs/DSH_CREATOR_DEVELOPMENT_GUIDE.md` 与 `release/handoffs/DSH-Creator-Pet-Bridge-Development-v1.0.0.zip`
开发，替代阶段 0 骨架（已从当前源码移除，历史保留在 Git 备份，协议不兼容）。

### 新增

- 自有 `node:http` loopback 监听（默认 `127.0.0.1:0`，`/pet-bridge/v1/`），不依赖 web carrier、不占用 GUI 端口。
- 六个真实端点：`/info`、`/sessions`、`/snapshot`、`/commands`、`/requests`、`/events`(SSE)。
- 认证与授权：连接 token 只存 SHA-256、恒时比较；客户端 → 会话白名单 → 能力三层校验；`Host`/`Origin` 围栏。
- 会话适配：复用既有活跃 Agent（`agent.followup`），用 `createUserMessage` 构造带标识的消息；
  `assistant/chunk` → `assistant.delta`（80 ms 合并、attempt 内 `index` 连续）；
  `assistant/message` → `assistant.message`；`agent/inbox/claimed` → `message.claimed`。
- 事件投影：`turn/start`/`turn/end` → `activity.state`/`activity.ended`（含真实终态映射）；
  `tool/call`/`tool/result` → 有界摘要；`approval/asked`/`decided` → `waiting-approval`/`running`；
  GUI 侧输入与标题变化 → `session.changed`。私密推理、工具参数与输出、注入上下文不外发。
- SSE：实例作用域游标、快照水位衔接、有界回放（5 分钟 / 2000 事件 / 8 MiB）、
  15 秒注释心跳、未知/过期游标 `resync.required`、慢客户端断流、一插件一条流。
- 持久台账：追加日志 + 原子快照，`fsync`，尾部半写截断、中间损坏转只读；
  `clientId+requestId` 幂等（规范化 JSON 哈希）；至少 24 小时保留；崩溃窗口按证据判定
  `accepted`/`rejected`/`unknown`，不自动重放。
- 可选能力 `session.cancel`：`activityId` 匹配校验、`keepInbox: true`（不悄悄丢弃其他前端排队内容），
  真实终态由 `activity.ended` 确认。
- `message.steer` 已实现，默认不声明（`enableSteer: false`），待真实付费 turn 验证。
- 工具：`scripts/pet-bridge-admin.mjs`（token 生成/轮换/撤销、会话授权、运行状态）、
  `scripts/bridge-smoke.mjs`（兼容桌宠语义的模拟客户端，默认只读）、
  `scripts/dev-fake-bridge.mjs`（无需 DSH 的本地试跑）、`scripts/probe-dsh.mjs`（真实插件树探针）、
  `scripts/pack.mjs`（按白名单打包并校验协议摘要）。
- **故障安全**：DSH 的 loader 会把任一插件启动失败视作整棵树失败，因此 `apply()` 兜住所有启动异常——
  记 error、回滚资源、不监听端口、不生成 `runtime.json`，但**不让 DSH 因此打不开**；授权表损坏时以
  「无授权客户端」继续运行，文件修复后约 2 秒自动恢复（`test/resilience.test.js`）。
- **会话日志读取修正**：真实 GUI 打开的会话上，`agent.session` 与 `ctx.sessions.get()` 的
  `events` 都可能为 `undefined`。适配层改为优先取 store 的会话，并对
  `events` / `eventsSnapshot` / `log` 多路兜底；监听器不再把异常抛回 DSH 的 append 路径
  （`session/event` 里单会话失败不再影响整条事件流）。
- **可诊断的 500**：非协议错误不再统一回「内部错误」，而是带**已脱敏**的具体原因
  （错误类 + 原因，去掉路径与堆栈，≤200 字符）；会话不可读时还会报出句柄的原型与成员形状。
- **台账状态机**：`accepted` 记录不再把已 `running` 的条目回退（DSH 的 `agent/inbox/claimed`
  是同步触发的，会早于 accepted 落盘）。
- 文档：`README.md`（含验证过的安装/固定端口/故障排查）、`COMPATIBILITY.md`、`TEST_REPORT.md`、
  `docs/PET_INTEGRATION.md`（桌宠端对接指南），协议原文与 SHA-256 副本。

### 未实现（有意，附原因）

- `interaction.answer`：会挡住 DSH GUI 的审批回答者，属于绕过「唯一决定」，故不声明。
- `persona.update`、`pet.tools`：目标版本/对端条件不满足（详见 COMPATIBILITY §6）。
- 自动新建/恢复/删除会话：基础版只向已存在的活跃 Agent 发送。

### 验证

- 模拟套件 59 项全通过；真实 DSH 0.1.1-rc.2 集成测试 1 项（10 阶段）全通过；
  真实 launcher 安装 + 启动 + 端点验证通过。真实桌宠联调与付费模型调用未执行（原因见 TEST_REPORT §11）。
