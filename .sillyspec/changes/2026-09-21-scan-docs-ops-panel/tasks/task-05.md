---
id: task-05
title: 'module docs increment + regression sweep'
title_zh: '模块文档增量 + 回归验证'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-21 09:58:52
priority: P1
depends_on: ['task-03', 'task-04']
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06, FR-07]
decision_ids: [D-001@v1, D-002@v1, D-003@v1]
allowed_paths:
  - .sillyspec/docs/backend/modules/scan_docs.md
  - .sillyspec/docs/frontend/modules/app-workspace-pages.md
  - NEW:.sillyspec/docs/frontend/modules/scan-docs-stats-panel.md
target_files:
  - .sillyspec/docs/backend/modules/scan_docs.md
  - .sillyspec/docs/frontend/modules/app-workspace-pages.md
  - NEW:.sillyspec/docs/frontend/modules/scan-docs-stats-panel.md
expects_from:
  - task-03: ScanDocsStatsPanel 组件已落地（含双榜 tab/三态）
  - task-04: docs-inject 遥测行已落地（sillyspec 仓）
goal: >
  收尾一致性：同步三份模块文档与实现，跑既有 scan-docs 相关测试确认零回归，
  对照原型复核面板视觉要点。
implementation:
  - .sillyspec/docs/backend/modules/scan_docs.md：契约摘要补 GET /scan-docs/stats 端点 + 注意事项补 stats 口径（两级覆盖率/map 退化/陈旧 null 计入/injection 读 knowledge_hits docs-inject 型）
  - .sillyspec/docs/frontend/modules/app-workspace-pages.md：ScanDocsPage 条目补运营面板挂载行为
  - NEW:.sillyspec/docs/frontend/modules/scan-docs-stats-panel.md：新组件模块卡（定位/契约/数据链/三态，参照 ops-dashboard 对应文档形态）
  - 回归：backend scan_docs 面 + knowledge 面 pytest、frontend scan-docs 页面测试 + 面板组件测试、sillyspec 仓 node test/run-tests.mjs（docs-inject 用例）
  - 原型对照：.sillyspec/changes/2026-09-21-scan-docs-ops-panel/prototype-scan-docs-ops-panel.html 的四子卡/榜布局/陈旧开合要点逐项核对
acceptance:
  - 三份模块文档与实现一致（端点/口径/组件行为无漂移）
  - backend scan_docs + knowledge 测试全绿；frontend scan-docs 页面 + 面板组件测试全绿；sillyspec 仓测试全绿
  - 既有 scan-docs 页面功能（树/搜索/卡片视图/后台同步）零回归
  - 原型要点（四子卡布局/陈旧清单开合/榜单形态）在实现中逐项可对上
verify:
  - cd backend && .venv/Scripts/python.exe -m pytest app/modules/scan_docs/ app/modules/knowledge/tests -q
  - cd frontend && pnpm exec vitest run "src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx" src/components/__tests__/scan-docs-stats-panel.test.tsx
  - cd C:/Users/qinyi/IdeaProjects/sillyspec && node test/run-tests.mjs
constraints:
  - 只改文档与跑测试，不再动源码（源码问题回写对应 task 卡）
  - 文档中文、沿用既有模块卡 frontmatter 格式
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
     implementation/acceptance 里的源码位置同样写仓根相对全路径+行号（src/foo.js）——
                    裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词
                    窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
