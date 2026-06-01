---
id: task-02
title: 修复 batch-generate lease_id 传递
priority: P0
estimated_hours: 0.5
depends_on: []
blocks: [task-03, task-07]
allowed_paths:
  - backend/app/modules/change_writer/schema.py
  - backend/app/modules/change_writer/router.py
  - backend/app/modules/change_writer/tests/test_router.py
author: qinyi
created_at: 2026-05-30 15:45:00
---

# Task-02: 修复 batch-generate lease_id 传递

## 修改文件

| 文件 | 操作 | 说明 |
|---|---|---|
| `backend/app/modules/change_writer/schema.py` | 修改 | `BatchGenerateRequest` 增加 `lease_id` 字段 |
| `backend/app/modules/change_writer/router.py` | 修改 | `batch_generate_documents` 端点传递 `data.lease_id` 给 service |
| `backend/app/modules/change_writer/tests/test_router.py` | 修改 | 新增 batch-generate 测试用例 |

## 实现要求

### 1. schema.py — BatchGenerateRequest 增加 lease_id

在 `BatchGenerateRequest` 类中增加 `lease_id` 可选字段：

```python
class BatchGenerateRequest(BaseModel):
    doc_types: list[str] = Field(..., min_length=1)
    lease_id: uuid.UUID | None = None
```

**注意**: 字段顺序不重要，但 `lease_id` 必须是 `None` 默认值以保持向后兼容。`uuid` 已在文件顶部 import。

### 2. router.py — 传递 lease_id 给 service

在 `batch_generate_documents` 端点中，将 `data.lease_id` 传给 `service.batch_generate_templates()` 的 `lease_id` 关键字参数：

```python
async def batch_generate_documents(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    data: BatchGenerateRequest,
    session: SessionDep,
    user: CurrentUser,
) -> BatchGenerateResponse:
    service = ChangeWriterService(session)
    generated = await service.batch_generate_templates(
        workspace_id,
        user.id,
        change_id=change_id,
        doc_types=data.doc_types,
        lease_id=data.lease_id,          # <-- 新增这行
    )
    return BatchGenerateResponse(generated=generated)
```

**说明**: service 层的 `batch_generate_templates()` 已经有 `lease_id: uuid.UUID | None = None` 参数并实现了 lease 解析逻辑，无需修改 service.py。

### 3. 新增测试用例

在 `test_router.py` 中新增 2 个测试：

#### test_batch_generate_with_lease_id

验证 batch-generate 带 lease_id 时文件写入 lease worktree：

```python
async def test_batch_generate_with_lease_id(client, db_session, mock_repo_dir):
    refs = await _setup_prerequisites(db_session)
    # 确保 change 目录存在
    change_dir = mock_repo_dir / ".sillyspec" / "changes" / "change" / "2026-05-26-test-change"
    change_dir.mkdir(parents=True, exist_ok=True)

    resp = await client.post(
        f"/api/workspaces/{refs['ws_id']}/changes/{refs['change_id']}/documents/batch-generate",
        json={
            "doc_types": ["proposal", "design"],
            "lease_id": str(refs["lease_id"]),
        },
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert "proposal" in body["generated"]
    assert "design" in body["generated"]

    # 验证文件写入磁盘
    assert (change_dir / "proposal.md").exists()
    assert (change_dir / "design.md").exists()
```

#### test_batch_generate_without_lease_id

验证不带 lease_id 时仍能正常工作（向后兼容）：

```python
async def test_batch_generate_without_lease_id(client, db_session, mock_repo_dir):
    refs = await _setup_prerequisites(db_session)
    change_dir = mock_repo_dir / ".sillyspec" / "changes" / "change" / "2026-05-26-test-change"
    change_dir.mkdir(parents=True, exist_ok=True)

    resp = await client.post(
        f"/api/workspaces/{refs['ws_id']}/changes/{refs['change_id']}/documents/batch-generate",
        json={
            "doc_types": ["proposal"],
        },
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert "proposal" in body["generated"]
    assert (change_dir / "proposal.md").exists()
```

## 接口定义

### BatchGenerateRequest（修改后）

```python
class BatchGenerateRequest(BaseModel):
    doc_types: list[str] = Field(..., min_length=1)   # 要生成的文档类型列表
    lease_id: uuid.UUID | None = None                  # 工作树租约 ID，None 时写 workspace root
```

### batch_generate_templates service 签名（已有，无需改动）

