---
author: flow-machine-draft
created_at: 2026-10-19T05:48:59.930Z
---
# 任务注册表（Tasks）— 2026-10-19-knowledge-search-build-switch

- [x] task-01: 新增配置开关（默认开启建库=现行为零变化）；关闭时未建索引工作区首搜不触发建库/嵌入，直接词面降级返回且带 reason=index_not_built，秒回不超时
- [x] task-02: 关闭路径 pytest 单测覆盖（不建库断言+降级语义+reason 字段），指定面全绿
- [x] task-03: known-issues 该条目状态更新为已根治（运维缓解+代码根治双闭环）
- [x] task-04: 跨变更共享 lint 门修复：translate_worker.py:184 补 dict[str, object] 类型标注（他侧 2026-10-19-thinking-zh-translate 已提交代码的 mypy var-annotated 错误阻断全仓 lint 门；验证=mypy app 0 错 + translate 37 测试仍绿 + ruff 双检过）
