---
author: flow-machine-draft
created_at: 2026-10-19T11:08:26.361Z
---
# 任务注册表（Tasks）— 2026-10-19-cross-repo-patch-slicing

- [x] task-01: assets/patch-file 端点新增可选 repo 参数（未命中已解析 repos keys 按 note 降级不抛错），切片取 change-patch.json 对应仓 repos[].patch 内联正文，复用既有切片与上限逻辑
- [x] task-02: 资产卡仓段下列出该仓文件清单（后端从 patch 头解析投影，超上限截断标注），点开单文件弹窗看跨仓 diff
- [x] task-03: 后端单测覆盖命中/未知仓/无 repos 三态，前端组件测试覆盖列表与点开弹窗，类型重生成同步
