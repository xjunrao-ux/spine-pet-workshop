# 测试报告（TEST_REPORT.md）

日期：2026-10-22（初版 2026-10-21）· 插件版本 `@local/dsh-pet-bridge@1.0.0` · 协议 `pet-dsh/1` 修订 1.0.0

三类证据严格分开，**不把模拟测试算作真实双端验证**：

| 类别 | 含义 | 本次状态 |
| --- | --- | --- |
| **模拟** | 模拟 Harness + 真实本地 TCP/HTTP/SSE。证明桥自身行为，不证明 DSH 版本兼容 | 62 项通过（另 1 项真实 DSH 测试默认跳过） |
| **真实 DSH** | 真实 `@deepseek-ai/dsh` 0.1.1-rc.2 插件树、真实 agent-loop、真实会话日志、真实 loopback 端口；模型用脚本化适配器（零费用） | 1 项集成测试（10 个阶段）通过 |
| **真实桌宠** | 真实 Spine 桌宠 v4.2.2 + 插件 `io.spine-workshop.dsh-pet` 1.0.0 直连真实 DSH | **发送链路已端到端验证通过**（见 §11）；取消/重连仅模拟证据 |

复现命令（Windows / Node 24）：

```powershell
cd X:\桌宠\spine-pet-workshop\dsh-pet-bridge
node --test "test/*.test.js"                                   # 全部（真实 DSH 默认跳过）
$env:DSH_BRIDGE_REAL_DSH='1'; node --test test/real-dsh.test.js # 真实 DSH
node scripts/probe-dsh.mjs                                      # 真实插件树事实探针
```

> 受限沙盒里 `node --test` 会报 `spawn EPERM`（不允许为每个测试文件开子进程管道），
> 加 `--test-isolation=none` 在当前进程内跑即可，结果等价。

原始日志（每项的完整输出）在仓库的 `dsh-pet-bridge/.probe/` 下：`test-<file>.log`、`test-real-dsh.log`、
`probe-dsh.log`、`desktop-config-dump.yml`、`desktop-default-config-dump.yml`。这些文件**不在**发布包里。

## 0. 总计

| 套件 | 文件 | 项数 | 通过 | 失败 |
| --- | --- | --- | --- | --- |
| 契约/线格式 | `test/wire.test.js` | 13 | 13 | 0 |
| 认证/授权/围栏 | `test/auth.test.js` | 8 | 8 | 0 |
| 限额/裁剪/限流 | `test/limits.test.js` | 5 | 5 | 0 |
| SSE/游标/回放/心跳 | `test/sse.test.js` | 8 | 8 | 0 |
| 台账/幂等/损坏 | `test/journal.test.js` | 5 | 5 | 0 |
| 崩溃恢复判定 | `test/recovery.test.js` | 5 | 5 | 0 |
| 投影/脱敏/合并 | `test/projection.test.js` | 6 | 6 | 0 |
| 故障安全（不拖垮宿主） | `test/resilience.test.js` | 3 | 3 | 0 |
| 端到端六端点 | `test/flow.test.js` | 9 | 9 | 0 |
| **真实 DSH 集成** | `test/real-dsh.test.js` | 1（10 阶段） | 1 | 0 |
| 真实插件树探针 | `scripts/probe-dsh.mjs` | 1 | 1 | 0 |

合计 63 项自动化测试（62 通过 + 1 项真实 DSH 测试在未设 `DSH_BRIDGE_REAL_DSH=1` 时跳过）。

> 沙盒提示：如果 `node --test "test/*.test.js"` 报 `spawn EPERM`，是因为受限沙盒不允许测试运行器为每个
> 文件开子进程管道；加 `--test-isolation=none` 在当前进程内跑即可（结果等价）。普通终端无此限制。

## 1. 契约（模拟）

