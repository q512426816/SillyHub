---
id: task-11
title: '/m 会话列表 FAB 让位 + mobile-workspace-header 收紧（FR-09）'
title_zh: '/m 会话列表 FAB 让位 + mobile-workspace-header 收紧（FR-09）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-26 23:19:47
priority: P0
depends_on: [task-02]
blocks: []
requirement_ids: [FR-09]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/app/m/workspaces/[id]/sessions/page.tsx
  - frontend/src/components/mobile/mobile-workspace-header.tsx
  - frontend/src/components/mobile/mobile-workspace-header.test.tsx
  - frontend/src/app/m/workspaces/[id]/sessions/__tests__/page.m-sessions.test.tsx
target_files:
  - frontend/src/app/m/workspaces/[id]/sessions/page.tsx
  - frontend/src/components/mobile/mobile-workspace-header.tsx
goal: >
  治手机端会话列表两处遮挡（截图③）：FAB「+」压最后一行卡片文字——列表末尾加
  FAB 让位留白（净距计算含外壳 pb 叠加，盲区④）；顶部「变更中心/会话」双大按钮
  高度收紧（mobile-workspace-header）。
implementation:
  - sessions/page.tsx：列表容器末尾加底部 spacer（高度 = FAB 52px + 间距 + 既有 bottom-24 偏移口径的净距），滚动到底最后一条完整可见
  - mobile-workspace-header.tsx：双按钮（变更中心/会话）py 高度按 m-app 基座收紧，标题区两行并一行（视宽度）
  - 页面测试更新：FAB 存在性/列表结构断言
acceptance:
  - 滚动到底最后一条会话卡片文字完整可见（spacer 高度断言 + 真机复验）
  - header 双按钮高度下降（类断言），点击行为不变
  - 页面测试套件全绿
verify:
  - cd frontend && pnpm vitest run "src/app/m/workspaces/[id]/sessions/__tests__/page.m-sessions.test.tsx" src/components/mobile/mobile-workspace-header.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - FAB 的点击/导航行为与位置（bottom-24 right-4）不动，只加让位留白
  - 不动会话列表数据逻辑与分组
  - 触摸热区 min-h-[44px] 不可降到 44px 以下（mobile-workspace-header.test.tsx 既有断言 + task-02 触控达标口径，plan 评审 gap-3）
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
