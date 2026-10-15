---
id: task-06
title: "Overview panel and sidebar meta panel"
title_zh: "概览面板与右侧信息栏"
author: qinyi
created_at: 2026-10-16 00:25:57
priority: P0
depends_on: [task-01, task-02]
blocks: []
requirement_ids: [FR-01, FR-08]
decision_ids: [D-001@v1, D-006@v1, D-016@v1]
allowed_paths:
  - NEW:frontend/src/components/changes/detail/change-overview-panel.tsx
  - NEW:frontend/src/components/changes/detail/change-overview-side.tsx
  - frontend/src/components/changes/detail/change-usage-card.tsx
  - NEW:frontend/src/components/changes/detail/__tests__/change-overview-panel.test.tsx
  - NEW:frontend/src/components/changes/detail/__tests__/change-overview-side.test.tsx
target_files:
  - NEW:frontend/src/components/changes/detail/change-overview-panel.tsx
  - NEW:frontend/src/components/changes/detail/change-overview-side.tsx
  - frontend/src/components/changes/detail/change-usage-card.tsx
  - NEW:frontend/src/components/changes/detail/__tests__/change-overview-panel.test.tsx
  - NEW:frontend/src/components/changes/detail/__tests__/change-overview-side.test.tsx
expects_from:
  task-02:
    - contract: "UnifiedRow"
      needs: [at, source, stage, tone, title, commitSha, commitTitle]
goal: >
  承载「概览」tab：主区待办卡（有则显）+ 摘要 StatGrid + 最近动态（统一时间线尾部倒序轻量行）；右侧 primer MetaPanel 五组压缩承载基本信息/执行用量/会话/范围对账计数/产出速览，用量取数与既有 ChangeUsageCard 共享（禁双实现）。
implementation:
  - "新建 frontend/src/components/changes/detail/change-overview-panel.tsx：props 含 change / workspaceId / changeId / archived / recentRows（UnifiedRow[]）/ boundSession 与待办相关透传；主区自上而下 = 待办卡（ChangeStageActions 复用，仅 pending_review 命中面板表时渲染；thin/quick/不可审批分支维持既有 null 行为）-> 摘要 StatGrid（在途：当前阶段/任务进度/已用时长/最后信号；归档：需求/决策/改动文件/净增行）-> 最近动态卡（UnifiedRow[] 取尾部 5 条倒序渲染为轻量行：图标 + 标题 + 阶段胶囊 + 时刻；不带阶段筛选 chips、不带合并口径脚注——那两者只属「过程」tab）+「查看全部」入口"
  - "新建 frontend/src/components/changes/detail/change-overview-side.tsx：primer MetaPanel/MetaPanelSection 五组——基本信息（key/类型/创建/负责人）、执行用量、会话（最近 2-3 条 + 打开会话工作台入口）、范围对账（三态计数 + 入口；归档态入口改指「产出 · 归档留档」）、产出速览（计数 + 入口）；窄栏文本一律 truncate + title 悬浮全文"
  - "frontend/src/components/changes/detail/change-usage-card.tsx：抽出共享取数与格式化（现 GET /changes/{cid}/usage 的 useQuery 与 by_model 归纳），供信息栏压缩排版复用——抽为具名 hook 或纯格式化函数，并保持 ChangeUsageCard 导出与行为不变（移动端契约）"
  - "归档态两处自适应契约：信息栏用量区标题「执行用量（合计）」且不提供「按模型明细」展开入口（页头「继续执行」由 task-08 的页面层隐藏）"
  - "测试：frontend/src/components/changes/detail/__tests__/change-overview-panel.test.tsx（在途 vs 归档首屏差异、待办卡显隐、最近动态倒序且不含 chips/脚注）+ frontend/src/components/changes/detail/__tests__/change-overview-side.test.tsx（五组渲染、归档用量形态、入口指向）"
acceptance:
  - "在途态首屏：待办卡（有待办时）在最上，其后摘要 StatGrid 与最近动态；归档态首屏：摘要为成果四格（需求/决策/改动文件/净增行）"
  - "最近动态渲染 <=5 行且为倒序（最新在上）；DOM 中不含阶段筛选 chips 与「合并口径」文案"
  - "右侧信息栏渲染五组；用量区显示 7 项指标且明细展开入口在途态在场、归档态不在场"
  - "ChangeUsageCard 的导出签名与既有行为不变（其既有用例测试全绿），且用量取数只存在一处实现（信息栏通过共享 hook/纯函数消费）"
  - "待办卡无待办时整卡不渲染；thin/quick/不可审批分支仍为 null"
verify:
  - "cd frontend && pnpm exec tsc --noEmit"
  - "cd frontend && pnpm exec vitest run frontend/src/components/changes/detail/__tests__/change-usage-card.test.tsx frontend/src/components/changes/detail/__tests__/change-overview-panel.test.tsx frontend/src/components/changes/detail/__tests__/change-overview-side.test.tsx"
constraints:
  - "MUST NOT 在信息栏另写一份用量取数（双实现漂移红线，D-016 的 Q-4）"
  - "ChangeUsageCard 与 ChangeStageActions 的导出与既有分支语义 MUST 保持（移动端与既有测试钉子）"
  - "信息栏不放执行日志/时间线（那是「过程」tab 的职责）；禁硬编码 hex"
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
