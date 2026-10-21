# 渲染证据（visual-evidence）

> 本变更（2026-10-22-session-trajectory-view / D-035）是**接线变更**：把父变更已定稿的轨迹视图接进产品会话页的「进度」视图，并把 `/runs` 的 `timing` 透传到轮视图。
> **未新增任何视觉参数、未改动 TrajectoryView / trajectory-timeline 的样式与结构**——轨迹面板逐字复用
> `frontend/src/components/daemon/trajectory/trajectory-view.tsx`（含三泳道 token 配色、320px 检查器、
> `role="grid"` 账本、轴右缘对齐）。因此视觉基准仍是父变更的定稿产物（下方金标），本变更只保证「同一组件在产品页同一数据口径下渲染」。
> 唯一新增的界面元素是进度视图顶部的一枚两段式呈现开关（沿用 `bg-muted/50 + rounded-full` 的既有 chip 口径，文字 token `text-[11px]`，无新颜色/无新阴影）。

## 1. 金标（父变更定稿产物，归档留档）

| 文件 | 内容 | 关键实测 |
|---|---|---|
| `.sillyspec/changes/archive/2026-10-20-session-page-dsh-alignment/proto-trajectory-lanes-2026-10-21.png` | 三泳道时间轴特写（输入 / 模型 / 工具 + 共享绝对轴） | `trajectory-lane-label` 3、`trajectory-bar` 618 |
| `.sillyspec/changes/archive/2026-10-20-session-page-dsh-alignment/proto-trajectory-zoom-2026-10-21.png` | 滚轮缩放后视野（刻度补秒 + 刷子位置） | 轴右缘与账本右缘 Δ=0.00px |
| `.sillyspec/changes/archive/2026-10-20-session-page-dsh-alignment/proto-trajectory-2026-10-21.png` | 轨迹页整屏（泳道 + 账本 + 检查器） | 路由 200 |

## 2. 本变更的渲染证据（可复跑）

- `frontend/src/components/daemon/__tests__/turn-timeline-trajectory-view.test.tsx`（5 例，全绿）：
  1. 进度视图默认「时间线」→ `turn-block` 照常、无 `trajectory-pane`（现状零变化）；
  2. 点「轨迹」→ `trajectory-pane` 在场、`trajectory-lane-label` **恰 3 个**、`turn-block` 让位（不双画）；
  3. 无 `timing` → 泳道头「近似」；带 `timing.attempts` → 泳道头「真实占用」（`modelBasis` 分派）；
  4. 无时间锚点 → `trajectory-empty` 显式空态（不白屏、不出轮块）；
  5. 「对话」视图无「进度视图呈现方式」tablist（两态视图零回归）。
- `frontend/src/components/daemon/trajectory/__tests__/from-turn-views.test.ts`（9 例，全绿）：段映射 / 轮边界 / 泳道齐备不越窗 / 无 timing→`approx` / 带 timing→`observed` / 跳过无锚点轮 / 跳过预览轮 / 纯函数幂等 / 多轮编号。
- `frontend/src/components/daemon/__tests__/runtime-session-helpers.test.tsx`（41 例）+ `page-helpers-enrich-api-duration.test.ts`（6 例）：`timing` 透传后身份稳定守卫仍返回原对象引用（流式期间不击穿 memo）。
- 数据路径：产品页**零新增网络请求**（`trajectoryFromTurnViews` 只吃页面已加载的 `SessionTurnView[]`；`timing` 复用同一次会话加载已拿到的 `/runs` 响应），与 dev 路由的差别仅数据来源（日志驱动 vs 轮视图驱动），两者共用 `assembleTrajectory` 的窗口/覆盖率/口径数学。

## 3. 未覆盖 / 已知缺口（显式登记，不静默）

- **未做产品页截图**：本会话无可用浏览器会话（dev server + Playwright 未起）。目视验收口径：
  `cd frontend && corepack pnpm dev` → 打开任一有历史轮的会话 → 切「进度」→ 点右上「轨迹」即为本次交付面。
- **混合口径**：老 daemon 或无 TTFT 采样的历史轮没有 `timing`，这些轮走「近似」；只要有一轮缺采样，整条泳道的 `modelBasis` 就降级为 `approx` 并标「近似」——不把近似数据标成真实。
- **`lib/daemon/sessions.ts` 手工镜像未补 `timing`**（父变更 R-17 已登记）：`page-helpers` 以可选字段结构化读取 + 注释说明，镜像补齐后可去掉断言，属既有遗留而非本变更新增缺口。
- **无视觉降级**：未因约束收窄结构、未统一掉任何样式、未缩范围（轨迹面板 = 定稿组件原样；新增的只有一枚两段式开关）。