- 命令：`node --test test/wire.test.js`
- 前置：无
- 实测：标识符文法（1–100 个 `[A-Za-z0-9._-]`）、游标与实例绑定且拒绝跨实例、`canonicalJson` 键序无关、
  字符数与 UTF-8 字节分别计算、`textOfContent` 只取 text 块、信封逐字段校验（`VERSION_MISMATCH`/`INSTANCE_CHANGED`/
  未知字段/`data` 非对象）、`message.send` 空文本/超 4000 字符/陌生字段（`url`、`shell`）拒绝、错误码→HTTP 状态映射。
- 证据：`.probe/test-wire.log`

## 2. 认证与围栏（模拟）

- 命令：`node --test test/auth.test.js`
- 实测：缺 token → 401 + `WWW-Authenticate: Bearer`，响应中不含 token；错 token → 401；
  把 `clients.json` 改成空表 → 约 1 秒后 401；撤销时**打开的 SSE 收到 `: revoked` 注释并被关闭**，
  已提交任务不受影响；跨客户端访问未授权会话 → 403（`snapshot`/`events`/`commands` 三个入口一致）；
  `Origin`（含 `null`）→ 403；陌生 `Host` → 403；能力未启用/未授予 → 501 且不出现在 `info`；
  方法不符 → 405 + `Allow`；未知端点 → 404；缺 `basePath` → 404。
- 证据：`.probe/test-auth.log`

## 3. 输入与限额（模拟）

- 命令：`node --test test/limits.test.js`
- 实测：>64 KiB 请求体在解析前 413（`Connection: close`）；畸形 JSON / 空体 / 错误类型 → 400；
  4000 字符边界通过、4001 拒绝；未知 op → 501 **且不落台账**；快照按条数与字符裁剪并 `truncated: true`，
  保留 `messageId`；HTTP 429 限流（`retryable: true`）。
- 证据：`.probe/test-limits.log`

## 4. SSE（模拟）

- 命令：`node --test test/sse.test.js`
- 实测：中文 + emoji + `\r\n`/`\n` 跨字节边界逐字还原，所有帧 `id === cursor`、`event: bridge`、单帧 ≤64 KiB；
  心跳是注释行、无 `id`、无 `data`、不推进游标；无 `Last-Event-ID` 时不回放；带快照游标只收其后事件；
  跨实例游标 → `resync.required{cursor-invalid}`；被挤出回放窗口的游标 → `resync.required{cursor-expired}`；
  窗口内重放连续不重复；第二个流取代第一个（收到 `: superseded`），业务事件只从新流到达。
- 证据：`.probe/test-sse.log`

## 5. 台账与幂等（模拟）

- 命令：`node --test test/journal.test.js`
- 实测：跨进程重启保留 `ended/completed` 与 `acceptedInstanceId`；未写完的尾记录被截断且已提交内容不变；
  中间记录损坏 → 台账只读、新提交 500、**文件原样保留**、旧记录仍可查；保留期满只清理终态、
  不确定记录保留；同 `(clientId, requestId)` 二次 `begin` 被拒。
- 证据：`.probe/test-journal.log`

## 6. 崩溃恢复（模拟）

- 命令：`node --test test/recovery.test.js`
- 前置：手工写入 `received` 记录，模拟「进程在入队与记账之间死掉」。
- 实测：`messageId` 已出现在会话日志 → `accepted`；仍在 `agent.inbox` → `accepted`；
  日志与 inbox 都没有且 Agent 空闲 → `rejected(CANCELLED)`；Agent 运行中无法证明 → `unknown(RESULT_UNKNOWN)`，
  且用同 `requestId` 不同内容重试得到 `REQUEST_CONFLICT`、**没有**产生新的 turn；会话整体消失 → `unknown`。
- 证据：`.probe/test-recovery.log`

## 7. 投影与脱敏（模拟）

- 命令：`node --test test/projection.test.js`
- 实测：`source.kind === 'plugin'` 的注入上下文、`reasoning` 块、`tool/call` 原始参数、`tool/result` 输出
  **都不出现**在快照里；两次生成用不同 `attemptId`、`index` 各自从 0 连续；
  200 个 provider 分片合并成 <20 个 `assistant.delta`（默认 80 ms 窗口）且拼接后与原文逐字相同；
  `approval/asked` → `activity.state:waiting-approval`、`approval/decided` → `running`，
  `pendingInteractions` 恒为空（没有回答通道就不假装有）；终态映射 `completed/max-tokens→completed`、
  `aborted→cancelled`、`error/blocked→failed`、`interrupted→interrupted`。
