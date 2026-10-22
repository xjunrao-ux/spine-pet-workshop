# @local/dsh-pet-bridge

Spine 桌宠 ↔ DeepSeek Harness 的 **DSH 端** Host 插件。它在 DSH 进程内开一个只监听 `127.0.0.1` 的
HTTP JSON + SSE 端点，让桌宠把你**已经授权的现有项目会话**当成自己的对话框：消息进入原会话，
沿用原有模型、工具、沙盒与审批；DSH GUI 与桌宠读同一份已提交历史。

- 协议：`pet-dsh/1` 修订 1.0.0 — [protocol/DSH_BRIDGE_PROTOCOL.md](protocol/DSH_BRIDGE_PROTOCOL.md)、
  [schemas/dsh-bridge-v1.schema.json](protocol/schemas/dsh-bridge-v1.schema.json)
- 桌宠宿主：v4.2.2+ 的 `context.localService` — [protocol/LOCAL_SERVICE_API.md](protocol/LOCAL_SERVICE_API.md)
- 桌宠端怎么对接：[docs/PET_INTEGRATION.md](docs/PET_INTEGRATION.md)
- 实测环境与被验证的 DSH 接口：[COMPATIBILITY.md](COMPATIBILITY.md)
- 测试矩阵与实际结果：[TEST_REPORT.md](TEST_REPORT.md)

> 本插件**不是**旧 `/dsh-pet/act` 阶段 0 骨架。旧骨架已从当前源码清理，历史保留在本地 Git 备份中，两套协议不兼容。

**已验证的端到端事实**：在 `spine-pet-workshop` v4.2.2 + 插件 `io.spine-workshop.dsh-pet` 1.0.0 上，
桌宠面板发出的消息经本插件进入 DSH 会话，回答经 SSE 推回桌宠；台账可查、断线可恢复。

---

## 1. 一分钟版本

```powershell
# ① 安装（把路径换成你放本包的目录）
$B = 'X:\桌宠\spine-pet-workshop\dsh-pet-bridge'
node "$env:USERPROFILE\.dsh\profiles\node_modules\@deepseek-ai\dsh\lib\bin.js" plugin --profile desktop add $B

# ② 固定端口（否则每次启动端口都变，桌宠里存的地址会失效）
#    编辑 ~/.dsh/profiles/desktop/cordis.patch.yml，追加：
#    - id: dsh-pet-bridge
#      config:
#        host: 127.0.0.1
#        port: 45871
#        basePath: /pet-bridge/v1/
#        enableCancel: true
#        enableSteer: false

# ③ 生成令牌并授权一个已存在的会话（token 只打印这一次）
node "$B\scripts\pet-bridge-admin.mjs" token create --client pet-livingroom --session <会话id> --with-cancel

# ④ 重启 DSH 桌面端（插件只在这时加载代码）

# ⑤ 确认在跑，并记下根地址
node "$B\scripts\pet-bridge-admin.mjs" status

# ⑥ 自检（只读，不花模型钱）
$env:DSH_PET_TOKEN = '<③ 打印的 token>'
node "$B\scripts\bridge-smoke.mjs"
```

日常只有一步：**打开 DSH**。插件自动起在固定端口，桌宠用存好的地址和令牌直连。

---

## 2. 安装（三种方式，都实测过）

先决条件：DSH 已安装并至少启动过一次（`~/.dsh/profiles/` 存在）。

### 关于 `dsh` 命令

桌面版的 `dsh` **通常不在 PATH 上**。下面所有命令都用完整路径，先设一次：

```powershell
$DSH = "$env:USERPROFILE\.dsh\profiles\node_modules\@deepseek-ai\dsh\lib\bin.js"
node $DSH --version      # 期望打印 0.1.1-rc.2
```

如果你自己有 `dsh` 在 PATH 上，把 `node $DSH` 换成 `dsh` 即可。

### 关于 pnpm

`dsh plugin` 只是把参数转发给 `pnpm`，所以**需要 pnpm 在 PATH 上**。桌面版自带一份，但在
`…\resources\runtime\primary-runtime\dependencies\pnpm\bin\pnpm.cjs`，可以临时做个转发脚本：

