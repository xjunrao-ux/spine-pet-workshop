# 桌宠端对接指南（pet-dsh/1 客户端侧）

本文写给**桌宠侧的 DSH 插件**。服务端（DSH Host 插件）已经完成并跑通，
协议原文见 `protocol/DSH_BRIDGE_PROTOCOL.md`，宿主能力原文见 `protocol/LOCAL_SERVICE_API.md`。

一句话：桌宠插件不碰网络，只通过 `context.localService` 让**桌宠主进程**替你发 HTTP/SSE；
你负责协议校验、会话绑定、状态机和界面。

---

## 1. 能力边界（先看清能用什么）

| 你有的 | 你没有的 |
| --- | --- |
| `context.localService.configure()` / `status()` / `subscribe()` / `request()` / `stream()` / `cancel()` | 自由 `fetch`、Node、任意网络、直接读磁盘 |
| 宿主维护的加密凭据（你只能看到 `configured`/`endpoint`） | 读取明文 token、自定义请求头、跟随重定向 |

硬预算：**每插件 4 个并发 HTTP、1 条 SSE**；请求 15 s 超时；SSE 45 s 无字节即视为死流；
请求体 ≤64 KiB、响应 ≤256 KiB、单事件 ≤64 KiB。所以：一个时刻只跟随**一个**会话，
切换会话要先 `cancel({streamId})` 再对新会话 `stream()`。

## 2. 连接前的准备：地址与令牌

1. 插件在 `manifest.permissions` 声明 `net.local`；
2. 用一个 `managerOnly` 的「连接 DSH」按钮调 `await local.configure()`——宿主会弹自己的可信窗口；
3. 用户在窗口里填：
   - **根地址**：`http://127.0.0.1:<端口>/pet-bridge/v1/`（插件日志或 `runtime.json` 里的 `url`）；
     必须是 `127.0.0.1` 或 `[::1]` + 明确端口，宿主拒绝 `localhost`、DNS、查询串；
   - **令牌**：DSH 侧 `pet-bridge-admin token create` 打印的那 64 位十六进制。
4. 之后 `await local.status()` 只给你 `{configured, endpoint, error}`——**你永远拿不到 token**，
   宿主在注入 `Authorization` 时自己去取。

> 根地址把 `/pet-bridge/v1/` 一起带上，客户端路径就是常量 `/info` `/sessions` …
> 也可以让用户只填 `http://127.0.0.1:<端口>/`，那你的路径要写成 `/pet-bridge/v1/info`。二选一，别混。

## 3. 建立连接的标准序列

```js
// 0) 先订阅，再发请求（宿主规定：未 subscribe 就 request 会被拒）
const release = await local.subscribe(onTransportEvent);

// 1) 握手：确认协议与实例
const info = await call('info-1', { method: 'GET', path: '/info' });
// info.data = { protocols:['pet-dsh/1'], instanceId, serverVersion, dshVersion, capabilities, limits }
// 必须先断言 protocols 含 'pet-dsh/1'，并把 instanceId 记下来（重启检测靠它）

// 2) 列会话，让用户选一个（只显示 available:true 的）
const sessions = await call('sessions-1', { method: 'GET', path: '/sessions' });

// 3) 读快照，拿到水位 cursor
const snapshot = await call('snap-1', { method: 'GET', path: '/snapshot', query: { sessionId } });
// snapshot.data = { instanceId, sessionId, cursor, messages[], activity, pendingInteractions, pendingPetCalls, truncated }

// 4) 从该 cursor 起订阅唯一 SSE
await local.stream({
  streamId: 'events-1',
  path: '/events',
  query: { sessionId },
  lastEventId: snapshot.data.cursor,   // 关键：把快照水位接上去，既不丢也不重
});

// 5) 发送
await call('send-1', {
  method: 'POST',
  path: '/commands',
  body: {
    protocol: 'pet-dsh/1',
    instanceId: info.data.instanceId,   // 必须是当前实例
    requestId: newRequestId(),          // 客户端生成，幂等键
    op: 'message.send',
    sessionId,
    data: { mode: 'followup', text },
  },
});
```

`call()` 就是「发 request + 等 response 事件」的封装：

```js
async function call(requestId, { method, path, query, body }) {
  await local.request({ requestId, method, path, query, body });
  return await responseOf(requestId);   // 见下一节：从 response 事件里按 requestId 取出
}
```

⚠️ `local.request()` 返回的 `{accepted:true}` 只是**宿主把传输发出去了**，不是服务端回执。
真正的结果在 `response` 事件里。

## 4. 传输事件 → 你的状态机

```js
function onTransportEvent(event) {
  switch (event.type) {
    case 'configuration.changed': /* configured=false：断开、清 UI、归还连接按钮 */
    case 'response':              /* event.requestId → 你发出时的 requestId（⚠️不是 body 里的 requestId） */
    case 'request.error':         /* event.code：NETWORK_ERROR / TIMEOUT / HTTP_401 / HTTP_403 / RATE_LIMIT … */
    case 'stream.open':           /* 200 + text/event-stream 已验证；可以标记“实时中” */
    case 'stream.event':          /* event.data 是**原始 SSE data 字符串**，你自己 JSON.parse + 校验 */
    case 'stream.end':            /* EOF：不代表任务成功，只代表连接结束 */
    case 'stream.error':          /* 断线/取消/超时：按退避重连，不要盲目重发命令 */
  }
}
```

`stream.event` 的处理必须**先校验再应用**：

```js
const env = JSON.parse(event.data);
if (env.protocol !== 'pet-dsh/1') return;
if (env.instanceId !== currentInstanceId) return resync();
if (env.sessionId !== currentSessionId) return;
if (env.cursor === lastCursor) return;            // 去重
lastCursor = env.id ?? env.cursor;                // 下次 Last-Event-ID
apply(env);                                       // 按 env.type 分发
```