- 证据：`.probe/test-projection.log`

## 8. 端到端六端点（模拟）

- 命令：`node --test test/flow.test.js`
- 实测：`/info` 能力与限额、`/sessions` 展示名与状态、`/snapshot` 空历史与游标；
  `message.send` → **202 回执**（失败不由回执表达），随后按序收到
  `message.claimed`（含 `requestId`/`messageId`/`turn`）→ `assistant.delta`（index 从 0 连续）→
  `assistant.message` → `activity.ended:completed`，`cursor` 严格递增；`/requests` 得到 `ended/completed`；
  同 `requestId` 同内容重放不产生第二个 turn、不同内容 `REQUEST_CONFLICT`；忙碌会话 `SESSION_BUSY` 且不写台账；
  `session.cancel` 对过期 `activityId` 返回 `EXPIRED`、对当前活动返回 `cancelling`；
  GUI 侧输入触发 `session.changed`；快照包含已提交的 user/assistant 历史。
- 证据：`.probe/test-flow.log`

## 9. 真实 DSH 集成（真实 DSH，脚本化模型）

- 命令：`$env:DSH_BRIDGE_REAL_DSH='1'; node --test test/real-dsh.test.js`
- 前置：本机已安装 DSH 0.1.1-rc.2；仓库内有指向 `~/.dsh/profiles/node_modules/@deepseek-ai` 的 junction。
- 做法：用 `@deepseek-ai/dsh-app-boot` 的 `loadProfile` 取真实 `dsh-base` 补丁层，
  `boot()` 起真实插件树（不含 web app，因此没有 GUI 也没有端口冲突），把本插件作为真实 Cordis 行装载，
  `ctx.llm.registerAdapter(['scripted'], …)` 注册脚本化适配器，
  `ctx.agents.create({sessionId, meta, agentOptions})` 建出**真实 Agent**，
  然后只用 HTTP/SSE 驱动它。整个过程 `DSH_HOME` 指向临时目录，不读写你的会话/设置/凭据，也不花钱。
- 实测（一条命令跑完 10 个阶段）：
  1. `dshVersion` = `0.1.1-rc.2`（由运行中的 `@deepseek-ai/dsh-agent` 清单读出）；
  2. `/info` 能力含 `session.cancel`、不含 `message.steer`；
  3. `/sessions` 把该会话列为 `available: true`/`idle`，`workspace` 为目录名 `project`；
  4. `/snapshot` 游标格式为 `<instanceId>.<n>`，初始无消息；
  5. `message.send` → 202；真实 agent-loop 产生事件序列
     `session.changed, activity.state, message.claimed, session.changed, assistant.delta ×2, assistant.message, activity.ended`；
     断言 `message.claimed.requestId` 与提交的一致、`assistant.message.text` 等于脚本化适配器的文本；
  6. `/requests` → `ended/completed`，`acceptedInstanceId` 等于当前实例；
  7. 快照随后含 user+assistant 两条已提交消息；
  8. 同 `requestId` 重放返回同一 `messageId`；
  9. `session.cancel` 对**真实** turn 生效：`activityId` 匹配 → `cancelling`，
     随后真实 `activity.ended` 为 `cancelled` 且 `activityId` 相同，台账最终 `ended/cancelled`；
  10. 卸载插件（`ctx.fiber.dispose()`）后端口关闭、`runtime.json` 被删除，而借用的会话仍在。
- 证据：`.probe/test-real-dsh.log`、`.probe/probe-dsh.log`

真实 DSH 侧另外做了一次**真实 launcher 安装验证**（不是测试套件，手工执行）：

