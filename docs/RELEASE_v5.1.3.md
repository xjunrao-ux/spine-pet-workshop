# SpinePet v5.1.3

Windows x64 正式版 · 2026-10-23

本版更新宿主的 DeepSeek 对话输入框。点击触发、左右调宽和发送按钮由宿主实现，需要更新安装版或便携版；单独导入插件 ZIP 不会升级这些界面功能。

## 本版变化

- 在“角色管理器 → 扩展 → DeepSeek 对话 → 对话触发与输入框”切换“鼠标悬停 / 点击角色”；默认保留悬停，拖动角色不会误开聊天。
- 输入框左右边缘均可拖动调宽（240–720 px），设置页也提供宽度滑条，自动保存宽度与触发方式。
- 保留左侧手柄移动位置、恢复跟随角色、不透明度、中文输入法、草稿和流式回复；缩放使用独立的请求尺寸，防止窗口在持续刷新中增长。
- 移除输入框最右侧重复的设置按钮，继续使用上方功能菜单的设置入口。
- 发送按钮改为圆形，使用居中的矢量箭头；生成中仍可停止回复。
- DeepSeek 插件更新为 1.1.1，调整使用提示与兼容说明；其他插件和桥组件版本不变。

## 下载与升级

- SpinePet-Setup-v5.1.3-x64.exe：安装版。
- SpinePet-Portable-v5.1.3-x64.exe：便携版。
- DeepSeek-Plugin-v1.1.1.zip：本版配套对话插件；已装 1.1.0 的用户升级宿主后即可使用新的交互设置，重新导入新 ZIP 可更新插件提示。
- Weather-Plugin-v1.2.0.zip、Codex-Plugin-v1.1.0.zip、DSH-Pet-Plugin-v1.1.0.zip、Hello-Counter-v1.0.0.zip：其他可选插件。
- local-dsh-pet-bridge-1.0.0.tgz：可选 DSH 端桥组件，不能作为桌宠 ZIP 导入。
- USAGE-v5.1.3.md、SHA256SUMS.txt：离线使用说明与完整附件校验值。

升级前退出旧实例。继续使用原用户数据目录，保留已有角色、API Key、人设、记忆、对话和设置；主程序不会自动替换已安装的外部插件。

[完整使用说明](https://github.com/xjunrao-ux/spine-pet-workshop/blob/v5.1.3/docs/versions/v5.1.3.md) · [验证范围](https://github.com/xjunrao-ux/spine-pet-workshop/blob/v5.1.3/docs/VALIDATION_v5.1.3.md)
