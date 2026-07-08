---
author: WhaleFall
created_at: 2026-07-07 16:15:16
change: 2026-07-07-daemon-machine-runtime-hierarchy
stage: brainstorm
---

# Decisions — 决策台账

> 稳定版本 ID（D-xxx@vN），源自需求澄清 Grill（Step 7）+ 方案选择（Step 8）+ 设计确认（Step 9）+ Design Grill（Step 12）。

## D-001@v1 机器级操作上提
- type: architecture
- status: accepted
- source: code + user
- question: 机器卡除展示外需要哪些操作？别名/升级是机器级还是 runtime 级？
- answer: 代码查证——`display_alias` 已是 instance 级（`update_runtime` 经 `daemon_instance_id` 写 `daemon_instance.display_alias`）；`self-update` 按 `daemon_instance_id` 路由 WS。两者本质机器级。可写目录 2026-07-06 已下沉 per-runtime。
- normalized_requirement: 别名+升级 daemon 上提到机器卡，新增 `PATCH /machines/{id}` + `POST /machines/{id}/self-update` 直写/直路由 instance；可写目录/会话/审计/启禁/移除留 runtime 卡（per-runtime，复用现有端点）。
- impacts: FR-2, FR-3, FR-4, FR-5；design §5.2, §5.3, §8
- evidence: `backend/app/modules/daemon/runtime/service.py:update_runtime`（别名写 instance）；`router.py:603` self-update 按 instance 路由；model.py daemon_runtimes.allowed_roots per-runtime

## D-002@v1 机器在线状态来源
- type: term
- status: accepted
- source: code
- question: 机器卡的「在线状态」如何定义（一台机器下多 runtime 各有 status）？
- answer: 直接用 `daemon_instance.status`。后端 `cleanup_stale_runtimes`（`DEFAULT_RUNTIME_STALE_SECONDS=45`）已以 `daemon_instance.last_heartbeat_at` 为权威，超时 → instance.status=offline + 联动其下非 disabled runtime offline。前端不自行派生。
- normalized_requirement: 机器卡状态徽章读 `machine.status`（online/offline/maintenance/disabled），与后端 stale 语义一致。
- impacts: FR-1, FR-4；design §4
- evidence: `runtime/service.py:759 cleanup_stale_runtimes`；`model.py DaemonInstance.status`

## D-003@v1 空机器（0 runtime）展示
- type: boundary
- status: accepted
- source: code
- question: daemon_instance 是否可能 0 runtime？如何展示？
- answer: 可能（admin 删光 runtime 但 instance 行残留，CASCADE 仅在 instance 删除时触发）。仍展示机器卡，runtime 区显空态。
- normalized_requirement: `GET /machines` 返回 0-runtime 机器（runtime_count=0, runtimes=[]）；机器卡展开体显「该机器暂无运行时」；别名/升级仍可用（不依赖 runtime）。
- impacts: FR-1, FR-4；design §11
- evidence: `model.py` DaemonRuntime→DaemonInstance ondelete=CASCADE（反向不级联）

## D-004@v1 用量聚合策略
- type: architecture
- status: accepted
- source: user
- question: 机器头聚合用量怎么取？`/machines` 内联 vs 复用现有 `/runtimes/usage`？
- answer: `/machines` 不内联用量（避免复杂 JOIN + 时间窗维度污染端点）。复用现有 `GET /runtimes/usage?window=`，前端按 `daemon_instance_id` 分组：runtime 卡用量直取，机器头聚合费用 = sum(total_cost_usd)。
- normalized_requirement: 用量两次往返（Promise.all 并发）；切窗只重发 /runtimes/usage；15s 列表轮询不重拉用量。
- impacts: FR-6, NFR-3；design §6
- evidence: `router.py:391 get_runtimes_usage`；`page.tsx:reloadUsage` 非实时策略

## D-005@v1 视图替换（不保留平铺切换）
- type: boundary
- status: accepted
- source: user
- question: 是否保留旧 runtime 平铺视图作为切换？
- answer: 完全替换为两级 Machine→Runtime 视图。需求明确 runtime 不再作为首页平铺对象；保留切换增维护成本与状态复杂度（YAGNI）。
- normalized_requirement: `/runtimes` 页只有两级手风琴，无平铺/分组 tab 切换。
- impacts: FR-4；design §2 非目标
- evidence: 用户 Step 6 选择「完全替换」

## D-006@v1 视觉 1:1 对齐原型
- type: boundary
- status: accepted
- source: user
- question: 前端视觉以什么为基准？
- answer: 必须完全 1:1 对齐 `prototype-machine-runtime.html`（方案 A）。机器头：聚合费用胶囊 + runtime 数胶囊 + 别名/升级按钮；runtime 卡：用量 4 数字 + sparkline + 可写目录 + 操作组。作为验收基准。
- normalized_requirement: 前端实现以原型为像素级参照，provider 徽章色调/状态徽章/布局结构与原型一致；runtime 卡去掉冗余 Daemon 版本行（上提机器头）。
- impacts: FR-4, FR-5, NFR-7；design §11
- evidence: 用户 Step 8 选择方案 A + 要求「完全按该风格样式开发」；prototype-machine-runtime.html

## D-007@v1 机器级分页
- type: architecture
- status: accepted
- source: user
- question: 机器列表怎么分页？
- answer: 机器级分页（每页 N 台机器，各带全部 runtime）。机器卡永不跨页断裂。默认 limit=20。
- normalized_requirement: `GET /machines` limit/offset 为机器级；前端 PAGE_SIZE=20 机器/页。
- impacts: FR-1, FR-4；design §5.1
- evidence: 用户 Step 6 选择「机器级分页」

---

## Grill 修正记录（Step 12）

- **C-001 命名笔误**：design §7.1 hook 调用 `listDaemonMachinesPage` 与 §7.2 定义 `listDaemonMachines` 不一致 → 统一为 `listDaemonMachines`。
- **C-002 视觉冗余**：runtime 卡 meta 原含「Daemon 版本」行，两级视图下冗余（同机共享）→ 去掉，该信息上提机器头，对齐 D-006。`daemon_version`/`daemon_build_id` 字段保留在 `DaemonRuntimeRead`（向后兼容其它消费方）。
