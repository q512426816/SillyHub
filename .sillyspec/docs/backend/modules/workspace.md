---
schema_version: 1
doc_type: module-card
module_id: workspace
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 工作区中枢（workspace）

## 定位

工作区（项目组）域中枢：注册/扫描/创建、成员与 per-member daemon 绑定、PPM 项目绑
定、只读组件目录与技能视图。workspace_id 是 change/task/agent_run 等实体的归属键。
**关系层已砍**（2026-07-06-component-readonly-split）：workspace_relations 表 +
WorkspaceRelation 模型全删，拓扑退化为纯项目组节点视图。

## 契约摘要

主路由（router.py，prefix=/workspaces）：
- `POST /scan`（dry-run 不下库）/ `POST /scan-generate`（扫描+落库+daemon 派发子流）
- `POST /`（直接创建）/ `GET /`（列表，q/type/status/user_id/limit/offset；user_id 过
  滤仅平台管理员生效，普通账号走 allowed_workspace_ids 边界）/ `GET|PATCH|DELETE
  /{id}`（DELETE 软删）/ `POST /{id}/activate` / `POST /{id}/rescan`
- `POST /{id}/init` / `POST /{id}/generate-projects`
- `GET /topology`（退化：仅项目组节点，edges 恒 []）/ `GET /my-bindings`
- `GET /{id}/components`（只读组件目录）/ `GET /{id}/skills` / `GET /{id}/mcp-config`

成员子域（members_router + members_service）：`GET|POST /{id}/members`、
`GET /members/search`、`PATCH|DELETE /{id}/members/{uid}`、
`POST /{id}/members/{uid}/transfer-ownership`

member_runtimes 子域：`GET|PUT /{id}/my-binding`（per-member 绑定行）、
`GET /{id}/members/bindings`、`PUT /{id}/my-binding/shared` +
`GET /{id}/shared-daemons` + `DELETE /{id}/members/{uid}/shared`（共享 daemon 借用）

link 子域（link_router）：`GET|POST /{id}/ppm-projects`、
`DELETE /{id}/ppm-projects/{ppm_project_id}`（workspace↔PPM 项目绑定）

表：`workspaces`（root_path / slug 活跃唯一——partial unique index 限
deleted_at IS NULL，软删行保路径可复活复用；display_alias 展示别名；组件元数据字段
保留自 ADR-07 吸收）+ M:N 关联 `task_workspaces` / `ppm_project_workspace` /
`agent_run_workspaces` + member_runtimes 的 `WorkspaceMemberRuntime`

## 关键逻辑

```
scan_generate: scanner 浅扫 → create（slug 唯一兜底/软删复活/建 owner 成员行/
               upsert_my_binding）→ daemon 派发扫描
resolve_runtime_for_writeback(ws, user):     # 写回链路 runtime 解析
  binding = MemberBindingResolver(ws, user)  # 无行 → 借用兜底 → 仍无 → 400
  runtime = 按 binding.daemon_id + ws.default_agent 现算（不偷 fallback）
```

- WorkspaceScanner：浅扫描（.sillyspec 骨架 + 顶层目录计数，不开单文件，预算 <200ms）
- WorkspaceService 创建链：`_ensure_creator_as_owner`（建 owner 成员行）、
  `_resurrect_soft_deleted`（同 root_path 复活软删行）、`_ensure_spec_workspace`
  （copytree .sillyspec 到平台 `spec_data_root/{ws}`，ignore .runtime，to_thread；
  platform-managed 已存在则仅 reparse changes；daemon-client 唯一模式无本地回退）
- MemberBindingResolver：`(workspace_id, user_id)` 复合 PK 查绑定行，miss 抛
  MemberBindingNotFound(409)；`resolve_runtime_for_writeback` 供写回/同步派发用
  （binding→daemon_id+default_agent 现算；无 binding 走 borrow_resolver 借用兜底；
  失败统一抛 DaemonClientNoActiveSession，reason=not_bound/daemon_offline/
  default_agent_unset/provider_unavailable）
- scan_generate 的 daemon 子流：`_guard_daemon_owned_by_user` 早校验防劫持（见人工备注）
- ComponentCatalogService：组件=项目组 `projects/*.yaml` 派生的只读元数据，不再是
  workspaces 行；SkillsViewService：backend 容器**直读** spec_root 的 skills/
  .mcp.json 视图（不经 HostFsDelegate RPC——daemon 宿主无该容器路径）

## 注意事项

- **拓扑/关系**：Topology* schema 保留仅为维持 GET /topology 响应契约，edges 恒空；
  不要在此加关系逻辑
- workspace 删除是软删（deleted_at 置位），root_path/slug 唯一性只对活跃行生效
- 绑定稳定键是 daemon_id（daemon-entity-binding 后）；daemon_runtime_id 仅 legacy
  兼容
- SkillsViewService 直读容器路径是刻意的（记忆 runtime-read-broken-daemon-client），
  勿改回 RPC
- 错误文案已中文化（error-message-l10n），守护测试强制
- list_with_owner 由 created_by JOIN users 填 owner 展示（OwnerRead），详情可 None

## 人工备注

<!-- MANUAL_NOTES_START -->
- scan-generate daemon-client 子流绑定键（ql-20260705-003）：daemon-entity-binding 后稳定绑定键是 `daemon_id`（守护进程实体），`daemon_runtime_id` 退化为 legacy 兼容。`ScanGenerateRequest` 接受 `daemon_id` 或 `daemon_runtime_id` 至少一个（daemon_id 优先）；`scan_generate_daemon_client` 给 daemon_id 时早校验 `_guard_daemon_owned_by_user` 防劫持，新建 workspace 时 `upsert_my_binding` 建 per-member 绑定行（与 create 流程对齐），使 `start_scan_dispatch` 经 MemberBindingResolver 解析到 daemon。前端 scanGenerate 加 `daemonId` 参，调用点（agent/page、workspace-config-card）一律传 `myBinding.daemon_id`。
<!-- MANUAL_NOTES_END -->
