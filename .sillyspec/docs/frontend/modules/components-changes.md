---
schema_version: 1
doc_type: module-card
module_id: components-changes
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 变更中心组件（components-changes）

## 定位
变更中心组件群：`changes/` 顶层 4 件（会话区块 / quicklog 表 / quicklog 抽屉 / 列表徽章）+
`changes/detail/` 9 张详情页卡片（左主右辅布局的拆分产物）+ 根级 3 件（change-file-tree /
stage-team-config / team-progress）。派生脉络：2026-08-11-change-detail-layout-rework
（详情页重做，page.tsx 1119→484 行拆 8 组件）、ql-20260811-002（侧栏宽内容卡挤崩修复）、
2026-08-14-change-center-conversation-driven（会话驱动化翻转：详情页退化成展示板+审批）、
2026-08-15-change-step-visibility（step 级可见性）。执行控制按钮已全删，变更由 agent 在
会话里经 sillyspec 驱动。

## 契约摘要
### changes/detail/（9 卡，左主右辅）
- `ChangeStageHeader`（change-stage-header.tsx）：主线顶部 5 阶段步骤条
  （brainstorm/plan/execute/verify/archive）；导出 `WORKFLOW_STAGES` /
  `WORKFLOW_STAGE_LABELS`（中文标签，多处复用）；非线性三态（quick/blocked/archived）
  或未知阶段（indexOf<0）返回 null，由 PageHeader 徽标承载。
- `ChangeStepTimeline`（change-step-timeline.tsx）：步骤时间线明细。
  - 类型 `StepTimelineEntry` 取自 api-types（pnpm gen:types 生成，禁止手写）。
  - 后端 _extract_step_progress 已归一：entries 顺序即展示顺序（组件不再排序）；
    completed_at 已归一 ISO 8601 UTC。
  - 七值状态色映射 DOT_CLASS（completed 绿/in-progress 蓝闪/pending 灰/waiting 琥珀/
    failed 红/blocked·stale 橙），未知值按 pending 灰兜底；kind 区分 step/event（履历）。
- `ChangeStageActions`（change-stage-actions.tsx）：详情页**唯一操作区**——审批卡。
  - `APPROVAL_PANELS` 按 gate（proposal_review / plan_review / human_test /
    archive_confirm）映射按钮文案与 action；archive_confirm 无打回项。
  - 走 `submitStageReview` 单端点透传 notify_session；据响应 notified_session /
    notify_error 展示三类降级提示（turn_conflict / session_inactive / 其它）。
  - 纯受控组件：不调 lib API，state/handler 由 page.tsx 注入。
- `ChangeTaskBoardCard`（change-task-board-card.tsx）：任务看板摘要（总进度条 + 各状态
  计数 + 「查看看板」Link）；taskBoard 为空或 columns 空 → 返回 null 自动隐藏（快速修复类）。
- `ChangeReviewHistoryCard`（change-review-history-card.tsx）：读
  `change.stages.review_history`（后端四个 gate 端点 + rerun_stage 真实写入处）。
  - 两种异构形状：gate `{decision, comment, submitted_at, ...}` 与 rerun
    `{action, stage, comment, at}`，经 `normalizeReviewHistory` 归一为
    ReviewHistoryItem（kind/label/tone/comment/at）后消费。
  - 替代读已废弃 change_reviews 死表的旧卡（旧卡对新变更永远空）。
- `ChangeSessionsCard`（change-sessions-card.tsx）：侧栏紧凑入口卡 → 宽 Dialog
  （max-w-6xl × 85vh）内渲染完整 ChangeSessionSection；Dialog 仅 open 时 mount。
- `ChangeFilesCard`（change-files-card.tsx）：同上模式包 ChangeFileTree。
- `ChangeAgentRunLog`（change-agent-run-log.tsx）：智能体运行状态简化视图
  （AgentStepProgress 内嵌）+ TeamProgress 组合；ql-20260816-001 后 steps 链路退役，
  步骤明细统一走 ChangeStepTimeline，本卡只留运行态/刷新。
- `QuicklogLinkedCard`（quicklog-linked-card.tsx）：按 linked_change=changeKey 反查关联
  快速任务（useQuery，page_size 20，含空壳占位——进行中关联 quick 任务可见，
  ql-20260820-008-fcb7）；只读、点击跳快速修复 tab；拉取失败静默隐藏区块。
### changes/ 顶层（4 件）
- `ChangeSessionSection`（change-session-section.tsx）：变更上下文内嵌会话区块。
  - 左 `SessionListLayout` + 右 `InteractiveSessionPanel`（与 runtimes 弹窗同源）。
  - 选中历史会话 → attachSessionId + initialTurns（logsToTurns）恢复；ended/failed
    会话先 `reopenSession` 转 reconnecting/active 再 attach（F-1/C-3：panel 轮询仅识别
    active/failed，ended 直接 attach 卡超时）；未选 → idle 新建，createSession 带
    change_id/workspace_id。
  - providers/model 来源 = listDaemonRuntimes；SUPPORTED_SESSION_PROVIDERS =
    ["claude", "codex"]。