```powershell
# 用一个独立 profile，避免动到日常使用的 desktop profile
dsh plugin --profile pet-bridge-test add "X:\桌宠\spine-pet-workshop\dsh-pet-bridge"
# → dependencies: + @local/dsh-pet-bridge link:X:/桌宠/spine-pet-workshop/dsh-pet-bridge
# → 自动写入 bundles: ["@deepseek-ai/dsh-base", "@local/dsh-pet-bridge"]

dsh --profile pet-bridge-test --dump-config
# → - id: dsh-pet-bridge / name: '@local/dsh-pet-bridge' / config: {...}

dsh --profile pet-bridge-test          # 真实启动
# → runtime.json: instance-7fc250db4af1, dshVersion 0.1.1-rc.2, url http://127.0.0.1:52494/pet-bridge/v1/
# → GET /info（带 token）200，返回协议 DTO
# → GET /sessions 200，列表里唯一的会话 available:false（该 profile 里没有活跃 Agent）
# → GET /info（不带 token）401，返回协议错误信封
# → GET /events?sessionId=（不存在的会话）404
# → 杀掉进程后端口关闭
```

验证用的客户端 `dsh-verify` 与其明文导出文件已撤销/删除，`~/.dsh/pet-bridge/clients.json` 现在是空授权表。
测试 profile 保留在 `~/.dsh/profiles/pet-bridge-test`（不启动就不占资源），
删除方法：删掉该目录 + `dsh plugin --profile pet-bridge-test remove '@local/dsh-pet-bridge'`（可选）。

## 10. 模拟客户端（兼容桌宠语义）

- 命令：先 `node scripts/dev-fake-bridge.mjs --port 39217`，另开终端
  `$env:DSH_PET_TOKEN='d'*64; node scripts/bridge-smoke.mjs --url http://127.0.0.1:39217/pet-bridge/v1/ --allow-model`
- 实测：9/9 通过 —— info、sessions、snapshot+游标、SSE 握手、202 回执（8 ms）、
  `message.claimed`→`assistant.message`→`activity.ended`、按 `Last-Event-ID` 恢复且不重发、
  同 `requestId` 去重 + 不同内容冲突、`/requests` 终态。`--allow-model` 未给时只跑只读 5 项。
- 结论：**兼容宿主语义的模拟客户端通过**；不等于已在真实桌宠验证。

## 11. 真实桌宠端验证（2026-10-22，手工）

环境：`spine-pet-workshop` v4.2.2 + 插件 `io.spine-workshop.dsh-pet` 1.0.0（权限 `net.local`），
DSH 0.1.1-rc.2 / desktop profile / 桥在固定端口 `45871`。

| 检查 | 实测结果 |
| --- | --- |
| 桌宠保存连接并握手 | 通过：面板状态进入 `selecting`（`/info` 已成功），说明地址 + 令牌被接受 |
| 加载授权会话 | 通过：`/sessions` 返回 1 条，面板列出并可选 |
| **桌宠发消息进入 DSH 会话** | **通过**：台账出现 `requestId=pet.77bea9ade45c4f57d06a2b4fc4711b93` → `messageId=2beb5e2a-0139-40f8-b5fd-676e239e346c`；该 id 在会话日志中对应 turn 15 的 `user/message`，内容即用户在桌宠面板输入的文字 |
| 202 回执 | 通过：`POST /commands` 返回 202 + `{status:'accepted', messageId}` |
| 认领与活动关联 | 通过：`message.claimed` 关联 `activityId=act.b3f01bd3.15`、`turn=15` |
| SSE 推回桌宠 | 通过：桥侧存在桌宠进程的 ESTABLISHED 长连接；DSH 的回答经 `assistant.*`/`activity.ended` 推送 |
| 台账查询（断线恢复依据） | 通过：`GET /requests?requestId=…` 返回 `accepted` + `messageId`/`activityId`/`acceptedInstanceId` |
| 快照读历史 | 通过：`GET /snapshot` 200，含最近 20 条（含上述 turn 15 的消息与回答） |
| 双端可见 | 通过：DSH GUI 与本会话看到同一条桌宠消息，回答同时出现在两端 |
| 重启后端口稳定 | 通过：固定端口 `45871` 在 11:43 那次重启后保持不变，桌宠无需改地址 |