```powershell
$node = (Get-Command node).Source
$pnpmCjs = 'D:\Users\Xenop\AppData\Local\Programs\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\pnpm\bin\pnpm.cjs'
$shim = Join-Path $env:TEMP 'pnpm-shim'
New-Item -ItemType Directory -Force -Path $shim | Out-Null
Set-Content -Path (Join-Path $shim 'pnpm.cmd') -Value "@echo off`r`n`"$node`" `"$pnpmCjs`" %*" -Encoding ASCII
$env:PATH = "$shim;$env:PATH"
pnpm.cmd --version
```

### 方式 A：目录安装（推荐，开发期也用它）

```powershell
node $DSH plugin --profile desktop add "X:\桌宠\spine-pet-workshop\dsh-pet-bridge"
```

实测输出：`+ @local/dsh-pet-bridge link:X:/桌宠/spine-pet-workshop/dsh-pet-bridge`。
因为包内声明了 `dsh.bundle.patch`，这条命令还会**自动**把包名追加进
`~/.dsh/profiles/desktop/package.json` 的 `dsh.profile.bundles`，无需手改清单。

确认插件树里有这一行（只读检查，不启动）：

```powershell
node $DSH --profile desktop --dump-config | Select-String 'dsh-pet-bridge' -Context 0,7
```

### 方式 B：安装打好的 tarball

```powershell
node $DSH plugin --profile desktop add "X:\…\local-dsh-pet-bridge-1.0.0.tgz"
```

⚠️ 在本机实测时这种方式会失败并报
`ERR_PNPM_EPERM … symlink '…\profiles\node_modules\@deepseek-ai'`——那台机器没有创建 symlink 的权限
（未开开发者模式），与包内容无关。**同一台机器用方式 A（目录，走 junction）是成功的**。
如果目标机器也没有 symlink 权限，请用方式 A。

### 方式 C：只加一行补丁，不动 bundles

适合不想改 `dsh.profile.bundles` 的场景：

```yaml
# ~/.dsh/profiles/desktop/cordis.patch.yml
- insert:
    - id: dsh-pet-bridge
      name: '@local/dsh-pet-bridge'
      config:
        port: 45871
```

三种方式**只能选一种**。重复装载会得到两个实例（不同端口），桌宠会连到先写入 `runtime.json` 的那个。

### 装完必须重启一次

- **代码**只在 DSH 启动时加载。插件已装好但改了源码 → 必须完整重启桌面端；
  `dsh plugin remove/add`、换安装目录、改 `bundles` **都不会**重新 import 已加载的模块（ESM 按模块 URL 缓存）。
- **配置**会热生效：改 `cordis.patch.yml` 里的 config 后，插件会在约 1–2 秒内按新配置重启（含换端口）。

---

## 3. 固定端口（强烈建议）

bundle 默认 `port: 0`（由系统分配），好处是不冲突，代价是**每次启动地址都变**，桌宠里存的地址立刻失效。

在 `~/.dsh/profiles/desktop/cordis.patch.yml` 追加一行 id 覆盖即可固定：

```yaml
- id: dsh-pet-bridge
  config:
    host: 127.0.0.1
    port: 45871
    basePath: /pet-bridge/v1/
    enableCancel: true
    enableSteer: false
```

注意两点：

1. **id 覆盖会替换整行 config，不是合并**，所以要把每个键都写上（括号里是默认值：
   `host=127.0.0.1`、`port=0`、`basePath=/pet-bridge/v1/`、`enableCancel=true`、`enableSteer=false`）。
2. 端口被别的程序占用时，插件**不会拖垮 DSH**：它记一条 error、不监听、不写 `runtime.json`，
   `pet-bridge-admin status` 会显示"未检测到"。换个端口即可，改完热生效。

---

## 4. 授权：令牌、客户端、会话白名单

插件**默认不共享任何会话**，也没有任何客户端。授权状态在 `~/.dsh/pet-bridge/clients.json`
（数据目录可用 `DSH_PET_BRIDGE_DATA_DIR` 覆盖），由管理脚本维护：

```powershell
$B = 'X:\桌宠\spine-pet-workshop\dsh-pet-bridge'

