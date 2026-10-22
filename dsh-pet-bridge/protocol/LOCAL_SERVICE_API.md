# 通用本地服务能力（v4.2.2）

权限 `net.local`，插件 API v1 的增量能力。外部 ZIP 仍无 fetch、Node、系统文件或任意网络。宿主提供通道，不理解 DSH、Agent、会话、工具参数或消息内容。

## 授权与配置

1. 插件在 manifest.permissions 声明 `net.local`，用户在 ZIP 导入时确认权限。
2. 插件调用 `context.localService.configure()`，宿主打开独立可信窗口。可将此操作绑定到插件自己的 managerOnly 设置按钮。
3. 用户填写完整服务根地址及连接令牌，点击“授权并保存连接”。地址必须为 `http://127.0.0.1:明确端口/路径/` 或 `http://[::1]:明确端口/路径/`。不支持 localhost、DNS、远程地址、URL 凭据/查询、重定向或自动端口扫描。
4. 宿主按插件身份加密保存完整记录。插件仅能获取 configured、endpoint 和固定错误码，不能指定 Authorization/其他请求头，也不能通过配置接口读取令牌。连接服务本身是信任边界，不能防止用户授权的恶意服务另行泄露其已知令牌。
5. 路径授权覆盖根路径下的读取和变更请求，不等于只读授权。修改/移除配置停止该插件全部传输并发出 configuration.changed。配置保留到显式移除，禁用/卸载只撤销运行能力。

## 接口

```js
const local = context.localService; // 仅在实际授权 net.local 时注入
const release = await local.subscribe(event => {
  // event 是通用传输事件，由插件识别协议/错误/业务含义。
});
const status = await local.status(); // {configured, endpoint, error}
await local.configure(); // {opened:true}；不等待用户输入，不启动连接
await local.request({requestId:'info-1', method:'GET', path:'/info'});
await local.request({requestId:'send-1', method:'POST', path:'/commands', body:{example:true}});
await local.stream({streamId:'events-1', path:'/events', query:{sessionId:'session-a'}, lastEventId:'instance-a.105'});
await local.cancel({requestId:'send-1'}); // 或 {streamId:'events-1'}，不能同时提供
release(); // 只退订回调，不会自动取消传输
```

`request` / `stream` 快速返回 `{requestId|streamId,accepted:true}`。这是宿主接受传输的回执，不是服务端执行回执。须先 subscribe 再提交。HTTP 的 requestId 用于本地操作关联；与 body 内协议 requestId 的映射由插件负责。

请求方法：GET / POST / PUT / PATCH / DELETE；GET 不允许 body。body 必须为可 JSON 序列化数据。只允许文档列出的字段，禁止传 URL、headers、cookie、代理或 TLS 参数。

path 是以 `/` 开头的服务内路径，拼接到授权根路径；例如根地址 `http://127.0.0.1:3080/bridge/` 加 `/info` 实际访问 `/bridge/info`。拒绝绝对地址、双斜线、反斜线、百分号编码、`.` / `..` 路径段、查询与片段。query 为最多 20 个 string→string 参数，宿主编码；值不能被当作 URL 执行。`/` 表示根路径本身。

同一活跃操作不能重复使用 requestId/streamId。传输结束后可以复用，但业务 requestId 的长期幂等必须由插件与服务端实现。HTTP 结果包括 4xx/5xx，只要有合法 JSON 就以 response 返回，不自动重试；重定向直接拒绝。204 为 data:null。

## 事件

| type | 其他字段 | 行为 |
| --- | --- | --- |
| configuration.changed | configured,endpoint,error | 用户保存/移除配置 |
| response | requestId,status,ok,data | 有限大小的 JSON HTTP 响应；不提供响应头、cookie、URL |
| request.error | requestId,code | 本地请求失败/取消/超时；不回传原始异常 |
| stream.open | streamId | 已验证 HTTP 200 和 text/event-stream |
| stream.event | streamId,event,data,lastEventId,retry? | SSE framing 结果；data 是字符串，不解析业务 JSON |
| stream.end | streamId | EOF；不能推断业务任务成功 |
| stream.error | streamId,code | 取消、断线、超时或限额错误 |

SSE 支持 UTF-8 分片、CR/LF/CRLF、多行 data、注释心跳和持久 id；没有空行终止的半个事件在 EOF 丢弃。retry 仅报告，宿主不自动重连。Last-Event-ID 由插件选择，限 200 个可打印 ASCII 字符。配置令牌的直接明文回显会被替换为 `[redacted]`，插件仍不得把服务数据当作 HTML 或指令执行。

固定错误码包括：NOT_CONFIGURED、CONFIG_UNAVAILABLE、ENCRYPTION_UNAVAILABLE、NETWORK_ERROR、TIMEOUT、CANCELLED、HTTP_401、HTTP_403、INVALID_CONTENT_TYPE、INVALID_RESPONSE、RESPONSE_LIMIT、INVALID_EVENT_STREAM、EVENT_LIMIT、RATE_LIMIT。格式/权限/并发错误在 RPC 提交时拒绝；插件应显示通用错误并允许用户查看配置，不依赖内部异常文案。

## 预算与生命周期

- 每插件最多 4 个 HTTP、1 条 SSE；每个沙盒最多 1 个本地事件订阅。
- 请求 JSON≤64 KiB，HTTP JSON 响应≤256 KiB，SSE 事件≤64 KiB；事件类型≤100 字符、id≤200 字符。
- 请求/握手 15 秒超时，SSE 收到任何字节都会刷新 45 秒空闲超时。
- SSE 每秒最多 120 个事件或 1 MiB 数据，超限关闭流；业务插件应进一步合并文本，避免超过宿主 publish 预算。
- 禁用、卸载、进程崩溃和权限撤销取消全部传输并释放订阅；异步迟到结果不会发送给已撤销的实例。
- `cancel` 只取消网络传输，不能取消远端已经接收的任务；停止 DSH 任务需要插件另外发送协议命令。
- 同时保持 SSE 消费与短 HTTP 请求，不把整个远端执行塞进插件的 7 秒命令等待。

## 与 DSH 的关系

[pet-dsh/1 共同声明](DSH_BRIDGE_PROTOCOL.md) 和 [JSON Schema](schemas/dsh-bridge-v1.schema.json) 供后续插件实现。宿主代码不会导入这两份业务声明。已有 dsh-pet-bridge 旧骨架不属于已验收服务，也不会自动连接。

## 验证

`pnpm test:local-service` 使用本机模拟 HTTP/SSE 服务验证地址、授权路径、凭据隔离、响应与流、取消、超时和权限撤销。`pnpm test:local-service:sandbox` 使用真实 Electron ZIP 沙盒与宿主配置窗口验证 RPC、隔离和资源释放。不调用模型、不读取真实 DSH 配置、不产生 API 费用。

SSE framing 参考 [HTML Standard](https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation)；本实现是受控流客户端，不实现浏览器 EventSource 的自动重连/重定向行为。加密能力参考 [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)。
