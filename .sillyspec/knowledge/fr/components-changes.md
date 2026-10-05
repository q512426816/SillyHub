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
