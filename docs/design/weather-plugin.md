# 受控天气接口与独立 ZIP 插件

> 历史开发记录。v3.2.2 已整理为正式版本，当前行为与验证见 [正式验收](v3.2.2-validation.md) 和 [图文使用说明](../versions/v3.2.md)。

日期：2026-10-12。插件 1.0.0，API v1 扩展能力 `weather.read`。本次以宿主原有 ZIP、声明式 UI、持久存储与生命周期实现为基础，不把天气加入内置注册表、不新增插件 ID 专用分支、不放开 Worker 的网络访问。

## 需求与取舍

旧接口禁止联网，纯 ZIP 无法自动收集天气。选择新增通用的天气领域适配器：宿主承担固定网络访问，插件承担地点选择、查询时机、业务缓存和展示。没有通用 fetch/URL 代理，也没有独立后台进程。现有音乐、通知和 Codex 使用原接口。

## 权限与接口

外部清单可声明 `weather.read`，导入时显示实际的数据共享范围。PluginPackages 检查允许权限，PluginHost/CapabilityBroker 按声明、授权与激活存活状态检查每次调用。Worker 仅暴露：

```ts
context.weather.search({ name: string }): Promise<Location[]>;
context.weather.forecast({ latitude: number, longitude: number }): Promise<Weather>;
```

输入只接受所列字段。名称最多 100 字符、至少 2 个非空白字符；纬度 -90..90、经度 -180..180，均为有限数。最多返回 5 个地点，供用户核对名称、省份和国家。Location 包含 id/name/region/country/latitude/longitude。

Weather 为 JSON：schemaVersion=1、source="Open-Meteo"、fetchedAt（UTC ISO）、timezone（IANA），current 包含 time/temperature/feelsLike/humidity/code/wind/isDay；hourly 数组最多 24 项，包含 time/temperature/rainProbability/code；daily 最多 7 项，包含 time/high/low/rainProbability/wind/code。温度统一摄氏、风速 km/h、概率与湿度百分比；缺测数值为 null。插件自行转换华氏。接口校验字段范围、时间、时区和数组长度后返回，不把原始响应任意透传。

目标固定为 Open-Meteo 的两个 HTTPS 端点，禁止重定向，不发送 Cookie、授权头或任意请求体。5 秒超时，256 KiB 响应上限，最多 4 个并发真实请求、每分钟 30 次请求。搜索缓存 5 分钟，预报缓存 10 分钟，总计最多 64 项。缓存读取也检查激活状态；禁用/停止同步撤销租约、取消在途网络。插件迟到结果按激活与地点版本丢弃。

## 运行与交付

插件路径：[源码](../../examples/weather-plugin/provider.js)、[清单](../../examples/weather-plugin/plugin.json)、[说明与许可证](../../examples/weather-plugin/README.md)。清单使用宿主预置 cloud 图标，无自定义 HTML/CSS/静态资源。页面 ID 稳定为 current/hourly/daily/location。业务状态以一个 state key 存储，schemaVersion=1；成功写入后才改变地点/缓存与发布；未知/损坏结构拒绝覆盖。关闭自动刷新仍允许手动查询与显示缓存。

激活不等待网络；命令启动后台查询并快速返回。每分钟检查自动刷新，失败按刷新间隔退避。城市搜索采用独立短任务，展示候选后用户确认。提供坐标输入以覆盖中文搜索无结果的情况。长期获取失败仍展示缓存并标记，首次查询失败仍保留设置入口。无 ui.reminders 权限，没有天气提醒或灾害预警承诺。

新插件包只有清单、单文件入口、README。旧宿主会因为未知权限拒绝导入，因此使用本次接口的宿主构建，不能把旧 v3.2.1 包称为支持天气接口。老插件无需更改清单和配置版本。宿主版本号暂未改变，发布新的可执行构建由项目维护者按发布流程办理。

## 验证入口

```powershell
node --test scripts/test-weather-plugin.mjs
pnpm test:plugins
node --test scripts/test-plugin-documentation.mjs
pnpm build
pnpm test:weather:sandbox
pnpm test:plugins:sandbox
```

天气单元测试覆盖固定目标/参数白名单、无重定向、权限拒绝、响应大小/数组/缺测、超时与取消、持久缓存、恢复、失败写入、断网保留、地点切换和迟到回包。天气沙盒测试使用隔离 userData 和可控 API 数据，安装真实 ZIP，在真实 Electron Worker 中验证搜索、选择、刷新、恢复和直接联网仍禁止。真实 API 连通性另行探测，网络错误不影响可控测试结论。图形界面人工交互仍需按开发手册的左右分页/页内滚动/表单焦点/窗口缩放检查。

## 来源

[天气 API 文档](https://open-meteo.com/en/docs)、[地理编码文档](https://open-meteo.com/en/docs/geocoding-api)、[数据许可](https://open-meteo.com/en/licence)、[免费接口条款](https://open-meteo.com/en/terms)。当前天气为模型估算；免费托管 API 非商业使用，不含 API 密钥配置。展示中保留 Open-Meteo 来源。

## 本次验收结果（2026-10-12）

- TypeScript 与 Vite 构建通过。
- 天气专项 12 项、文档示例 5 项全部通过；调整前的原插件单元回归 40 项也通过。
- 调整前的原沙盒回归 8 项、天气实际 ZIP/Worker/菜单验收 6 项全部通过；天气测试使用独立 profile，实际用户数据未改动。
- 上海真实 Open-Meteo 请求成功：返回 5 个城市候选、24 项小时预报、7 项每日预报、Asia/Shanghai 时区；记录时间 2026-10-12 17:01（中国标准时间）。
- 已检查当前天气与预报截图，修复城市/温度同行拥挤；通用表单草稿、地点选择、禁用重启与卸载恢复均已验证。人工拖动窗口缩放等未纳入本次自动化交互。
- ZIP：`release/plugins/Weather-Plugin-v1.0.0.zip`，9,640 字节。SHA-256：`f1294f4b1c277cefa1d7074a2f204337f5a4bb5cc0e177de55b30b459f4dc5af`。
- 可复核记录位于本机 `.local/weather-validation/results.json`、`live-api.json`、`weather-current.png`、`weather-forecast.png`；校验值另附 ZIP 同目录 `.sha256` 文件。截图是隔离测试数据，真实 API 探测只记录连通性和长度元数据。

源码已更新并构建，启动根目录 `启动桌宠.cmd` 可使用新接口。现有已安装 EXE 不会因源码修改自动更新；需要新宿主构建后才可导入天气 ZIP。本次没有发布远程版本或替换已安装 EXE。

验收末尾工作区另有并行修改，将待办移入 plugins/todo 并调整 Codex 来源。天气沙盒验收已改为按当前内置注册表检查全部插件，新的注册表下 6 项天气沙盒、12 项天气专项和项目构建再次通过；修正开发手册的待办源码链接后，5 项文档示例也通过。全仓历史回归计数属于调整前的快照，并行迁移的整体回归由该改动负责。


2026-10-13 更新：天气插件 1.1.0 改为所选城市副标题和 cloud 图标，宿主使用左右按钮分页。最新行为与验收见 [分页与右键菜单验收](plugin-navigation-validation.md)，上方 1.0.0 包的校验值仅对应历史产物。
