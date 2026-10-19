---
author: flow-machine-draft
created_at: 2026-10-19T05:48:59.930Z
---
# 任务注册表（Tasks）— 2026-10-19-knowledge-search-build-switch

- [x] task-01: 新增配置开关（默认开启建库=现行为零变化）；关闭时未建索引工作区首搜不触发建库/嵌入，直接词面降级返回且带 reason=index_not_built，秒回不超时
- [x] task-02: 关闭路径 pytest 单测覆盖（不建库断言+降级语义+reason 字段），指定面全绿
- [x] task-03: known-issues 该条目状态更新为已根治（运维缓解+代码根治双闭环）
