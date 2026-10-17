# 我的第一个插件：计数器

适用于 Spine 桌宠工坊 v3.2.3 / v3.2.2，插件 API v1，ZIP 包格式 v1。

这是一个教学 demo：点击“加一”更新计数，点击“清零”恢复到零。
使用纯 JavaScript，无第三方依赖，无需编译，不申请权限，不联网，不持久化。
禁用、重启、卸载插件或退出程序后，计数丢失；重新启用从零开始。

## 文件与修改

- `plugin.json`：名称、ID、图标、入口、权限与命令声明。
- `provider.js`：业务逻辑与页面数据。修改文字或按钮后重新打包导入即可。
- `README.md`：使用说明。

演示 ID 为 `com.example.hello-counter`，正式发布自己的插件时请改成稳定且唯一的 ID。
相同 ID 导入会替换已有插件。作者与源码来源：Spine 桌宠工坊仓库中的本示例；
独立发布时请填写自己的作者信息、源码地址、下载地址与变更记录。

本目录新编写示例使用 MIT 许可，可复制修改并保留版权与许可说明；不适用于宿主或其他目录。
完整许可见 [LICENSE](LICENSE)。打包脚本会附带 LICENSE，但运行时仍只加载声明的 JS 入口。

作者：Spine Pet Workshop contributors，维护者 GitHub：xjunrao-ux。
源码：https://github.com/xjunrao-ux/spine-pet-workshop/tree/v3.2.3/examples/hello-counter-plugin
下载：https://github.com/xjunrao-ux/spine-pet-workshop/releases/download/v3.2.3/Hello-Counter-v1.0.0.zip

## 打包

在宿主仓库根目录运行：

```powershell
node scripts/package-plugin.mjs examples/hello-counter-plugin release/plugins/Hello-Counter-v1.0.0.zip
```

## 安装

打开“角色管理器 → 扩展 → 导入插件 ZIP”，选择生成的 ZIP，核对名称、ID 和空权限清单后确认。
在桌宠菜单找到计数器，尝试加一和清零。无需解压 ZIP 或修改主程序。

## 下一步

如需退出后保留计数，在清单声明 `storage.own`，激活时调用
`context.storage.get`，命令中先 `await context.storage.set` 再更新内存。
异步写入还需要串行处理连续点击，避免丢失更新。完整接口见 `docs/PLUGIN_DEVELOPMENT.md`。
