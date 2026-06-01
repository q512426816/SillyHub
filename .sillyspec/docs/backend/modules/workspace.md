---
author: qinyi
created_at: 2026-05-31T23:30:00
---

# workspace

> 最后更新：2026-05-31
> 最近变更：feat(worktree): worktree lease lifecycle management
> 模块路径：`app/modules/workspace/**`

## 职责

管理 SillySpec 工作区的注册、扫描、更新、软删除/复活，以及工作区间的拓扑关系（WorkspaceRelation）和 M:N 关联表（change_workspaces、task_workspaces、agent_run_workspaces）。

## 当前设计

### 架构

```
WorkspaceService（编排层）
  ├── WorkspaceScanner（扫描器）— 文件系统探测 .sillyspec 结构
  ├── WorkspaceParser（解析器）— 解析 projects/*.yaml 生成子工作区
  ├── RelationService（关系服务）— WorkspaceRelation CRUD
  ├── TopologyBuilder（拓扑构建）— 全局工作区关系图
  └── _rewrite_path() — Docker 容器内外路径映射
```

### 关键逻辑

1. **创建即扫描**：`create()` 先调用 `scan()` 确认 root_path 是合法 SillySpec 工作区，再写入 DB
2. **软删除 + 复活**：`deleted_at IS NULL` 部分唯一索引允许同路径新记录；创建时先查找同路径墓碑行并复活
3. **Reparse 子工作区**：解析 `projects/*.yaml`，UPSERT 子 Workspace + WorkspaceRelation，移除已消失的子项
4. **路径映射**：Docker 环境下 `host_path_prefix → container_path_prefix` 自动重写
5. **IntegrityError 翻译**：Postgres UNIQUE 违例映射为 `WorkspacePathDuplicate` / `WorkspaceSlugDuplicate`

## 对外接口

| 接口 | 方法 | 说明 | 调用方 |
|------|------|------|--------|
| `POST /workspaces/scan` | `scan_workspace()` | 干跑扫描（不写 DB） | 前端 |
| `POST /workspaces` | `create_workspace()` | 注册新工作区（自动扫描+复活检测） | 前端 |
| `GET /workspaces` | `list_workspaces()` | 列表（管理员看全部，普通用户按 RBAC 过滤） | 前端 |
| `GET /workspaces/topology` | `get_topology()` | 全局拓扑关系图 | 前端 |
| `GET /workspaces/{id}` | `get_workspace()` | 获取单个工作区 | 前端 |
| `PATCH /workspaces/{id}` | `update_workspace()` | 更新字段（exclude_unset） | 前端 |
| `DELETE /workspaces/{id}` | `delete_workspace()` | 软删除（status → deleted） | 前端 |
| `POST /workspaces/{id}/rescan` | `rescan_workspace()` | 重新扫描文件系统 | 前端 |
| `POST /workspaces/{id}/reparse` | `reparse_workspace()` | 重新解析子工作区+关系 | 前端 |
| `GET /workspaces/{id}/relations` | `list_relations()` | 列出出入关系 | 前端 |
| `POST /workspaces/{id}/relations` | `create_relation()` | 创建关系 | 前端 |
| `DELETE /workspaces/relations/{id}` | `delete_relation()` | 删除关系 | 前端 |

## 关键数据流

```
POST /workspaces → WorkspaceService.create()
  → _rewrite_path()                  # Docker 路径映射
  → scan(root_path)                  # WorkspaceScanner 探测
  → _guard_path()                    # 文件系统校验
  → _resurrect_soft_deleted()        # 查找墓碑行
  → INSERT Workspace                 # flush + IntegrityError 翻译
  → return Workspace
```

```
POST /workspaces/{id}/reparse → WorkspaceService.reparse()
  → get(workspace_id)               # 校验父工作区
  → WorkspaceParser.parse()         # 解析 projects/*.yaml
  → UPSERT 子 Workspace             # 按 source_yaml_path 匹配
  → 软删除消失的子项
  → 删除旧关系 → 创建新关系（内存去重）
  → COMMIT
```

## 设计决策

| 决策 | 理由 | 来源 |
|------|------|------|
| 部分唯一索引（`deleted_at IS NULL`） | 软删除后同路径可重新注册 | migration 202605261000 |
| 创建时自动复活墓碑行 | 用户预期"删了想恢复"而非报重复 | service.py `_resurrect_soft_deleted` |
| 子工作区 root_path 拼接 | 有 path 用 `parent/path`，无 path 用 `parent/component_key` | service.py `_build_child_root_path` |
| 关系三元组唯一 `(source, target, type)` | 防止重复关系 | model.py `ux_workspace_relations_triplet` |
| Reuse attack 检测不在此模块 | 归 auth 模块管理 | auth/service.py |
| created_by 暂无 FK 约束 | users 表后于 workspaces 上线，预留字段 | model.py docstring |

## 依赖关系

### 依赖本模块
- `change/service.py`：ChangeService 依赖 WorkspaceService 验证 workspace 存在
- `task/service.py`：TaskService 依赖 WorkspaceService
- `worktree/service.py`：获取 workspace.repo_url
- `auth/service.py`：bootstrap 时 seed workspace_owner 角色

### 本模块依赖
- `core/config`：路径映射配置 `host_path_prefix` / `container_path_prefix`
- `core/errors`：7 种 Workspace 相关 AppError
- `workspace/scanner`：文件系统扫描器
- `workspace/parser`：projects/*.yaml 解析器
- `workspace/topology`：TopologyBuilder

## 注意事项

- `list_()` 的 count 查询使用全表扫描（V1 规模可接受，后续需优化）
- Reparse 会硬删除 `WorkspaceRelation`（非软删除），不可恢复
- 路径映射只在 Docker 环境生效，本地开发 `host_path_prefix` 为空时跳过
- `component_key`、`type`、`role` 等字段吸收自 ProjectComponent（ADR-07）

## 变更索引

| 日期 | 变更 | 摘要 |
|------|------|------|
| 2026-05-31 | 初始归档 | 从代码逆向生成模块文档 |
