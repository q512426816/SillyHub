---
author: flow-machine-draft
created_at: 2026-09-26T07:11:14.105Z
---
# 决策记录（Decisions）— 2026-09-26-assets-testfile-path-resolve

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：短路径后缀匹配救错文件——同 basename 的测试文件在仓库多个模块存在且都非 `.sillyspec/.runtime/` 前缀时（如 frontend 与 backend 各一个同名测试），后缀匹配多命中已降级为候选列表由用户选，不自动猜；唯一后缀命中才自动救回，且救回时弹窗明示真实路径 + 原记录路径，用户可察觉错配。试过但放弃：①直接修归档件 test-trace.json 的路径数据——放弃，审计件 sha256 锚定链会被破坏，且同类短路径在其它归档变更可能重复出现，逐个修数据不如展示层统一兜底；②后端 assets 聚合时归一——放弃，后端容器无真实仓库文件系统，探测必须走 daemon RPC，等价于把解析搬到后端但多一跳契约变化，收益不成比例。搜索端点按文件名子串匹配（RPC 60s 超时）大仓性能由 explorer 既有实现承载，本变更只新增弹窗打开时的一次调用。
