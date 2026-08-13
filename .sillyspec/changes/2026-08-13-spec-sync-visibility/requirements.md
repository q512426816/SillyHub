---
author: qinyi
created_at: 2026-08-13T22:23:06
change: 2026-08-13-spec-sync-visibility
---

# 需求（Requirements）：工作区配置页「同步到服务器」可见性增强

## 功能需求

### FR-01 失败原因透传
同步失败时，前端展示后端真实 error message，而非写死的「同步到服务器失败」。
- 输入：outbox 行 status=failed + error 字段（后端已落库 `DaemonChangeWrite.error` + `sync_manual_get_pending` 已返回）。
- 输出：前端失败反馈框显示 `latest.error`（为空时兜底「同步到服务器失败」）。
- 影响文件：`frontend/src/lib/spec-workspaces.ts`（PendingSyncItem 整体对齐后端）、`frontend/src/components/workspace-config-card.tsx:269-271`。
- impacts: task-W1, verify-失败原因可见用例

### FR-02 按钮含义提示
5 个按钮（初始化/扫描/同步到服务器/导入/生成项目）每个有 antd Tooltip 解释「这个按钮干什么」。
- 影响文件：`frontend/src/components/workspace-config-card.tsx`（5 按钮 414-481）。
- impacts: task-W2

### FR-03 disabled 原因提示
按钮灰掉时 Tooltip 切到原因文案（并发互斥/非 owner/操作进行中）。用 `<Tooltip><span><Button disabled></span></Tooltip>` 包裹让 disabled 按钮也能触发 Tooltip。
- impacts: task-W2

### FR-04 规范对齐 FRONTEND_PAGE_STYLE §5/§11
shadcn Button→antd；size sm→middle；"…中"文案→动词原形+loading prop；`window.confirm`→antd `Modal.confirm`。
- 影响文件：`frontend/src/components/workspace-config-card.tsx`（import 重构 + 316/337 confirm）。
- 范式参考：`agent-profile-form.tsx:377-398`。
- impacts: task-W2

### FR-05 同步终态计数
同步完成后显示「已同步 N 个文件变更」（N=files_total）。
- 后端：`DaemonChangeWrite` 加 `files_total: int|null`、`files_processed: int|null` 列 + Alembic 迁移；`sync_manual_get_pending` 返回加字段。
- daemon：spec-sync 分支 complete 前最后一次 progress 上报 `{files_total, files_processed: files_total}`（D-004 单一写者）。
- 前端：done 分支展示（files_total 为 null 时降级文案「已同步完成」无数字——留 plan task 补，Design Grill 次要观察）。
- impacts: task-W3, verify-终态计数

### FR-06 同步实时进度（阶段级）
同步过程中显示 antd Progress 条 + N/M（阶段级：打包中/上传中/落盘中，非逐文件跳动）。
- 后端：新增 `PATCH /api/daemon/change-writes/{id}/progress`（status==claimed 校验 BL-3，不置终态）。
- daemon：`postSpecSync` 加 onProgress 回调；`packSpecDir` 加 `onWalkComplete(filesCount)` 钩子（BL-2 全量路径 total 上报）。
- 前端：syncing 分支 antd Progress（percent=processed/total*100）+ 「同步中 N/M」。
- **降级（BL-2）**：全量首同步期间（walkComplete 前 total 未知）仅显示阶段名「打包中」，N/M 仅在增量路径 / 全量 walkComplete 后显示。
- impacts: task-W4, verify-实时进度

## 非功能需求

### NFR-01 兼容性
files_total/processed nullable，兼容已有 outbox 旧行（D-002）。数据可清空（CLAUDE.md 规则 11）但仍走规范迁移。

### NFR-02 不改状态机
pending→claimed→done/failed 流转不变。progress 端点不置终态；complete 不碰计数列（D-004）。

### NFR-03 跨平台
迁移/端点/前端兼容 Windows/Linux/macOS（项目既有约束）。

## 决策引用

- D-001@V1 ③b 阶段级非逐文件 ✓（FR-06）
- D-002@V1 迁移 nullable 兼容 ✓（NFR-01）
- D-003@V1 Wave 分阶段 ✓（任务结构）
- D-004@V1 计数列单一写者 ✓（FR-05/NFR-02，Design Grill BL-1 收敛）

无未覆盖的 D-xxx@vN（剩余风险：无）。
