---
author: flow-machine-draft
created_at: 2026-10-13T04:35:45.436Z
---
# 决策记录（Decisions）— 2026-10-13-editpatch-fullchain

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：响应体积——structuredPatch 大文件可达数十 KB，messages 窗口多条 patch 叠加膨胀。缓解：daemon 侧 64KB all-or-nothing 上限（残缺 JSON 无消费价值）+ 既有 200 段窗口/20MB 预算守门；超限走无 patch 回退不炸。 放弃的方案：(a) backend 用 extra="allow" 泛化透传 daemon 全部新字段——放宽契约面，字段漂移不可见，违背逐字对齐纪律，放弃（仍显式声明）；(b) edit_patch 附着到 tool_use 段——源数据在载体行（tool_result 侧），放 use 段要跨段回填，放弃；(c) 超限截断 JSON 而非整体丢弃——残缺 JSON 必然 parse 失败等价于丢弃但携带幻觉风险，放弃。
