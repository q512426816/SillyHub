---
author: sillyspec-fr-index
created_at: 2026-09-29T09:40:28.972Z
---

# FR 索引 — components-changes

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 模块卡：modules/components-changes.md（域=模块 id 同构；行为条目↔模块契约互跳）

## FR-components-changes-001 时间线卡事件轴有节点连线时间轴视觉,事件/任务多时限高内部滚动不再撑爆详情页,事件超过阈值默认折叠可
变更：2026-09-29-change-detail-timeline-files-polish
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 折叠 相关模块就绪；When 时间线卡事件轴有节点连线时间轴视觉,事件/任务多时限高内部滚动不再撑爆详情页,事件超过阈值默认折叠可展开；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-29-change-detail-timeline-files-polish/requirements.md#FR-01
最近确认：5307276fa19543342bc4b11b9fe3f165f53ecf87

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-29-change-detail-timeline-files-polish:flow:FR-01
  tests: frontend/src/components/changes/detail/__tests__/change-timeline-card.test.tsx「ChangeTimelineCard 事件折叠（阈值 30）」 | frontend/src/components/changes/detail/__tests__/change-timeline-card.test.tsx「fake-check 告警醒目态（琥珀强调）」 | frontend/src/components/changes/detail/__tests__/change-timeline-card.test.tsx「三段渲染：诞生锚 + 事件轴（中文标签/commit 标题）+ 任务面（勾选×提交锚）+ 统计」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-29-change-detail-timeline-files-polish
  status: active

## FR-components-changes-002 变更文件弹窗内联与全屏预览均能结构化渲染 watcher-events.jsonl(逐行解析,时刻/
变更：2026-09-29-change-detail-timeline-files-polish
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 变更文件弹窗内联与全屏预览均能结构化渲染 watcher-events.jsonl(逐行解析,时刻/类型/详情人类可读)；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-29-change-detail-timeline-files-polish/requirements.md#FR-02
最近确认：5307276fa19543342bc4b11b9fe3f165f53ecf87

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-29-change-detail-timeline-files-polish:flow:FR-02
  tests: backend/app/modules/change/tests/test_files_router.py::test_list_files（.jsonl | frontend/src/components/__tests__/change-file-tree.test.tsx | frontend/src/components/files/__tests__/file-preview-modal.test.tsx | frontend/src/components/files/__tests__/preview-registry.test.ts | frontend/src/components/files/__tests__/structured-views.test.tsx「tryParseJsonl」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-29-change-detail-timeline-files-polish
  status: active

## FR-components-changes-003 变更目录固定产物文件(proposal.md/design.md/tasks.md/flow-sta
变更：2026-09-29-change-detail-timeline-files-polish
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 变更目录固定产物文件(proposal.md/design.md/tasks.md/flow-state.yaml/change.patch 等)在文件树与内容；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-29-change-detail-timeline-files-polish/requirements.md#FR-03
最近确认：5307276fa19543342bc4b11b9fe3f165f53ecf87

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-29-change-detail-timeline-files-polish:flow:FR-03
  tests: frontend/src/components/__tests__/change-file-tree.test.tsx「固定产物树节点主显中文名 + 原名对照，非固定名维持原名」 | frontend/src/components/__tests__/change-file-tree.test.tsx「选中固定产物：内容标题中文名 + 原路径对照；全屏 meta.name 恒原名」 | frontend/src/components/mobile/mobile-change-detail.test.tsx「文档 chip 点击打开 FilePreviewModal」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-29-change-detail-timeline-files-polish
  status: active

## FR-components-changes-004 既有时间线卡与变更文件树相关测试不回归,新增能力有测试覆盖
变更：2026-09-29-change-detail-timeline-files-polish
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When 既有时间线卡与变更文件树相关测试不回归,新增能力有测试覆盖；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-29-change-detail-timeline-files-polish/requirements.md#FR-04
最近确认：5307276fa19543342bc4b11b9fe3f165f53ecf87

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-29-change-detail-timeline-files-polish:flow:FR-04
  tests: backend/app/modules/change/tests/test_files_router.py | frontend/src/components/__tests__/change-file-tree.test.tsx | frontend/src/components/changes/detail/__tests__/change-timeline-card.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-29-change-detail-timeline-files-polish
  status: active

## FR-components-changes-005 文件树行内中文名与英文小字紧凑相邻排列(左对齐),不再两端分离
变更：2026-09-30-change-file-cn-align
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 文件树行内中文名与英文小字紧凑相邻排列(左对齐),不再两端分离；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-30-change-file-cn-align/requirements.md#FR-01
最近确认：d1e177421b7887da267d28e28f269b66169c6e6d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-30-change-file-cn-align:flow:FR-01
  tests: frontend/src/components/__tests__/change-file-tree.test.tsx「固定产物树节点主显中文名 + 原名对照，非固定名维持原名」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-30-change-file-cn-align
  status: active

## FR-components-changes-006 徽标(排队中/只读)仍靠行右端不受影响
变更：2026-09-30-change-file-cn-align
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 徽标 相关模块就绪；When 徽标(排队中/只读)仍靠行右端不受影响；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-30-change-file-cn-align/requirements.md#FR-02
最近确认：d1e177421b7887da267d28e28f269b66169c6e6d

