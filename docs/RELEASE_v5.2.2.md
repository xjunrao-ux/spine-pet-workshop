# SpinePet v5.2.2

Windows x64 正式版 · 2026-10-25

修复角色管理器在 Windows 任务栏或窗口标题栏显示 Electron 默认图标的问题。

## 本版变化

- Windows 窗口改用现有多尺寸 ICO，避免直接将 1254×1254 的 PNG 用作大小系统图标。
- 角色管理器显式设置任务栏应用标识与图标路径；ICO 随程序放入独立资源目录，Windows Shell 可直接读取。
- 便携版的任务栏图标与重新启动命令指向外层 EXE，避免固定到临时解包目录。
- 打包检查增加独立 ICO 的内容校验，继续沿用原应用 ID、安装位置及用户数据目录。

## 下载与升级

- 安装版：`SpinePet-Setup-v5.2.2-x64.exe`。v5.2.1 安装版可在“更新与开发”检查更新，下载后点击“重启并安装”。
- 便携版：`SpinePet-Portable-v5.2.2-x64.exe`，退出旧实例后运行新版。
- 五个选装插件及 DSH 桥沿用现有版本；首次使用插件仍需下载 ZIP 并在扩展页导入。
- 附带离线使用说明、SHA256SUMS、latest.yml 与安装包 blockmap。

如果之前固定的是旧 Electron 任务栏快捷方式，可取消固定后从新版重新固定。v5.1.3 及更早版本需手动安装新版；正常升级保留角色、插件及配置。

[完整使用说明](https://github.com/xjunrao-ux/spine-pet-workshop/blob/v5.2.2/docs/versions/v5.2.2.md) · [验证范围](https://github.com/xjunrao-ux/spine-pet-workshop/blob/v5.2.2/docs/VALIDATION_v5.2.2.md)
