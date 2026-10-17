# Spine 桌宠工坊插件开发规范与接入手册

文档版本：1.4.0 · 更新日期：2026-10-17 · 对应宿主：v3.2.3 正式版（兼容 v3.2.2 API v1） · 插件 API：v1 · ZIP 包格式：v1。

本手册面向独立插件作者。目标是：不修改主程序、不加入内置注册表，只编写自己的插件源码，打包为 ZIP，由用户在角色管理器导入，使用同一套菜单、左右分页、设置、存储和角色提醒。

> API v1 已有可运行实现，但仍处于开发验证期，并非永久冻结的 SDK。v3.1.2 正式版不支持 ZIP 导入；早期仅有内置插件的 v3.2.1 测试包也不支持。请使用 v3.2.2 或包含相同接口的宿主构建，在“角色管理器 → 扩展 → 导入插件 ZIP”安装。本文以现有代码为准，不把未来规划写成已开放接口。

新手入口：[JavaScript 计数器快速入门](PLUGIN_QUICKSTART.md) · [插件安装使用手册](PLUGIN_USAGE.md) · [GitHub 社区目录](../community/README.md) · [PR 投稿规范](../community/CONTRIBUTING.md)。

## 目录

- [1. 接入范围与基本规则](#1-接入范围与基本规则)
- [2. 从零做一个可安装插件](#2-从零做一个可安装插件)
- [3. ZIP 包格式与打包方式](#3-zip-包格式与打包方式)
- [4. plugin.json 清单规范](#4-pluginjson-清单规范)
- [5. 生命周期与 context 接口](#5-生命周期与-context-接口)
- [6. 菜单页面与声明式组件](#6-菜单页面与声明式组件)
- [7. 命令、表单与返回值](#7-命令表单与返回值)
- [8. 设置、存储与版本兼容](#8-设置存储与版本兼容)
- [9. 提醒、隐私与已读](#9-提醒隐私与已读)
- [10. 安全边界与运行预算](#10-安全边界与运行预算)
- [11. 调试、测试与验收](#11-调试测试与验收)
- [12. 发布与生态接入规范](#12-发布与生态接入规范)
- [13. 常见问题与代码索引](#13-常见问题与代码索引)

## 1. 接入范围与基本规则

### 1.1 已开放与未开放

| 能力 | 外部 ZIP 插件当前状态 |
| --- | --- |
| 独立插件 ID、安装、同 ID 替换、启用、禁用、重启、卸载 | 已开放 |
| 胶囊菜单入口、吸顶标题、左右按钮分页、内容内部滚动 | 已开放，由宿主渲染 |
| 通用文本、按钮、表单、列表、时间、百分比组件 | 已开放 |
| 角色管理器自动生成插件设置 | 已开放 |
| 本插件独立持久化存储 | 已开放，需 `storage.own` |
| 角色字幕提醒与宿主已读标识 | 已开放，发提醒需 `ui.reminders` |
| 音乐读取/控制、系统通知 | 仅受信任内置插件可用，外部 ZIP 不开放 |
| Codex 额度与任务状态 | 已开放受控 `codex.read` 只读订阅，需新版宿主；Codex 功能现以独立 ZIP 交付 |
| 图片文件、封面上传、自定义 SVG 图标 | 外部资源接口未开放；可使用宿主预置图标 |
| 受控天气 API（weather.read） | v3.2.2 已支持 |
| 任意网络、AI API、数据库连接、系统文件、进程与 shell | 未开放 |
| 自定义 HTML/CSS、DOM、独立窗口 | 未开放 |
| 插件市场、远程安装、自动更新、签名验证、插件间通信 | 未实现 |

因此当前适合开发本地待办、简短笔记、计时展示、习惯记录、手工录入的状态面板等插件。需要其他联网、后台服务或其他程序数据的功能，应先提出新的受控能力设计，不能通过绕过沙盒接入。天气领域接口见 [受控天气设计与验收](design/weather-plugin.md)；此接口不开放任意 URL 或插件内 fetch。

当前内置项为音乐、系统通知、待办；待办沿用旧 ZIP 身份 `example.todo`，旧安装索引迁移为内置，任务、配置与缓存保留，不能再用 ZIP 覆盖或卸载它。Codex 使用外部身份 `io.spine-workshop.codex`，没有导入时不运行、不显示；宿主只保留受控只读适配器，不包含 Codex Provider 与页面定义。

### 1.2 规范用语

- **必须**：插件作者需要遵守的格式、行为或发布要求；并非每条发布要求都有自动校验器。
- **不得**：当前不支持的行为，或可能造成越权、数据丢失的做法。
- **建议**：便于维护和生态协作的约定，不代表宿主会强制执行。
- **规划**：尚未实现，不得在插件说明中宣称可用。

### 1.3 宿主与插件分工

```text
用户选择本机 ZIP → 清单/路径/权限校验 → 用户确认 → 安装记录
                                                   ↓
                        沙盒 Worker：activate(context) → 插件实例
                                                   ↓
             插件快照、命令、存储、提醒 → 宿主校验 → 统一 UI / 本机数据
```

插件必须只提供“内容与业务逻辑”。悬停、点击固定、菜单位置、透明度、拖动调整尺寸、翻页交互、标题吸顶、字幕队列和隐私策略属于宿主。不得复制整套宿主 UI，或向主程序插入针对某个插件 ID 的分支。

## 2. 从零做一个可安装插件

下面的“便签演示”是完整的最小可用示例。它提供两页菜单、编辑表单、本机保存、保存提醒和已读红点；无需修改宿主源码。示例代码通过本文配套测试检查。

### 2.1 建立独立目录

```text
quick-note/
├── plugin.json
├── provider.js
└── README.md
```

将下面两个代码块分别保存为 `plugin.json` 和 `provider.js`。README 至少说明用途、权限、安装方式和数据保留行为。

### 2.2 清单

<!-- example:manifest:start -->
```json
{
  "packageType": "spine-pet-plugin",
  "packageVersion": 1,
  "id": "com.example.quick-note",
  "name": "便签演示",
  "menuLabel": "便签",
  "version": "1.0.0",
  "apiVersion": 1,
  "configVersion": 1,
  "entry": "provider.js",
  "icon": "note",
  "entryVisibility": "when-enabled",
  "description": "独立 ZIP 便签：本机保存，使用统一菜单与角色提醒。",
  "permissions": ["storage.own", "ui.reminders"],
  "compatibilityNotes": ["卸载保留数据，同 ID 重装恢复。程序未运行时不会提醒。"],
  "settingsSchema": [
    {
      "key": "remindOnSave",
      "type": "boolean",
      "label": "保存后提醒",
      "description": "字幕仍遵循宿主的隐私、专注和提醒开关。",
      "default": true
    }
  ],
  "commands": [
    {
      "id": "saveNote",
      "permissions": ["storage.own"],
      "fields": {"text": {"type": "string", "maxLength": 200}}
    }
  ]
}
```
<!-- example:manifest:end -->

`com.example.quick-note` 仅供演示。发布自己的插件必须改成自己的稳定 ID，避免覆盖别人的数据。

### 2.3 入口模块

<!-- example:provider:start -->
```js
export async function activate(context) {
  const stored = await context.storage.get('state');
  if (stored !== null && (
    stored.schemaVersion !== 1 ||
    typeof stored.text !== 'string' || stored.text.length > 200 ||
    !Number.isSafeInteger(stored.sequence) || stored.sequence < 0
  )) {
    throw new Error('Unsupported note data');
  }

  let state = stored ?? { schemaVersion: 1, text: '', sequence: 0 };
  let closed = false;
  let queue = Promise.resolve();
  const changeKey = () => 'note-change:' + state.sequence;

  function getSnapshot() {
    return {
      available: true,
      status: 'ready',
      message: state.text ? '便签已保存' : '等待填写便签',
      pages: [
        {
          id: 'overview', title: '我的便签', icon: 'note',
          subtitle: '本机保存',
          readKey: state.sequence > 0 ? changeKey() : null,
          blocks: state.text
            ? [{ type: 'text', text: state.text, multiline: true }]
            : [{ type: 'status', icon: 'note', title: '还没有便签',
                 description: '点击右下角下一页填写内容。' }]
        },
        {
          id: 'edit', title: '编辑便签', icon: 'edit',
          blocks: [{
            type: 'form', id: 'note-editor-' + state.sequence,
            commandId: 'saveNote', payload: {}, submitLabel: '保存便签',
            fields: [{ key: 'text', type: 'textarea', label: '便签内容',
                       required: true, maxLength: 200, value: state.text }]
          }]
        }
      ]
    };
  }

  const publish = () => { if (!closed) context.publish(getSnapshot()); };
  const close = () => { closed = true; };
  context.onCleanup(close);

  return {
    getSnapshot,
    execute(commandId, payload) {
      const operation = queue.then(async () => {
        if (closed || context.signal.aborted) throw new Error('Plugin stopped');
        if (commandId !== 'saveNote') throw new Error('Unknown command');
        const text = String(payload.text ?? '').trim();
        if (!text || text.length > 200) throw new Error('Invalid note');
        const next = { schemaVersion: 1, text, sequence: state.sequence + 1 };
        await context.storage.set('state', next);
        state = next;
        publish();

        if (context.getConfig().remindOnSave) {
          await context.emit({
            id: changeKey(), dedupeKey: changeKey(), count: 1,
            createdAt: new Date().toISOString(),
            pageId: 'overview', readKeys: [changeKey()],
            summary: { private: '有一条便签更新', details: '便签已保存\n' + text }
          });
        }
        return { navigateTo: 'overview' };
      });
      queue = operation.catch(() => {});
      return operation;
    },
    onSettingsChanged() { publish(); },
    onRead() { publish(); },
    dispose: close
  };
}
```
<!-- example:provider:end -->

注意：这是便于入门的示例，不是具有事务性提醒投递的生产笔记系统。便签写入成功后，即使提醒请求失败，便签也已经保存；需要可靠重试时，参照[提醒去重与投递](#94-去重与投递语义)设计持久化 outbox。

### 2.4 打包并安装

在宿主仓库根目录运行，替换为自己的源码路径与输出路径：

```powershell
node scripts/package-plugin.mjs "D:/plugins/quick-note" "release/plugins/Quick-Note-v1.0.0.zip"
```

这个脚本只打包清单、声明的入口以及可选 README/ LICENSE，并执行导入格式检查；不会执行插件代码。

安装流程：

1. 退出旧宿主，启动支持 ZIP 导入的开发构建。
2. 打开角色管理器 → **扩展** → **导入插件 ZIP**。
3. 选择 ZIP，核对插件 ID、版本和两个权限，确认安装。
4. 确认状态为“运行中”；悬停角色，在胶囊菜单打开便签。
5. 点击右下角下一页到编辑页，保存内容，检查第一页、字幕和红点。
6. 关闭并重开程序，确认便签仍在；测试禁用、启用、卸载和重装。

导入是本机文件选择，不是互联网上传。拒绝权限确认时，不安装、不执行包内代码。无需先解压 ZIP，也不用修改 `registry.mjs`。

## 3. ZIP 包格式与打包方式

### 3.1 必需结构

```text
Quick-Note-v1.0.0.zip
├── plugin.json         必须位于 ZIP 根目录，UTF-8 JSON
├── provider.js         清单 entry 指定的单文件 ESM 入口
└── README.md           建议附带，导入时不执行
```

可以把入口放在 `dist/provider.js`，并把 `entry` 写成该路径；但入口仍必须是一个已打包模块。不得将整个 `quick-note/` 文件夹作为最外层目录压入 ZIP，导致实际清单变成 `quick-note/plugin.json`。

ZIP 中其他文件只参与归档校验，不会成为插件可访问的静态资源目录；当前安装缓存只使用清单和入口源码。不支持 `fetch('./config.json')` 或导入 ZIP 中的第二个模块。

### 3.2 硬限制

| 项目 | 当前限制 |
| --- | --- |
| ZIP 文件体积 | 不超过 8 MiB |
| ZIP 条目数，含目录条目 | 不超过 64 |
| 所有条目解压后总大小 | 不超过 16 MiB |
| 单个条目解压大小 | 不超过 4 MiB |
| 单个条目的解压/压缩大小比 | 不超过 200，压缩大小非零时检查 |
| 根目录 `plugin.json` | 不超过 64 KiB |
| 入口 JS UTF-8 字节数 | 不超过 512 KiB，不能为空 |
| ZIP 路径长度 | 不超过 180 个 JS 字符 |
| 同时安装的外部插件 | 不超过 32 个 |
| 压缩方式 | STORE 或 DEFLATE；不支持 ZIP64、分卷、加密 |

本文 KiB/MiB 分别表示 1024/1024² 字节；文本字符上限按 JavaScript `string.length` 计算，不等于 UTF-8 字节数。

路径必须使用 `/`。禁止绝对路径、反斜杠、`..`、空路径段、盘符、ADS、控制字符、Windows 设备名、尾随点/空格、链接与重名条目（忽略大小写）。文件头、目录、CRC 与条目范围必须一致。

### 3.3 开发时允许多文件，交付时必须单文件

源码可以使用 TypeScript、多文件模块和第三方纯 JS 库，但作者必须在开发机预先打包：输出一个浏览器 Worker 可运行的 ESM 文件，再把清单的 `entry` 指向它。

- 不得保留 `import './helper.js'`、`import 'some-package'`、`require()` 或 Node 内置模块导入。
- 依赖必须不需要 DOM、网络、Node 或当前禁用的浏览器存储能力。
- 不得把 `node_modules` 放进 ZIP；宿主不会安装依赖。
- 使用自己熟悉的打包工具即可；本仓库没有为外部插件提供单独的 npm SDK 或一键项目生成器。

也可使用其他 ZIP 工具，但必须得到相同根目录结构，并通过 `inspectPluginZip` 校验。通用打包脚本要显式指定输出路径；它不传参数时默认构建 Codex 示例，默认文件名也为 Codex，不会自动按任意插件名生成。可用 `pnpm package:codex` 单独生成 Codex ZIP，应用打包不会预装它。

## 4. plugin.json 清单规范

### 4.1 字段表

| 字段 | 类型 / 必需 | 规范 |
| --- | --- | --- |
| `packageType` | string / 是 | 固定 `spine-pet-plugin` |
| `packageVersion` | integer / 是 | 当前固定 `1` |
| `id` | string / 是 | 3–100 字符，匹配 `^[a-z][a-z0-9.-]{2,99}$`；不得以 `workshop.` 开头 |
| `name` | string / 是 | 非空，最多 100 字符，管理器和隐私提醒使用 |
| `menuLabel` | string / 否 | 最多 100 字符，菜单提示标签；建议短且非空 |
| `version` | string / 是 | 最多 30 字符；作者必须使用非空 SemVer，如 `1.2.0`；当前校验器不解析 SemVer |
| `apiVersion` | integer / 是 | 当前必须是 `1` |
| `configVersion` | integer / 是 | 至少 `1`，与宿主保存的配置版本严格匹配 |
| `entry` | string / 是 | ZIP 内安全相对路径，以 `.js` 或 `.mjs` 结尾，区分大小写 |
| `icon` | string / 是 | 宿主预置图标名，见下表 |
| `entryVisibility` | string / 是 | `when-enabled` 或 `when-available` |
| `description` | string / 否 | 最多 1000 字符，默认空字符串 |
| `permissions` | string[] / 是 | 可为空数组；外部支持下表四个权限 |
| `compatibilityNotes` | string[] / 否 | 最多 20 条，每条最多 2000 字符，显示在管理器 |
| `settingsSchema` | object[] / 否 | 最多 30 项，默认空数组；见第 8 节 |
| `commands` | object[] / 否 | 最多 40 项，默认空数组；见第 7 节 |

未定义的清单字段不会自动变成能力。当前没有有效的 `minHostVersion`、`dependencies`、`updateUrl`、`main`、`renderer` 或 `onInstall` 钩子；不得依赖这些字段。发布信息应放 README，或明确标成不参与执行的作者元数据。

### 4.2 ID、身份与权限

建议使用自己控制的反向域名风格 ID，如 `io.yourteam.task-list`，并长期保持不变。ID 是安装替换、存储和已读空间的身份，不是显示名称。

同 ID 导入会替换并启用原插件，保留原有配置和数据，不会安装第二份。更改 `name` 不改变身份；更改 `id` 则成为另一插件，不自动迁移数据。当前没有发布者身份签名：知道 ID 不代表拥有该插件，发布包必须让用户核对来源。

外部权限：

| 权限 | 提供的能力 | 缺少授权时 |
| --- | --- | --- |
| `storage.own` | `context.storage.get/set`，仅本插件 | 请求拒绝 |
| `ui.reminders` | `context.emit`，经宿主策略处理的字幕 | 请求拒绝 |
| `codex.read` | `context.codex.subscribe`，本机额度与任务元数据只读流 | 不提供 codex 对象；主进程也会拒绝越权订阅 |
| `weather.read` | `context.weather.search/forecast`，固定 Open-Meteo 城市/天气查询 | 请求拒绝 |

仅展示内容和执行纯内存逻辑可使用 `permissions: []`。不得申请 `media.read`、`media.control`、`notifications.read`，这些声明会使外部包在执行前被拒绝。Codex 权限允许看到任务名称，必须告知用户读写范围；它不是凭据、任务控制或模型调用权限。

### 4.3 图标与入口显隐

可用图标：`music`、`notifications`、`codex`、`note`、`clock`、`cloud`、`close`、`play`、`pause`、`next`、`previous`、`checklist`、`check`、`undo`、`trash`、`plus`、`edit`。

- `when-enabled`：启用即保留入口，即便没有条目。适合待办、便签、计时器。
- `when-available`：启用且快照 `available: true` 才展示；失败或不兼容时仍可显示问题入口。
- 禁用或卸载：移除菜单入口。不能由插件快照自行覆盖启用状态。

## 5. 生命周期与 context 接口

### 5.1 必须导出的入口

```js
export async function activate(context) {
  // 读取自己的数据，创建业务状态，注册清理。
  return {
    getSnapshot() { /* 返回当前声明式快照 */ },
    async execute(commandId, payload) { /* 执行已声明命令 */ },
    async onSettingsChanged(config) { /* 可选 */ },
    async onRead() { /* 可选 */ },
    dispose() { /* 释放计时器等 */ }
  };
}
```

必须是命名导出 `activate`，仅 `export default` 无效。可同步或异步激活。返回实例必须有 `getSnapshot` 和 `dispose`；如果声明命令，还必须实现 `execute`。

生命周期顺序：安装确认或启动恢复 → 激活 → 首次快照 → 命令/设置/已读/主动发布 → 禁用、替换、卸载、退出或故障 → 清理并销毁执行环境。

### 5.2 实例方法

| 方法 | 何时调用 | 作者约定 |
| --- | --- | --- |
| `getSnapshot()` | 激活后、命令后、设置/已读更新后；也可由作者调用构造 publish 数据 | 建议同步、纯读取、无写入和无提醒；不要改变业务状态 |
| `execute(commandId, payload)` | 按钮、表单或管理器命令通过校验后 | 返回普通 JSON 数据或 Promise；不要返回宿主的 `{ok,...}` 包装 |
| `onSettingsChanged(config)` | 宿主设置保存后，含全局偏好变化 | 可重建定时器；允许重复调用，勿重复累加订阅 |
| `onRead()` | 本插件的已读变更保存后 | 无参数；用 `context.isRead(key)` 获取新状态 |
| `dispose()` | 结束本次激活 | 必须可重复调用，快速清理，不依赖最后一次写入 |

外部 Worker 对部分调用会 `await getSnapshot()`，但同步实现最容易测试和复用。不要把内置 Provider 的第三参数 `execute(..., {signal})` 当成外部接口：外部当前只传两个参数，停止信号通过 `context.signal` 取得。

### 5.3 外部 context 完整列表

```ts
interface ExternalPluginContext {
  signal: AbortSignal;
  startedAt: number;
  getConfig(): Record<string, unknown>;
  getPreferences(): { details: boolean };
  isRead(key: string): boolean;
  codex?: {
    subscribe(
      onState: (state: CodexReadState) => void | Promise<void>,
      onEvent?: (event: CodexReadEvent) => void | Promise<void>
    ): Promise<() => void>;
  };
  weather: {
    search(params: { name: string }): Promise<Location[]>;
    forecast(params: { latitude: number; longitude: number }): Promise<Weather>;
  };
  storage: {
    get(key: string): Promise<JsonValue | null>;
    set(key: string, value: JsonValue): Promise<null>;
  };
  publish(snapshot: ContentSnapshot): void;
  emit(event: ReminderEvent): Promise<null>;
  onCleanup(callback: () => void): void;
}
```

Location/Weather 的完整 JSON 字段、输入限制、域名、超时、取消、配额及旧宿主兼容条件见 [天气接口说明](design/weather-plugin.md)。天气接口在 v3.2.2 已支持；早期 v3.2.1 构建不支持，声明 weather.read 的包会被拒绝。

这是说明性类型，不是已发布的可导入 npm 类型包。`JsonValue` 指 JSON 可安全表达的 null、boolean、有限 number、string、数组或普通对象；具体快照和提醒字段见下文。

- `signal`：本次激活的停止信号。销毁前会尝试 abort；强制终止时不能保证回调执行完。
- `startedAt`：本次激活开始时的 Unix 毫秒时间，不是安装时间。
- `getConfig()`：本插件配置的副本，不可通过修改副本保存设置。
- `getPreferences()`：目前只返回 `details`。不能读取专注、锁屏等完整宿主状态，提醒策略由宿主判断。
- `isRead(key)`：本插件已读缓存查询，读状态更新时由宿主同步；不跨插件查询。
- `storage.get/set`：异步窄接口，必须等待结果；无 key 列表、delete、事务或文件路径访问。
- `publish`：主动提交完整快照，不是局部 diff；无返回确认。失败可能由宿主标为“无效页面”，不可认为返回即已渲染。
- `emit`：提交提醒请求；Promise 成功不等于字幕实际显示或用户看过。
- `onCleanup`：登记快速同步清理函数，常用于 `clearInterval`。不要把持久化只放在清理函数。
- `codex`：只在已授权 codex.read 的执行环境提供，唯一操作是异步 subscribe；不能读写任意文件、发起任务或读取账号凭据。详见 5.5。

外部没有 `context.capabilities`、`context.assets`、`context.fail`、`getReadKeys`、文件路径或其他插件身份参数。内置 Provider 的上下文是受信任代码接口的超集，不能直接照搬给外部插件。

### 5.4 并发与停止

宿主避免相同命令的重复并发，但不同命令、设置回调和定时器仍可能交错。涉及同一业务状态的操作建议用队列串行化；失败后恢复队列，不要令一次异常阻塞后续全部操作。

每次成功修改都应先持久化，再发布与返回成功。禁用后重新启用会创建新实例，不保留旧 Worker 内存。dispose 最终只获得很短的尽力清理机会；程序崩溃或强制终止时可能完全没有回调。

### 5.5 Codex 只读订阅（codex.read）

需要含此网关的新宿主构建；同为 API v1 的早期构建没有此能力。源码与可安装包参考 [Codex 清单](../examples/codex-plugin/plugin.json)和 [Provider](../examples/codex-plugin/provider.js)。

```js
export async function activate(context) {
  if (!context.codex) throw new Error('需要已授权 Codex 只读能力的宿主');
  let current = { running: false, connected: false, tasks: [] };
  const snapshot = () => ({
    available: current.running, status: current.connected ? 'ready' : 'waiting',
    pages: current.running ? [{ id: 'limits', title: 'Codex 额度', icon: 'codex',
      blocks: [{ type: 'metric', label: '主窗口', value: current.primary?.remaining ?? null }]
    }] : []
  });
  const release = await context.codex.subscribe(state => {
    current = state;
    context.publish(snapshot());
  });
  context.onCleanup(release);
  return { getSnapshot: snapshot, dispose: release };
}
```

订阅返回 Promise，必须 await；解析后取得幂等的取消函数。每个外部执行实例最多一个 Codex 订阅；多插件订阅共用宿主适配器。禁用、卸载、失败或退出会强制撤销，不依赖作者主动取消。回调必须快速返回，异步回调拒绝或抛错会停止该插件。

`CodexReadState` 为普通 JSON 对象：

- `running`、`connected`：boolean；`allowed`：boolean 或 null。
- `primary`、`secondary`：null 或 `{remaining, minutes, resetsAt}`；remaining 为 0–100 或 null，minutes 为正数或 null，resetsAt 为 ISO/有效时间字符串或 null。
- `updatedAt`：时间字符串或 null；`error`、`taskError`：最多 1000 字符的诊断文字或 null。
- `tasks`：最多 100 项 `{id, name, status, turnStatus}`；id/name 分别最多 200/500 字符，两个状态最多 100 字符。状态未知时必须保留未知，不推测完成。

`CodexReadEvent` 为 `{id, createdAt, text}`，来自原有任务状态适配器；id/text 最多 500/1000 字符，createdAt 为有效时间字符串。事件回调本身不会显示字幕，需再用已授权的 `context.emit` 关联自己的页面和稳定去重 key。

只读字段经过白名单、长度和数量限制，未声明的后台字段不会转发。没有 fetch、RPC 方法名、任务修改、账号信息或其他底层调用口。无可用 CLI/登录/数据时应展示等待或未知；Codex 程序未运行时 `when-available` 菜单隐藏。

旧 `workshop.codex` 的配置和桌宠已读/去重标识兼容复制到外部 ID，旧记录保留；安装确认仍会启用插件，不会绕过权限确认。首次启动仍由适配器抑制历史任务通知。

## 6. 菜单页面与声明式组件

### 6.1 内容快照

<!-- example:snapshot:start -->
```json
{
  "available": true,
  "status": "ready",
  "message": "1 项内容",
  "updatedAt": "2026-10-12T06:00:00.000Z",
  "preferredPageId": "overview",
  "pages": [
    {
      "id": "overview",
      "title": "内容概览",
      "subtitle": "本机数据",
      "icon": "note",
      "readKey": "content:1",
      "blocks": [{"type": "text", "text": "第一条内容", "multiline": true}]
    }
  ]
}
```
<!-- example:snapshot:end -->

| 字段 | 约束 |
| --- | --- |
| `available` | 必须 boolean，控制可用型入口 |
| `status` | 必须为 `waiting`、`ready`、`degraded`、`error` 之一，表示内容状态，不是实例运行状态 |
| `pages` | 必须数组，最多 100 页；可为空，宿主显示等待/错误页 |
| `message` | 可选，最多 4000 字符，主要用于管理器和空页 |
| `updatedAt` | 可选，可被 `Date.parse` 解析的时间字符串，最多 50 字符；建议 UTC ISO |
| `preferredPageId` | 可选，最多 200 字符；必须指向作者提供的页面，首次选页时使用，不强制覆盖用户当前页 |
| `diagnostics` | 可选诊断字段，见 6.4；不是能力授权 |

快照 JSON 字符串和跨进程单条消息各最多 1,048,576 个 JavaScript 字符，不是同等数量的 UTF-8 字节。必须留出协议包装余量，不要把页面堆到上限。所有传输值必须是 JSON 安全数据；不得传函数、BigInt、循环引用、Map、Date 对象、`undefined` 或 NaN。

`id`、`manifest`、`origin`、`enabled`、`runtime`、`epoch`、`revision`、`config`、`grantedPermissions`、`assets`、`unread` 都由宿主生成，不属于作者快照。插件不能伪造这些顶层字段获得权限。

### 6.2 页面与左右分页

每页必需字段：`id`（非空、最多 200 字符、插件内唯一）、`title`（最多 200 字符）、`icon`、`blocks`（最多 100 个顶层块）。可选 `subtitle`（最多 300 字符）和 `readKey`（null 或最多 500 字符字符串）。

必须保持页面 ID 稳定，内容更新不应每次重新生成全部 ID。对于“每条通知一页”，用消息身份作为 `id`，用来源名作为 `title`。对于额度/最近任务，把它们做成两个独立页面，并分别给标题。

宿主负责：

- 标题固定在内容上方；底部左右箭头切换页面，首尾按钮禁用。滚轮仅滚动当前页内容，到边界也不翻页。
- 支持左右方向键与 PageUp/PageDown（输入框编辑时不拦截方向键）；代码返回 navigateTo 使用同一页面定位。未显示页面不接受键盘聚焦。
- 悬停预览、点击固定；表单聚焦自动固定；面板边缘缩放由宿主完成。
- 同 ID 表单刷新时尽力保存草稿和焦点。切换编辑对象必须改变 `form.id`，否则旧草稿可能覆盖新对象的默认值。
- 每页 `readKey` 用于红点和桌宠已读；不写 `unread` 字段，宿主计算它。

### 6.3 组件全集

字段未标为可选时应显式提供。不要依赖校验器暂时宽松的地方，也不要添加自定义 `type`。

| type | 必需字段 | 可选字段 / 说明 |
| --- | --- | --- |
| `text` | `text: string`，最多 4000 字符 | `tone: normal/muted/error`、`strong: boolean`、`multiline: boolean`、`ellipsis: boolean` |
| `group` | `layout: row/column`、`children: Block[]`，最多 50 个 | `appearance`、`contextActions`，见下文；递归深度从顶层 0 开始不得超过 8 |
| `button` | `commandId`、`label`、`icon`、`enabled: boolean`、建议显式 `payload: {}` | label/commandId 各最多 100 字符；`variant: icon/text`、`primary: boolean` |
| `form` | `id` 非空、`commandId`、`submitLabel`、`fields` | id/commandId/submitLabel 各最多 100 字符；`payload: {}`、`enabled: boolean`；最多 12 个字段 |
| `list` | `items: [{label, status}]`，最多 100 项 | label 最多 500、status 最多 100 字符；`emptyText`；item.id 可作作者标识，当前无点击行为 |
| `status` | `icon`、`title`、`description` | title 最多 200、description 最多 4000 字符，适合空状态 |
| `time` | `label` 最多 200 字符、`value: ISO string/null` | null 显示未知；宿主以本机格式显示日期 |
| `progress` | `value: number/null` | 数值范围 0–100，null 表示未知 |
| `metric` | `label` 最多 100 字符、`value: number/null`，0–100 | `resetsAt: ISO string/null`；当前渲染为“百分比剩余”，不是任意数字指标 |
| `timeline` | `id` 最多 200 字符、`positionMs`、`durationMs`、`playing: boolean` | 两个时间必须非负有限 number 或 null；`updatedAt` 可选；仅展示，未开放外部播放器控制或拖动 seek |
| `image` | `icon` 作为回退图标 | `alt`；外部不能上传 asset，使用省略/null asset 的图标回退即可 |

`appearance` 只支持 `default`、`album`、`song-info`、`controls`、`notice`、`notice-top`、`item`、`actions`，主要用于 group。这是宿主样式预设，不是 CSS 类名自由输入口。需要右侧操作时：外层 group 使用 layout=row、appearance=item，第一个子 group 为 column 内容，第二个为 column、appearance=actions 的图标按钮栏；窄面板下仍不挤压覆盖文字。

group 可选 contextActions 为最多 10 个标准 button 块，字段和命令权限规则与普通按钮一致；只允许按钮，禁止任意菜单 HTML。宿主将它们渲染为项目右键菜单，也支持 Shift+F10/菜单键，方向键选择与 Esc 关闭。点击菜单项通过同一 execute 通道执行；点击外部、切页、关闭和内容替换会收起菜单。待办在右侧只声明完成/撤回，其余操作由 contextActions 声明。旧宿主不支持该呈现，需使用本次构建。

文本不会当 HTML 或 Markdown 执行。按钮的 `icon` 变体默认只展示图标，label 用作提示和无障碍名称；`text` 变体同时显示文字。不支持图片 URL、自定义字体、输入框占位字段、富文本编辑器或表格组件。

表单字段规范：

| 字段 | 约束 |
| --- | --- |
| `key` | 与命令参数名一致；匹配 `^[a-zA-Z][a-zA-Z0-9]{0,60}$`，不得为 constructor/prototype；同表单不得重复 |
| `type` | `text`、`textarea`、`datetime` |
| `label` | string，最多 100 字符 |
| `required` | 可选 boolean，推荐在必填标题上设 true |
| `maxLength` | 可选整数 1–4000，主要用于文本输入；不能替代命令校验 |
| `value` | 可选 string，最多 4000 字符；datetime 使用 ISO 时间字符串 |

datetime 使用本机时区输入，提交时转换为 UTC ISO；空输入提交 `""`。提供给命令的文本字段也始终是 string，当前没有 number/boolean/select 表单输入组件。

### 6.4 可选诊断

```ts
diagnostics?: {
  permission?: string; // 最多 100 字符的诊断文字，不是授权结果
  sources?: Array<{id: string; name: string; message?: string}>;
  channels?: Array<{id: string; name: string; message?: string}>;
}
```

两个数组最多各 100 项；id/name 各最多 200，message 最多 1000 字符。诊断仅是内容信息，不能扩大权限。外部没有系统通知读取权限，因此这些字段不会让它加入管理器的系统通知来源控制。

## 7. 命令、表单与返回值

### 7.1 命令清单

```json
{
  "id": "saveTask",
  "permissions": ["storage.own"],
  "fields": {
    "id": {"type": "string", "maxLength": 100},
    "title": {"type": "string", "maxLength": 160},
    "notes": {"type": "string", "maxLength": 1000, "optional": true, "allowEmpty": true},
    "dueAt": {"type": "string", "maxLength": 50, "optional": true, "allowEmpty": true}
  }
}
```

命令 `id` 必须匹配 `^[a-zA-Z][a-zA-Z0-9.-]{0,60}$`，清单内唯一。字段 key 与表单相同命名规则；`fields` 是普通对象，缺省等同空对象。

| 参数 type | 支持的约束 |
| --- | --- |
| `string` | `maxLength` 默认 200；`allowEmpty` 默认 false；空白字符串仍应由业务层 trim 检查 |
| `number` | 必须有限 number；可设置 `min`、`max` |
| `boolean` | 必须真实 boolean，不接受 `"true"` 字符串 |
| 所有类型 | `optional` 表示参数可以不传；`enum` 表示只允许数组中的指定值 |

`null` 不等于“未传”，不能用 null 代替 optional。未知参数会拒绝，而不是静默丢弃。日期、任务存在性、所有权、条目数量等业务条件仍需 Provider 校验。

`permissions` 是插件清单权限的子集；宿主会检查已授权。省略不代表获得额外能力。`managerOnly: true` 可限制只能从角色管理器执行；再提供 `label`，宿主会生成管理器按钮。管理器按钮当前只传 `{}`，不能用它调用有必填参数的命令。

### 7.2 按钮和表单提交

```js
{ type: 'button', commandId: 'complete', payload: { id: 'task-1' },
  label: '标记完成', icon: 'check', enabled: true }
```

button.commandId 和 form.commandId 必须指向已声明命令。表单先复制 `payload`，再用输入字段值覆盖同名 key；例如编辑表单在 payload 放任务 id，在 fields 放 title/notes。

宿主会先做 HTML 表单校验，再做命令字段校验。业务操作成功后仍必须返回/发布符合约束的新快照；仅改 UI 草稿不会写入磁盘。

### 7.3 返回值与导航

插件返回：

```js
return { navigateTo: 'pending', resetForm: true };
```

- `navigateTo`：定位到本插件现存页面 ID；不存在时不导航。
- `resetForm: true`：仅针对本次提交的表单，调用原生 reset，恢复到当前渲染的默认值；并不保证变成空文本。
- 其他 JSON 数据可作为结果，但当前通用 UI 不自动展示这些字段。
- 不需要导航时返回 `null` 即可。

不要返回 `{ok: true, data: ...}`：那是宿主桥接层的包装，插件返回它只会再被套一层。业务失败请 throw；异常细节不会直接暴露给最终用户，菜单显示通用错误。

宿主桥接结果为 `{ok:true,data}` 或 `{ok:false,error:{code,message,retryable}}`。常见 code：`DISABLED`、`UNKNOWN_COMMAND`、`FORBIDDEN`、`INVALID_PARAMS`、`BUSY`、`COMMAND_FAILED`、`CANCELLED`。已读接口另可能返回 `INVALID_READ`、`SAVE_FAILED`。外部插件没有直接调用该桥接对象的权限，列出它们是为了调试宿主结果。

## 8. 设置、存储与版本兼容

### 8.1 设置声明

角色管理器按 `settingsSchema` 自动生成控件；插件通过 `getConfig()` 读取。key 应唯一，使用与命令字段相同的 ASCII 名称规则，作者不得使用 constructor/prototype 等危险键。

```json
[
  {"key":"reminders","type":"boolean","label":"开启提醒","default":true},
  {"key":"intervalSeconds","type":"number","label":"检查间隔（秒）","default":15,"min":5,"max":120},
  {"key":"sortOrder","type":"enum","label":"排序","default":"due","options":["due","created"]},
  {"key":"tags","type":"stringList","label":"标签","default":[],"description":"每行一个标签。"}
]
```

| type | 控件与归一化 |
| --- | --- |
| `boolean` | 开关；非 boolean 回到声明的 default |
| `number` | 数字输入；有限数值按 min/max 裁剪，否则用 default；不自动取整 |
| `enum` | 下拉框；只接受 options 内的值，否则用 default；当前 options 使用字符串作为显示名 |
| `stringList` | 多行输入；保存为 string[]，去重，最多 100 项，每项最多 150 字符 |

必须给有效 `label` 和与类型匹配的 `default`；number 应提供合理边界，enum 的 default 必须在 options 中。当前没有自由文本 string 设置类型，文本编辑应使用菜单 form。`optionSource` 是内置来源列表约定，外部不得依赖它来获取系统数据。

设置由宿主自动保存，不需要插件再存一份。`getConfig()` 不提供 set 功能。宿主全局选项不能由插件写入；全局偏好变化可能触发 `onSettingsChanged`，因此处理函数必须可重复调用。

### 8.2 独立数据存储

```js
const state = await context.storage.get('state'); // 不存在时为 null
await context.storage.set('state', { schemaVersion: 1, items: [] });
```

| 项目 | 约束 |
| --- | --- |
| 身份空间 | 宿主固定绑定插件 ID，不接受作者传另一个 ID |
| key | `^[a-zA-Z][a-zA-Z0-9._-]{0,79}$`，1–80 字符；禁止 constructor/prototype/__proto__ |
| 总配额 | 每个插件 512 KiB，包含宿主 JSON 包装、所有 key 和 value 的 UTF-8 字节 |
| key 数量 | 最多 100 个 |
| 写入 | 逐插件排队、原子文件替换；set 成功后再报告业务成功 |
| 未提供 | remove/delete、listKeys、跨插件读取、数据库、文件句柄、事务 |

写 null 表示存储 null，不是删除 key。不得用 undefined 表示删除。删除业务条目可从自己维护的 items 数组移除后保存整个状态。

存储是本机 JSON，不加密。不要保存密码、令牌或不必要的聊天正文；也不要在提醒文本和发布样例中泄露隐私。菜单中的本插件业务内容不会被全局隐私开关自动删掉，该开关主要约束提醒摘要。

### 8.3 四种版本不要混用

| 版本 | 谁维护 | 意义与当前行为 |
| --- | --- | --- |
| `version` | 插件作者 | 发布版本，建议 SemVer；宿主不做新旧排序，允许同 ID 替换和降级 |
| `apiVersion` | 宿主接口 | 当前只能 1；不兼容包在导入/恢复时不执行 |
| `configVersion` | 插件作者 | 管理器配置结构；保存版本不同则实例不兼容，不自动迁移 |
| 业务数据 `schemaVersion` | 插件作者 | 存在自有 value 内，由插件自行判断和迁移；与宿主文件外层 schema 无关 |

兼容更新建议保持 configVersion，新增有默认值的可选设置；保留旧 key，不突然改变含义。需要破坏性配置迁移时，先协调宿主迁移接口，目前不能只增加 configVersion。

业务数据升级应：读取旧版本 → 识别已知旧结构 → 构造新状态 → 保存成功 → 使用新状态。遇到无法理解的未来版本必须拒绝继续写入，不得重置为空。对数据结构变更，应测试升级和降级失败时原数据仍保留。

### 8.4 卸载、重装与备份

卸载会停止运行、移除注册和菜单，但保留配置、独立数据与包缓存；同 ID 重装可以恢复。当前 UI 没有“删除全部插件数据”的选项，不要把卸载说明写成彻底清除。

默认本机数据目录位于 `%APPDATA%/spine-pet-workshop/`，测试时可能使用隔离目录。维护者排查位置：

```text
userData/
├── feature-settings.json          全局与插件配置，schema v2
├── plugin-read-state.json         已读与提醒去重，schema v1
└── plugins/
    ├── installed.json             外部安装索引
    ├── packages/<hash>.json       已校验清单与入口缓存
    └── data/<sha256(plugin-id)>.json  本插件独立数据
```

这些路径是诊断说明，不是插件 API，也不是长期稳定的文件协议。不得让用户手动改索引接入插件。备份应先退出宿主，再备份完整 userData；替换/降级插件前尤其建议备份。

## 9. 提醒、隐私与已读

### 9.1 提醒请求

<!-- example:event:start -->
```json
{
  "id": "task-due:42",
  "dedupeKey": "task-due:42",
  "createdAt": "2026-10-12T06:00:00.000Z",
  "count": 1,
  "pageId": "pending",
  "readKeys": ["task-42:due-v2"],
  "summary": {
    "private": "有一项待办到期",
    "details": "待办到期\n检查插件接口"
  }
}
```
<!-- example:event:end -->

必需：非空 id/dedupeKey（各最多 500 字符）、createdAt（有效时间字符串，最多 50 字符）、summary.private（最多 500 字符）。可选 details 最多 1000 字符，count 为 1–1000 整数；readKeys 最多 100 个、每个最多 500 字符。pageId 应匹配本插件已有页面。

调用 `await context.emit(event)`。当前事件没有 kind/severity/actions/webhook 等扩展协议，不要伪造插件 ID，宿主会绑定真实身份。

### 9.2 隐私与抑制规则

- 显示模式：外部提醒使用“插件名 · details”，没有 details 时回退 private。
- 隐私模式：固定“插件名 · N 条新提醒”，默认 N 为 1；忽略作者提交的 private 正文，防止内容泄露。
- 字幕关闭、专注模式、锁屏、禁用期间不主动展示。
- 被抑制的提醒仍可能记录去重，不会在退出专注后自动重放。
- emit 成功只是宿主处理请求，并不提供“用户已看到”的投递确认。

### 9.3 已读与页面红点

页面 `readKey` 是内容版本身份，不是页面 ID。建议 `JSON.stringify([业务ID, 业务版本])` 或其他稳定组合。内容不变时不得每轮生成新 key，否则会反复显示红点；有实质新内容时应换 key。

宿主按插件 ID 隔离已读状态。页面稳定可见约 650 ms 后会先本地视为已看；离开菜单/关闭或显式标记时提交持久化。只对当前显示页计算稳定可见时间。带 readKey 的页面会提供“标记桌宠提醒已查看”按钮。

事件 readKeys 必须关联当时存在的页面 readKey；建议先 publish 更新页面，再 emit。关联不存在或已查看的页面时，字幕队列可能立即过滤该事件。全部关联 key 都已读时，宿主不再提醒。没有 readKeys 的事件不跟随页面已读自动撤掉。

桌宠已读仅代表桌宠提醒，不代表微信、QQ 或其他应用内消息已读。`context.isRead(key)` 在启动、设置/已读回调同步的缓存上查询；不要自行编辑宿主已读文件。已读与事件去重记录当前各最多保留全局最近 2000 条，不是无限期日志。

### 9.4 去重与投递语义

`dedupeKey` 在同一插件下重复不会再次弹出；不同业务事件必须使用不同 key。不要只用当前时间生成 key，也不要每次启动给历史事件换 key。

需要跨重启防重复提醒时，建议：

1. 在业务存储中保存任务的已提醒版本和待投递事件（outbox）。
2. 先持久化 outbox，再 publish 对应页面。
3. 用稳定 dedupeKey 调用 emit；成功后将 outbox 标记为已处理并保存。
4. 重启时仅重试未处理 outbox，继续使用原 key。

这提高恢复能力，但不是严格 exactly-once 保证：宿主去重记录异步落盘且有限额，崩溃、记录淘汰或磁盘故障仍可能影响结果。不得把抑制的提醒当成失败后持续重发，否则会打扰用户。

参考独立[待办 Provider](../plugins/todo/provider.js)的 sequence、latestReminder、delivered 与 remindedFor 实现。

## 10. 安全边界与运行预算

### 10.1 执行环境

入口在隐藏 Electron 沙盒窗口中的 Worker 执行，不在 Node 主进程 import/eval。没有 window/document/DOM、Node/Electron、系统文件和 shell；模块加载自宿主提供的 Blob，不是 ZIP 文件目录。

Worker 直接网络及 file URL 请求被 CSP 和会话过滤限制；weather.read 仅由宿主固定服务适配器访问，不改变 CSP；新窗口、导航、下载和浏览器权限拒绝。额外 Worker、SharedWorker、indexedDB、caches、navigator.storage、OffscreenCanvas 被禁用。常用 Date、Math、JSON、Intl、Promise、计时器等可用于纯业务逻辑。

不得修改 Worker 的 onmessage/postMessage 或内部协议，不得依赖宿主预加载对象、Electron IPC、内部 URL 和传输消息格式。这些是实现细节，不是开放接口。

### 10.2 预算与故障

| 项目 | 当前实现 |
| --- | --- |
| 外部启动握手 | 约 4.5 秒超时；宿主激活总等待 5 秒 |
| 外部请求（命令/设置/已读） | 约 7 秒；宿主命令外层等待最多 10 秒 |
| 心跳 | 每 5 秒检查，回应等待 2 秒 |
| 单条传输消息 | 最多 1,048,576 个 JavaScript 字符，包含协议包装 |
| Worker 到宿主消息速率 | 单个执行实例每秒窗口最多 120 条，包含 publish、RPC 和回复 |
| 同时处理的能力 RPC | 最多 32 个 |
| 内存检查 | 心跳时检查渲染进程 working set，超过约 384 MiB 触发停止 |
| 停止 | 立即撤销窄接口；尽力清理后约 60 ms 强制销毁环境 |

这些是当前实现的保护参数，不是业务 SLA。内存检查是周期性检查，不是硬实时配额，瞬时消耗仍可能超出；异步 await 也可能因心跳保持响应而长期挂起。作者必须主动约束任务量和异步等待。

不要 busy loop、每帧 publish、无界积累数组或大量并发 RPC。计时器需设置合理间隔并在 dispose 清理。后台插件只有宿主运行且插件启用时才执行，不是系统计划任务或常驻 Windows 服务。

一个插件超时/出错会被标记，其他插件应继续工作。用户可在管理器重启、禁用或卸载故障插件。无效页面可能显示“插件返回了无效页面数据”，不是自动给予更宽松接口。

### 10.3 信任声明

当前没有发布者签名与市场审核，也没有独立安全审计结论。哈希用于缓存完整性检查，不证明发布者身份。沙盒和预算检查不是绝对安全保证，用户仍只应安装可信来源。

插件 README 必须真实声明读写范围和提醒用途；不得把“私有空间”描述成加密保险箱，不得把“ZIP 导入”描述成官方认证。

## 11. 调试、测试与验收

### 11.1 推荐开发顺序

1. 确定本阶段能力是否足够，选择自己的稳定 ID。
2. 先做一页空状态和一条纯内存命令，验证安装与菜单。
3. 接入 storage，完成写入后再发布，验证重启恢复。
4. 添加 form、设置、分页和提醒，保持标题与页面 ID 稳定。
5. 测试禁用/卸载、配置兼容、异常数据和沙盒限制。
6. 打包 ZIP，在真实宿主导入；完成 README、变更记录和校验值后分发。

作者可在自己控制的测试环境运行已审阅的源码进行纯业务单元测试，但不要在 Node 中直接 import 来路不明的 ZIP 入口。格式校验不执行源码；真正兼容性必须在沙盒宿主验证。

### 11.2 格式校验

打包脚本已自动校验。已有 ZIP 可在宿主源码仓库根目录使用：

```powershell
node --input-type=module -e 'import {readFileSync} from "node:fs"; import {inspectPluginZip} from "./electron/plugins/packages.mjs"; const p=inspectPluginZip(readFileSync(process.argv[1])); console.log({id:p.manifest.id,version:p.manifest.version});' "release/plugins/Quick-Note-v1.0.0.zip"
```

该检查不验证业务逻辑、不验证发布者、不代表代码安全。不要把 inspect 返回的 code 打印到公共日志，也不要把缓存 hash 当作 ZIP 文件 SHA-256；缓存 hash 只基于规范化清单与入口。

### 11.3 仓库回归入口

```powershell
pnpm build
pnpm test:plugins
node --test scripts/test-plugin-documentation.mjs
pnpm test:plugins:sandbox
pnpm test:plugins:codex
pnpm test:plugins:zip-ui
pnpm test:plugins:ui
```

前三项检查构建、通用插件/ZIP 逻辑和本文示例。其余项需要 Electron/Windows 环境，使用隔离演示配置，覆盖通用沙盒、外置 Codex、内置待办与历史菜单回归。**这些脚本不会自动测试你自己的 ZIP**；独立作者需编写自己的测试，并在宿主手动导入自己生成的包。

手册示例测试会提取本文标注的完整清单和入口，验证包格式、快照、表单命令、存储恢复和提醒；示例标记是文档测试锚点，不是 ZIP 包字段。

### 11.4 发布前检查表

- [ ] 不修改宿主注册表、不新增插件 ID 专用菜单分支，也能安装运行。
- [ ] ZIP 根目录有清单，入口单文件，权限和包大小符合限制。
- [ ] 每个按钮/表单的命令已声明，参数类型、长度、可选与空值一致。
- [ ] 页面标题按来源/功能区分，左右分页、页内滚动、缩放和空状态正常。
- [ ] 刷新不丢草稿，编辑不同对象不串草稿，重复点击不会重复写入。
- [ ] 每次成功修改持久化，关闭重开、禁用启用、卸载重装可恢复。
- [ ] 数据上限、损坏数据、未来版本和磁盘错误不导致静默清空。
- [ ] 提醒按业务事件去重，历史内容不因启动重复提示，隐私/专注/锁屏行为符合说明。
- [ ] dispose 可重复调用，定时器不叠加，长任务不阻塞 Worker。
- [ ] 未依赖直接联网、Node、DOM、额外资源目录或未开放系统能力；受控天气需声明 weather.read。
- [ ] README、兼容性、数据保留、许可证和来源信息真实完整。

## 12. 发布与生态接入规范

### 12.1 目前的生态接入方式

当前“接入生态”指采用共同 API、包格式和 UI 规范，在自己的仓库独立开发，通过可信下载源分发 ZIP，用户本机导入。v3.2.3 提供 [GitHub 社区目录](../community/README.md)：作者在自己的 GitHub 发布 ZIP，通过 PR 提交条目，经检查与审核后收录；不会自动安装。详细步骤见[投稿规范](../community/CONTRIBUTING.md)。没有应用内中心市场，也没有官网上传或登记后自动安装的流程。

建议每个插件维护独立仓库：

```text
your-plugin/
├── src/                 作者自己的多文件源码
├── plugin.json
├── README.md
├── CHANGELOG.md
├── LICENSE              作者选择并有权授予的许可
├── tests/
└── dist/provider.js     打包后单文件，entry 指向它
```

源码仓库的目录不限，但 ZIP 必须符合第 3 节。不要把宿主仓库本地绝对路径、账号信息、演示之外的用户数据、node_modules 或配置缓存加入分发包。

### 12.2 README 必须说明的内容

- 插件名称、稳定 ID、版本、作者及可核验的源码/下载地址。
- 支持的宿主构建与 API/包格式版本；开发构建与正式版要区分。
- 功能、界面操作流程、权限申请原因、不开启权限会怎样。
- 数据存储是否本机、是否加密、是否联网、禁用/卸载是否保留。
- 提醒时间、检查频率、程序退出后的行为、隐私模式限制。
- 升级与降级说明，已知问题，问题反馈渠道。
- 代码和第三方依赖/素材的许可证与来源。

API v1 没有正式发布者验证字段；README 的作者声明不等同宿主认证。

### 12.3 发布产物与更新

建议使用 `Your-Plugin-v1.2.0.zip` 文件名，并在发布页面附 SHA-256：

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath "release/plugins/Your-Plugin-v1.2.0.zip"
```

同一个版本不要发布内容不同的 ZIP；更新时升级插件 version、补充变更记录，保持 ID。用户重新导入同 ID 包，核对来源与权限后替换。宿主不自动更新、不做版本新旧排序，也不阻止降级；作者必须说明数据兼容风险。

新编写的计数器示例仅其自身目录使用 MIT 许可，见[示例 LICENSE](../examples/hello-counter-plugin/LICENSE)，可按许可复制修改。该许可不扩展到宿主和其他示例。当前项目 `package.json` 标记 `UNLICENSED`，未授予宿主代码的开源复用许可；本文不改变该状态。开发独立插件、复制待办示例、分发宿主或第三方素材的权限应分别核实。不得因本文公开接口就宣称可以任意复制整个项目或示例。

### 12.4 新能力与扩展协作

需求超出当前能力时，建议向维护者提交：业务目标、最小权限、输入/输出 JSON 示例、隐私边界、取消与超时、资源预算、版本兼容和测试计划。

新能力应先在宿主提供受控适配器，再让插件声明权限调用。不得自行添加通用 exec、任意文件路径、任意 IPC 或网络代理。v3.2.3 的社区收录格式见 [schema.json](../community/schema.json)，它不扩展运行 API。未来可以讨论授权网络域名、插件资源接口、数据迁移、签名、应用内市场、SDK 类型与脚手架；这些仍不属于已开放接口。

维护者处理新组件时应：新增通用契约 → 校验 → 通用渲染 → 声明式示例 → 回归测试 → 更新本手册。不要只让某一个插件特例成功而破坏独立性。

## 13. 常见问题与代码索引

### 13.1 排错表

| 现象 | 检查 / 处理 |
| --- | --- |
| 管理器没有导入按钮 | 使用了正式 v3.1.2 或早期 v3.2.1 包；更新到 ZIP 插件构建 |
| 提示 ZIP 根目录需要清单 | 压缩了整个外层文件夹；让 plugin.json 直接在 ZIP 根目录 |
| 包格式/权限/接口不兼容 | packageType/packageVersion/apiVersion，保留命名空间和外部权限白名单（天气能力需更新后的宿主） |
| 入口找不到或启动失败 | entry 大小写、UTF-8、命名导出 activate、返回方法；检查是否残留多文件/Node 导入或启动超时 |
| 导入成功但不出现入口 | 插件是否启用；when-available 对应 available 是否为 true；错误状态看管理器 |
| 点击无效或无效参数 | 命令是否声明，managerOnly，payload 多传了 key，空 datetime 是否允许 |
| 表单 number/boolean 被拒绝 | 当前表单只传 string；调整命令或在 Provider 校验后转换业务值 |
| 编辑时出现上一个任务草稿 | form.id 未随编辑对象切换；用 task ID 区分表单 |
| 无效页面数据 | 缺必填字段、未知组件/图标、超限、无效时间、外部使用了未注册图片 asset |
| 数据存储失败 | 权限、key 格式、JSON 类型、总配额、磁盘写入或停止后调用 |
| 字幕没有弹出 | 权限、字幕开关、专注/锁屏、dedupeKey 重复、readKeys 已读或没有对应页面 |
| 更新后版本不兼容 | configVersion 与旧配置不同；当前无自动配置迁移，不要手工清空用户文件 |
| 重装没有恢复旧条目 | ID 或用户配置目录不同；业务 schema 变化；卸载默认并未删除数据 |
| 包校验失败且显示隔离状态 | 缓存完整性/清单/API/授权记录不匹配；从可信原始 ZIP 重新导入或卸载；原数据保留 |
| 安装记录无法加载 | 索引格式损坏或未来版本；原文件保留，当前禁止覆盖；备份后由维护者排查，重新导入不一定能直接修复 |

### 13.2 接口依据与参考实现

| 文件 | 用途 |
| --- | --- |
| [contracts.mjs](../electron/plugins/contracts.mjs) | 清单、参数、快照、组件、提醒校验，当前契约依据 |
| [packages.mjs](../electron/plugins/packages.mjs) / [zip.mjs](../electron/plugins/zip.mjs) | 包格式、安装恢复、缓存校验与归档限制 |
| [worker-code.mjs](../electron/plugins/runtime/worker-code.mjs) | 外部 context 与 Worker 生命周期的实际暴露范围 |
| [sandbox-runtime.mjs](../electron/plugins/sandbox-runtime.mjs) | 来源校验、预算、网络限制与执行环境销毁 |
| [host.mjs](../electron/plugins/host.mjs) | 启停、命令、权限、已读、隐私与故障策略 |
| [storage.mjs](../electron/plugins/storage.mjs) / [settings-store.mjs](../electron/plugins/settings-store.mjs) | 独立数据、设置与去重存储 |
| [renderer.ts](../src/plugins/renderer.ts) / [types.ts](../src/plugins/types.ts) | UI 组件渲染与宿主前端类型；不是外部 SDK 类型包 |
| [extensions.ts](../src/extensions.ts) / [settings.ts](../src/features/settings.ts) | 页面、表单、导航与自动生成设置 |
| [待办内置清单](../plugins/todo/plugin.json) / [Provider](../plugins/todo/provider.js) | 保留统一接口与原存储身份的内置业务参考 |
| [Codex ZIP 清单](../examples/codex-plugin/plugin.json) / [Provider](../examples/codex-plugin/provider.js) | 独立包与只读订阅参考；不在内置注册表中 |
| [package-plugin.mjs](../scripts/package-plugin.mjs) | 不执行源码的 ZIP 打包及格式校验 |
| [示例文档测试](../scripts/test-plugin-documentation.mjs) | 本文完整示例的自动检查 |
| [ZIP 验收记录](design/zip-plugin-todo-validation.md) / [架构方案](design/v3.2.1-plugin-architecture.md) | 当前验收与架构背景；历史规划不等于外部已开放能力 |

文档修订记录：1.3.0 新增 cloud 图标、左右分页、group.contextActions 与项目右键菜单。1.2.0 待办内置及右侧操作、Codex 外置与 codex.read 只读订阅，补充身份兼容。1.1.0 新增受控 weather.read 与独立天气插件，保留 Worker 的直接联网限制。1.0.0 为首版公开接口手册。后续接口改动必须同步修改字段说明、完整示例和回归测试。