## FR-components-changes-007 change-file-tree 相关测试不回归
变更：2026-09-30-change-file-cn-align
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When change-file-tree 相关测试不回归；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-30-change-file-cn-align/requirements.md#FR-03
最近确认：d1e177421b7887da267d28e28f269b66169c6e6d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-30-change-file-cn-align:flow:FR-03
  tests: frontend/src/components/__tests__/change-file-tree.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-30-change-file-cn-align
  status: active

## FR-components-changes-008 timeline.md 预览渲染为按时间排序的竖向时间线（时刻列+节点+事件文本，任务面/统计脚注分区呈现），解析失败回落原 markdown 渲染
变更：2026-10-13-change-files-view-polish
状态：active
摘要：主路径；格式漂移回落
场景正文：
- 场景：主路径 — Given 变更目录含 sillyspec 生成的 timeline.md（含事件时间轴/任务面/脚注三段）；When 用户在变更文件树选中该文件；Then 内联预览渲染竖
- 场景：格式漂移回落 — Given timeline.md 缺「── 事件时间轴 ──」区块（CLI 未来格式漂移）；When 选中预览；Then 按普通 markdown 渲染，不报错。
全文：.sillyspec/changes/archive/2026-10-13-change-files-view-polish/requirements.md#FR-01
最近确认：b6df42cbc8653f688b25f861a5c203e191486d50

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-change-files-view-polish:flow:测试绑定FR-01
  tests: frontend/src/components/files/__tests__/structured-views.test.tsx「TimelineView：渲染时间线/任务面/脚注」 | frontend/src/components/files/__tests__/structured-views.test.tsx「tryParseTimeline：无事件时间轴区块返回 null」 | frontend/src/components/files/__tests__/structured-views.test.tsx「tryParseTimeline：解析事件/任务/脚注与排序」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-change-files-view-polish
  status: active

## FR-components-changes-009 change.patch 预览按文件折叠展示（每文件一行：路径+增删统计，默认收起，展开看该文件红绿 diff），无 diff --git 头回落整片 DiffView
变更：2026-10-13-change-files-view-polish
状态：active
摘要：主路径；单文件/无头回落
场景正文：
- 场景：主路径 — Given change.patch 含多个文件的 unified diff；When 选中预览；Then 文件清单默认收起，点击某文件行展开仅该文件的红绿 diff。
- 场景：单文件/无头回落 — Given patch 内容无 `diff --git` 头（或非 diff 格式）；When 选中预览；Then 渲染整片 DiffView（其内部回落纯文本），行为与现
全文：.sillyspec/changes/archive/2026-10-13-change-files-view-polish/requirements.md#FR-02
最近确认：b6df42cbc8653f688b25f861a5c203e191486d50

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-change-files-view-polish:flow:测试绑定FR-02
  tests: frontend/src/components/files/__tests__/structured-views.test.tsx「PatchTreeView：默认收起、点击展开该文件 diff」 | frontend/src/components/files/__tests__/structured-views.test.tsx「tryParsePatchFiles：按 diff --git 切分文件段」 | frontend/src/components/files/__tests__/structured-views.test.tsx「tryParsePatchFiles：无 diff --git 头返回 null」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-change-files-view-polish
  status: active

## FR-components-changes-010 plan.md/delta.md/module-impact.md/symbol-impact.md/apply-manifest.json/verify-facts.json/scope-audit.json 在文件树与内容标题显示中文名+原名对照，与既有固定产物一致
变更：2026-10-13-change-files-view-polish
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 变更目录含 plan.md 等固定产物；When 文件树渲染；Then 节点主显「实现计划」等中文名，原名以 muted 小字对照。
全文：.sillyspec/changes/archive/2026-10-13-change-files-view-polish/requirements.md#FR-03
最近确认：b6df42cbc8653f688b25f861a5c203e191486d50

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-change-files-view-polish:flow:测试绑定FR-03
  tests: frontend/src/components/__tests__/change-file-tree.test.tsx「固定产物树节点主显中文名 + 原名对照」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-change-files-view-polish
  status: active

## FR-components-changes-011 内联预览与全屏预览（previewers）共用同一套新视图，不做两套渲染
变更：2026-10-13-change-files-view-polish
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 用户在内联预览点击「全屏预览」打开 timeline.md/change.patch；Then 全屏弹窗渲染与内联同一视图组件，两处呈现一致。
全文：.sillyspec/changes/archive/2026-10-13-change-files-view-polish/requirements.md#FR-04
最近确认：b6df42cbc8653f688b25f861a5c203e191486d50

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-change-files-view-polish:flow:测试绑定FR-04
  tests: frontend/src/components/files/__tests__/structured-views.test.tsx「TimelineView/PatchTreeView 为共享导出，内联与全屏同源」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-change-files-view-polish
  status: active

