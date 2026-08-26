---
id: task-09
title: Run full regression suite
title_zh: 全量回归测试
author: qinyi
created_at: 2026-08-26 23:43:50
priority: P0
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06, task-07, task-08]
blocks: []
requirement_ids: [NFR-04]
decision_ids: []
allowed_paths:
  - frontend/src/components/daemon/session-panel.tsx
  - frontend/src/components/daemon/session-input-bar.tsx
  - backend/app/modules/daemon/session/service.py
goal: >
  task-01~08 全部落地后跑 backend 与 frontend 全量回归（pytest 覆盖率门槛
  60% + vitest / tsc / lint），确认 /team、附件、草稿既有用例零回归
  （NFR-04），为 task-10 冒烟放行。
implementation:
  - cd backend && uv run pytest -q --cov=app --cov-fail-under=60（local.yaml 全量口径）
  - cd frontend && pnpm test
  - cd frontend && pnpm typecheck
  - cd frontend && pnpm lint
  - 重点核对 /team 拦截剥离回填、附件流、草稿与 session-panel placeholder 既有用例全绿
  - 出现失败先归因到 task-01~08 具体改动，回归修复留在对应 task 的文件范围内
acceptance:
  - backend pytest 全绿且覆盖率不低于 60%（门槛未触发）
  - frontend vitest / typecheck / lint 三项全绿
  - /team、附件、草稿既有用例零回归（plan 全局验收标准 1 与 3 的测试面）
verify:
  - cd backend && uv run pytest -q --cov=app --cov-fail-under=60
  - cd frontend && pnpm test
  - cd frontend && pnpm typecheck
  - cd frontend && pnpm lint
constraints:
  - 只跑测试不改源码；失败修复回归 task 内不动其他 task 文件
related_tests: []
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
