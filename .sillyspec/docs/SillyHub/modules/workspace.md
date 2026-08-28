---
schema_version: 1
doc_type: module-card
module_id: workspace
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 工作区聚合管理（workspace）

## 定位
平台核心组织单元（项目组）的聚合模块：目录扫描、创建/软删/复活、
成员与 RBAC、成员运行时绑定（member_runtimes）、PPM 项目链接、
组件目录与 skills 只读视图。
workspace_id 是全平台跨组件协作主轴；daemon-client 唯一模式下，
工作区是「成员宿主机上的一个 SillySpec 项目」的服务端投影。

## 契约摘要
- 路由（四个 router）：
  - `router prefix=/workspaces tag=workspace`：
    `POST /scan` 预览扫描、`POST /scan-generate` 扫描+建区（支持 daemon client 源）、
    `POST ""` 创建、`GET ""` 列表（分页）、`GET/PATCH/DELETE /{id}`、
    `POST /{id}/activate` 复活、`POST /{id}/rescan`、
    `POST /{id}/generate-projects`、`GET /topology`、`GET /my-bindings`、
    `POST /{id}/init`（转调 AgentService.start_init_dispatch，
    鉴权 workspace-scoped，非本区成员 403）、
    `GET /{id}/components`、`GET /{id}/skills`、`GET /{id}/mcp-config`；
    `GET ""` 列表（分页，`?type=` 枚举 / `?unclassified=true` 互斥，
    2026-08-18-workspace-role-type）
  - `members_router`：成员列表 / 邀请搜索 / 添加 / 改角色 / 移除 / 转让所有权
  - `link_router tag=workspace-ppm-links`：PPM 项目绑定 / 解绑 / 列表（PpmProjectBrief）
  - `member_runtimes.router`：`GET/PUT /my-binding`、`PUT /my-binding/shared`、
    `GET /members/bindings`、`GET /shared-daemons`、`DELETE /members/{user_id}/shared`
- 数据（model.py）：
  - `Workspace`：吸收组件元数据（component_key / type / role / repo_url /
    default_branch，ADR-07）、**type 为 8 值受控词表**（constants.py
    WORKSPACE_TYPE_VALUES + WorkspaceTypeLiteral，2026-08-18-workspace-role-type：
    Create 必填枚举、Update Literal、读路径不校验存量）、**description(Text)**
    用途说明列、default_agent / default_model +
    `default_agent_profile_id`（档案软约束兜底：run 未显式指定时回退，
    档案删则 SET NULL 回退 default_agent，D-014）、
    tech_stack / build_command / test_command、status、deleted_at。
    root_path 与 slug 的唯一性是 **partial unique index（WHERE deleted_at IS NULL）**——
    软删行保留原值，同路径重建走复活而非冲突（migration 202605261000）
  - M2N 中间表：`TaskWorkspace` / `AgentRunWorkspace` / `PpmProjectWorkspace`。
    **WorkspaceRelation 表已删除**（关系/环检测特性退出）
- topology：`TopologyBuilder.build` 已**退化**——只返回项目组节点
  （活跃且 component_key IS NULL，过滤兼容 brownfield 残留组件行），
  edges 恒空（D-001@V1：组件不再是 workspace 行）
- 组件目录：`ComponentCatalogService` 从 spec 树 `projects/*.yaml` **只读派生**组件
  （无 workspace 身份，写端点天然不可作用，2026-07-06-component-readonly-split）；
  组件 type 经 YAML_TYPE_NORMALIZE_MAP（18 键）**展示层归一**到词表值、
  description 随 ParsedWorkspace 透传进 ComponentRead（2026-08-18-workspace-role-type，
  不落 Workspace 表）
- skills / mcp-config：`SkillsViewService` 经 SpecPathResolver 定位 specDir，
  只读列 skills/ 名录与 mcp 配置；daemon-client 经 HostFsDelegate RPC 读
  （server-local 直接 Path 读）；无 skills/ 目录返回空列表不报错

