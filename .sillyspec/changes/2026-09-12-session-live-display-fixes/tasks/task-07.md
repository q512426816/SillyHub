---
id: task-07
title: '三端相关面测试 + lint/typecheck 全绿'
title_zh: '三端相关面测试 + lint/typecheck 全绿'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-13 00:24:41
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-1.1, FR-1.2, FR-1.3, FR-1.4, FR-2.1, FR-2.2, FR-2.3, FR-3.1, FR-3.2, FR-3.3, FR-3.4, FR-4.1, FR-4.2, FR-5.1, FR-5.2]
decision_ids: []
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06]
allowed_paths:
  - frontend/src/components/daemon/
  - sillyhub-daemon/src/model-error/
  - backend/app/modules/daemon/
target_files: []  # 验证任务：无新增改动
goal: >
  task-01 至 task-06 完成后的三端相关面回归门：相关测试 + lint/typecheck 全绿（禁全量测试，规则 0）。
implementation:
  - frontend：pnpm exec vitest run src/components/daemon/__tests__/session-log-assembler.test.ts src/components/daemon/__tests__/runtime-session-helpers.test.tsx；pnpm exec tsc --noEmit。
  - sillyhub-daemon：pnpm exec vitest run tests/model-error/；pnpm typecheck。
  - backend：uv run pytest app/modules/daemon/tests/ -q --no-cov（daemon session 面）+ ruff check/mypy 三处改动文件。
acceptance:
  - 上述相关面测试全部通过；lint/typecheck 零错误。
  - 全局验收第 3 条（brownfield 零回归断言清单）逐项确认。
verify:
  - 各端命令见 implementation（本任务即验证任务）。
constraints:
  - 禁跑全量测试（CLAUDE.md 规则 0）。
  - 发现非本变更引入的旧测试债：按规则 21 惯例顺手修复并记录，不为躲报错回改实现。
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
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
