---
id: task-02
title: 实现 Workspace 识别与扫描
phase: V1
priority: P0
status: draft
owner: qinyi
estimated_hours: 16
affected_components:
  - platform-api
  - platform-web
allowed_paths:
  - backend/app/modules/workspace/
  - backend/app/models/workspace.py
  - backend/migrations/versions/
  - frontend/src/app/(dashboard)/workspaces/
depends_on:
  - task-01
blocks:
  - task-03
  - task-04
  - task-05
  - task-06
---

## 1. 目标

实现"指定一个本地目录 → 识别是否为 SillySpec Workspace → 入库 → 列表展示"的最小回路。

**不在范围**：

- projects/*.yaml 详细解析（task-03）
- scan docs 解析（task-04）
- changes 解析（task-05）
- tasks 解析（task-06）
- 文件变更监听（V2）

## 2. 输入

- `references/01-sillyspec-native-layout.md`
- `references/03-domain-model.md` §3.1 Workspace
- `references/10-storage-and-indexing.md`
- `references/17-db-schema.md` §2.3

## 3. 产出清单

### 3.1 数据表

按 `references/17-db-schema.md` §2.3 中 `workspaces` 表建立 migration：

```sql
CREATE TABLE workspaces (...);  -- 见 17-db-schema.md
```

文件名 `202605260900_create_workspaces.py`。

### 3.2 后端模块结构

```text
backend/app/modules/workspace/
├─ __init__.py
├─ router.py            # FastAPI 路由
├─ service.py           # 业务逻辑
├─ scanner.py           # 文件系统扫描器
├─ schema.py            # Pydantic / SQLModel DTO
├─ model.py             # Workspace SQLModel
└─ tests/
   ├─ test_scanner.py
   ├─ test_service.py
   └─ fixtures/
      └─ minimal-sillyspec/   # 单测用最小样例
         ├─ projects/.gitkeep
         ├─ changes/change/.gitkeep
         ├─ changes/archive/.gitkeep
         └─ local.yaml
```

### 3.3 API

| 方法 | 路径 | 权限 | 说明 |
|---|---|---|---|
| POST | `/api/workspaces/scan` | `workspace:write` | 传入 `root_path`，扫描并返回未保存的 dry-run 结果 |
| POST | `/api/workspaces` | `workspace:write` | 创建 Workspace（持久化） |
| GET | `/api/workspaces` | `workspace:read` | 列出当前用户可见的 Workspace |
| GET | `/api/workspaces/{id}` | `workspace:read` | 详情 |
| POST | `/api/workspaces/{id}/rescan` | `workspace:write` | 重新扫描，更新 last_scanned_at |
| DELETE | `/api/workspaces/{id}` | `workspace:admin` | 软删除（仅断开关联，不删源文件） |

`POST /api/workspaces/scan` 请求体：

```json
{ "root_path": "/abs/path/to/repo" }
```

响应：

```json
{
  "root_path": "...",
  "sillyspec_path": ".../.sillyspec",
  "is_sillyspec": true,
  "structure": {
    "has_projects_dir": true,
    "has_changes_dir": true,
    "has_docs_dir": true,
    "has_runtime_dir": true,
    "has_local_yaml": true,
    "projects_count": 3,
    "active_changes_count": 1,
    "archived_changes_count": 0
  },
  "warnings": []
}
```

### 3.4 Scanner 核心实现

```python
# backend/app/modules/workspace/scanner.py
class WorkspaceScanner:
    REQUIRED_DIRS = ["projects", "changes/change", "changes/archive"]
    OPTIONAL_DIRS = ["docs", "knowledge", "quicklog", ".runtime"]
    OPTIONAL_FILES = ["local.yaml"]

    def scan(self, root: Path) -> ScanResult:
        sillyspec = root / ".sillyspec"
        if not sillyspec.is_dir():
            return ScanResult(root_path=str(root), is_sillyspec=False, warnings=["no_sillyspec_dir"])
        ...
```

性能要求：在含 10 个 component / 20 个 change 的 workspace 上扫描必须 ≤ 200ms。

### 3.5 前端页面

`frontend/src/app/(dashboard)/workspaces/page.tsx`：

- 列表展示已创建的 Workspace（卡片：name、root_path、最后扫描时间、状态）
- "添加 Workspace"按钮 → 表单（root_path 输入框）→ 调 `/scan` dry-run → 显示 structure → 用户确认 → 调 `POST /workspaces` 保存
- 每张卡片 "Re-scan" 按钮

### 3.6 错误处理

| 场景 | HTTP | 错误码 |
|---|---|---|
| root_path 不存在 | 400 | `HTTP_400_WORKSPACE_PATH_NOT_FOUND` |
| root_path 不是目录 | 400 | `HTTP_400_WORKSPACE_PATH_NOT_DIR` |
| `.sillyspec` 不存在 | 400 | `HTTP_400_WORKSPACE_NOT_SILLYSPEC` |
| root_path 已被另一 active Workspace 占用 | 409 | `HTTP_409_WORKSPACE_PATH_DUPLICATE` |
| slug 已被另一 active Workspace 占用 | 409 | `HTTP_409_WORKSPACE_SLUG_DUPLICATE` |

> 注：唯一约束通过 partial unique index 实现，仅作用于 `deleted_at IS NULL` 的行。
> 软删除后用相同 `root_path` 重新创建会**复活**原记录而非冲突（见 AC-04b）。
| 文件系统权限不足 | 403 | `HTTP_403_WORKSPACE_PERMISSION_DENIED` |

## 4. 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 用 `tests/fixtures/minimal-sillyspec` 调 `/scan` | `is_sillyspec=true`，counts 全 0，无 warnings |
| AC-02 | 用 `c:\Users\qinyi\IdeaProjects\multi-agent-platform`（本仓库）调 `/scan` | `is_sillyspec=false`，warnings 含 `no_sillyspec_dir` |
| AC-03 | 不存在路径调 `/scan` | 返回 400 + `HTTP_400_WORKSPACE_PATH_NOT_FOUND` |
| AC-04 | 创建 active Workspace 后再用相同 root_path 创建 | 409 冲突 |
| AC-04b | 软删除后再用相同 root_path 创建 | 成功，旧记录复活，主键不变，`status=active`，`deleted_at=null` |
| AC-05 | 列表 API 返回当前用户有权限的 Workspace | 无权限的 Workspace 不出现 |
| AC-06 | Re-scan 后 `last_scanned_at` 更新 | 时间戳变化 |
| AC-07 | 单测覆盖率 | ≥ 80% |
| AC-08 | 扫描 10×20 规模目录 | < 200ms（pytest-benchmark） |
| AC-09 | 软删除后 GET 列表不出现 | 但 admin 加 `?include_deleted=true` 可见 |
| AC-10 | 前端能完整走完"扫描 → 预览 → 确认创建"流程 | E2E（Playwright 可选）或手动验证截图 |

## 5. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| Windows 与 Linux 路径分隔符差异 | 跨平台失败 | 全程 pathlib.Path；存库统一 POSIX 风格 + 标准化绝对路径 |
| 符号链接 / 网络盘 | 扫描超时或循环 | scanner 不 follow symlink；设 timeout=5s |
| 大目录扫描慢 | UI 卡顿 | dry-run 只看顶层；详细扫描放 task-03~06 |
| 路径里含中文 / 空格 | 解析报错 | 测试用例必须含中文+空格路径 |
| 多用户并发同一 root_path | 创建冲突 | DB 唯一索引兜底 |

## 6. 完成定义

- [ ] 10 个 AC 通过
- [ ] 单测 + benchmark 通过 CI
- [ ] 前端页面截图存档
- [ ] `verification.md` 追加 task-02 记录
- [ ] PR 合并
