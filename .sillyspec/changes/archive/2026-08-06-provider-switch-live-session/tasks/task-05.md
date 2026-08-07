---
id: task-05
title: "router and schema return SetDefaultResult structured result"
title_zh: "router 与 schema 返回 SetDefaultResult 结构化结果"
author: WhaleFall
created_at: "2026-08-06 16:40:41"
priority: P1
depends_on: [task-03]
blocks: [task-09]
requirement_ids: [FR-07]
decision_ids: []
allowed_paths:
  - backend/app/modules/llm_provider/router.py
  - backend/app/modules/llm_provider/schema.py
  - backend/app/modules/llm_provider/tests/test_router.py
goal: >
  set 与 unset_default 两端点改为返回结构化 SetDefaultResult，含 switched 布尔加
  affected_sessions 整数加 error 可空字符串，供前端展示切换结果与受影响运行中会话数
  （区分立即生效与等待 turn 边界文案）。覆盖 FR-07，为 task-09 toast 与类型对齐提供契约。
implementation:
  - schema.py 新增 SetDefaultResult（BaseModel 子类）三字段 switched 布尔、affected_sessions 整数、error 默认 None 可空字符串，风格对齐同文件 UsageResult 纯响应 DTO（不加 from_attributes）
  - router.py 第 144 行 set-default 端点 response_model 由 LlmProviderRead 改为 SetDefaultResult，函数体由 task-03 service 返回的 DefaultSwitchResult 按字段名透传构造
  - router.py 第 155 行 unset-default 端点对称改造 response_model 为 SetDefaultResult
  - 新建 tests/test_router.py 覆盖 set-default 与 unset-default 两端点（返回 SetDefaultResult 三字段、鉴权、owner 过滤）
  - gen:types 同步 frontend api-types.ts 与 backend openapi.json 归 task-09（前端任务）统一执行，本 task 不跑（中间 Wave 2-4 task 不依赖 openapi）
acceptance:
  - set-default 与 unset-default 响应体包含 switched、affected_sessions、error 三个字段
  - switched 为布尔、affected_sessions 为整数、error 为字符串或 null
  - 现有 get_current_user 鉴权与 service 内 user_id owner 过滤不破坏，跨用户访问仍 404 或 403 不泄漏
verify:
  - cd backend && uv run --extra dev pytest app/modules/llm_provider/tests/test_router.py 跑绿
constraints:
  - 不改端点路径与 HTTP 方法（仍为 POST 加 path 末段 set-default 与 unset-default）
  - 保持 get_current_user 鉴权与 service 内 user_id owner 过滤（D-008 owner 级，跨用户不泄漏）
  - 不改其它端点（list、create、get、update、delete、fetch-models、usage 一律不动）；SetDefaultResult 仅作响应模型不作请求体
provides:
  - contract: SetDefaultResult
    fields: [switched, affected_sessions, error]
---
