---
id: task-05
title: '原型对账与聚焦回归（build 对账 + 后端 compare 用例族 + 前端两测试文件 + lint/typecheck）'
title_zh: '原型对账与聚焦回归（build 对账 + 后端 compare 用例族 + 前端两测试文件 + lint/typecheck）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-16 17:26:11
priority: P1
depends_on: ['task-03', 'task-04']
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-007@v2]
allowed_paths:
  - frontend/src/components/prototype/conflict-sync-states-view.tsx
  - frontend/scripts/prototype-build.mjs
  - frontend/prototype-dist/conflict-sync-states.html
  - .sillyspec/changes/2026-10-16-conflict-full-tree-compare/prototype-conflict-sync-states.html
target_files:
  - frontend/src/components/prototype/conflict-sync-states-view.tsx
  - frontend/scripts/prototype-build.mjs
  - frontend/prototype-dist/conflict-sync-states.html
goal: >
  确认原型产物与源码对账（重编译 git diff 空）并跑本改动面的聚焦回归，作为 verify 前的自检面。
implementation:
  - cd frontend && pnpm prototype:build → git status --porcelain frontend/prototype-dist/ 应为空（产物与源码对账）
  - 若产物有差异：以重编译结果为准，并同步拷贝 frontend/prototype-dist/conflict-sync-states.html 到 .sillyspec/changes/2026-10-16-conflict-full-tree-compare/prototype-conflict-sync-states.html
  - 后端聚焦：cd backend && uv run pytest app/modules/daemon/tests/test_sillyspec_compare.py -q --no-cov（输出重定向 .sillyspec/.runtime/logs/，只回看 tail -n 50）
  - 前端聚焦：cd frontend && pnpm test -- src/components/changes/__tests__/conflict-compare-modal.test.tsx src/components/changes/__tests__/platform-sync-section.test.tsx
  - 本改动面 lint/typecheck：cd frontend && pnpm lint && pnpm exec tsc --noEmit；cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy app
acceptance:
  - pnpm prototype:build 后 frontend/prototype-dist/ 无未提交差异；变更目录产物与 dist 一致
  - 后端 compare 用例族与前端两测试文件全绿（日志文件 tail 证据）
  - 本改动面 lint/typecheck 零告警
verify:
  - cd frontend && pnpm prototype:build && git status --porcelain prototype-dist/
  - cd backend && uv run pytest app/modules/daemon/tests/test_sillyspec_compare.py -q --no-cov
constraints:
  - 禁止跑全量测试（规则 0）；命令输出超 50 行一律重定向落盘只看 tail
  - 禁止手改 prototype-dist 产物 HTML（产物必须来自编译）
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
