# 社区插件目录

这里是 Spine 桌宠工坊的 GitHub 社区入口，无需独立网站。作者在自己的 GitHub 仓库开发和发布插件，向本仓库提交 PR 收录；维护者审核后，用户从下表下载插件 ZIP 并手动导入。

[开发第一个插件](../docs/PLUGIN_QUICKSTART.md) · [完整开发规范](../docs/PLUGIN_DEVELOPMENT.md) · [投稿与更新](CONTRIBUTING.md) · [安装使用手册](../docs/PLUGIN_USAGE.md) · [提交收录申请](https://github.com/xjunrao-ux/spine-pet-workshop/issues/new?template=plugin-submission.yml) · [提出插件点子](https://github.com/xjunrao-ux/spine-pet-workshop/issues/new?template=plugin-idea.yml)

## 可下载插件

<!-- catalog:start -->
| 插件 | 作者 | 分类 | 版本 / 最低宿主 | 权限 | 下载 |
| --- | --- | --- | --- | --- | --- |
| [我的第一个插件](https://github.com/xjunrao-ux/spine-pet-workshop/tree/v3.2.3/examples/hello-counter-plugin)：零权限计数器，点击加一、清零；重启归零。 | [xjunrao-ux](https://github.com/xjunrao-ux) | 学习示例 | 1.0.0 / 3.2.3 | 无 | [ZIP](https://github.com/xjunrao-ux/spine-pet-workshop/releases/download/v3.2.3/Hello-Counter-v1.0.0.zip) · [详情](plugins/com.example.hello-counter.json) |
| [Codex 信息](https://github.com/xjunrao-ux/spine-pet-workshop/tree/v3.2.3/examples/codex-plugin)：只读本机 Codex 额度和最近任务，不创建或修改任务。 | [xjunrao-ux](https://github.com/xjunrao-ux) | 开发工具 | 1.1.0 / 3.2.3 | codex.read、ui.reminders | [ZIP](https://github.com/xjunrao-ux/spine-pet-workshop/releases/download/v3.2.3/Codex-Plugin-v1.1.0.zip) · [详情](plugins/io.spine-workshop.codex.json) |
| [天气与预报](https://github.com/xjunrao-ux/spine-pet-workshop/tree/v3.2.3/examples/weather-plugin)：城市搜索、当前天气、24 小时与 7 天天气预报。 | [xjunrao-ux](https://github.com/xjunrao-ux) | 天气 | 1.1.0 / 3.2.3 | storage.own、weather.read | [ZIP](https://github.com/xjunrao-ux/spine-pet-workshop/releases/download/v3.2.3/Weather-Plugin-v1.1.0.zip) · [详情](plugins/local.spine-weather.json) |
<!-- catalog:end -->

当前首批条目是项目维护的示例与选装插件，尚无第三方投稿。目录不代表独立安全审计或发布者签名认证；核对作者、权限与下载来源后再安装。所有校验值见条目 JSON，计算对象是实际下载 ZIP 的完整字节，不是宿主缓存哈希。

## 如何安装和更新

1. 查看条目的最低宿主版本和权限，下载明确版本的 ZIP 附件。不要下载 GitHub 自动生成的 Source code.zip，不要解压。
2. 打开“角色管理器 → 扩展 → 导入插件 ZIP”，核对名称、ID、版本和权限，确认安装。
3. 在桌宠菜单使用插件；错误原因可在扩展页查看。更新时重新导入同 ID 的新 ZIP，保留配置与数据。
4. 卸载只停止插件、移除入口，保留数据与包缓存。同 ID 重装可恢复持久化数据；计数器示例没有持久化数据。

社区目录的 `minHostVersion` 是人工确认的兼容说明，不是 API v1 新增字段，宿主不会据此自动阻止安装。当前没有在线安装、自动更新、评分系统或账号系统。

## 作者与维护者

- 作者：[按投稿规范](CONTRIBUTING.md)新增一个 `plugins/<id>.json` 并提交 PR；源码无需编进主程序。
- 更新：保持 ID，升级版本并更新下载链接、权限、SHA-256 与说明，重新提交 PR。旧下载版本应保留。
- 不会 PR：填写收录申请 Issue。点子可以先提交需求，等作者认领开发；Issue 本身不会自动变成目录条目。
- 维护者：核实来源和 ID 归属、审阅权限与兼容性；目录校验不执行插件代码，也不自动抓取投稿者 URL。

表格由 `pnpm community:generate` 生成；`pnpm community:check` 检查格式和表格同步。已有下载文件时，运行 `node scripts/community-catalog.mjs --archives release/v3.2.3` 校验 ZIP 摘要与清单一致性。