## 关键逻辑
创建与扫描链（`WorkspaceService`）：
```
scan = WorkspaceScanner.scan(root)     # 纯函数：扁平根判定 + 结构标志 + 计数
parsed = WorkspaceParser.parse(root)   # yaml → ParsedWorkspace(+relations)
create: 软删可复活（_resurrect_soft_deleted）→ slug 去重
        → _ensure_creator_as_owner → _ensure_spec_workspace 连带建 spec 空间
```
- scanner 扁平根判定（D-005 daemon-client 平台托管模式，spec_root 无
  `.sillyspec` 包裹）：`projects/` 或 `changes/` 任一存在即 SillySpec 工作区；
  统计 projects 下 yaml 数与 changes/change、changes/archive 下条目数
  （目录或顶层 .md 均算 change，dotfile 忽略）；
  `_iter_dir` 防御性（目录扫描中消失返回 []）；末尾内联挂 parser 产出
  parsed_workspaces / parse_warnings / parse_errors
- member_runtimes.resolver 是**写回链路共享解析器**：
  `MemberBindingResolver.resolve_member_binding`（成员→daemon 绑定）+
  `resolve_runtime_for_writeback`（runtime 现算 D-001@v1，
  失败抛 DaemonClientNoActiveSession 400），
  spec_workspace.sync-manual 等写回链路复用
- member_runtimes.queries 双解析**统一全序**（2026-08-28-fix-cross-machine-worker-dispatch D-005@v1）：`resolve_representative_binding`（四 SQL 变体）与 `resolve_daemon_instance_for_workspace`（host_fs 路由）均 `ORDER BY 实例心跳 DESC NULLS LAST, daemon_id ASC`——多成员多机绑定时钉定链路与 worktree 路由必收敛同机；路由查询 inner join daemon_instances（stale 绑定行被静默丢弃，良性）。
- scan_generate 走 daemon client RPC 源，`_guard_daemon_owned_by_user` 校验
  daemon 归属；`_find_active_scan_run` 防并发重复扫描
- members_service：`_count_workspace_owners` 最后 owner 保护
  （转让/移除不可清空 owner）；add_or_update 校验角色存在；
  search_users_for_invite 按关键字搜可邀请用户

## 注意事项
- 软删而非物理删：list / topology 默认排除 deleted_at 非空行，
  同 root_path 重建走复活路径
- parser 仍产出 parsed_relations 但已无持久化（WorkspaceRelation 删除后），
  topology 恒无边——前端拓扑图勿再期待组件级边
- rescan 只更新 last_scanned_at 不重建结构；本模块已无 reparse 端点
  （结构重建由 spec_workspace 落盘后的两阶段 reparse 承担）
- `POST /{id}/init` 是 init 派发入口（init lease → daemon 写
  `.sillyspec-platform.json` + pull bundle + 触发 sillyspec init），
  权限收紧到 workspace 成员（security-audit-remediation task-09）
- 组件视图只读派生自 projects/*.yaml：改组件信息改 yaml，平台侧不写库
- **类型词表语义**（2026-08-18-workspace-role-type）：
  Create.type 必填 8 值枚举（缺/非法 422）；Update omit=不改/null=清空
  （exclude_unset）；读路径不校验存量（NULL=未分类、未知值原样返回不 422）；
  `GET ""` 支持 `?type=`（枚举校验）与 `?unclassified=true`（type IS NULL，
  两者同传 422）；migration 20260818150000 加 description 列+存量 type CASE
  收编（幂等，18 键与 YAML_TYPE_NORMALIZE_MAP 同步义务）
- my-binding / shared-daemons 是成员运行时会话绑定（daemon 会话归属与共享），
  与 members（RBAC 成员）是两套概念，勿混
- slug 规则 URL 友好（`^[a-z0-9][a-z0-9-]*[a-z0-9]$`），
  冲突自动追加后缀去重（`_ensure_unique_slug`）

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
