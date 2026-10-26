# UI 视觉证据（2026-10-26-session-stage-progress）

> task-04 UI 变更执行时随手落盘（补记于 verify 收口——本变更 UI 面为单组件文案/样式增强，
> 以测试断言为视觉锚点 + 原型对照说明，无整页截图需求）。

## 变更 UI 面

`frontend/src/components/daemon/turn-status-bar.tsx`（轮状态条单行区域）：
1. 阶段标签文案（PHASE_LABEL 九值，替代笼统「执行中/排队中」）；
2. ≥30s 超时警示形态（warning token 三类名 +「已等待 N 秒」）；
3. first_event 退位（标签回退现状文案，右侧活动摘要接管）。

## 视觉锚点（测试断言级）

| 视觉形态 | 锚点（turn-status-bar-phase.test.tsx） |
|---|---|
| 阶段文案「正在同步规范文件」等九值 | 「九个词表值文案与 design.md 阶段词表逐字一致」`toEqual` 全量断言（:43-56） |
| 超时警示样式类 | `border-warning/40` + `bg-warning/10` className 断言 + `/已等待 31 秒/` 文案断言（:67-82） |
| 30s 内现状样式 | `border-primary/[0.18]` 且不含 `warning`（:84-95） |
| 退位形态 | first_event 后显示「执行中」+ 主色样式、无警示（:98-114） |
| 零回归 | 无 currentPhase 时「执行中」+ 主色样式（:116-126） |

## 原型对照

批准稿 `prototype-session-stage-progress.html`（变更目录，真码管线产物）：
- 状态条单行形态 = 原型 ⑤ 区（轻量单行，D-001@v1）——实现为既有 TurnStatusBar 标签位增强，无新增区域，一致；
- 超时警示 = 原型 warning 形态（变色 + 已等待秒数，D-003@v1）——实现用主题 token 类名（非硬编码色），与原型视觉语义一致；
- 文案 = 原型阶段词表九值逐字（测试 `toEqual` 锁定，防漂移）。

偏差：无（形态/文案/警示三面与批准稿一致；实现细节按 FRONTEND_PAGE_STYLE.md 主题 token 铁律执行）。
