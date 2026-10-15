# 符号影响面报告

> tasks.md 内容指纹（生成时）: d321037ebe575b3f——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 新增文件（change-tabs.tsx：DetailTab/visibleTabs/TAB_LABELS/ChangeTabs），**无签名级变更**——仅新增导出，无既有调用点；面板以 `import type` 消费 DetailTab，页面在 task-07 接线。
- task-02: 新增文件（merge-change-timeline.ts 纯函数 + change-unified-timeline.tsx），**无签名级变更**——仅新增导出（mergeChangeTimeline / inferTaskTimeStatus / UnifiedRow / TaskTimeStatus）；消费方 task-05（inferTaskTimeStatus）与 task-06（UnifiedRow）均在任务范围内。
- task-03: **有签名级变更（同模块内闭合，非对外）**：①`change-assets-graph.tsx` 由「资产卡内嵌分区」改为可独立挂载——新增导出 `DEFAULT_CANVAS_HEIGHT`（420）、空态由三态 `return null` 改为分区级显式渲染；受影响调用点仅 2 处：`frontend/src/components/changes/detail/change-assets-card.tsx`（本卡同步改造：移出图谱挂载）与 `frontend/src/components/changes/detail/__tests__/change-assets-graph.test.tsx`（本卡同步适配）——均在任务范围内。②`change-assets-card.tsx` 的 props（workspaceId/changeId/changeKey）与对外导出不变；主查询错误分支由整卡 `return null` 改为分区级说明、分组形态由固定高度内滚改自然高度+5 行+展开全部、在途不渲染归档留档组、归档态归档留档保底渲染——均为**组件内部行为变更**，调用点 `page.tsx`（task-07 接线）与 `page-restore-assets.test.tsx`（task-07 适配）在范围内。
- task-04: 新增文件（change-files-panel.tsx），**无签名级变更**——复用 `ChangeFileTree`（frontend/src/components/change-file-tree.tsx，只读不改）、`ScopeAuditCommandCard`、`QuicklogLinkedCard` 三者既有 props；无既有调用点受影响。
- task-05: 新增文件（change-task-checklist.tsx），**无签名级变更**——消费 task-02 的 `TaskTimeStatus` 契约；不修改后端 `TimelineTask` DTO。
- task-06: **有签名级变更（导出保持、内部抽共享取数）**：`change-usage-card.tsx` 抽出共享取数/格式化（具名 hook 或纯函数），`ChangeUsageCard` 的导出签名与行为 MUST 不变——既有调用点 4 处均不受影响且都在核对面内：`frontend/src/components/changes/quicklog-drawer.tsx`、`frontend/src/components/mobile/mobile-change-detail.tsx`（移动端契约）、`frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx`（task-07 接线）、`frontend/src/components/changes/detail/__tests__/change-usage-card.test.tsx`（本卡同步适配）。`change-stage-actions.tsx` 仅接线层调整（若无需改动则不改），其既有导出与四分支语义保持，调用点 `page.tsx`（task-07）与 `change-stage-actions.test.tsx` 在范围内。
- task-07: **有签名级变更（跨模块契约，硬约束）**：①`frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx` 的具名导出 `isTerminalChange` MUST 原地保留且语义不变——既有调用点 `frontend/src/components/mobile/mobile-change-detail.tsx:66-67`（跨模块，**移动端不在本变更改造面**，故为兼容红线，由 page-tabs.test.tsx 加导出在场断言）。②页面组件结构重写（四面板按 tab 懒挂载；卸载 `ChangeStepTimeline` 与 `ChangeTimelineCard` 挂载）——受影响调用点：`frontend/src/components/changes/detail/change-step-timeline.tsx` 与 `change-timeline-card.tsx` 文件与导出 MUST 保留（移动端 mobile-change-detail.tsx 仍 import 前者）；页面级测试 4 文件（page-tabs 新增；page-restore-assets / page-last-signal / page-team-toggle 适配——实测后两者经 `change-step-timeline` 引用该挂载面）均在本卡 allowed_paths 内。
- task-08: **无签名级变更**：只做归档态收窄与两态空态互斥的页面/面板行为收口（含页头「继续执行」在归档态不渲染、信息栏用量形态、对账入口改指、在途/归档空态互斥），涉及的 `page.tsx` / 概览面板与信息栏 / `change-assets-card.tsx` 均无对外签名或导出变化；承接表核对为文档面动作。