# 生成 token + 授权会话（--with-cancel 授予取消能力）
node "$B\scripts\pet-bridge-admin.mjs" token create --client pet-livingroom --session <会话id> --with-cancel

# 查看
node "$B\scripts\pet-bridge-admin.mjs" list
node "$B\scripts\pet-bridge-admin.mjs" status        # 读 runtime.json + 校验进程是否还活着

# 追加会话 / 撤销客户端 / 换令牌
node "$B\scripts\pet-bridge-admin.mjs" grant  --client pet-livingroom --session <另一个会话id>
node "$B\scripts\pet-bridge-admin.mjs" revoke --client pet-livingroom
node "$B\scripts\pet-bridge-admin.mjs" token rotate --client pet-livingroom
```

**怎么找会话 id**：

```powershell
$env:DSH_SESSION_ID        # 当前终端所属的 DSH 会话（最方便）
# 或列最近的会话目录
Get-ChildItem "$env:USERPROFILE\.dsh\sessions" -Recurse -Directory |
  Where-Object Name -like 'session-*' | Sort-Object LastWriteTime -Descending |
  Select-Object -First 5 Name,LastWriteTime
```

要点：

- token 至少 32 随机字节（hex 64 字符），服务端**只存 SHA-256**、恒时比较。它不是模型 API Key。
- token 只在终端出现一次。忘了就 `token rotate`；`--export` 可写一份受保护的本地交接文件
  （`~/.dsh/pet-bridge/connection-export.json`，**用完请删除**；Windows 上 POSIX 权限 ≠ ACL）。
- 撤销后约 2 秒内新请求 `401`，该客户端的 SSE 被关闭；**已提交的 DSH 任务不会被取消**。
- 白名单只能填**已存在**的会话。`/sessions` 只列白名单条目；没有活跃 Agent 的显示
  `available:false`（桌宠侧应展示但标"不可用"）。
- `session.cancel` 需要 `--with-cancel` **且** config 里 `enableCancel: true`（默认开）。

---

## 5. 在桌宠里连接

1. 桌宠 → 该插件（菜单名「DSH 任务」）→ 设置里的 **「配置 DSH 连接」**（managerOnly 命令），
   会弹出**宿主自己的**可信连接窗口（不是 DSH 的窗口）。
2. 填：
   - **根地址**：`http://127.0.0.1:45871/pet-bridge/v1/` —— **必须带 `/pet-bridge/v1/`**，
     只填到端口会 404；宿主不接受 `localhost`、DNS、查询串。
   - **令牌**：第 4 节生成的那串。
3. 保存后**再点一次「连接」**（插件是先保存连接、再握手）。
4. 面板分页到**「会话」页** → 「刷新列表」→ 选目标会话的「选择」。
   > 面板首页（聊天页）只显示空状态提示，看不到会话列表，这是该插件的分页设计。
5. 状态从"请选择授权会话"变成"实时连接就绪"即成功。

---

## 6. 端点

所有业务请求必须带 `Authorization: Bearer <token>`；不接受任何带 `Origin` 的请求（含 `Origin: null`）；
`Host` 必须是本实例的 loopback 授权。响应 `application/json; charset=utf-8` + `Cache-Control: no-store`。

| 端点 | 返回形状 | 说明 |
| --- | --- | --- |
| `GET /info` | 裸对象 | `{protocols, instanceId, serverVersion, dshVersion, capabilities, limits}`；不调模型 |
| `GET /sessions?cursor=` | 裸对象 | `{instanceId, items[], nextCursor}`；`workspace` 只给目录名 |
| `GET /snapshot?sessionId=` | 裸对象 | `{instanceId, sessionId, cursor, messages[], activity, pendingInteractions, pendingPetCalls, truncated}` |
| `POST /commands` | 信封 | `message.send` 成功 → **202** `{status:'accepted', messageId}` |
| `GET /requests?requestId=` | 信封 | 台账：`received/accepted/running/ended/rejected/unknown` |
| `GET /events?sessionId=` | SSE | `event: bridge`，`id` = 信封 `cursor`；每 15 s 注释心跳 |

