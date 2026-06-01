---
author: qinyi
created_at: 2026-06-01 06:57:43
---

---
id: task-13
title: 新增 DispatchResponse + TransitionResponse schemas
priority: P1
estimated_hours: 1
depends_on: [task-10]
blocks: [task-14, task-15]
allowed_paths:
  - backend/app/modules/change/schema.py
---

## 修改文件

- `backend/app/modules/change/schema.py`

## 实现要求

根据 design.md Phase 6 "Response Model" 和 requirements.md FR-09，在 `schema.py` 末尾新增两个 response model。

### 命名冲突说明

**当前 `DispatchResponse`（task-04 新增）** 已被 agent-status 和 manual-dispatch 端点使用，字段为：
- `change_id: uuid.UUID`
- `current_stage: str`
- `has_active_run: bool`
- `config_enabled: bool`
- `last_dispatch: dict | None`
- `dispatch_result: dict | None`

**design.md Phase 6 的 `DispatchResponse`** 是 transition 返回专用的，字段为：
- `dispatched: bool`
- `agent_run_id: str | None`
- `stage: str | None`
- `reason: str | None`

两者结构完全不同、用途不同。为避免破坏现有端点（agent-status / manual-dispatch），采用以下方案：

- **保留现有 `DispatchResponse`** 不变（已被 3 个端点引用）
- **新增 `TransitionDispatchResponse`**：对应 design.md 中 transition 专用的 DispatchResponse
- **新增 `TransitionResponse`**：对应 design.md 中的 TransitionResponse，嵌套 `TransitionDispatchResponse`

> 这样既遵循 CONVENTIONS.md 的 `<Entity><Action>` 命名规范，又不破坏向后兼容。task-14 实际修改 router 时导入 `TransitionDispatchResponse` 和 `TransitionResponse`。

## 接口定义

在 `schema.py` 末尾 `# ── Agent Dispatch (task-04)` 段落之后新增：

```python
# ── Transition Response (task-13) ──────────────────────────────────────────


class TransitionDispatchResponse(BaseModel):
    """Transition 专用的 agent dispatch 结果。

    与 DispatchResponse（agent-status/manual-dispatch 端点使用）不同，
    此 schema 仅描述 transition 触发 dispatch 的结果。
    """

    dispatched: bool = Field(
        ...,
        description="是否成功 dispatch 了 AgentRun",
    )
    agent_run_id: str | None = Field(
        default=None,
        description="AgentRun ID（dispatched=True 时有值）",
    )
    stage: str | None = Field(
        default=None,
        description="目标 SillySpec 阶段",
    )
    reason: str | None = Field(
        default=None,
        description="未 dispatch 的原因（dispatched=False 时有值）",
    )


class TransitionResponse(BaseModel):
    """POST /changes/{id}/transition 的返回类型。

    包含变更状态和 agent dispatch 信息。
    """

    change: dict[str, Any] = Field(
        ...,
        description="变更数据（ChangeRead 的 dict 表示）",
    )
    agent_dispatch: TransitionDispatchResponse | None = Field(
        default=None,
        description="Agent dispatch 结果（无 dispatch 时为 null）",
    )
```

同时需要在文件顶部 import 区补充 `Any`（如果尚未导入）：

```python
from typing import Any
```

检查当前 `schema.py` 的 import 行：
- 已有 `from __future__ import annotations`（line 2）
- 已有 `from pydantic import BaseModel, ConfigDict, Field`（line 8）
- **没有** `from typing import Any`，需要新增

完整 import 修改：

```python
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field
```

## 边界处理

1. **agent_dispatch 为 None**：前端通过判断 `null` 决定不显示 agent 状态区域。Pydantic 序列化时 `None` 输出为 JSON `null`。
2. **agent_run_id 为 None**：当 `dispatched=False` 时此字段为 `None`，前端不应依赖此字段判断 dispatch 状态，应优先看 `dispatched` 布尔值。
3. **change dict 结构与 ChangeRead 一致**：使用 `dict[str, Any]` 而非嵌套 `ChangeRead` model，因为 router 中已经通过 `enriched_change.model_dump()` 得到 dict，保持灵活。
4. **新增 schema 不影响现有 DispatchResponse**：现有 agent-status 和 manual-dispatch 端点继续使用原有 `DispatchResponse`，导入和序列化不受影响。
5. **reason 字段国际化**：当前使用英文 reason 字符串（如 `"dispatch_exception"`、`"config_disabled"`），后续如有 i18n 需求可扩展为 code + message 结构，但当前保持简单字符串。
6. **TransitionDispatchResponse 全部字段有默认值**（除 `dispatched`）：方便在 dispatch 失败时快速构造 `TransitionDispatchResponse(dispatched=False, reason="...")`，无需填充无关字段。
7. **from __future__ import annotations**：文件已有此 import，所有类型注解为字符串形式，不会触发运行时求值问题。

## 非目标

- 不修改现有 `DispatchResponse` schema（被 agent-status / manual-dispatch 端点使用）
- 不修改 `ChangeCreate`、`ChangeRead` 等现有 schema
- 不修改 `router.py` 的端点返回逻辑（task-14 负责）
- 不修改 `service.py` 的 `transition_with_dispatch` 返回结构（task-14 负责适配）

## 参考

- `design.md` Phase 6 "Response Model"（line 308-323）
- `requirements.md` FR-09 "Transition Response Model"（line 122-132）
- `CONVENTIONS.md` Schema 命名约定：`<Entity><Action>` 格式
- 现有 `DispatchResponse` 定义：`schema.py` line 177-185
- `router.py` transition 端点：line 264-288（当前返回 `dict[str, Any]`）
- `service.py` transition_with_dispatch 返回值：line 434-437

## TDD 步骤

1. **写测试**：在 `backend/app/modules/change/tests/` 中新增测试，验证 `TransitionDispatchResponse` 和 `TransitionResponse` 的序列化
2. **确认失败**：import 失败（schema 不存在）
3. **新增 schema**：在 `schema.py` 末尾添加 `TransitionDispatchResponse` + `TransitionResponse`，补充 `Any` import
4. **确认通过**：测试全部通过
5. **验证向后兼容**：现有 `DispatchResponse` 相关测试（test_dispatch.py）仍然通过

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|----------|----------|
| AC-01 | `TransitionDispatchResponse(dispatched=True, agent_run_id="abc", stage="propose")` 序列化 | JSON 包含 `dispatched=true, agent_run_id="abc", stage="propose", reason=null` |
| AC-02 | `TransitionDispatchResponse(dispatched=False, reason="config_disabled")` 序列化 | JSON 包含 `dispatched=false, agent_run_id=null, stage=null, reason="config_disabled"` |
| AC-03 | `TransitionResponse(change={"id": "..."}, agent_dispatch=TransitionDispatchResponse(dispatched=True, ...))` 序列化 | JSON 包含 `change` dict 和 `agent_dispatch` 对象 |
| AC-04 | `TransitionResponse(change={"id": "..."}, agent_dispatch=None)` 序列化 | JSON 包含 `change` dict 且 `agent_dispatch=null` |
| AC-05 | 现有 `DispatchResponse` 不受影响 | agent-status 和 manual-dispatch 端点相关测试通过 |
| AC-06 | `from app.modules.change.schema import TransitionDispatchResponse, TransitionResponse` 可导入 | 无 ImportError |