## 5. 事件清单与界面动作

| `type` | 界面动作 | 注意 |
| --- | --- | --- |
| `message.claimed` | 把这条用户消息挂到某次执行上（`activityId`/`turn`） | 这是「进了哪次执行」的唯一实证，别用 202 推断 |
| `assistant.delta` | 追加到 `attemptId` 对应的临时气泡，`index` 从 0 连续 | 换了 `attemptId` 说明重试，新建气泡而不是续写 |
| `assistant.message` | 用 `messageId` 的完整文本**替换**该轮临时输出 | 断线重连后以它为准 |
| `tool.started` / `tool.finished` | 显示 `name` + `summary`（只有摘要，没有参数/输出） | 不展示终端内容 |
| `activity.state` | `running` / `waiting-approval` / `waiting-input` / `cancelling` | `waiting-approval` 要提示「去 DSH GUI 处理」，本协议没有回答通道 |
| `activity.ended` | `completed` / `failed` / `cancelled` / `interrupted` → 收起进度 | **只有它才是任务终态**；202 和 idle 都不算 |
| `session.changed` | 重新拉一次 `/snapshot` | GUI 侧输入、标题变化、状态变化都会来这条；不要当成任务成功 |
| `resync.required` | 关闭流 → 重新 `info` + `snapshot` → 用新 `cursor` 重新 `stream` | 游标过期/跨实例 |
| `interaction.*` / `pet.tool.*` | 本版本不会出现 | 能力未声明就不要写对应 UI |

## 6. 重连与退避

- 断线：`1 → 2 → 4 → 8 → 最大 30 s` 退避重连，重连时带 `lastEventId: lastCursor`；
- `HTTP_401/403`、协议不兼容：**停止重试**，提示用户重新授权；
- 重连后先 `GET /info` 比 `instanceId`：变了就是 DSH 重启过 → 重新 `snapshot`（旧 cursor 一律丢弃）；
- **不要因为断线就重发 `message.send`**：查询 `/requests?requestId=…` 看台账，
  `accepted/running/ended` 都用原结果，`unknown` 就如实显示「结果未知」，别重试。

## 7. 错误码 → 用户话术

| code | 建议文案 |
| --- | --- |
| `UNAUTHORIZED` | 令牌无效或已撤销，请重新连接 |
| `FORBIDDEN` | 这个会话没有被授权给桌宠 / 地址被拒 |
| `SESSION_NOT_FOUND` | DSH 里那个会话没有打开（没有活跃 Agent），请先在 DSH 中打开 |
| `SESSION_BUSY` | DSH 正在执行，请稍后再发 |
| `INSTANCE_CHANGED` | DSH 重启过，已刷新 |
| `UNSUPPORTED_CAPABILITY` | 该能力未启用（比如追加指令） |
| `REQUEST_CONFLICT` | 内部错误：同一请求号内容不一致（应该永不发生） |
| `REQUEST_UNKNOWN` / `RESULT_UNKNOWN` | 结果未知，请到 DSH GUI 确认 |
| `EXPIRED` | 取消的目标活动已经变了 |
| `OVERLOADED` | 请求太频繁，稍后重试（可安全重试） |
| `BODY_TOO_LARGE` | 消息太长（≤4000 字符） |

## 8. 打包与自测（不需要真实 DSH）

服务端自带一个**模拟 DSH**，端口和令牌固定，回复是假文本：

```powershell
node scripts\dev-fake-bridge.mjs --port 39217      # 令牌 devdevdevdevdev0，会话 session-xxxxxxxx
```

桌宠插件开发期就把它当 DSH 用：根地址 `http://127.0.0.1:39217/pet-bridge/v1/`、令牌 `devdevdevdevdev0`。
它跑的是同一份服务端代码，所以六端点、SSE 水位、幂等、取消语义都和真实 DSH 一致，
只是「模型的回复」是写死的。

**开发顺序建议**：先在模拟桥上把 6 端点 + 事件状态机跑通 → 再换成真实 DSH 地址跑同一套用例 →
最后做 UI 打磨。这样你不会把「桌宠写错了」和「DSH 环境问题」混在一起。

## 9. 验收清单（两端联调时逐条打勾）

- [ ] 未配置时 `status()` 返回 `configured:false`，UI 只给「连接」按钮
- [ ] 错误令牌：`request.error` 是 `HTTP_401`，UI 不崩、可重新授权
- [ ] `info` 的 `protocols` 不含 `pet-dsh/1` 时拒绝连接（而不是当成未知服务继续用）
- [ ] 只展示 `available:true` 的会话；历史会话标灰并说明原因
- [ ] 首次进入：`snapshot` → `cursor` → `stream(lastEventId=cursor)`，期间到达的事件不丢不重
- [ ] 发送后 202 只表示「接收」，气泡保持「执行中」直到 `activity.ended`
- [ ] `assistant.delta` 按 `attemptId` 分组、`index` 连续；`assistant.message` 能替换临时输出
- [ ] 切换会话：先 `cancel({streamId})` 再开新流（否则触发宿主「1 条 SSE」限制）
- [ ] 断网 30 s：退避重连，`lastEventId` 续传，**没有重发** `message.send`
- [ ] DSH 重启：`instanceId` 变化 → 重新 snapshot，旧 cursor 不再使用
- [ ] `session.changed` 会触发一次 snapshot 刷新
- [ ] `waiting-approval` 显示「去 DSH GUI 批准」，而不是自己造一个批准按钮
- [ ] 停用插件：SSE 关闭、无残留重连定时器；DSH 侧已提交的任务继续跑
