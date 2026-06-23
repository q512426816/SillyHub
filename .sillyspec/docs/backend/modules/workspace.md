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
## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
