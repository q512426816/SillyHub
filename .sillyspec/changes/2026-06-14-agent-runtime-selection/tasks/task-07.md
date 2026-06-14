---
author: qinyi
created_at: 2026-06-14T22:04:34
id: task-07
title: scan-generate 入口支持 provider（R-05 闭合）
priority: P0
estimated_hours: 1
depends_on: [task-03]
blocks: [task-12, task-13]
allowed_paths:
  - backend/app/modules/workspace/schema.py
  - backend/app/modules/workspace/router.py
  - backend/app/modules/workspace/service.py
---

# task-07: scan-generate 入口支持 provider（R-05 闭合）

## 上下文
design.md §6.1 标注的 R-05 存疑点（scan-generate provider 注入点）已在 plan 阶段调研闭合：注入点 = `ScanGenerateRequest`(schema.py L53) → `scan_generate` router(L71) → `WorkspaceService.scan_generate`(service.py L765) → `start_scan_dispatch`（task-03 已加 provider 形参）。依赖 task-03。前端 scan 触发 UI（task-12）依赖本契约。

## 修改文件（必填）
- `backend/app/modules/workspace/schema.py` — `ScanGenerateRequest`（L53）
- `backend/app/modules/workspace/router.py` — `scan_generate`（L71）
- `backend/app/modules/workspace/service.py` — `WorkspaceService.scan_generate`（L765）

## 实现要求
1. **`ScanGenerateRequest`**（schema.py L53-62）：增 `provider: str | None = Field(default=None, max_length=64)`。
2. **`scan_generate`**（router.py L71-89）：透传 `service.scan_generate(root_path=payload.root_path, user_id=user.id, agent_service=agent_service, provider=payload.provider)`。
3. **`WorkspaceService.scan_generate`**（service.py L765-864）：增 `provider: str | None = None` 形参，透传 `agent_service.start_scan_dispatch(..., provider=provider)`（现 L852-857 调用）。

## 接口定义（代码类任务必填）
```python
# schema.py
class ScanGenerateRequest(BaseModel):
    root_path: str = Field(min_length=1, max_length=4096)
    provider: str | None = Field(default=None, max_length=64)  # 新增

# router.py
@router.post("/scan-generate", response_model=ScanGenerateResponse)
async def scan_generate(payload: ScanGenerateRequest, session, user):
    ...
    workspace_id, agent_run_id = await service.scan_generate(
        root_path=payload.root_path, user_id=user.id,
        agent_service=agent_service,
        provider=payload.provider,   # 新增
    )

# service.py
async def scan_generate(self, *, root_path, user_id, agent_service, provider=None):
    ...
    await agent_service.start_scan_dispatch(
        ..., provider=provider,   # 新增透传（task-03 已支持）
    )
```

## 边界处理（必填）
- **传 provider**：透传 start_scan_dispatch → 显式覆盖（FR-06）。
- **不传 / null**：provider=None → start_scan_dispatch 内部读 workspace.default_agent 兜底（task-03）。
- **空 body 兼容**：ScanGenerateRequest 仍要求 root_path（必填），provider 可选，不破坏既有调用。
- **新建 workspace 无 default_agent**：scan-generate 创建的新 workspace default_agent=NULL（除非另行设置），provider=None 走 ORDER BY last_heartbeat。
- **max_length**：64，与其他 provider 字段一致。
- **不校验 provider 合法性**：容忍未知，回退兜底（task-02）。

## 非目标（本任务不做的事）
- 不改 start_scan_dispatch 内部（task-03）。
- 不改 placement（task-02）。
- 不在 scan-generate 时设置新 workspace 的 default_agent（那是单独的 PATCH 流程，task-04/10）。
- 不改前端（task-12）。

## 参考
- `ScanGenerateRequest`（schema.py L53）、`scan_generate`（router.py L71）、`WorkspaceService.scan_generate`（service.py L765，调 start_scan_dispatch L852-857）。

## TDD 步骤
1. 写测试：`backend/app/modules/workspace/tests/test_scan_generate_provider.py`
   - POST scan-generate body 含 `"provider":"codex"` → 断言 start_scan_dispatch（mock）收到 provider="codex"。
   - 不含 provider → start_scan_dispatch 收到 None。
2. 确认失败。
3. 改 schema + router + service 三处透传。
4. `cd backend && uv run pytest -q app/modules/workspace/tests/test_scan_generate_provider.py` 通过。
5. 回归既有 scan_generate 测试。

## 验收标准
| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | POST scan-generate body 含 provider | start_scan_dispatch 收到该 provider |
| AC-02 | POST scan-generate body 不含 provider | start_scan_dispatch 收到 None（兜底） |
| AC-03 | scan_generate service 传 provider | 透传 start_scan_dispatch |
| AC-04 | 既有 scan_generate 测试无回归 | 全绿 |
| AC-05 | R-05 注入点全部连通（schema→router→service→dispatch） | 无断链 |
