---
id: task-07
title: "Page orchestration — four panels wiring and URL-driven tabs"
title_zh: "页面编排与四面板接线（含移动端契约与原型接线对照）"
author: qinyi
created_at: 2026-10-16 00:25:57
priority: P0
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06]
blocks: []
requirement_ids: [FR-02, FR-03, FR-12, FR-14, FR-15]
decision_ids: [D-002@v1, D-008@v1, D-010@v1, D-011@v1, D-013@v1, D-016@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx
  - NEW:frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-tabs.test.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-last-signal.test.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx
  - frontend/src/components/prototype/change-detail-v2-view.tsx
  - frontend/scripts/prototype-build.mjs
target_files:
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx
  - NEW:frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-tabs.test.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-last-signal.test.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx
goal: >
  本变更的集成点：把 page.tsx 重写为 tab 容器（primer PageHead + 阶段条常驻 + ?tab= 唯一源驱动与钳制 + 四面板按 tab 挂载 + 卸载两时间线挂载），保留页模块对外导出与移动端 9 符号契约，并完成原型接线对照。
implementation:
  - "重写 frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx：保留既有取数（getChange 10s 轮询 + isTerminalChange 终态停轮 + listWorkspaceAgentSessions 近似绑定会话 + 审批 handleGateAction + DetailDeleteAction）与 isTerminalChange 具名导出（原地保留、语义不变：status === \"archived\" || location === \"archive\"）"
  - "页头改 primer PageHead（面包屑 + 标题 + 状态胶囊（原手写徽标 IIFE 收敛为映射）+ 元信息 + 操作），阶段条 ChangeStageHeader 常驻于 tab 栏之上；thin 出身维持轻量流程条替换阶段条（既有语义）"
  - "tab 驱动：以 useSearchParams 读 ?tab= 为唯一源，缺省/非法值/不在 visibleTabs(archived)（如归档态 ?tab=files、切换变更残留值）一律 router.replace 钳回 overview；ChangeTabs 受控接入"
  - "四面板按当前 tab 仅挂载当前面板（懒挂载，避免首屏多余取数）；卸载 ChangeStepTimeline 与 ChangeTimelineCard 的挂载点（文件与导出保留，MUST NOT 删除）；阶段条节点点击 -> 切到「过程」tab 并置阶段筛选"
  - "移动端契约核验：逐符号确认 9 项 import 可解析（含 isTerminalChange 与 PENDING_REVIEW_LABEL），并跑移动端测试绿"
  - "页面级测试：新增 frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-tabs.test.tsx（?tab= 驱动与钳制、归档收窄、面板懒挂载、页模块导出 isTerminalChange 仍在场且语义不变）；改造 frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx（原「两时间线共存」钉子改为「统一时间线挂载 + 两旧卡不再挂载」）；同步适配 page-last-signal / page-team-toggle 的挂载位置断言"
  - "原型接线对照：逐面板以 frontend/src/components/prototype/change-detail-v2-view.tsx（批准稿）为结构基准核对；结构对不齐处停机带截图裁决并留痕，MUST NOT 静默降级；若需改原型源码则重跑 cd frontend && pnpm prototype:build 并复核产物 diff（MUST NOT 手改产物 HTML）"
acceptance:
  - "?tab=assets 深链与刷新停在产出 tab；?tab=不存在 与归档态 ?tab=files 被 replace 钳回概览（URL 与渲染面板一致）；浏览器前进/后退时面板随 URL 回放（URL 为唯一源）；多标签并发切换为「后到者胜」的显式取舍（不引入跨标签同步，非缺陷）"
  - "归档态渲染 3 个 tab（无「文件与对账」）；在途态 4 个；thin 出身同样 4 个且阶段条位置为轻量流程条（thin 页面级断言的 owner 唯一在 task-07）"
  - "首屏只挂载概览面板（其余面板取数在切 tab 前不发生；页面级断言以挂载在场性或 mock 调用次数证明）"
  - "isTerminalChange 从 page.tsx 可导出且语义不变（测试直接断言两态布尔）；移动端 9 符号可解析且 mobile-change-detail 测试全绿"
  - "ChangeStepTimeline 与 ChangeTimelineCard 不再挂载于桌面页，但两文件与导出仍在场；pnpm prototype:build 后 git diff frontend/prototype-dist/ 为空"
verify:
  - "cd frontend && pnpm exec tsc --noEmit"
  - "cd frontend && pnpm exec vitest run frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/ frontend/src/components/changes/detail/__tests__ ../components/mobile/__tests__/mobile-change-detail.test.tsx"
  - "cd frontend && pnpm prototype:build && git -C .. diff --quiet frontend/prototype-dist/ && echo 产物对账通过"
constraints:
  - "MUST NOT 删除 change-step-timeline.tsx / change-timeline-card.tsx / change-usage-card.tsx（「清理死代码」是移动端契约破坏的高危路径）"
  - "MUST NOT 改后端端点/DTO；不改移动端文件；不改变更列表页"
  - "不改审批/派发/门禁业务语义（只换挂载位置与编排）"
  - "禁 tab 内嵌套 tab；禁硬编码 hex；文案中文"
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
