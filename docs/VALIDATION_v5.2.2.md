# v5.2.2 验证记录

日期：2026-10-25。目标：Windows x64 SpinePet v5.2.2。正式程序从复用的 main 工作区构建，以下记录实际执行结果。

## 自动化与管理器

| 检查 | 结果 |
| --- | --- |
| pnpm test:release | 101 项通过，0 失败 |
| 更新、语音、主题、DeepSeek、DSH、呈现测试 | 55 项通过，0 失败 |
| DSH 桥测试 | 62 项通过；1 项真实 DSH 专项按默认条件跳过 |
| 管理器真实 Electron 回归 | 7 项通过：模型缩略图、角色参数、主题、导入/切换/删除、紧凑布局和状态恢复 |
| 更新页真实 Electron 回归 | 8 项通过：默认语音、插件替换、下载与显式安装触发、设置持久化及紧凑布局 |
| TypeScript 与 Vite | 构建通过 |
| 文档与社区目录 | 本地文档链接通过；五个本次插件附件的身份、权限、固定链接和完整 SHA-256 通过 |

## Windows 原生图标

- 对最终解包 EXE 与便携 EXE 分别启动独立测试实例，通过 WM_GETICON 读取真实窗口图标，通过 SHGetPropertyStoreForWindow 读取任务栏属性。
- 两种程序的 AppUserModelID 均为 local.spine.desktop.pet.workshop；当前 150% 缩放环境下，大小图标分别为 24×24、48×48，内容摘要与现有 ICO 对应图像一致。
- 解包程序任务栏图标指向 resources/spinepet-icon.ico，独立文件与源 ICO 字节一致，可由 Windows Shell 直接读取。
- 便携版任务栏图标指向外层 SpinePet-Portable-v5.2.2-x64.exe；重新启动命令同样指向带引号的外层 EXE，显示名称为 SpinePet，未指向临时解包目录。

## 最终发行包

- NSIS 安装版和便携版构建成功，ProductVersion 均为 5.2.2。
- pnpm test:packaged 通过：60 份运行文件与构建源码一致，包含独立 ICO、内置模型、待办与更新器依赖，排除开发目录及用户资料。
- Test-ReleaseBinaries.ps1 对最终解包管理器、解包模型、便携管理器、便携模型四次隔离启动均通过；截图非空，管理器和角色渲染正常。
- 真实更新器从本机回环测试服务器下载最终 NSIS 安装包并通过 SHA-512；损坏数据被拒绝，不能进入安装状态。
- latest.yml 对应本次安装包的版本、名称和 SHA-512，生成对应 blockmap；发布脚本再次核对后上传。
- 五个选装插件与 DSH 桥保持上一版本的附件内容和版本；本版发布共 12 个自定义附件，摘要以同一 Release 的 SHA256SUMS.txt 为准。

## 证据与边界

测试日志、native-taskbar-icons.json、binary-smoke.json、packaged-contents.json 以及最终截图保留在正式工作区 .local/release-v5.2.2-validation；更新器结果位于 .local/update-transport，管理器和更新页日志也在本版验证目录中。

所有运行检查使用隔离 Profile，没有对个人安装执行安装或卸载，也未修改真实开机启动设置。更新下载与完整性校验已实测，本轮未执行个人安装目录的覆盖升级。已有旧 Electron 固定快捷方式可能需要取消固定后从新版重新固定。
