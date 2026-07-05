---
id: task-05
title: 端到端验收测试 + 部署（覆盖：AC-01~06）
author: WhaleFall
created_at: 2026-07-01 13:04:17
priority: P0
depends_on: [task-01, task-02, task-03, task-04]
blocks: []
requirement_ids: []
decision_ids: []
allowed_paths: []
goal: >
  全栈测试 + 部署：验证 daemon-client workspace 导入后变更中心显示 changes
  （含 archive）、import 全程 SSE 无 proxy 500。

implementation:
  - backend：spec_workspace + change 模块 pytest 通过；ruff check/format/mypy 过（uv run）
  - daemon：vitest 通过；pnpm bundle 产出新 sillyhub-daemon.js（build/bundle）
  - frontend：pnpm typecheck + lint 通过
  - 部署 backend：cd deploy && docker compose build backend && docker compose up -d backend；
    确认 /daemon/latest.json 分发新 daemon 版本
  - 用户重启本机 daemon（preflight 自更新到新 daemon）

acceptance:
  - AC-01 重启 daemon 后导入，变更中心显示 changes（含 archive）
  - AC-02 import 全程 SSE 阶段进度（packing/apply/reparse_docs/reparse_changes/done），无 proxy 500
  - AC-03 daemon 离线时 SSE 推 HTTP_504_DAEMON_RUNTIME_OFFLINE error 事件并正常关闭（不挂死）
  - AC-04 reparse docs/changes 单阶段失败设 dirty，SSE 流继续到 done
  - AC-05 sync 端点（POST /spec-workspace/sync）上传 tar 后 changes 入 Change 表
  - AC-06 全栈测试 + ruff/format/mypy/typecheck/lint/vitest 全过

verify:
  - cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy app
  - cd backend && uv run pytest app/modules/spec_workspace app/modules/change -q
  - cd sillyhub-daemon && pnpm vitest run && pnpm bundle
  - cd frontend && pnpm typecheck && pnpm lint
  - cd deploy && docker compose build backend && docker compose up -d backend
  - curl http://127.0.0.1:8000/daemon/latest.json（确认新版本号/构建产物）

constraints:
  - daemon 改动需用户重启本机 daemon 才生效（preflight 自更新）
  - 本项目未上线，允许重置开发/测试数据（不要求历史兼容，CLAUDE.md 规则10）
  - commit/push 走 pre-commit hook（backend ruff/mypy + frontend lint/typecheck/test）
  - backend 镜像构建前 daemon bundle 须先产出（additional_contexts: daemon）
---