> 「信封」= `{protocol, ok, data}` 或 `{protocol, ok:false, error}`；`/info`、`/sessions`、`/snapshot` 是裸对象。
> 这是协议 §8 的规定，桌宠端必须按端区分。

`POST /commands` 支持的操作：

| op | data | 结果 |
| --- | --- | --- |
| `message.send` | `{mode:'followup', text}`（≤4000 字符） | 202 accepted |
| `message.send` | `{mode:'steer', text}` | 需 `enableSteer: true` + 客户端被授予 `message.steer` |
| `session.cancel` | `{activityId}` | 200 `{status:'cancelling', activityId}`；终态由 `activity.ended` 确认 |

`interaction.answer` / `pet.tool.result` / `persona.update` → `501 UNSUPPORTED_CAPABILITY`。

SSE 事件：`message.claimed`、`assistant.delta`、`assistant.message`、`tool.started`、`tool.finished`、
`activity.state`、`activity.ended`、`session.changed`、`resync.required`。
本版本不发 `interaction.*` / `pet.tool.*`。

关键语义（桌宠端最容易做错的三点）：

1. **202 只是接收**，不是成功；终态看 `activity.ended`（`completed/failed/cancelled/interrupted`）。
2. `message.claimed` 是"这条消息进了哪次执行"的唯一实证（来自 DSH 的 `agent/inbox/claimed`）。
3. 断线后**不要重发** `message.send`，先查 `/requests?requestId=…`；`unknown` 就如实显示"结果未知"。

---

## 7. 错误码

| code | HTTP | 含义 |
| --- | --- | --- |
| `INVALID_REQUEST` | 400 | 信封/字段/类型不合法，或含不支持的字段 |
| `UNAUTHORIZED` | 401 | 缺少/错误/已撤销 token |
| `FORBIDDEN` | 403 | Host/Origin 被拒，或该会话未授权给此客户端 |
| `VERSION_MISMATCH` | 400 | `protocol` 不是 `pet-dsh/1` |
| `INSTANCE_CHANGED` | 409 | 信封里的 `instanceId` 不是当前实例（DSH 重启过） |
| `SESSION_NOT_FOUND` | 404 | 该会话没有活跃 Agent |
| `SESSION_BUSY` | 409 | 会话正在执行，普通提交被拒（不会静默转 steer） |
| `UNSUPPORTED_CAPABILITY` | 501 | 能力未声明/未启用 |
| `REQUEST_CONFLICT` | 409 | 同一 `requestId` 用于不同内容 |
| `REQUEST_UNKNOWN` | 404 | 台账没有该请求（或已过保留期） |
| `RESULT_UNKNOWN` | 409 | 有记录但无法证明结果；**不授权自动重发** |
| `EXPIRED` | 409 | `activityId` 与当前活动不匹配 |
| `BODY_TOO_LARGE` | 413 | 请求体 > 64 KiB |
| `OVERLOADED` | 429 | 速率/并发超限或读取超时（唯一可安全重试的） |
| `INTERNAL_ERROR` | 500 | 内部错误；`message` 会带**已脱敏的具体原因**（无堆栈、无路径） |

失败响应只有 `{protocol, ok:false, error:{code,message,retryable}}`，不同时带 `data`。

---

