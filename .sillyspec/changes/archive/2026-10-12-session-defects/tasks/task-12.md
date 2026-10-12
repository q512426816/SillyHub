---
id: task-12
title: 'Final acceptance — related-surface tests all green + ruff/mypy/tsc/vitest lint gates + item-by-item check against the design file list'
title_zh: '收口验收——相关面测试全绿 + ruff/mypy/tsc/vitest lint 门 + 对照 design 文件清单验收'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-12 21:01:59
priority: P0
depends_on: ['task-01', 'task-02', 'task-03', 'task-04', 'task-05', 'task-06', 'task-07', 'task-08', 'task-09', 'task-10', 'task-11']
blocks: []
requirement_ids: [FR-09]
decision_ids: [D-001@v1, D-002@v1]
allowed_paths:
  - backend/app/modules/daemon/tests/test_run_sync_agent_events.py
  - backend/app/modules/daemon/tests/test_close_interactive_run_model_error.py
  - backend/app/modules/daemon/tests/test_close_interactive_run_session_status.py
  - backend/app/modules/daemon/tests/test_auto_recover_failed_turn.py
  - backend/app/modules/daemon/tests/test_auto_recover_integration.py
  - backend/app/modules/daemon/tests/test_auto_resume_chain_limit_hint.py
  - backend/app/modules/daemon/tests/test_auto_resume_integration.py
  - backend/app/modules/daemon/tests/test_agent_session_tasks.py
  - backend/app/modules/daemon/tests/test_session_create_config.py
  - backend/app/modules/daemon/tests/test_inject_session_model.py
  - backend/app/modules/daemon/tests/test_session_recovery.py
  - sillyhub-daemon/tests/event-wire.test.ts
  - sillyhub-daemon/tests/model-error/classifier.test.ts
  - sillyhub-daemon/tests/policy/shell-paths.test.ts
  - sillyhub-daemon/tests/policy/path-utils.test.ts
  - sillyhub-daemon/tests/policy/filesystem-policy.test.ts
  - sillyhub-daemon/tests/interactive/session-manager-write-guard.test.ts
  - frontend/src/components/agent-log/__tests__/normalize.test.ts
  - frontend/src/components/agent-log/__tests__/normalize-dual-path.test.ts
  - frontend/src/components/agent-log/__tests__/run-error-item.test.tsx
target_files: []  # 可选：本 task 计划改动的文件（对账用精确路径清单，格式见下方注释；不填保留 []）
goal: >
  收口验收：本变更相关面测试全绿 + ruff/mypy/tsc/vitest lint 门零 error，对照 design.md 文件变更清单逐文件对账无遗漏，生产实证五模式复现清单逐项留痕。
implementation:
  - 'backend 相关面 pytest（规则 0，按 module 禁全量）：cd backend && uv run pytest app/modules/daemon/tests/test_run_sync_agent_events.py app/modules/daemon/tests/test_close_interactive_run_model_error.py app/modules/daemon/tests/test_close_interactive_run_session_status.py app/modules/daemon/tests/test_auto_recover_failed_turn.py app/modules/daemon/tests/test_auto_recover_integration.py app/modules/daemon/tests/test_auto_resume_chain_limit_hint.py app/modules/daemon/tests/test_auto_resume_integration.py app/modules/daemon/tests/test_agent_session_tasks.py app/modules/daemon/tests/test_session_create_config.py app/modules/daemon/tests/test_inject_session_model.py app/modules/daemon/tests/test_session_recovery.py'
  - 'daemon/frontend vitest 相关文件：cd sillyhub-daemon && pnpm test -- tests/event-wire.test.ts tests/model-error/classifier.test.ts tests/policy tests/interactive/session-manager-write-guard.test.ts；cd frontend && pnpm test -- src/components/agent-log/__tests__/normalize.test.ts src/components/agent-log/__tests__/normalize-dual-path.test.ts src/components/agent-log/__tests__/run-error-item.test.tsx（task-02 新建的 sillyhub-daemon/tests/agent-log/message-coalescer.test.ts 到场后就地纳入）'
  - 'lint 门：cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy app；cd sillyhub-daemon && pnpm typecheck；cd frontend && pnpm lint && pnpm typecheck'
  - '对照 design.md「文件变更清单」逐文件核对交付（含 NEW: 前缀文件在场：message-coalescer.ts 及其测试、docs/sillyspec 两记档），无遗漏'
  - '生产实证五模式复现清单逐项核对并留痕：同毫秒时间戳聚集 / 消息碎片成对 / 任务幽灵成对行 / `-p` flag 误提取 / 相对路径 daemon cwd 误锚（对应 plan.md 全局验收标准 2）'
acceptance:
  - 相关面测试全部绿且未执行全量套件（FR-09）
  - lint 门零 error（backend ruff check + ruff format --check + mypy、sillyhub-daemon typecheck、frontend lint + typecheck）
  - design.md 文件变更清单逐文件对账无遗漏
  - 五模式复现清单逐项留痕（复现用例转绿记录）
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_run_sync_agent_events.py app/modules/daemon/tests/test_close_interactive_run_model_error.py app/modules/daemon/tests/test_close_interactive_run_session_status.py app/modules/daemon/tests/test_auto_recover_failed_turn.py app/modules/daemon/tests/test_auto_recover_integration.py app/modules/daemon/tests/test_auto_resume_chain_limit_hint.py app/modules/daemon/tests/test_auto_resume_integration.py app/modules/daemon/tests/test_agent_session_tasks.py app/modules/daemon/tests/test_session_create_config.py app/modules/daemon/tests/test_inject_session_model.py app/modules/daemon/tests/test_session_recovery.py
  - cd sillyhub-daemon && pnpm test -- tests/event-wire.test.ts tests/model-error/classifier.test.ts tests/policy tests/interactive/session-manager-write-guard.test.ts
  - cd frontend && pnpm test -- src/components/agent-log/__tests__/normalize.test.ts src/components/agent-log/__tests__/normalize-dual-path.test.ts src/components/agent-log/__tests__/run-error-item.test.tsx
  - cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy app
  - cd sillyhub-daemon && pnpm typecheck
  - cd frontend && pnpm lint && pnpm typecheck
constraints:
  - 无源码改动：仅当相关面测试暴露断言失效时改测试（限于 allowed_paths 列出的三个测试目录内文件）；实现 bug 回对应 task 修实现，禁止改测试凑绿（CLAUDE.md 规则 9）
  - 测试规则 0：禁跑全量套件（全量留给 CI）；api-types.ts 已由 task-07 走 pnpm gen:types，本 task 不手写类型
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     target_files 格式（可选，对账用精确文件级意图声明，与 allowed_paths 语义不同）：
                    精确文件路径（仓根相对、正斜杠），当前不存在、将由本 task 新建的文件加
                    NEW: 前缀（如 NEW:src/foo.js）；禁 glob（src/**）、禁目录前缀（src/dir/）、
                    禁绝对路径；无明确文件级意图时保留 [] 占位行不动。
     implementation/acceptance 里的源码位置同样写仓根相对全路径+行号（src/foo.js:123）——
                    裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词
                    窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
