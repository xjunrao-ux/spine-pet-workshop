# 天气与预报插件 1.1.0

稳定 ID：`local.spine-weather`。作者：本地 Spine 桌宠工坊天气插件项目。源码：[spine-pet-workshop/examples/weather-plugin](https://github.com/xjunrao-ux/spine-pet-workshop/tree/v3.2.2/examples/weather-plugin)。下载：[v3.2.2 Release](https://github.com/xjunrao-ux/spine-pet-workshop/releases/tag/v3.2.2)。反馈：[GitHub Issues](https://github.com/xjunrao-ux/spine-pet-workshop/issues)。无需天气 API 密钥，无运行时第三方代码依赖。

## 安装与使用

推荐使用 v3.2.2 正式版宿主（支持 `weather.read`、云朵图标及左右分页）；原 v3.2.1 ZIP 插件构建及 v3.1.2 正式版不支持此天气包。包格式 v1、插件 API v1、配置版本 v1。更新宿主后，打开角色管理器 → 扩展 → 导入插件 ZIP，选择 `Weather-Plugin-v1.1.0.zip` 并确认权限。主程序内置注册表无需加入此插件。

悬停桌宠，打开“天气”，在“城市设置”搜索城市（至少 2 个字符，可用拼音/英文）。核对省份、国家后点击“选择”；也可填写名称及 WGS84 经纬度。成功查询后，用右下角左右箭头查看“当前天气”“未来 24 小时”“7 天天气预报”。“刷新天气”可手动更新。角色管理器中可设置摄氏/华氏、自动刷新及刷新间隔（15–180 分钟，默认 30 分钟）。

地点与单位不依赖系统定位。预报时间按返回的地点时区显示；宿主“天气数据时间”和“获取时间”组件按电脑时区显示。没有数据时显示空状态；字段缺测显示“未知”；查询失败保留原缓存并明确提示，超过刷新间隔会标记缓存过期。预报包含当天及后续日期，最多 7 天；小时预报从当前小时开始，最多 24 小时。数据服务返回天数不足时仅展示实际返回的内容。

## 权限与隐私

- `storage.own`：保存所选地点、最近天气缓存和业务版本，仅写本插件的本机空间。未授权不能保存或运行本插件。
- `weather.read`：通过宿主的窄接口搜索城市及查询天气；未授权不能查询或运行本插件。插件本身没有 fetch、Node、文件访问或通用网络代理能力。

请求仅发给 `geocoding-api.open-meteo.com/v1/search` 与 `api.open-meteo.com/v1/forecast`。城市搜索发送输入名称，天气查询发送所选经纬度；服务端可看到请求来源 IP。不会读取聊天、系统通知、Codex 状态或其他插件数据，不自动定位。缓存是本机 JSON，不加密；禁用/卸载保留，重装相同 ID 可恢复。没有字幕提醒、天气警报或系统后台服务；宿主退出/插件禁用后不再刷新。

启用且有地点时每分钟检查是否到刷新间隔；失败后等待设置的刷新间隔再自动重试，也可手动重试。手动重复刷新至少相隔 2 秒。宿主按坐标缓存 10 分钟，搜索缓存 5 分钟，因此刷新可能返回同一获取时间。接口共享上限为 4 个在途请求、每分钟 30 个真实请求、最多 64 项缓存；单请求超时 5 秒，响应上限 256 KiB。

## 数据来源与限制

[Open-Meteo 天气接口](https://open-meteo.com/en/docs)提供天气模型数据，当前天气属于模型估算，预报会更新，不能当作官方灾害预警。城市地理资料来自 [GeoNames](https://www.geonames.org/)，经 [Open-Meteo Geocoding API](https://open-meteo.com/en/docs/geocoding-api) 获取。

天气数据采用 [CC BY 4.0](https://open-meteo.com/en/licence)，应保留 Open-Meteo 来源说明。免费托管接口按其[服务条款](https://open-meteo.com/en/terms)限于非商业用途，并受服务配额/可用性约束。商业发布应先接入符合服务协议的适配器；本插件不存储 API 密钥。部分中文城市名称索引不足，可尝试拼音、英文或经纬度。网络不可达时不承诺能查询成功。

## 升级、降级与开发

同 ID ZIP 替换保留数据和设置；业务结构为 schemaVersion 1。未知版本/损坏缓存会拒绝激活并保留原数据；当前没有自动迁移或清空按钮。更换为没有 weather.read 的旧宿主会拒绝执行此包，需恢复支持的宿主。升级或降级前退出程序并备份完整 userData。

源码独立，provider.js 为单文件 ESM，无其他模块导入。宿主侧天气桥接位于 `electron/plugins/weather-adapter.mjs`。仓库根目录执行：

```powershell
node scripts/package-plugin.mjs examples/weather-plugin release/plugins/Weather-Plugin-v1.1.0.zip
node --test scripts/test-weather-plugin.mjs
pnpm test:weather:sandbox
```

相关实现和验收说明见宿主的 `docs/design/weather-plugin.md`。本地源码提供测试，发布地址见本文开头；发布者签名尚未配置，ZIP 导入不代表官方认证。插件作者需自行维护后续版本，不会自动升级。

## 变更记录与许可证

1.1.0：预报副标题显示所选城市，新增云朵图标；页面通过左右箭头切换，滚轮仅滚动当前页。保持旧 ID、配置版本和缓存结构，导入同 ID 新包可恢复数据。需要包含云朵图标与左右分页的新宿主构建。

1.0.0：首次提供城市搜索、坐标输入、当前天气、24 小时与 7 天预报、自动刷新、缓存和温度单位切换。

以下 MIT 许可仅覆盖本目录新编写的天气插件代码，不授予宿主代码复用权；宿主许可证保持 UNLICENSED，数据来源的条款另行适用。

MIT License — Copyright (c) 2026 Local Spine Weather Plugin contributors

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
