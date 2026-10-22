# 桌宠 DSH 设计附件

主文档：[PET_DSH_PLUGIN_DESIGN.md](../../PET_DSH_PLUGIN_DESIGN.md)。设计版本 1.0.0，协议 pet-dsh/1，宿主 v4.2.2。

- manifest.design.json：满足宿主清单格式的设计样例；没有 provider.js，不能安装。实际插件应采用 plugin.json 文件名。
- ui-snapshots.json：9 个状态的标准组件快照；不是截图或运行结果。
- wire-scenarios.json：16 个双端交互场景，含传输调用、宿主回调、wire 包络和待实现断言。
- baseline.json：源码与协议哈希；后续服务改动后重新核对。
- validation-report.json：本次静态检查结果，明确列出未验证范围。

当前导入器整体授权 manifest.permissions，提醒功能可关闭但不是单独可选授权项。服务当前不支持 interaction.answer、persona.update、pet.tools，界面不得声称可用。

在仓库根目录运行 node scripts/build-pet-dsh-design.mjs，可重建附件并校验清单、快照、参数、wire 样例和打包完整性。使用已有 Ajv 8 依赖，不访问网络、不启动 DSH、不发送任务。不能把静态检查当作客户端实现与端到端验收。
