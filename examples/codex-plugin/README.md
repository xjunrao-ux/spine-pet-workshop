# Codex 信息 ZIP 插件

独立插件 `io.spine-workshop.codex`，版本 1.1.0。只依赖公开 context，无宿主源码导入。需支持 `codex.read` 沙盒订阅的v3.2.2 正式版宿主，早期 ZIP 测试包不支持该权限。

角色管理器 → 扩展 → 导入插件 ZIP → 选择本包 → 确认读取本机 Codex 状态与角色提醒权限。没有导入时不订阅、不显示；本机 Codex 可读取且运行时展示额度和最近任务两页。

禁用/卸载停止订阅；旧内置 Codex 的桌宠已读与去重记录兼容保留。未知数据保持未知，不调用模型，不创建或修改任务，没有直接 Node、系统文件、任意网络与凭据访问。只导入可信来源；尚无签名验证或自动更新。

完整接口见宿主仓库 `docs/PLUGIN_DEVELOPMENT.md`。打包：

```powershell
node scripts/package-plugin.mjs examples/codex-plugin release/plugins/Codex-Plugin-v1.1.0.zip
```
