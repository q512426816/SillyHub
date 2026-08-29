---
id: task-05
title: 'gen:types sync + regression wrap-up'
title_zh: 'gen:types 三端同步 + 相关测试回归收口'
author: 'qinyi'
created_at: 2026-08-29 21:47:06
priority: P0
depends_on: [task-01, task-02, task-03, task-04]
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-004@v1]
allowed_paths:
  - backend/openapi.json
  - frontend/src/lib/api-types.ts
  - sillyhub-daemon/src/api-types.ts
expects_from: 'task-02 端点已进 OpenAPI（backend 启动导出或 gen:types 脚本自带导出，按 scripts/gen-api-types.mjs 实际流程）'
goal: >
  用 gen:types 把 SessionUsageRead schema 同步进三端生成物（CLAUDE.md 规则 21：后端 schema 改动必须同 commit 提交生成物），并跑本变更相关测试回归收口。
implementation:
  - cd frontend && pnpm gen:types（生成 src/lib/api-types.ts + backend/openapi.json）
  - cd sillyhub-daemon && pnpm gen:types（生成 src/api-types.ts）
  - 检查生成物 diff 仅含 SessionUsageRead 相关新增（异常漂移单独报告，不顺手改无关）
  - 回归：backend test_session_usage.py + frontend session-usage-bar/session-usage-panel-mount/既有 panel 测试 + tsc
acceptance:
  - AC-05：生成物同步提交，三端相关测试全绿，tsc 0 错
verify:
  - cd frontend && pnpm gen:types && git diff --stat -- src/lib/api-types.ts ../backend/openapi.json
  - cd sillyhub-daemon && pnpm gen:types && git diff --stat -- src/api-types.ts
  - cd backend && uv run pytest -q --no-cov app/modules/daemon/tests/test_session_usage.py
  - cd frontend && pnpm vitest run src/components/daemon/__tests__/session-usage-bar.test.tsx src/components/daemon/__tests__/session-usage-panel-mount.test.tsx
constraints:
  - 只跑本变更相关测试（CLAUDE.md 规则 0，全量留 CI）
  - 不手写生成物内容；生成物漂移异常时停下报告而非强改
  - frontend gen:types 前确认 node_modules 健康（CLAUDE.md 规则 21 坑位）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
