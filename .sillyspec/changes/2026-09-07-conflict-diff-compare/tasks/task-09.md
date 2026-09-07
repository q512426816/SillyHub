---
id: task-09
title: '三端本变更测试与类型检查全跑'
title_zh: '三端本变更测试与类型检查全跑'
author: 'qinyi'
created_at: 2026-09-07 13:53:21
priority: P0
depends_on: ['task-02', 'task-04', 'task-07', 'task-08']
blocks: []
requirement_ids: []
decision_ids: []
allowed_paths:
  - backend/app/modules/daemon/tests/test_sillyspec_compare.py
  - sillyhub-daemon/tests/sillyspec-conflict-snapshot.test.ts
  - frontend/src/components/changes/__tests__/conflict-compare-modal.test.tsx
  - frontend/src/components/changes/__tests__/platform-sync-section.test.tsx
target_files: []  # 可选：本 task 计划改动的文件（对账用精确路径清单，格式见下方注释；不填保留 []）
goal: >
  跑通本变更三端新增与适配的全部相关测试及两端 tsc 类型检查，确认 Wave 1-3 实现无回归，为 task-10 实机集成验收提供绿灯前置。
implementation:
  - backend 跑 compare 端点测试（权限/白名单/504/diff/截断/ql_id 透传用例）
  - daemon 跑快照 RPC 测试（conflictSnapshot/ql_id/截断/防逃逸用例）
  - frontend 跑弹窗新测与行改造适配测两个文件
  - frontend 与 daemon 各跑一次 tsc --noEmit 类型检查
  - 任一失败先归因（本变更缺陷或预存债），本变更缺陷回修对应实现 task 后重跑
acceptance:
  - 三端本变更相关测试全部通过（pytest 单文件 + vitest 两批零失败）
  - frontend 与 daemon 的 tsc --noEmit 均退出码 0
  - 仅跑本变更相关测试，未触发三端全量（全量留 CI）
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_sillyspec_compare.py -q
  - cd sillyhub-daemon && pnpm exec vitest run tests/sillyspec-conflict-snapshot.test.ts
  - cd frontend && pnpm exec vitest run src/components/changes/__tests__/conflict-compare-modal.test.tsx src/components/changes/__tests__/platform-sync-section.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
  - cd sillyhub-daemon && pnpm exec tsc --noEmit
constraints:
  - 仅跑本变更相关测试文件，禁全量 pytest/vitest（CLAUDE.md 规则 0，全量留 CI）
  - 本 task 不改任何源码与测试代码，发现缺陷回退对应实现 task 修复
  - 不修改 local.yaml 的 known_failures 豁免清单
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
