---
author: flow-machine-draft
created_at: 2026-09-27T15:15:48.346Z
---
# 决策记录（Decisions）— 2026-09-27-thin-affected-modules-from-patch-manifest

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：files 含 CLI 侧冻结的 `.sillyspec/docs/` 交付文档路径（note 声明保留），可能命中文档类模块产生轻微噪声——实测本仓 SillyHub 图无 docs/ 前缀模块，噪声为零，故只滤 `.sillyspec/changes/` 而不扩大滤除面。放弃的方案：直接读 CLI 新三键 `modules[].id`——id 语义绑定 flow 运行仓的项目图，跨仓无意义，且存量件无此键。曾评估并否决「维持单图」：单图选择依赖目录字母序巧合且 Windows 平台失效（实测坐实），多图合并的粗粒度冗余命中（backend/frontend 顶层粗模块与细模块并存）经真实数据冒烟权衡为可接受展示代价，最终落地多图合并（本条为评审 P2 清偿修正——原稿写作时基于「SillyHub 单图已覆盖」的错误前提）。
