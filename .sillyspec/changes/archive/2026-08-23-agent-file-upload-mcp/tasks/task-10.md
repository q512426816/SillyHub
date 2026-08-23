---
id: task-10
title: 'sync api types three-way and run full regression'
title_zh: 'gen:types 三端同步 + 全量回归（pytest/vitest/lint）+ l10n 校验'
author: 'qinyi'
created_at: 2026-08-23 09:37:06
priority: P0
depends_on: ['task-01', 'task-02', 'task-03', 'task-04', 'task-05', 'task-06', 'task-07', 'task-08', 'task-09']
blocks: []
requirement_ids: [FR-08]
decision_ids: ['D-008@v1']
allowed_paths:
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
  - sillyhub-daemon/src/api-types.ts
  - backend/tests/test_session_agent_session_id_migration.py
related_tests_note: test_session_agent_session_id_migration.py 的 test_alembic_single_head_chain 钉死 head=20260821130000，本变更前即红（与 task-01 连带修复的 mission_session_id 同模式钉值债）；按 CLAUDE.md「旧测试债顺手修」惯例在 task-10 顺手修为「单 head+walk_revisions 链可达」（execute Wave6 已修）
goal: >
  gen:types 三端同步（新端点 schema 落 openapi.json 与两份 api-types.ts）+ 全仓回归（pytest/vitest/lint）+ l10n 校验，收口 FR-08 兼容性验收
implementation:
  - 'gen:types 前确认前端 node_modules 健康（cd frontend && pnpm exec tsc --version 可跑、.bin 有 shim）；半坏先 pnpm install --force 修复，防假 CSSProperties/缺模块报错误判'
  - 'cd frontend && pnpm gen:types（先经 backend/scripts/dump_openapi.py 刷 openapi.json 再生成）；cd sillyhub-daemon && pnpm gen:types；openapi.json + 两份 api-types.ts 三端一并提交，禁止手写'
  - '全量回归：cd backend && uv run pytest；cd frontend && pnpm test && pnpm lint && pnpm typecheck；cd sillyhub-daemon && pnpm test && pnpm typecheck；backend lint 按仓库现行命令（ruff）'
  - 'l10n 校验：cd backend && uv run pytest tests/core/test_error_message_l10n.py + agent/file_artifacts 用户链路报错含 CJK 用例'
acceptance:
  - 'frontend 与 sillyhub-daemon 两处 pnpm gen:types:check 零漂移（git diff --exit-code）'
  - 'backend pytest、frontend/daemon vitest、两端 typecheck、lint 全绿（既有测试零回归）'
  - 'l10n：file_artifacts 用户链路报错含 CJK 测试通过'
  - 'api-types.ts + openapi.json 三端同步提交（含 /api/agent/file-artifacts 新端点 schema）'
verify:
  - 'cd frontend && pnpm gen:types && pnpm gen:types:check'
  - 'cd sillyhub-daemon && pnpm gen:types:check'
  - 'cd backend && uv run pytest'
  - 'cd frontend && pnpm test && pnpm lint && pnpm typecheck'
  - 'cd sillyhub-daemon && pnpm test && pnpm typecheck'
constraints:
  - 'gen:types 前确认前端 node_modules 健康（pnpm exec tsc --version 可跑）；半坏用 pnpm install --force 修（普通 install 可能命中缓存不修）'
  - '提交 api-types.ts + openapi.json 三端同步，不让类型落后后端形成债；禁止手写 api-types'
  - '旧测试债顺手修不加新债（gen:types 暴露的无关旧债按惯例补字段修好，非测试逻辑有误不改测试语义）；顺手修若触及 allowed_paths 外文件，记入 execute 笔记并同步本卡 allowed_paths'
  - '本任务只动生成产物与测试修复；产品代码问题回流对应 task 修，不在本卡混改'
expects_from:
  task-03:
    - contract: OpenAPI schema
      needs: [/api/agent/file-artifacts 新端点已入 openapi.json]
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
