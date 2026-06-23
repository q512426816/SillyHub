---
schema_version: 1
doc_type: module-card
module_id: workspace
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:16:36
---
# workspace

## 定位
SillyHub 工作区拓扑的根聚合模块。管理本地代码目录到「工作区」实体的完整生命周期：扫描目录结构、解析 `.sillyspec` 配置、持久化元数据、维护父-子组件与依赖关系、生成全局拓扑、管理成员。是几乎所有业务模块（change/task/worktree/agent/...）的上下文根，workspace_id 是跨组件协作的主轴。

产品视角：工作区是 SillyHub 的核心组织单元——一个代码仓库/目录对应一个工作区，其下挂 spec 空间、变更、任务、agent 执行、worktree。父子组件模型让 monorepo 的每个子包也能成为独立工作区，共享 spec 规范又各自隔离执行。成员管理把工作区与 RBAC 角色绑定，拓扑图可视化全局依赖。几乎所有操作都以 workspace_id 为起点。

## 契约摘要
- 路由：
  - `APIRouter prefix=/workspaces tag=workspace`：`POST /scan` 扫描（`ScanResponse`）、`POST /` 创建、`GET /` 列表（分页/include_deleted）、`GET/PATCH/DELETE /{id}`、`POST /{id}/rescan`、`POST /{id}/reparse`、`GET/POST/DELETE /{id}/relations`、`GET /topology`
  - `members_router`：`GET /{id}/members` 列表、`GET /{id}/members/search` 邀请搜索、`POST /{id}/members` 添加/更新、`PATCH /{id}/members/{uid}` 改角色、`DELETE /{id}/members/{uid}` 移除、`POST /{id}/transfer-ownership` 转让
- 数据：`Workspace`（root_path/slug/component_key/parent_id 等）、`WorkspaceRelation`、`ChangeWorkspace`/`TaskWorkspace`/`AgentRunWorkspace`（M2N 中间表）
- 子服务：`WorkspaceService`（核心）、`WorkspaceScanner`（纯函数扫描）、`RelationService`（关系+环检测）、`TopologyBuilder`（拓扑图）、`members_service`（成员）
- 依赖：`core`、`models`、`scan_docs`、`auth`；被 change/task/knowledge/scan_docs/runtime/spec_workspace/worktree/agent/daemon/git_gateway/git_identity 几乎全部业务依赖
- 跨组件协作：workspace_id 是跨组件协作主轴；spec_workspace 为其挂 spec 空间；worktree/agent 在其下执行

## 关键逻辑
创建与重解析（`WorkspaceService`）：
```
scan = scanner.scan(root_path)                  # 纯函数目录扫描
parsed = parser.parse(root_path)                # .sillyspec → ParsedWorkspace + Relations
ws = create_or_resurrect(root_path, parsed)     # 软删可复活
reparse: 父工作区重解析 → 自动建/改/软删子 component 工作区
topology: TopologyBuilder.build(session) → 节点+边图
```
- scanner/parser 是纯函数层，无 DB 依赖，可独立测试
- slug 自动生成 + 唯一约束（正则 `^[a-z0-9][a-z0-9-]*[a-z0-9]$`，`_ensure_unique_slug` 冲突追加后缀）
- `RelationService` 做环检测防 A→B→A 循环依赖
- `members_service` 管理成员角色、所有权转让、最后 owner 保护（`_count_workspace_owners`）
- `generate_projects` / `scan_generate` / `scan_generate_daemon_client` 支持 daemon client 路径源
- `_build_child_root_path` 计算子组件工作区根路径
- `_resurrect_soft_deleted` 复活已软删工作区而非新建

### Scanner 扫描结果
`WorkspaceScanner.scan(root)` 返回 `ScanResult`：
- `WorkspaceStructure`：目录结构标志（has_docs/has_changes/has_components 等）+ yaml 数 + changes 数
- `_normalise` 规范化路径，`_count_yaml`/`_count_changes` 统计指标
- scanner 纯函数无 DB 依赖，创建前先 scan 再 parser.parse 取配置
- ScanResult 供前端 scan 对话框预览，决定是否创建

## 注意事项
- 软删除而非物理删，保留审计 + 允许复活（`_resurrect_soft_deleted`）
- reparse 会软删不再存在的子工作区，注意级联影响（change/task 等关联）
- 软删工作区默认 list 隐藏，topology 也排除
- `generate_projects` / `scan_generate` 支持 daemon client 路径源（`is_daemon_client_path_source`）
- `resolve_root_path_for_server` 处理 daemon 注册的路径在 server 侧的重写（`_rewrite_path`）
- slug 校验 `_validate_slug` 拒绝不合法值，URL 友好标识
- scanner 统计 yaml 数与 changes 数（`_count_yaml`/`_count_changes`）供 ScanResult 展示
- 创建工作区时 `_ensure_spec_workspace` / `_ensure_spec_workspace_from_platform` 自动连带建 spec 空间
- members 转让所有权需保证至少一个 owner，不可全部转出
- `_find_active_by_root_path`/`_find_active_by_slug` 查重，避免重复创建
- `_find_active_scan_run` 查活跃扫描 agent run，防并发重复扫描
- `activate` 激活软删工作区，恢复可见性
- RelationService.create 创建关系前做环检测，成环抛错
- TopologyBuilder.build 从全部活跃工作区 + 关系构建节点边图
- members_service.search_users_for_invite 按关键字搜可邀请用户
- add_or_update_member 邀请或改角色，校验角色存在性
- `_get_role_by_key` 按角色 key（owner/admin/member）取 Role
- scanner 的 ScanResult 含 has_docs/has_changes/has_components 等布尔标志
- parser.parse 读 .sillyspec 配置产出 ParsedWorkspace + ParsedRelation
- RelationService.list_for_workspace 列工作区全部关系
- TopologyBuilder.build 返回 TopologyResponse（nodes + edges）
- soft_delete 设 deleted_at，list 默认 exclude，include_deleted=true 可查
- rescan 只更新 last_scanned_at 不改结构，reparse 才重建子工作区
- daemon client 路径源经 _is_daemon_client_payload 识别特殊处理
- generate_projects 从 .sillyspec 配置生成子工作区
- members 的 role_key 决定权限（owner 全权/admin 管理/member 读写）
- transfer_ownership 需当前 owner 发起，目标成员须存在

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
