---
id: task-06
title: '变更详情页重排（checks 横条/时间线主线/MetaPanel 右栏）+ 测试同步'
title_zh: '变更详情页重排（checks 横条/时间线主线/MetaPanel 右栏）+ 测试同步'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-27 00:40:13
priority: P0
depends_on: ['task-04']
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-001@v1, D-003@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/
  - frontend/src/components/changes/detail/
target_files:
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx
related_tests:
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-last-signal.test.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx
expects_from:
  task-04:
    needs: [Timeline, TimelineItem, MetaPanel, MetaPanelSection]
  task-02:
    needs: [StateLabel]
goal: >
  变更详情页从步骤条+10+ 异构卡片流重排为 PR 详情页结构：六阶段 checks 横条 +
  左主列时间线 + 右侧 296px MetaPanel 六组，信息字段零丢失。
implementation:
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx（551 行）重排：页头（标题+状态 StateLabel+key mono+操作组）→ 六阶段 checks 横条（改造 frontend/src/components/changes/detail/change-stage-header.tsx:159：六段图标+名称+状态，当前段高亮，可点筛选承接 FR-auto-frontend-013 阶段-时间线联动）→ 左主列 Timeline（change-step-timeline 事件流迁移为 TimelineItem；Agent 执行日志内嵌 children 可折叠）→ 右栏 MetaPanel 六组（负责人/消耗统计/变更文件/关联会话/关联快速任务/观测事件——收敛 change-assets-card:606、change-sessions-card、quicklog 关联、change-events-card 六卡入 MetaPanelSection）
  - 沉淀资产卡挂载保留（FR-auto-frontend-019 承接）；thin/quick 徽章口径保留（FR-auto-frontend-020 承接，StateLabel variant=attention iconName=zap）
  - 同步修 [cid]/__tests__/ 三份测试 + detail/ 涉及组件测试（change-stage-header/change-step-timeline/change-assets-card 等，改断言不改意图）
acceptance:
  - DOM 对照原型「变更详情」视图：checks 横条+时间线主线+MetaPanel 右栏三区
  - 六阶段可点联动时间线过滤；时间线日志块可折叠
  - 次线五卡信息字段全部在 MetaPanel 六组内可见（字段对照清单核对）；既有测试改断言后全绿
verify:
  - cd frontend && pnpm vitest run "src/app/(dashboard)/workspaces/[id]/changes/[cid]" src/components/changes/detail
  - cd frontend && pnpm typecheck
constraints:
  - 不改数据层（轮询/接口调用零改动）；detail/ 未涉及组件零改动（R-06 页面锚定）
  - 移动端 mobile-change-detail 零波及
  - 删除操作保持既有 Modal（FR-auto-frontend-014 承接）
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