## 8. 配置全表

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `host` | `127.0.0.1` | 只能是 `127.0.0.1` 或 `::1` |
| `port` | `0` | 生产建议固定（见第 3 节）；实际值写进 `runtime.json` 与日志 |
| `basePath` | `/pet-bridge/v1/` | 必须以 `/` 结尾 |
| `dataDir` | `$DSH_HOME/pet-bridge` | 台账、映射、`runtime.json`（**不要**放项目工作区） |
| `clientsFile` | `<dataDir>/clients.json` | 授权表；损坏时记 error 并以"无授权客户端"继续运行，修好后约 2 秒自动恢复 |
| `enableCancel` | `true` | 关掉后不声明 `session.cancel` |
| `enableSteer` | `false` | 打开后才声明 `message.steer` |
| `limits.requestBytes` | `65536` | 超过即 413，在解析 JSON 之前 |
| `limits.responseBytes` | `262144` | 超出会被裁剪/拒绝 |
| `limits.eventBytes` | `65536` | 单个 SSE 事件上限 |
| `limits.messageChars` | `4000` | `text` 上限 |
| `limits.eventsPerSecond` | `30` | 业务事件速率目标 |
| `limits.heartbeatMs` | `15000` | SSE 注释心跳间隔 |
| `limits.journalRetentionHours` | 最小 `24` | 台账保留期 |
| `limits.sessionPageSize` | `20` | `/sessions` 每页条数 |
| `replay.windowMs` / `maxEvents` / `maxBytes` | 5 分钟 / 2000 / 8 MiB | SSE 有界回放窗口 |
| `journal.compactBytes` / `sweepIntervalMs` / `fsync` | 4 MiB / 10 分钟 / `true` | 台账持久化 |
| `eventRate.deltaFlushMs` / `deltaFlushChars` | `80` / `2048` | 文本合并窗口 |
| `snapshot.messageLimit` / `.messageChars` | `20` / `16000` | 快照裁剪 |
| `concurrency.maxHttp` / `maxSse` / `maxConnections` | `4` / `1` / `16` | 对应桌宠宿主的预算 |

未知配置键会被拒绝（拼写错误不会静默生效）。

---

## 9. 启停、升级、卸载、回滚

```powershell
# 停用：在补丁行加 disabled: true；或从 bundles 里去掉；然后重启
# 卸载
node $DSH plugin --profile desktop remove '@local/dsh-pet-bridge'

# 换版本（目录安装）
node $DSH plugin --profile desktop add "<新目录>"     # 然后完整重启
```

- 停用/卸载会：停止接受新提交 → 关闭 SSE 与心跳 → 结束本插件自己的等待 → 刷新并关闭台账 →
  关闭监听 → 删除 `runtime.json`。**不会**取消已提交的 DSH 任务，**不会**销毁你借给它用的会话。
- 授权数据（`clients.json`、台账）留在 `dataDir`，重新启用后继续有效；`instanceId` 每次启动都变。
- 回滚：装回旧目录后完整重启；台账带格式版本号，遇到不认识的版本会保留原件并拒绝写入。

### 故障安全：坏了也不会拖垮 DSH

DSH 的 loader 把「某个插件启动失败」当成整棵插件树失败，所以本插件**刻意不在启动阶段抛错**：

- 配置写错（未知键、端口越界）→ 记一条 error，**不监听任何端口**，不生成 `runtime.json`，DSH 照常打开；
- `clients.json` 损坏 → 记 error，以"无授权客户端"继续运行，修好文件后约 2 秒自动恢复；
- 台账目录不可写等运行期问题 → 回滚资源、关闭监听，同样不拖垮宿主。

最坏情况是**桥不可用**，而不是**DSH 打不开**。

---

## 10. 故障排查（全部来自实战）