结论：**真实桌宠端与真实 DSH 之间的 `message.send` + 回执 + SSE 推送 + 快照读历史已端到端验证通过。**
未验证的桌宠侧能力：`session.cancel`、断线重连后的 `resync`、`message.steer`（默认关闭）——这些仍只有模拟证据。

## 12. 打包与安装验证

| 检查 | 命令 | 实测结果 |
| --- | --- | --- |
| 打包检查 | `node scripts/pack.mjs` | 通过：白名单打包、协议三份摘要与交接包一致、无 `node_modules`/`.env`/`clients.json`/`runtime.json`/`requests.jsonl`/`test/`/`legacy-stage0`、产物 `.build/local-dsh-pet-bridge-1.0.0.tgz` |
| 包完整性（可运行） | 把 tarball 解包到 `~/.dsh/profiles/.pet-bridge-package-check/package`，`DSH_BRIDGE_PLUGIN_PATH=<解包目录>/src/index.js node scripts/probe-dsh.mjs` | 通过：`BOOT OK` → `/info`、`/sessions`、真实 turn 后的 `/snapshot` 全部正确，`PROBE OK`。证明包里运行时需要的文件齐全（解包目录已在验证后删除） |
| 正式安装（目录） | `dsh plugin --profile desktop add "…\dsh-pet-bridge"` | 通过：`+ @local/dsh-pet-bridge link:…`，并自动写入 `bundles`；`--dump-config` 出现该行；真实启动 + 六端点验证通过（见 §9、§11） |
| 正式安装（tarball） | `dsh plugin --profile pet-bridge-test add <绝对路径>\local-dsh-pet-bridge-1.0.0.tgz` | **失败**：`ERR_PNPM_EPERM … symlink '…\profiles\node_modules\@deepseek-ai' -> '…\dsh-pet-bridge_tmp_…\node_modules\@deepseek-ai'`。这是本机没有 symlink 权限（未开启开发者模式）导致的环境限制，不是包内容问题；同一台机器用目录安装（junction）正常。因此包的可运行性改用「解包后真实 boot」验证（上一行） |

结论：包内容经过真实 DSH 启动验证；两种安装方式里，目录安装已端到端通过，tarball 安装受本机 symlink 权限限制未能完成。
如果目标机器同样没有 symlink 权限，请用目录方式安装。

## 13. 未通过 / 未执行的项目（如实列出）

| 项目 | 状态 | 原因 |
| --- | --- | --- |
| 真实桌宠：`session.cancel` | 未执行 | 需在桌宠面板对执行中的活动点取消；本次只验证了发送链路 |
| 真实桌宠：断线重连 / `resync` | 未执行 | 需在桌宠侧断开 DSH 再恢复；只有模拟证据 |
| GUI 侧栏肉眼确认 | 部分 | 数据面与 GUI 同源且会话内可见该消息；未逐帧核对侧栏渲染 |
| 付费模型真实回复 | 未执行 | 用户未单独授权费用；真实 DSH 集成测试用脚本化适配器走真实 agent-loop |
| `message.steer` | 未验证 | 需执行中的 turn；故 `enableSteer` 默认 `false`、不声明能力 |
| `interaction.answer` / `pet.tools` | 未实现 | 会把 DSH 审批变成绕过通道 / 对端无注册机制（见 COMPATIBILITY §6） |
| 多客户端并发写同一会话 | 未做压测 | 协议本身是单客户端 + 单 SSE 模型；只验证了第二流取代第一流 |
| 慢客户端写满缓冲被断流 | 只做了代码路径 | 需要构造长时间不读的 TCP 客户端；`queuedBytes` 阈值逻辑存在但未端到端触发 |
| Windows ACL 强制 | 未验证 | 只依赖用户 profile 既有 ACL，并明说 POSIX mode ≠ ACL |
| 4,000 字符以上的 CJK 快照极端组合 | 部分覆盖 | 覆盖了 30×300 汉字 ×20 条裁剪，未做 16000 字符上限的逐条压力 |