## FR-components-changes-012 聚焦测试通过（structured-views/change-file-tree/相关 previewer），不跑全量
变更：2026-10-13-change-files-view-polish
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 新增 TimelineView/PatchTreeView 与中文名映射；When 运行聚焦测试文件；Then 全部通过且既有用例无回归。
全文：.sillyspec/changes/archive/2026-10-13-change-files-view-polish/requirements.md#FR-05
最近确认：b6df42cbc8653f688b25f861a5c203e191486d50

## FR-components-changes-013 GET files 默认（不带 sync 参数）为纯读：不触发 daemon 同步、直接返回平台镜像数据，响应语义与现状一致
变更：2026-10-14-files-refresh-explicit-sync
状态：active
摘要：默认纯读零同步
场景正文：
- 场景：默认纯读零同步 — Given 当前用户工作区已绑定 daemon 且在线；When 请求 GET files（不带 sync 参数）；Then daemon RPC 通道零调用，响应 200 且 items 为平台镜像现有内容
全文：.sillyspec/changes/archive/2026-10-14-files-refresh-explicit-sync/requirements.md#FR-01
最近确认：42704a75aad01b355dbe090f0562ddc95090d094

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-14-files-refresh-explicit-sync:flow:测试绑定FR-01
  tests: backend/app/modules/change/tests/test_files_refresh_sync.py「test_default_read_only_skips_sync」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-14-files-refresh-explicit-sync
  status: active

## FR-components-changes-014 显式 sync=1（前端刷新按钮点击、错误重试）才触发 daemon 定向上行同步，等待预算从 15s 降到 3s，超时静默降级返回现有镜像数据
变更：2026-10-14-files-refresh-explicit-sync
状态：active
摘要：点击刷新触发同步；超时降级
场景正文：
- 场景：点击刷新触发同步 — Given 绑定 daemon 在线；When 请求 GET files?sync=1；Then 先向该 daemon 发送 sillyspec_sync_change RPC（timeout=3.0），同步完成后返回新鲜清单
- 场景：超时降级 — Given 绑定 daemon 在线但同步超过 3s 预算；When 请求 GET files?sync=1；Then RPC 超时被静默消化，响应 200 返回现有镜像数据（CLI 后台跑完，daemon 防抖 15s 内再点秒回新数据）
全文：.sillyspec/changes/archive/2026-10-14-files-refresh-explicit-sync/requirements.md#FR-02
最近确认：42704a75aad01b355dbe090f0562ddc95090d094

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-14-files-refresh-explicit-sync:flow:测试绑定FR-02
  tests: backend/app/modules/change/tests/test_files_refresh_sync.py「test_binding_without_daemon_id_skips_sync」 | backend/app/modules/change/tests/test_files_refresh_sync.py「test_daemon_offline_skips_sync」 | backend/app/modules/change/tests/test_files_refresh_sync.py「test_no_binding_skips_sync」 | backend/app/modules/change/tests/test_files_refresh_sync.py「test_online_triggers_sync_before_list」 | backend/app/modules/change/tests/test_files_refresh_sync.py「test_rpc_remote_error_degrades_old_daemon」 | backend/app/modules/change/tests/test_files_refresh_sync.py「test_rpc_timeout_degrades」 | backend/app/modules/change/tests/test_files_refresh_sync.py「test_runtime_offline_degrades」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-14-files-refresh-explicit-sync
  status: active

## FR-components-changes-015 悬浮面板 autoRefreshMs 轮询、初始挂载加载、保存后刷新均不带 sync（不触发同步）
变更：2026-10-14-files-refresh-explicit-sync
状态：active
摘要：轮询零同步
场景正文：
- 场景：轮询零同步 — Given 悬浮面板开着（autoRefreshMs=15000 轮询中）；When 定时器触发 refreshTree；Then 发出的 GET files 不带 sync 参数（纯读，零 daemon 开销）
全文：.sillyspec/changes/archive/2026-10-14-files-refresh-explicit-sync/requirements.md#FR-03
最近确认：42704a75aad01b355dbe090f0562ddc95090d094

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-14-files-refresh-explicit-sync:flow:测试绑定FR-03
  tests: frontend/src/components/__tests__/change-file-tree-autorefresh.test.tsx「初始挂载与 autoRefresh 轮询：listChangeFiles 无 sync 选项（纯读，零 daemon 开销）」 | frontend/src/components/__tests__/change-file-tree-autorefresh.test.tsx「点击「刷新」 | frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-14-files-refresh-explicit-sync
  status: active

## FR-components-changes-016 backend/daemon typecheck + 聚焦测试全绿，api-types 经 gen:types 再生成
变更：2026-10-14-files-refresh-explicit-sync
状态：active
摘要：静态与测试门
场景正文：
- 场景：静态与测试门 — Given 全部代码改动落盘；When 跑 lint/typecheck/聚焦测试与 gen:types
全文：.sillyspec/changes/archive/2026-10-14-files-refresh-explicit-sync/requirements.md#FR-04
最近确认：42704a75aad01b355dbe090f0562ddc95090d094

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-14-files-refresh-explicit-sync:flow:测试绑定FR-04
  tests: backend/app/modules/change/tests/test_files_router.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-14-files-refresh-explicit-sync
  status: active