| 症状 | 原因 / 处理 |
| --- | --- |
| `Cannot find module 'C:\Users\…\scripts\bridge-smoke.mjs'` | 没 `cd` 进包目录就用相对路径。用完整路径 `node "X:\…\dsh-pet-bridge\scripts\bridge-smoke.mjs"` |
| `'dsh' 不是内部或外部命令` | `dsh` 不在 PATH；用 `node $DSH …` 的完整路径 |
| `'pnpm' is not recognized` | 见第 2 节的 pnpm 转发脚本 |
| `pet-bridge-admin status` 显示"未检测到" | 插件没加载 / 启动失败。看第 9 节兜底：端口冲突、配置非法都会这样；换端口或修配置 |
| `status` 显示的是上次运行残留 | 进程被硬杀时 `runtime.json` 会留下；脚本会校验 pid，提示"残留" |
| 401 | token 错/已撤销/未登记。`list` 看哈希前缀；忘了就 `token rotate` |
| 403 | ① 会话不在该客户端白名单；② `Host` 不对（别走代理）；③ 带了 `Origin`（浏览器打开会带） |
| 404 `SESSION_NOT_FOUND` | 该会话没有活跃 Agent（没在 GUI 里打开，或重启后未恢复）。看 `/sessions` 的 `available` |
| 404（桌宠连不上其它端点） | 根地址漏了 `/pet-bridge/v1/`，请求打到 `/info` 上 |
| 409 `SESSION_BUSY` | 会话正在执行（例如 DSH 里正在跑一轮），等空闲或改用确认过的追加指令 |
| 409 `INSTANCE_CHANGED` | DSH 重启过，重新 `GET /info` 拿新 `instanceId` |
| 501 | 能力没开：`enableSteer`、`enableCancel`，或客户端未被授予 |
| 413 / 429 | 请求体 >64 KiB；或速率超限（等 1 秒，唯一可安全重试的） |
| 桌宠面板「请选择授权会话」但没有列表 | 面板分页到**「会话」页**再点「刷新列表」；聊天页只显示空状态 |
| 桌宠"已固定"但没连上 | 「已固定」是图钉，不是连接状态；看状态行是"尚未配置连接"还是"请选择授权会话" |
| 改了源码不生效 | ESM 按模块 URL 缓存：`remove/add` 只重建实例、不重新 import。必须**完整重启**桌面端 |
| 改了 config 不生效 | 等 1–2 秒热生效；若端口被占则不监听（见第 3 节） |

`/snapshot` 这类 500 的 `message` 字段现在会带**已脱敏的具体原因**（错误类 + 原因，去掉路径与堆栈），
因此排查时优先看它，而不是猜。

---

## 11. 测试与自检

```powershell
$B = 'X:\桌宠\spine-pet-workshop\dsh-pet-bridge'

# 单元/集成（不需要 DSH、不花模型钱）：模拟 Harness + 真实本地 HTTP/SSE
node --test "$B\test\*.test.js"
# 若受限沙盒报 spawn EPERM，加 --test-isolation=none

# 真实 DSH 集成（脚本化模型，零费用；需要仓库里的 node_modules junction）
$env:DSH_BRIDGE_REAL_DSH = '1'; node --test "$B\test\real-dsh.test.js"

# 真实插件树探针：打印版本、服务、端点数、真实会话历史
node "$B\scripts\probe-dsh.mjs"

# 兼容桌宠语义的模拟客户端（默认只读；--allow-model 才真发消息）
$env:DSH_PET_TOKEN = '<token>'
node "$B\scripts\bridge-smoke.mjs"

# 不装 DSH 也能本地试：起一个模拟 DSH（令牌固定 devdevdevdevdev0）
node "$B\scripts\dev-fake-bridge.mjs" --port 39217
```

打包：

```powershell
node "$B\scripts\pack.mjs"    # → .build/local-dsh-pet-bridge-1.0.0.tgz（白名单 + 协议摘要校验）
```

---

## 12. 已知限制

- **只声明并验证了**基础五项 + `session.cancel`。`interaction.answer`、`persona.update`、`pet.tools`
  未声明（原因见 COMPATIBILITY §6）；`message.steer` 实现但默认关闭。
- **没有审批回答通道**：审批只能在 DSH GUI 点；桌宠侧只能看到 `waiting-approval`。
- **单会话单流**：桌宠宿主每插件 1 条 SSE，一个时刻只跟随一个会话；切会话先关旧流。
- **子 Agent 的 turn** 不在本桥投影里（在各自的子会话中）。
- **硬杀进程**会留下 `runtime.json`；工具已用 pid 活性识别。
- **取消不清 inbox**：传 `keepInbox: true`，其他前端排队内容不会被悄悄丢掉。
- **tarball 安装**在缺少 symlink 权限的 Windows 上会失败，请用目录安装。
- 未做多客户端并发压测（协议本身是单客户端 + 单 SSE 模型）。

## 许可

MIT。
