# Spine 桌宠工坊 v3.2.3

Windows x64，2026-10-17。本次打通 GitHub 社区插件投稿与开发入口：不用独立网站，作者通过 PR 提交插件，审核后进入目录，用户下载 ZIP 导入桌宠。

## 下载

| 文件 | 用途 |
| --- | --- |
| Spine-Pet-Workshop-Setup-v3.2.3-x64.exe | Windows x64 安装版 |
| Spine-Pet-Workshop-Portable-v3.2.3-x64.exe | Windows x64 便携版 |
| Hello-Counter-v1.0.0.zip | 零权限计数器教学示例，加一/清零，重启归零 |
| Weather-Plugin-v1.1.0.zip | 选装天气，与 v3.2.2 的插件功能兼容 |
| Codex-Plugin-v1.1.0.zip | 选装 Codex 只读额度和任务信息 |
| SHA256SUMS.txt | 两个 EXE 和三个插件 ZIP 的 SHA-256 |
| USAGE-v3.2.3.md | 下载、升级与操作说明 |

请下载明确命名的 EXE 或插件 ZIP 附件，GitHub 自动生成的 Source code.zip 不是可运行程序或插件安装包。

## 社区入口

- [浏览插件目录](https://github.com/xjunrao-ux/spine-pet-workshop/blob/v3.2.3/community/README.md)：首批收录计数器、天气与 Codex，显示作者、版本、兼容范围、权限和下载地址。
- [手写第一个插件](https://github.com/xjunrao-ux/spine-pet-workshop/blob/v3.2.3/docs/PLUGIN_QUICKSTART.md)：纯 JavaScript，无依赖计数器，可修改按钮后打包导入；示例自身提供 MIT 许可。
- [安装使用手册](https://github.com/xjunrao-ux/spine-pet-workshop/blob/v3.2.3/docs/PLUGIN_USAGE.md)：下载、权限确认、更新、禁用、卸载与排错。
- [开发规范](https://github.com/xjunrao-ux/spine-pet-workshop/blob/v3.2.3/docs/PLUGIN_DEVELOPMENT.md)：实际 API v1、生命周期、声明式组件、存储与受控能力。
- [投稿规范](https://github.com/xjunrao-ux/spine-pet-workshop/blob/v3.2.3/community/CONTRIBUTING.md)：Fork/PR 收录、Issue 申请、作者归属、更新与下架。无需独立网页。

仓库增加收录/点子 Issue 表单、PR 模板、目录 JSON Schema 和自动检查。目录生成脚本从条目生成 README 表格；可选本地 ZIP 检查核对完整 SHA-256、ID、名称、版本、API 和权限，不执行插件代码。

## 安装与升级

退出旧版后运行新版，保留角色、设置和数据。下载计数器 ZIP，在“角色管理器 → 扩展 → 导入插件 ZIP”选择文件、核对权限后安装，再打开桌宠的加号入口。ZIP 不要解压。

宿主和外部插件分别更新；相同 ID 的 ZIP 替换会保留配置和持久化数据。计数器没有持久化状态，重启归零。卸载外部插件保留独立数据和包缓存。

## 范围

本版提供 GitHub 社区目录，软件内仍手动导入 ZIP，没有应用内商店、远程安装、自动更新、评分或发布者签名。目录的最低宿主版本是展示信息，不是 API 新字段；API v1 仍在验证期。

天气服务与非商业使用限制、Codex 只读范围、网易云 SMTC 和系统通知兼容边界沿用 v3.2.2。宿主、Spine Runtime、角色素材和其他示例的许可分别适用；计数器自身的 MIT 许可不改变其他目录许可。
