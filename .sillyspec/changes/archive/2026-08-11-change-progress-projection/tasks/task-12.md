---
id: task-12
title: run module pytest + connect e2e + R-06 local 500 triage
title_zh: 各模块 pytest + connect 联调 + R-06 本机 500 排查
author: qinyi
created_at: 2026-08-11 20:27:34
priority: P0
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06, task-07, task-08, task-09, task-10, task-11]
blocks: []
allowed_paths:
  - backend/app/modules/platform_sync/tests/
  - backend/app/modules/change/tests/
  - local.yaml
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06, FR-07, FR-08]
decision_ids: [D-001@v1, D-002@v1, D-003@v1, D-004@v2, D-005@v1, D-006@v1]
goal: >
  跑 platform_sync 与 change 子模块 pytest 全绿，connect 联调闭环，排查并修复 R-06 本机 platform sync POST 500 根因
implementation:
  - 用 backend/.venv 跑 platform_sync 与 change 子模块全部 pytest（local.yaml test_strategy=module 命中）
  - 用 curl 复现本机 platform sync POST progress 500，抓 FastAPI 堆栈与 request_id 定位根因
  - 区分 500 是 platform_sync 路由或鉴权 bug 还是本机环境问题（DB 迁移未跑、uvicorn 未重载）
  - 修复根因后回归确认 curl 复现无 500，必要时在 allowed_paths 内补 500 回归用例
  - connect 联调用本机 local.yaml：resolve-by-root-path 换发 shpsync_ 写入 platform 段保留注释
  - 验证反查 404、无 WORKSPACE_WRITE 403、断网降级不阻断
  - 验证 workspace A/B 同名 change 不串进度、未上行 fallback 现有值
acceptance:
  - platform_sync 与 change 子模块 pytest 全绿
  - R-06 本机 platform sync POST 500 根因已闭环且 curl 复现无 500
  - connect 换发 workspace-scoped token 写入 local.yaml 保留注释
  - resolve-by-root-path 反查不到 404、无 WORKSPACE_WRITE 403、断网降级不阻断
  - 变更中心 current_stage 显示工具上行权威值覆盖猜值，workspace A/B 同名不串，未上行 fallback
constraints:
  - 修 R-06 根因不绕测试，不修测试来通过
  - 跨仓联调用本机 local.yaml，connect 写入保留注释
  - 新增或修复测试限定在 allowed_paths 内，实现修复仅触及 500 根因最小范围
verify:
  - backend/.venv/Scripts/python.exe -m pytest app/modules/platform_sync/tests -q
  - backend/.venv/Scripts/python.exe -m pytest app/modules/change/tests -q
related_tests: 新增用例落在 backend/app/modules/platform_sync/tests 与 backend/app/modules/change/tests 内，既有测试保持绿
provides: R-06 根因结论与修复、子模块 pytest 全绿证据、connect 联调结果
expects_from: task-01..task-11 交付的实现与迁移已就绪（platform_sync 表与列、token 签发鉴权、enrich join、connect 换发、gen:types）
---
