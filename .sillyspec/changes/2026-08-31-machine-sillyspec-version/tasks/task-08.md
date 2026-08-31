---
id: task-08
title: '回归收口——daemon 相关套件 + backend daemon 模块测试 + frontend machine-card 测试全绿；tsc/ruff/mypy/format 0 错（depends_on: task-01, task-02, task-03, task-04, task-05, task-06, task-07）'
title_zh: '回归收口——daemon 相关套件 + backend daemon 模块测试 + frontend machine-card 测试全绿；tsc/ruff/mypy/format 0 错（depends_on: task-01, task-02, task-03, task-04, task-05, task-06, task-07）'
author: 'qinyi'
created_at: 2026-08-31 08:31:16
priority: P0
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06, task-07]
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, NFR-01, NFR-03]
decision_ids: [D-001@v1, D-002@v1]
allowed_paths:
  - sillyhub-daemon/tests/sillyspec-manager.test.ts
  - sillyhub-daemon/tests/daemon-heartbeat-sillyspec.test.ts
  - sillyhub-daemon/tests/protocol-session-contract.test.ts
  - sillyhub-daemon/tests/config.test.ts
  - backend/app/modules/daemon/tests/test_machine_sillyspec.py
  - backend/tests/modules/daemon/test_protocol_session_contract.py
  - frontend/src/components/daemon/__tests__/machine-card-sillyspec.test.tsx
goal: >
  全变更回归收口：按 local.yaml 命令跑三端相关测试套件与静态检查，发现并修复跨 task 集成缝隙；
  为 verify 阶段（integration-critical）准备证据清单。禁止跑全量测试（CI 职责），只跑本变更相关套件。
implementation:
  - daemon：pnpm exec vitest run tests/sillyspec-manager.test.ts tests/daemon-heartbeat-sillyspec.test.ts tests/protocol-session-contract.test.ts tests/config.test.ts tests/daemon-heartbeat-pending.test.ts tests/preflight*.test.ts tests/daemon-selfupdate*.test.ts（相关套件）+ pnpm exec tsc --noEmit + eslint
  - backend：uv run pytest app/modules/daemon/tests -q --no-cov -n auto + tests/modules/daemon/ 契约测试 + uv run ruff check app/modules/daemon && uv run mypy app/modules/daemon && ruff format --check
  - frontend：pnpm exec vitest run src/components/daemon/__tests__/ + pnpm exec tsc --noEmit + eslint 改动文件
  - alembic upgrade head 本地库验证单 head；修复发现的跨 task 缝隙（仅限 allowed_paths 内测试文件与既有 task 产物偏差的最小修补，源码级问题回对应 task 语义修补并记录）
  - 汇总证据（命令+结果）供 verify 阶段引用
acceptance:
  - 三端相关套件全绿；tsc/ruff/mypy/eslint/format 检查 0 错
  - alembic 单 head；无未说明的跳过项
verify:
  - 见 implementation 各命令（逐条留输出证据）
constraints:
  - 禁止全量测试（规则 0：只跑修改相关，全量留给 CI）
  - 禁止为通过而改测试断言语义（规则 9）；测试修补仅限新增字段适配
  - 本 task 不新增源码功能改动；发现源码缺陷回溯修补并注明归属 task
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