- `QuicklogTable`（quicklog-table.tsx）：快速任务列表。DataTable + 状态 Select 筛选 +
  `keepPreviousData`；STATUS_META 4 态（completed 已完成 / in_progress 进行中 /
  partial_done 已暂存 / stale 疑似中断）。空壳占位默认显示（showPlaceholder 默认勾选，
  取消=收窄筛选、空态文案按收窄口径，ql-20260820-008-fcb7）——进行中 quick 会话 CLI
  只落「(quick 任务)」占位标题，默认隐藏会话全程不可见。
- `QuicklogDrawer`（quicklog-drawer.tsx）：条目详情抽屉（antd Drawer）。四段正文固定
  顺序（需求/根因/方案/结果，BODY_ORDER）+ 文件括注清单 + 关联变更链接 + 「原始 md」
  Switch 直出 raw_block；缺失字段逐项优雅降级。
- `ChangeStepBadge`（change-step-badge.tsx）：列表页徽章。stage 主行 = StatusBadge +
  STAGE_KIND/STAGE_LABELS（两常量导出供列表页复用）；stepProgress 非空且 step_total>0
  追加副行：三态标记 + 64px 迷你进度条 + "step x/y · 当前步名"。
### 根级（3 件）
- `ChangeFileTree`（change-file-tree.tsx）：变更文件树 + 内容区。
  - 预览三模：.md → MarkdownPreview（复用统一 sanitize 插件 markdownRehypePlugins）/
    .html·htm → iframe / 其他纯文本 → 只读源码。
  - 保存链路 SaveStatus 五态（idle/saving/done/pending/failed）；数据走 lib/change-files
    （buildChangeFileTree / listChangeFiles / listPendingChangeFiles / get·save content）。
- `StageTeamConfig`（stage-team-config.tsx）：execute/verify 的 worker 预设编辑。
  - 输出 `StageWorkerPreset[] = { profile_id?, objective, role }`（onWorkersChange，
    2026-08-12 起 worker/主 agent 均选档案，去 agent_type/model）。
  - STAGE_DEFAULT_ROLE/OBJECTIVE 按 stage 给默认；ROLE_OPTIONS 7 值
    （impl/verify/test/arch/code_style/integration/risk）。
- `TeamProgress`（team-progress.tsx）：只读 mission 进度三块——主 agent 决策日志
  （orchestrator_log）/ worker 列表（紫系样式对齐 mission-console）/ CostBar
  （cost_so_far/budget_usd）；按 ACTIVE_STATUS（planning/running/degraded）控轮询；
  与 mission-console 的区别：不带创建表单，供 stage/会话内嵌。

## 关键逻辑
- 侧栏宽内容卡模式（容器断点陷阱的正解）：
  ```
  <section>标题 + 说明 + <Button onClick={() => setOpen(true)}>打开</Button></section>
  {open && <Dialog className="max-w-6xl h-[85vh]"> <完整宽组件/> </Dialog>}   // 惰性 mount
  ```
- 审批流：按钮 → action（APPROVAL_PANELS 映射）→ page.tsx → submitStageReview
  （notify_session）→ 响应驱动三类降级提示。

## 注意事项
- **容器断点陷阱（关键）**：`md:` 是视口断点非容器断点——侧栏 320px 内禁止内嵌带
  `md:grid-cols-*` 两栏的宽组件（ChangeSessionSection 的 `md:grid-cols-[230px_1fr]`、
  ChangeFileTree 预览），一律走入口卡 + 宽 Dialog 模式（change-sessions-card.tsx:20-21
  代码注释为证；桌面视口下 320px 容器仍强制两栏 → 面板挤到 ~80px 不可用）。
- Dialog 内容仅 open 时 mount（radix Portal 惰性），关闭即卸载——勿把数据请求/SSE
  提升到入口卡层，保持零空载请求。
- `ChangeStageActions` 是唯一操作区：推进/重新派发/验证门禁/选档案/团队配置按钮已随
  会话驱动化删除，勿复活执行控制（quick 由 agent 在会话跑 sillyspec run quick）。
- `ChangeStepTimeline`：completed_at 直接展示字符串，禁止 `new Date()` 解析（Safari
  日期坑，Grill #18）；output 全量透传 + max-h 滚动兜底（R-07 超长不撑爆布局）。
- review_history 两种异构形状消费前必须过 normalizeReviewHistory，勿直读原始字段。
- quicklog 状态口径 4 态在 table/drawer/linked-card 三处各自定义，改动须三处同步。
- 测试：`changes/__tests__/`（session-section / step-badge / quicklog-drawer / table）
  + `detail/__tests__/` 8 套（9 卡中仅 quicklog-linked-card 无专属测试，其余全覆盖）。

- 快速修复关联会话卡（2026-08-25-session-spec-binding）：quicklog-sessions-card 镜像 change-sessions-card（listQuicklogSessions 取数/仅本人过滤/前3条预览/?session= 深链到 /workspaces/[id]/quicklog/[qlId]/sessions）；挂在 quicklog-drawer 结构化视图底部（原始 md 视图不渲染）。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