```python
async def batch_generate_templates(
    self,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    change_id: uuid.UUID,
    doc_types: list[str],
    lease_id: uuid.UUID | None = None,
) -> list[str]:
```

### batch_generate_documents router 签名（修改后）

```python
@router.post(
    "/changes/{change_id}/documents/batch-generate",
    response_model=BatchGenerateResponse,
)
async def batch_generate_documents(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    data: BatchGenerateRequest,
    session: SessionDep,
    user: CurrentUser,
) -> BatchGenerateResponse:
```

## 边界处理

1. **lease_id 为 None（不传）**: service 已有 `lease_id: uuid.UUID | None = None` 默认值，走 workspace root 路径，不报错。测试 `test_batch_generate_without_lease_id` 覆盖。

2. **lease_id 指向不存在的 lease**: service 的 `_get_active_lease` 会抛出 `WorktreeLeaseNotFound`（404），由全局异常处理器捕获返回 HTTP 404。

3. **lease_id 不属于当前用户**: service 的 `_get_active_lease` 检查 `lease.user_id != user_id`，抛出 `WorktreeLeaseNotFound`（404），防止越权访问。

4. **lease 状态非 locked**: service 的 `_get_active_lease` 检查 `lease.status != "locked"`，抛出 `ChangeWriteError`（400），阻止在已释放的 lease 上写入。

5. **doc_types 包含不支持的类型**: service 的 `DOCUMENT_BUILDERS.get(doc_type)` 返回 None 时 skip 该类型，不报错，只是不在 generated 列表中返回。已有行为不变。

6. **change 目录不存在于 lease worktree**: service 抛出 `ChangeWriteError`（400），message 为 "Change directory does not exist."。

## 非目标

- 不修改 service.py（`batch_generate_templates` 已支持 `lease_id` 参数）
- 不修改 `BatchGenerateResponse` schema
- 不修改 `markdown_builder.py`
- 不处理 `doc_types` 去重（已有行为）
- 不做权限增强（依赖现有 `_get_active_lease` 鉴权）

## 参考

- design.md: "已有端点修复" 章节 — `POST /workspaces/{ws_id}/changes/{id}/documents/batch-generate` 增加 `lease_id` 参数并传递给 service
- design.md AD-1: service 方法直接封装在 ChangeWriterService 内
- design.md 兼容策略: "已有 API 端点的签名和行为不变（仅 batch-generate 增加 lease_id 参数，但有默认值保持兼容）"
- service.py L190-267: `batch_generate_templates` 已完整实现 lease_id 解析逻辑
- schema.py L42-44: 当前 `BatchGenerateRequest` 缺少 `lease_id` 字段
- router.py L79-97: 当前 `batch_generate_documents` 未传递 `lease_id`

## TDD 步骤

1. **先写测试**: 在 `test_router.py` 中新增 `test_batch_generate_with_lease_id` 和 `test_batch_generate_without_lease_id`
2. **运行测试**: 确认两个测试失败（`lease_id` 未传递，batch-generate 不走 lease 路径）
3. **修改 schema.py**: `BatchGenerateRequest` 增加 `lease_id: uuid.UUID | None = None`
4. **修改 router.py**: `batch_generate_documents` 中传递 `lease_id=data.lease_id`
5. **运行测试**: 确认两个新测试通过
6. **运行全量**: 确认已有测试无回归

## 验收标准

| 序号 | 验收项 | 预期结果 | 验证方式 |
|---|---|---|---|
| 1 | `BatchGenerateRequest` 包含 `lease_id` 字段 | 字段类型 `uuid.UUID \| None`，默认值 `None` | 读取 schema.py 确认 |
| 2 | `batch_generate_documents` 传递 `lease_id` | `service.batch_generate_templates()` 收到 `lease_id=data.lease_id` | 读取 router.py 确认 |
| 3 | 带 lease_id 的 batch-generate 正常写入 | 返回 200，文件写入 lease worktree 对应目录 | `test_batch_generate_with_lease_id` 通过 |
| 4 | 不带 lease_id 的 batch-generate 向后兼容 | 返回 200，文件写入 workspace root 路径 | `test_batch_generate_without_lease_id` 通过 |
| 5 | 已有测试无回归 | 全套 pytest 通过，无新增失败 | `pytest backend/` 全绿 |
| 6 | service.py 无需修改 | `batch_generate_templates` 已有 `lease_id` 参数 | diff 确认 service.py 无变更 |
