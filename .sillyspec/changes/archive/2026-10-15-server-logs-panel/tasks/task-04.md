---
id: task-04
title: 'Rework server-status page: drop stats card, embed log panel'
title_zh: '页面改造——删业务统计卡+集成日志卡满宽置底+断言更新+聚焦回归'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-15 16:20:11
priority: P0
depends_on: [task-02, task-03]
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-007@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/admin/server-status/page.tsx
  - frontend/src/app/(dashboard)/admin/server-status/__tests__/page.test.tsx
target_files:
  - frontend/src/app/(dashboard)/admin/server-status/page.tsx
  - frontend/src/app/(dashboard)/admin/server-status/__tests__/page.test.tsx
  - .sillyspec/docs/frontend/modules/app-admin-pages.md
  - .sillyspec/docs/frontend/modules/lib-api.md
  - .sillyspec/docs/frontend/modules/lib-health.md
  - .sillyspec/docs/multi-agent-platform/modules/backend.changelog.md
  - .sillyspec/docs/multi-agent-platform/modules/frontend.changelog.md
expects_from:
  task-03:
    - contract: ServerLogPanel
      needs: [组件默认导出]
  task-02:
    - contract: ServerLogsResponse
      needs: [available_files, total_lines]
goal: >
  页面集成：删除业务统计卡（含 StatCell 组件与相关注释）、ServerLogPanel 满宽置底、
  副标题文案更新，page.test.tsx 全用例扫描更新后聚焦回归。
implementation:
  - frontend/src/app/(dashboard)/admin/server-status/page.tsx：删除 StatCell 组件定义（:80 一带）与业务统计 SectionCard（:201-238 一带，含 status.tasks/projects/milestones/users 消费）；文件头注释块（:10-21）同步移除统计卡描述；副标题改「服务器性能、依赖状态与运行日志，每 5 秒自动刷新」；引入 import ServerLogPanel from "@/components/server-log-panel"，在依赖卡后加 <ServerLogPanel />（满宽：依赖卡加 lg:col-span-2 或日志卡自持 col-span-2，按删卡后 grid 视觉平衡选一，与原型一致）
  - frontend/src/app/(dashboard)/admin/server-status/__tests__/page.test.tsx：**全用例扫描**替换统计卡断言——128 四值断言出现在 3 个用例（:91-94、:126、:136-137 一带），全部改为日志卡在场断言（mock @/lib/health 增 getServerLogs 返回 fixture）；文件头注释（:5 一带）同步；STATUS_FIXTURE 中 tasks/projects/milestones/users 字段因类型约束保留（SystemStatusResponse 类型不变）
  - 聚焦回归：后端 test_server_log_filer+test_server_logs_api+test_health、前端 server-log-panel+admin 域、tsc/eslint 全绿
acceptance:
  - 页面无业务统计卡（grep StatCell 零命中于 page.tsx；测试无「128」等四值断言）
  - 日志卡满宽渲染并显示「服务器日志」标题与安全提示
  - 聚焦测试全绿：前端 admin 域（含更新后 page.test.tsx）+ 后端三个日志相关测试文件；tsc 与 eslint 零错
verify:
  - cd frontend && pnpm exec vitest run "src/app/(dashboard)/admin" src/components/__tests__/server-log-panel.test.tsx --no-coverage && pnpm exec tsc --noEmit && pnpm lint
  - cd backend && uv run pytest tests/test_server_log_filer.py tests/test_server_logs_api.py tests/test_health.py -q --no-cov
constraints:
  - STATUS_FIXTURE 类型字段不删（响应结构零变化）；仅删页面消费与断言
  - 不改 menu-permissions/app-shell（无菜单变化）
related_tests:
  - path: frontend/src/app/(dashboard)/admin/server-status/__tests__/page.test.tsx
    reason: 业务统计卡断言（3 用例多值）因删卡失效，全用例扫描同步为日志卡断言
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
