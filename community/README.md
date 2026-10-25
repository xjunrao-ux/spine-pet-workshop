# 社区插件目录

这里是 Spine 桌宠工坊的 GitHub 社区入口，无需独立网站。作者在自己的 GitHub 仓库开发和发布插件，向本仓库提交 PR 收录；维护者审核后，用户从下表下载插件 ZIP 并导入。接入更新功能的宿主可在“角色管理器 → 更新与开发”检查已安装插件的新版本，确认后在线更新。

[开发第一个插件](../docs/PLUGIN_QUICKSTART.md) · [完整开发规范](../docs/PLUGIN_DEVELOPMENT.md) · [投稿与更新](CONTRIBUTING.md) · [安装使用手册](../docs/PLUGIN_USAGE.md) · [提交收录申请](https://github.com/xjunrao-ux/spine-pet-workshop/issues/new?template=plugin-submission.yml) · [提出插件点子](https://github.com/xjunrao-ux/spine-pet-workshop/issues/new?template=plugin-idea.yml)

## 可下载插件

<!-- catalog:start -->
| 插件 | 作者 | 分类 | 版本 / 最低宿主 | 权限 | 下载 |
| --- | --- | --- | --- | --- | --- |
| [我的第一个插件](https://github.com/xjunrao-ux/spine-pet-workshop/tree/v5.2.3/examples/hello-counter-plugin)：入门 demo：点击加一或清零，不联网、不保存数据。 | [xjunrao-ux](https://github.com/xjunrao-ux) | 学习示例 | 1.0.0 / 3.2.3 | 无 | [ZIP](https://github.com/xjunrao-ux/spine-pet-workshop/releases/download/v5.2.3/Hello-Counter-v1.0.0.zip) · [详情](plugins/com.example.hello-counter.json) |
| [Codex 信息](https://github.com/xjunrao-ux/spine-pet-workshop/tree/v5.2.3/examples/codex-plugin)：外置 ZIP 插件：显示本机 Codex 额度、重置时间与可读取的任务状态。 | [xjunrao-ux](https://github.com/xjunrao-ux) | 开发工具 | 1.1.0 / 3.2.3 | codex.read、ui.reminders | [ZIP](https://github.com/xjunrao-ux/spine-pet-workshop/releases/download/v5.2.3/Codex-Plugin-v1.1.0.zip) · [详情](plugins/io.spine-workshop.codex.json) |
| [DeepSeek 对话](https://github.com/xjunrao-ux/spine-pet-workshop/tree/v5.2.3/examples/deepseek-plugin)：可按设置悬停或点击桌宠简短聊天，回复通过气泡显示；API、人设和记忆在角色管理器配置。 | [xjunrao-ux](https://github.com/xjunrao-ux) | 其他 | 1.1.1 / 5.1.3 | ai.deepseek、storage.own、ui.reminders | [ZIP](https://github.com/xjunrao-ux/spine-pet-workshop/releases/download/v5.2.3/DeepSeek-Plugin-v1.1.1.zip) · [详情](plugins/io.spine-workshop.deepseek.json) |
| [DSH 会话伙伴](https://github.com/xjunrao-ux/spine-pet-workshop/tree/v5.2.3/examples/dsh-pet-plugin)：连接已有 DSH 会话：流式对话、任务摘要、取消、可选追加指令与回执恢复。连接凭据由宿主隔离保存。 | [xjunrao-ux](https://github.com/xjunrao-ux) | 开发工具 | 1.1.0 / 5.1.2 | net.local、storage.own、ui.reminders | [ZIP](https://github.com/xjunrao-ux/spine-pet-workshop/releases/download/v5.2.3/DSH-Pet-Plugin-v1.1.0.zip) · [详情](plugins/io.spine-workshop.dsh-pet.json) |
| [天气与预报](https://github.com/xjunrao-ux/spine-pet-workshop/tree/v5.2.3/examples/weather-plugin)：选择城市，查看当前天气、未来 24 小时和 7 天天气预报。数据由 Open-Meteo 提供。 | [xjunrao-ux](https://github.com/xjunrao-ux) | 天气 | 1.2.0 / 5.1.2 | storage.own、weather.read | [ZIP](https://github.com/xjunrao-ux/spine-pet-workshop/releases/download/v5.2.3/Weather-Plugin-v1.2.0.zip) · [详情](plugins/local.spine-weather.json) |
<!-- catalog:end -->

当前首批条目是项目维护的示例与选装插件，尚无第三方投稿。目录不代表独立安全审计或发布者签名认证；核对作者、权限与下载来源后再安装。所有校验值见条目 JSON，计算对象是实际下载 ZIP 的完整字节，不是宿主缓存哈希。

## 如何安装和更新

1. 查看条目的最低宿主版本和权限，下载明确版本的 ZIP 附件。不要下载 GitHub 自动生成的 Source code.zip，不要解压。
2. 打开“角色管理器 → 扩展 → 导入插件 ZIP”，核对名称、ID、版本和权限，确认安装。
3. 在桌宠菜单使用插件；错误原因可在扩展页查看。可在“更新与开发”检查已收录插件并确认更新，保留配置、启用状态与数据；也可重新导入同 ID 的新 ZIP。
4. 卸载只停止插件、移除入口，保留数据与包缓存。同 ID 重装可恢复持久化数据；计数器示例没有持久化数据。

社区目录的 `minHostVersion` 是发布元数据，不是 API v1 插件清单字段。在线更新会据此阻止安装不兼容的版本；手动 ZIP 导入仍需用户自行核对。当前仅支持已安装插件的在线检查与确认更新，不提供应用内市场、评分或账号系统。插件不会未经确认自动替换。

## 作者与维护者

- 作者：[按投稿规范](CONTRIBUTING.md)新增一个 `plugins/<id>.json` 并提交 PR；源码无需编进主程序。
- 更新：保持 ID，升级版本并更新下载链接、权限、SHA-256 与说明，重新提交 PR。旧下载版本应保留。
- 不会 PR：填写收录申请 Issue。点子可以先提交需求，等作者认领开发；Issue 本身不会自动变成目录条目。
- 维护者：核实来源和 ID 归属、审阅权限与兼容性；目录校验不执行插件代码，也不自动抓取投稿者 URL。

表格和 [在线更新目录](catalog.json) 由 `pnpm community:generate` 一起生成；`pnpm community:check` 检查格式和生成内容同步。已有下载文件时，运行 `node scripts/community-catalog.mjs --archives release/v3.2.3` 校验 ZIP 摘要与清单一致性。
