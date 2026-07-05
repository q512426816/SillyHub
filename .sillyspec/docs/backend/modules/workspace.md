---
schema_version: 1
doc_type: module-card
module_id: workspace
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:08:51
---
# workspace
## 定位
工作区（项目/代码仓库）的注册、扫描、拓扑、关系（relation）与软删除管理。是变更/任务/agent 等模块的挂载根，workspace_id 作为这些实体的归属键。
## 契约摘要
- `POST /api/workspaces/scan` → ScanResponse：扫描本地目录，返回解析结果（不下库）。
- `POST /api/workspaces/scan-generate` → ScanGenerateResponse：扫描 + 落库建 workspace（含 daemon-client 子流）。
- `POST /api/workspaces` → WorkspaceRead：直接创建。
- `POST /api/workspaces/{id}/activate`：激活；`POST /{id}/rescan`：重扫；`POST /{id}/reparse`：重解析文档；`POST /{id}/generate-projects`：生成子项目。
- `GET /api/workspaces` / `GET /{id}` / `PATCH /{id}` / `DELETE /{id}`：CRUD（删除走软删）。
- `GET /api/workspaces/topology`：全局拓扑；`GET/POST/DELETE /{id}/relations`：workspace 间关系。
- `WorkspaceService`：scan/create/list_/get/rescan/soft_delete/update/generate_projects/reparse/activate/scan_generate(_daemon_client)。
- `RelationService`（relation_service.py）：关系 CRUD（自环/重复校验）。
- `members_router.py` / `members_service.py`：工作区成员（RBAC 角色绑定）。
- 模型：Workspace / WorkspaceRelation / ChangeWorkspace / TaskWorkspace / AgentRunWorkspace（多对多关联表）。
## 关键逻辑
```
scan_generate:
  scanner.scan(root_path) → ParsedWorkspace
  create(): slug 去重 + 路径校验(_guard_path) → INSERT Workspace
  _ensure_spec_workspace(): 同步建 spec_workspace
  返回 workspace + scan 结果
rescan: 复用 scanner，差异更新
```
## 注意事项
- 路径安全：`_guard_path` 拦截越界/不可读路径；daemon-client 路径有专门 `_rewrite_path`。
- 软删除：`soft_delete` 仅置标记，`_resurrect_soft_deleted` 在相同 root_path 重建时复活记录。
- slug 唯一性靠 `_ensure_unique_slug` 追加后缀，非 DB 唯一约束兜底。
- change/task/agent 的 workspace 关联通过 *_workspace 关联表，删除 workspace 需考虑级联。
- `display_alias`：workspace 新增 nullable `display_alias VARCHAR(200)`，标题优先展示、空值回退 name/slug（2026-06-25-admin-global-daemon-workspace-management，D-002）。
- 列表筛选分页：`GET /api/workspaces` 支持 `q/type/status/user_id/limit/offset`；`user_id` 仅平台管理员生效（按 created_by 过滤），普通账号仍走 `allowed_workspace_ids` 权限边界（D-001/D-003）。
- owner 展示：列表 owner 由 created_by JOIN users 填充（OwnerRead 嵌套 DTO，D-006），详情可为 None。
## 人工备注
<!-- MANUAL_NOTES_START -->
- scan-generate daemon-client 子流绑定键（ql-20260705-003）：daemon-entity-binding 后稳定绑定键是 `daemon_id`（守护进程实体），`daemon_runtime_id` 退化为 legacy 兼容。`ScanGenerateRequest` 接受 `daemon_id` 或 `daemon_runtime_id` 至少一个（daemon_id 优先）；`scan_generate_daemon_client` 给 daemon_id 时早校验 `_guard_daemon_owned_by_user` 防劫持，新建 workspace 时 `upsert_my_binding` 建 per-member 绑定行（与 create 流程对齐），使 `start_scan_dispatch` 经 MemberBindingResolver 解析到 daemon。前端 scanGenerate 加 `daemonId` 参，调用点（agent/page、workspace-config-card）一律传 `myBinding.daemon_id`。
<!-- MANUAL_NOTES_END -->
