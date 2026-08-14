---
id: task-07
title: remove change_writer create/proxy-create/execute/documents endpoints + references
title_zh: 删除 change_writer create/proxy-create/execute/documents 端点 + 引用清理
author: qinyi
created_at: 2026-08-14 15:46:49
priority: P0
depends_on: []
blocks: [task-09]
requirement_ids: [FR-04b]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/change_writer/router.py
  - backend/app/modules/change_writer/__init__.py
  - backend/app/modules/change_writer/tests/test_router.py
  - backend/app/modules/change_writer/tests/test_proxy.py
provides:
  null:
    fields: []
goal: >
  删除页面下线后无调用方的 change_writer create/proxy-create/execute/documents 端点
  （Grill F-5 清点：前端仅 create-change 页 + lib/changes.ts + 测试 + api-types 引用；
  后端引用全在 change_writer 模块内）。文档模块同步在 task-12。
implementation:
  - backend/app/modules/change_writer/router.py：删除 create / proxy-create / documents/generate /
    documents/batch-generate / execute 五个端点（:34-251，按 plan-review 实测清单）。
  - 清理模块内因此不再被引用的辅助函数/import（proxy.py 的建行逻辑 create_change 相关，若仅被删除
    端点使用则一并删；若被 reparse/其它路径复用则保留并标注）。
  - 删除/改写引用这些端点的既有测试（test_router.py / test_proxy.py 中针对已删端点的用例删除，
    保留仍有效的部分）。
  - 全局搜后端残留引用（router 挂载、main.py include_router、MCP 工具），确保无 dangling import。
  - 注意：前端 api-types.ts / lib/changes.ts 的 createChange/proxyCreateChange/executeChange 删除
    在 task-09（前端去表单），本任务只删后端端点 + 后端引用，前端类型在 task-11 gen:types 收口。
acceptance:
  - 五个端点从 change_writer/router.py 删除，后端无任何指向它们的 import/调用
  - 相关既有测试删除/改写后 pytest 通过（无指向已删端点的失败用例）
  - ruff format + ruff check + mypy 通过
  - backend 全量引用搜索无 create/proxy-create/execute/documents 残留引用（除文档）
verify:
  - cd backend && uv run pytest app/modules/change_writer -q --no-cov
  - cd backend && uv run ruff format --check app/modules/change_writer && uv run ruff check app/modules/change_writer && uv run mypy app/modules/change_writer
  - rg "proxyCreateChange|createChange|executeChange" backend/app （确认无残留）
constraints:
  - 前端对应删除在 task-09，本任务不碰 frontend 源码（api-types.ts 在 task-11 gen:types）
  - 端点删除不留兼容层（未上线，design §9）
  - 若 proxy 建行逻辑被其它路径复用，保留并标注，不整文件删
---
