---
author: qinyi
created_at: 2026-08-27 07:57:00
task: task-16
source_task: task-08
---

# X-03 · 变更详情子组件复用落位清单（verify/archive 对账）

> 依据：design §5.3 复用准则（纯内容渲染直接复用；lg:grid/固定宽/桌面交互耦合的重绘）
> 与 §10 R-04（落位决定逐组件记录，防主观漂移）。
> 素材来源：task-08 实现汇报 + `frontend/src/components/mobile/mobile-change-detail.tsx:13-42`
> 头注释（X-03 落位清单），task-16 收尾逐条核对后落盘。
> 范围：桌面 `frontend/src/components/changes/detail/` 全部 10 个子组件 +
> 预览弹层 `components/files/file-preview-modal.tsx`（详情页消费的第 11 项），共 11 项。

## 落位汇总

| 落位 | 数量 | 组件 |
|---|---|---|
| 复用（纯内容/原样/黑盒） | 3 | change-step-timeline、change-agent-run-log、file-preview-modal |
| 重绘（移动版自绘，数据层/常量复用） | 5 | change-stage-header、change-stage-actions、change-files-card、change-sessions-card、quicklog-linked-card |
| 不复刻/不移植（D-002 裁剪或区块未含） | 3 | change-task-board-card、change-review-history-card、run-file-artifacts |

## 逐组件落位与依据

1. **change-stage-header → 重绘**
   依据：桌面 `flex flex-wrap`（C-15 勘误：无 lg:，实际是 flex-wrap）在 390px 宽度下
   六阶段折行拥挤，不适合直接复用。移动版自绘横向滚动紧凑步骤条；**纯常量复用**其
   导出 `WORKFLOW_STAGES`（阶段顺序）与 change-step-badge 的 `STAGE_LABELS`（含 scan
   补齐标签）。

2. **change-stage-actions → 重绘**
   依据：桌面 antd `sm` 按钮触摸热区 <44px，且无折叠头/内联二次确认的移动交互；
   `APPROVAL_PANELS` 映射为模块私有不可 import。移动版待办态标题改经
   `PENDING_REVIEW_LABEL`（task-05 给桌面 changes/page.tsx:63 加 export 复用）映射，
   通过/驳回 action 词表对齐 `lib/changes.ts submitStageReview` JSDoc 就地内联
   （proposal_approve / plan_approve / test_pass / archive_confirm /
   *_revise|replan|bug）。

3. **change-files-card（ChangeFilesCard）→ 重绘壳**
   依据：桌面 max-w-6xl Dialog + 内嵌 ChangeFileTree「树 + 预览」横向布局为宽屏耦合。
   移动版改 flat 文件 chip 列表；**数据函数复用** `lib/change-files`
   （listChangeFiles / fetchChangeFileRaw）；预览**原样复用** FilePreviewModal
   （defaultFullscreen=true 全屏直出，天然适配手机）。

4. **change-step-timeline → 纯内容复用**
   依据：stage 分组垂直时间线，无 lg:grid/固定宽，竖屏天然适配。挂进自绘折叠卡壳。

5. **change-agent-run-log → 内容级复用（黑盒挂壳）**
   依据：ChangeAgentRunLog 整体黑盒挂进自绘折叠壳；其内部
   AgentStepProgress/AgentRunPanel 子卡自带边框，套壳后双层卡片视觉可接受；
   `getAgentStatus` 数据函数复用，query 挂 `["change", wid, cid]` 失效前缀之下。

6. **change-sessions-card → 重绘**
   依据：桌面条目/卡尾 Link 耦合桌面门户路由；移动契约是 `props.onOpenSession`
   回调（宿主跳移动会话列表）。**数据层复用** listChangeSessions + 同 key
   `["agentSessions", "changeSessionsCard", wid, cid]`（与桌面卡共享缓存）。

7. **change-task-board-card → 不复刻**
   依据：D-002 变更中心核心版裁剪（任务看板移动端不做），任务区渲染桌面引导条替代。

8. **change-review-history-card → 不移植**
   依据：本变更详情区块清单未含审核历史卡；task-09 装配详情页壳未消费。日后如需，
   `normalizeReviewHistory` 已导出可直接复用（低成本补挂）。

9. **quicklog-linked-card → 重绘内容**
   依据：桌面条目 Link 指向桌面 `changes?tab=quicklog` 路由，移动端需走页内交互。
   **数据层复用** listQuicklogEntries + 同 key `["quicklogLinked", wid, changeKey]`
   （与桌面卡共享缓存）；状态徽标 4 态映射（completed/in_progress/partial_done/
   stale）就地对齐桌面 STATUS_META 内联（模块私有不可 import）。

10. **run-file-artifacts → 不移植**
    依据：任务详情页「产出文件」区，属 D-002 任务域裁剪范围；桌面变更详情页本身
    也未挂载该组件。

11. **file-preview-modal → 原样复用**
    依据：constraints 禁改 `components/files/`；2026-08-26-file-fullscreen-preview
    已支持全屏态，移动端 defaultFullscreen 直出即可。

## 对账结论

11 项全部有落位决定与依据，与 design §5.3 准则、§14 C-15（flex-wrap 勘误）一致；
无「随手复制整份桌面实现」或「无依据弃用」项。R-04 漂移风险闭环。
