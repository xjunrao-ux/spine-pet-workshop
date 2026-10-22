# 兼容性清单（COMPATIBILITY.md）

本文记录**本机实测**的 DSH 扩展机制，而不是协议文档的推测。表中的每一行都注明证据来源：
`类型文件` = 安装包内的 `.d.ts`；`运行探针` = `scripts/probe-dsh.mjs` 在真实 DSH 进程中启动真实插件树并打印结果；
`配置转储` = 真实 `dsh --profile … --dump-config` 的输出；`集成测试` = `test/real-dsh.test.js`。

## 1. 运行环境（实测）

| 项目 | 值 | 证据 |
| --- | --- | --- |
| DSH 桌面端版本 | `0.2.0-rc.2` | `resources/runtime/primary-runtime/runtime.json` 的 `desktopVersion` |
| `@deepseek-ai/dsh` 包版本 | `0.1.1-rc.2` | `dsh --version` → `0.1.1-rc.2`；`/info` 的 `dshVersion` 也由运行中的 `@deepseek-ai/dsh-agent` 清单读出，同为 `0.1.1-rc.2` |
| Cordis | `@deepseek-ai/cordis@4.0.1` | `profiles/node_modules/@deepseek-ai/cordis/package.json` |
| Node（宿主） | `24.21.0`（桌面应用自带，`runtime/primary-runtime/dependencies/node/bin/node.exe`） | `runtime.json` 的 `node` |
| Node（PATH） | `24.18.0` | `node --version` |
| 系统 / 架构 | Windows `10.0.26100` / `x64` | `$PSVersionTable`、`runtime.json` 的 `platform`/`arch` |
| DSH Home | `C:\Users\Xenop\.dsh`（`DSH_HOME`） | 环境变量 |
| 当前 profile / carrier | `desktop`（Electron 桌面壳 + Web carrier，GUI 在 `http://127.0.0.1:19387`） | `DSH_PROFILE`、`DSH_WEB_URL` |
| 插件运行时 | 与 DSH 同进程的 Host 侧 Cordis 插件（ESM，无构建步骤） | 配置转储里出现 `- id: dsh-pet-bridge` |

## 2. 插件装载机制（实测）

