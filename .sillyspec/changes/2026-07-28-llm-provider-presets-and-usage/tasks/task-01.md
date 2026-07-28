---
id: task-01
title: "backend/app/modules/llm_provider/schema.py 加 UsageData（plan_name/extra/is_valid/invalid_message/total/used/remaining/unit，全 Optional）+ UsageResult（success/data:list[UsageData]|None/error:str|None）+ 用量瞬时错误类（对应 5xx）"
title_zh: schema 加用量查询结果与数据结构
author: qinyi
created_at: 2026-07-28 10:37:44
priority: P0
depends_on: []
blocks: [task-02, task-03, task-06]
requirement_ids: [FR-03, FR-04]
decision_ids: [D-005@v1]
allowed_paths:
  - backend/app/modules/llm_provider/schema.py
provides:
  - contract: UsageData
    fields: [plan_name, extra, is_valid, invalid_message, total, used, remaining, unit]
  - contract: UsageResult
    fields: [success, data, error]
expects_from: []
goal: >
  定义用量查询统一返回结构 UsageResult/UsageData 与瞬时错误类，供
  handler/service/router/前端对齐 cc-switch provider.rs:283-315 snake_case 契约。
implementation:
  - 在 FetchModelsResponse 段落后追加 UsageData（8 字段全 Optional：plan_name/extra/is_valid/invalid_message/total/used/remaining/unit），snake_case 对齐 cc-switch provider.rs:283-315。
  - 追加 UsageResult：success:bool / data:list[UsageData]|None / error:str|None（多 tier 走 data 数组）。
  - 追加用量瞬时错误类（如 LlmProviderUsageTransient，沿用现有 AppError 范式），映射 5xx 供 task-03 raise。
  - 复用现有 import（BaseModel），不改既有 LlmProvider*/FetchModels* 字段，brownfield 兼容。
acceptance:
  - UsageData 8 字段全部 Optional，默认 None。
  - UsageResult.data 为 list[UsageData]|None；瞬时错误类存在且映射 5xx。
  - 既有 schema（LlmProvider*/FetchModels*）零改动、import 成功。
verify:
  - cd backend && .venv/Scripts/python.exe -m pytest app/modules/llm_provider/tests/test_schema*.py -q --no-cov
  - cd backend && .venv/Scripts/python.exe -c "from app.modules.llm_provider.schema import UsageResult, UsageData"
constraints:
  - snake_case 对齐 cc-switch，不引入 camelCase 别名。
  - 不加 migration、不改 DB（D-004）。
  - brownfield：新增 DTO 不影响既有端点出参契约。
---
