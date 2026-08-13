---
author: qinyi
created_at: 2026-08-13T22:23:06
change: 2026-08-13-spec-sync-visibility
---

# 提案（Proposal）：工作区配置页「同步到服务器」可见性增强

## 一句话

让工作区配置页的同步等 5 个操作对用户透明可观测——失败看得见原因、按钮看得懂含义、进度看得见文件数。

## 背景与动机

用户在工作区配置页点「同步到服务器」时遭遇恒失败（P0 ql-007 已修，commit 88899f9c，根因是 `.runtime/sillyspec.db` 含 NUL 字节触发 asyncpg 500）。排查中暴露三个可见性盲区：

1. **失败原因不可见**：前端只显示「同步失败。同步到服务器失败」，NUL 这个真实原因被掩盖，用户反复点击无解。
2. **按钮语义不透明**：5 个按钮只有「生成项目」有说明，其余 4 个靠动词硬猜；disabled 时几乎全无原因提示。
3. **进度不可量化**：同步只有「同步中…」转圈，无文件级进度（用户原话要"当前同步数和总数"）。

P0 修了"能不能同步成功"，本提案解决"同步过程对用户透不透明"。

## 方案概要（四块，Wave 分阶段）

- **Wave 1 失败原因透传**：后端已就绪（`DaemonChangeWrite.error` 已落库+已返回），前端 `PendingSyncItem` 整体对齐后端字段（既有 schema 漂移一并修）+ 失败分支透传 `latest.error`。
- **Wave 2 按钮提示 + 规范对齐**：5 按钮加 antd Tooltip（含义 + disabled 原因）；对齐 `FRONTEND_PAGE_STYLE.md` §5/§11（shadcn→antd / sm→middle / "…中"→loading / window.confirm→Modal）。
- **Wave 3 同步终态计数**：完成后显示「已同步 N 个文件」。`DaemonChangeWrite` 加 `files_total/processed` 列 + 迁移；计数列**单一写者=progress 端点**（D-004，complete 不碰计数列）。
- **Wave 4 同步实时进度（阶段级）**：过程中 antd Progress 条 + N/M。后端新增 `PATCH /api/daemon/change-writes/{id}/progress`（status==claimed 校验，BL-3）；daemon `postSpecSync` 加 `onProgress` 回调 + `packSpecDir` 加 `onWalkComplete` 钩子（BL-2 全量路径 total 上报窗口）。

## 不在范围内（Non-Goals）

- 不做逐文件级实时进度（D-001：需重构 apply_ops 逐 op 事务，复杂度过高；取阶段级）。
- 不改 `workspace-card.tsx`（工作区列表卡片同款违规，避免蔓延，留后续 quick）。
- 不改同步状态机（pending→claimed→done/failed 不变）。
- 不给导入/生成项目加量化进度（仅同步，用户明确点名"文件同步"）。

## 关键决策

- D-001 ③b 阶段级非逐文件；D-002 迁移 nullable 兼容；D-003 Wave 分阶段；D-004 计数列单一写者（Design Grill BL-1 收敛）。

## 风险

详见 design.md 风险登记（7 条，含 BL-1 已收敛 / BL-2 全量降级 / gen:types node_modules 预案）。

## 前置依赖

P0（ql-20260813-007，commit 88899f9c）已合并——同步可成功是本提案的基础。