DSH profile = `~/.dsh/profiles/<name>/`，其中 `package.json` 声明 `dsh.profile.bundles`（有序 bundle 层），
`cordis.patch.yml` 是用户补丁层。每层是 YAML 数组的 loader 补丁（`insert` 列表、按 `id` 覆盖 config、禁用）。
bundle 是声明了 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` 的 npm 包。

- **Host 导出**：插件模块导出命名空间 `name` / `inject` / `apply(ctx, config)`；`apply` 可为 async。
  `ctx.effect(fn)` 返回的清理函数在 fiber 卸载时按逆序执行，允许 async。
  证据：`@deepseek-ai/dsh-web-app/lib/types/index.d.ts`（`export declare const name/inject/apply`）、
  `cordis/lib/types/fiber.d.ts`（`Effect`/`AsyncEffect`、`effect()` 重载）。
- **安装入口**：`dsh plugin --profile <name> add <package|path>` 转发 pnpm。若包声明了 `dsh.bundle.patch`，
  该命令**同时**把包名追加进 `dsh.profile.bundles`。
  证据（本次实测输出）：`+ @local/dsh-pet-bridge link:X:/桌宠/spine-pet-workshop/dsh-pet-bridge`，
  随后 `~/.dsh/profiles/pet-bridge-test/package.json` 的 `bundles` 变为
  `["@deepseek-ai/dsh-base", "@local/dsh-pet-bridge"]`。
- **依赖解析**：bare 包名先按安装锚点、再按 profile 目录解析；宿主另维护
  `~/.dsh/profiles/node_modules` 扁平回退目录（每个包一个链接），所以插件可以 `import '@deepseek-ai/dsh-llm'`
  而不必自带副本。证据：`dsh-app-boot/lib/types/profile.d.ts` 的 `healProfilesModuleFallback` 注释；
  实测 `node_modules/@deepseek-ai/dsh-agent/package.json` 呈 junction 指向安装位置。
- **依赖声明方式**：本包**不声明 `peerDependencies`**。实测发现声明 peer 会让 pnpm 在导入包时尝试创建
  symlink（`ERR_PNPM_EPERM … symlink '…\profiles\node_modules\@deepseek-ai'`），而本机未开启开发者模式、
  普通用户不能创建 symlink，于是安装失败。宿主提供的包版本改为记录在
  `package.json` 的 `dsh.petBridge.hostProvidedPackages`（纯元数据，不参与安装）：
  `@deepseek-ai/cordis@4.0.1`、`dsh-agent`/`dsh-llm`/`dsh-session@0.1.1-rc.2`。
  运行时这些包由 DSH 安装目录/profile 回退目录提供，实测可用。
- **生命周期**：启动失败要回滚；卸载时 `ctx.effect` 清理函数执行。实测：卸载后端口关闭、`runtime.json` 被删除
  （`test/real-dsh.test.js` 第 10 步）。
- **启动失败的爆炸半径**：loader 的 `assertEntriesActivated` 把任一条目失败当成
  `plugin tree failed to load`，即整个 DSH 起不来（本次开发中真实见过这条错误）。因此本插件在 `apply()` 里兜住
  所有启动异常：记 error、回滚资源、不监听端口、不生成 `runtime.json`，但**不向 apply 抛出**。
  `test/resilience.test.js` 覆盖配置非法、未知配置键、授权表损坏三种情况。

## 3. 会话与输入（实测）

| 项目 | 结论 | 证据 |
| --- | --- | --- |
| 活跃 Agent 注册表 | `ctx.agents`（`AgentRegistry`）：`get(id)` / `list()` / `roots()` / `create()` / `resume()` | `dsh-agent/lib/types/index.d.ts`；集成测试用 `ctx.agents.create({sessionId, meta, agentOptions})` 建出真实 Agent |
| 会话存储 | `ctx.sessions`（`SessionStore`）：`get(id)` / `list()`；`session.events` 是**已提交、只增、互不跳号**的事件日志 | `dsh-session/lib/types/index.d.ts`；探针打印的 snapshot 来自真实日志 |
| Agent 状态 | `agent.status` = `idle` \| `running`；`agent/status` 事件在每次变化时发出 | `dsh-agent/lib/types/runtime-types.d.ts` |
| UserMessage 构造 | `createUserMessage({ content, source: { kind: 'user' } })` → 冻结的 `UserMessage`，`id` 由 `crypto.randomUUID()` 生成（36 字符，满足 wire 标识符文法） | 实测：`import('@deepseek-ai/dsh-llm')` 返回 `id: <uuid>`、`Object.isFrozen === true` |
| 普通消息入口 | `agent.followup(message)`：成为独立 turn 的唯一普通消息，并唤醒 driver | 运行时类型；集成测试真实跑通 |
| 追加指令 | `agent.steer(message)`：空闲时开 turn，运行中在下一步边界消费 | 同上（本版本已实现但默认不声明，见 §6） |
| 认领边界 | `agent/inbox/claimed` 事件携带 `{ agent, message, turn }`，是「哪条消息进入哪次执行」的唯一实证 | 集成测试里 `message.claimed` 的 `turn` / `activityId` 由此产生 |
| inbox 投影 | `agent.inbox.nextTurn` / `nextStep` / `hasPending` | `dsh-agent/lib/types/inbox.d.ts`；崩溃恢复用它证明消息是否仍在排队 |
| 现有 Agent 复用 | 只借用 `ctx.agents.get()` 的 Agent，从不创建/销毁/重置/分叉用户会话 | 源码 `src/dsh-adapter.js` 只有 `get`，没有 `create`/`dispose` |

## 4. 输出与事件（实测）

| 项目 | 结论 | 证据 |
| --- | --- | --- |
| 增量文本 | `assistant/chunk` 事件的 `data.chunk` 是 `StreamChunk`；`{type:'text-delta', index, text}` 是可见文字，`reasoning-delta` 是私密推理（不转发） | `dsh-llm/lib/types/types.d.ts`；集成测试收到 2 个合并后的 `assistant.delta` |
| 已提交助手消息 | `assistant/message` 携带 `{ turn, step, message: AssistantMessage, usage?, interrupted? }` | 同上；`assistant.message` 的 `messageId` 就是 `message.id` |
| 工具调用 | `tool/call`（`callId`,`name`,`arguments` 原始字符串）→ `tool/result`（`ToolResultMessage` + 可选 `error`） | 本桥只转发工具名与固定摘要，不转发参数与输出 |
| Turn 边界 | `turn/start {turn}` / `turn/end {turn, reason}`；`reason.kind` ∈ `completed`/`aborted`/`blocked`/`error`/`max-tokens`/`interrupted` | `dsh-session/lib/types/types.d.ts` |
| 审批 | `approval/asked` / `approval/decided` 是**会话日志**里的 log-only 事件；`approval/request` 是会被 UI 回答者认领的 waterfall | `dsh-user-approval/lib/types/index.d.ts`；本桥只读日志推断 `waiting-approval`，不注册回答者 |
| 标题 | `session/title` 日志事件；`ctx.sessionTitle.get(session)` 返回 `{title, …}` | `dsh-session-title/lib/types/index.d.ts` |
| 事件订阅 | `ctx.on('session/event', (session, event) => …)` 在**提交之后**同步触发，`session.events` 已含新事件；根上下文（未打 scope 标签）的监听器可收到全部会话 | 运行时类型 + 实测（探针与集成测试都依赖这一语义） |
| 私密字段 | 无协议层过滤，必须由插件只挑选 text 块 | `snapshot` 测试断言推理/工具/注入上下文不出现在响应里 |

## 5. 控制（实测）

| 项目 | 结论 | 证据 |
| --- | --- | --- |
| `agent.cancel(cause, options)` | 中止当前 turn；`options.keepInbox` 为 `true` 时保留排队与追加内容，否则清空 inbox | `dsh-agent/lib/types/runtime-types.d.ts` |
| 本桥的选择 | 用 `{ kind: 'user' }` + `{ keepInbox: true }`：只中止当前活动，不悄悄丢弃其他前端排队的内容 | `src/dsh-adapter.js` 的 `CANCEL_CAUSE` 与 `cancel()` |
| 取消的可见性 | 取消请求只回 `cancelling`；真实终态由 `turn/end` 的 `aborted` → `activity.ended cancelled` 确认 | 集成测试第 8 步断言 `outcome === 'cancelled'` 且 `activityId` 相同 |
| `whenIdle()` | 反映**整个 Agent** 的空闲，不是某条 prompt 的结果；本桥不拿它当回执 | 运行时类型注释 |
| 取消与子活动 | 本版本只观察顶层 turn；子 Agent（subagent）的 turn 在其自己的会话里，不并入 | 设计取舍，见 README「已知限制」 |

## 6. 能力开关（本次交付）

| 能力 | 状态 | 依据 |
| --- | --- | --- |
| `sessions.list` / `session.snapshot` / `message.send` / `events.follow` / `requests.lookup` | **声明并实现** | 集成测试（真实 DSH）全部跑通 |
| `session.cancel` | **声明并实现**（默认 `enableCancel: true`） | 集成测试对真实 agent-loop 取消成功，`activity.ended cancelled` |
| `message.steer` | **实现但默认不声明**（`enableSteer: false`） | 真实 DSH 上的 steer 需要一个正在执行、且模型愿意在下一步边界消费的 turn；本次未做付费模型验证，因此默认关闭。打开后 `message.steer` 出现在 `info.capabilities` |
| `interaction.answer` | **不声明** | 唯一决定通道是 `approval/request` waterfall：注册回答者会**挡住** DSH GUI 的回答者，形成绕过通道，违反「审批唯一决定」。本版本只提示用户到 DSH GUI 处理 |
| `persona.update` | **不声明** | 会话人格要走 `system-prompt` / `dsh-persona` 的 scope 机制，本版本未实现可验证的 revision 语义 |
| `pet.tools` | **不声明** | 对端（桌宠 v4.2.2）没有通用工具注册/跨插件执行服务；基础协议也没有动态工具注册端点 |

未声明的能力不会出现在 `info.capabilities`，发送对应命令返回 `501 UNSUPPORTED_CAPABILITY`。

## 7. 未使用/未验证的旧假设

旧阶段 0 骨架（已从当前源码移除，历史见 Git 备份）里的这些做法**在本版本被明确放弃**，仅记录历史取舍：

- `/dsh-pet/act`、`conversationId`、`hello`/`delta`/`done`：不属于 `pet-dsh/1`。
- `inject: ['webServer']` + `ctx.webServer.register(...)`：依赖 web carrier；本版本改为自己开 loopback 监听，
  因为 headless/desktop profile 未必有 web 服务，且 GUI 端口会变。
- `~/.dsh/pet-bridge.json` 自动配对文件：协议禁止自动读 `~/.dsh` 与凭据签发；本版本改为
  用户显式执行 `pet-bridge-admin.mjs` 生成 token，只保存 SHA-256。
- 工具白名单 `allowTools`：本版本不改用户的工具集合（连接授权不等于执行扩权）。

## 8. 无法验证的部分（如实记录）

| 项目 | 状态 / 原因 |
| --- | --- |
| 真实桌宠联调 | **已部分验证（2026-10-22）**：`spine-pet-workshop` v4.2.2 + 插件 `io.spine-workshop.dsh-pet` 1.0.0 直连真实 DSH，`message.send` → 会话 → SSE 推回全链路通过（证据见 TEST_REPORT §11）。桌宠侧的 `session.cancel`、断线重连仍只有模拟证据 |
| GUI 侧栏肉眼可见 | 数据面已证实（同一条桌宠消息出现在会话与快照里）；未逐帧核对侧栏渲染 |
| 付费模型调用 | 用户未单独授权；集成测试用脚本化 `LlmAdapter` 走真实 agent-loop，零费用 |
| 多客户端并发竞争 | 宿主每插件只允许 4 个 HTTP + 1 条 SSE，协议本身是单客户端模型；只做了单客户端 + 第二流取代测试 |
| Windows ACL 等价性 | 只在数据目录上依赖用户 profile 的既有 ACL，并明确声明「POSIX mode ≠ ACL」 |

## 9. 开发过程中新增的两条实证（供后续版本参考）

1. **读取会话日志要走 session store，不要只信 `agent.session`。**
   在由 GUI 打开的真实会话上，`ctx.agents.get(id).session` 与 `ctx.sessions.get(id)` 拿到的对象
   `constructor.name` 都是 `Session`，但 `session.events` 都是 `undefined`；而在假 Harness、
   `agents.create`、`agents.resume` 三条路径里 `events` 都是正常数组。
   结论：适配层应优先从 store 取会话对象，并对 `events` / `eventsSnapshot` / `log` 多路兜底；
   失败时报出对象的原型与成员形状，而不是一句「内部错误」。
2. **配置热生效、代码不热更新。**
   改 `cordis.patch.yml` 的 config 后 1–2 秒插件按新配置重启（含换端口）；
   但 `dsh plugin remove/add`、换安装目录、改 `bundles` 都**不会**重新 import 已加载的模块
   （ESM 按模块 URL 缓存）。升级源码后必须完整重启 DSH。
3. **`port: 0` 的代价**：每次启动端口都变，桌宠里保存的根地址会失效。
   生产环境应在 profile 补丁层用 id 覆盖把端口固定下来（见 README §3）。
