---
author: flow-machine-draft
created_at: 2026-10-17T09:09:32.394Z
---
# 任务注册表（Tasks）— 2026-10-17-dsh-rc2-routing-restore

- [x] task-01: writeDshHome 写三件套（package.json 模板清单 + pnpm-workspace.yaml + 无 compat 的 patch），单测钉三件与「禁 compat」
- [x] task-02: 驱动 set_config_option 模型值 = ["sillyhub","<model>"] JSON 数组串，单测钉板
- [x] task-03: 通知信封拆包兼容两种形状（有 update 键即拆），单测/真机验证回复落库
- [x] task-04: UI 真机一轮：dsh 会话回复正常渲染，模型自答 GLM-5.3-FlashX/智谱
- [x] task-05: typecheck + dsh 相关单测全绿
