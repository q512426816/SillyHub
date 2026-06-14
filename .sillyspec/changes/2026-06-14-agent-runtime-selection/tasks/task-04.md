---
author: qinyi
created_at: 2026-06-14T22:04:34
id: task-04
title: workspace schema 增 default_agent（Create/Update/Read）
priority: P0
estimated_hours: 1
depends_on: [task-01]
blocks: [task-08]
allowed_paths:
  - backend/app/modules/workspace/schema.py
  - backend/app/modules/workspace/service.py
---

# task-04: workspace schema 增 default_agent（Create/Update/Read）

## 上下文
让 `default_agent` 通过 API 可读可写：创建时可选设置、PATCH 可改/清空、GET 可读（FR-01）。依赖 task-01（模型列已存在）。

## 修改文件（必填）
- `backend/app/modules/workspace/schema.py` — `WorkspaceCreate`(L71) / `WorkspaceUpdate`(L110) / `WorkspaceRead`(L145)
- `backend/app/modules/workspace/service.py` — `WorkspaceService.update`（确认 exclude_unset 覆盖 default_agent）

## 实现要求
1. **`WorkspaceCreate`**（L71）：增 `default_agent: str | None = Field(default=None, max_length=64)`。
2. **`WorkspaceUpdate`**（L110）：增 `default_agent: str | None = None`（无 max_length 约束也行，与既有 Update 风格一致）。**关键**：`WorkspaceService.update` 必须用 `model_dump(exclude_unset=True)`（既有注释 L113-115 已说明）——省略字段=不改，显式传 null=清空。
3. **`WorkspaceRead`**（L145）：增 `default_agent: str | None = None`，确保 `model_config = ConfigDict(from_attributes=True)` 能从 ORM 读出。
4. **service.update**（若已用 exclude_unset 则无需改，仅确认 default_agent 在 update 流程中被正确应用）：确认 `WorkspaceUpdate.model_dump(exclude_unset=True)` 后赋值给 ORM 字段。

## 接口定义（代码类任务必填）
```python
class WorkspaceCreate(BaseModel):
    # ... 既有 ...
    default_agent: str | None = Field(default=None, max_length=64)  # 新增

class WorkspaceUpdate(BaseModel):
    # ... 既有（全部 optional）...
    default_agent: str | None = None  # 新增；exclude_unset 决定改/不改/清空

class WorkspaceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    # ... 既有 ...
    default_agent: str | None = None  # 新增
```

## 边界处理（必填）
- **PATCH 省略 default_agent**：`exclude_unset=True` → 字段不出现 → ORM 值保持不变（FR-01 第三块）。
- **PATCH 显式 null**：`{"default_agent": null}` → 字段出现且为 None → ORM 置 NULL（FR-01 第二块，清空默认）。
- **PATCH 非空字符串**：`{"default_agent": "claude"}` → ORM 更新为 "claude"（FR-01 第一块）。
- **Create 不传**：默认 None，workspace 创建后 default_agent=NULL。
- **max_length 校验**：Create 用 64 限制，超长由 Pydantic 拒绝（422）。
- **未知 provider 名**：schema 不做白名单校验（R-06，容忍未知，placement 回退兜底）。

## 非目标（本任务不做的事）
- 不加 provider 白名单/枚举校验。
- 不改 model.py（task-01）。
- 不改 router（PATCH 端点 L289 既有，自动支持新字段）。
- 不改前端（task-08）。

## 参考
- 既有 `WorkspaceUpdate` 全 optional + service `exclude_unset=True` 模式（schema.py L110-142 注释）。
- `WorkspaceRead` 用 `ConfigDict(from_attributes=True)`（L145）。

## TDD 步骤
1. 写测试：`backend/app/modules/workspace/tests/test_schema_default_agent.py`
   - PATCH `{"default_agent":"claude"}` → GET 返回 "claude"。
   - PATCH `{"default_agent":null}`（default 原为 claude）→ GET 返回 null。
   - PATCH `{}` 或 `{"name":"x"}`（不传 default_agent）→ default_agent 保持不变。
   - Create `{"name":...,"root_path":...,"default_agent":"codex"}` → GET 返回 "codex"。
2. 确认失败。
3. 加 schema 字段 + 确认 service exclude_unset。
4. `cd backend && uv run pytest -q app/modules/workspace/tests/test_schema_default_agent.py` 通过。
5. 回归既有 workspace 测试。

## 验收标准
| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | PATCH {"default_agent":"claude"} 后 GET | default_agent=="claude" |
| AC-02 | default=claude 时 PATCH {"default_agent":null} 后 GET | default_agent is None |
| AC-03 | default=claude 时 PATCH 不含 default_agent 后 GET | default_agent 仍为 "claude"（exclude_unset） |
| AC-04 | Create 含 default_agent | GET 返回该值 |
| AC-05 | Create 不含 default_agent | GET 返回 None |
| AC-06 | 既有 workspace router/service 测试无回归 | 全绿 |
