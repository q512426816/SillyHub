---
author: qinyi
created_at: 2026-05-30T09:05:00
---

# Design: Workflow State Machine Enhancement

## 架构决策

### AD-1: 审计日志覆盖方式 → SQLAlchemy Event Hook

**决策**: 使用 SQLAlchemy `after_insert` / `after_update` / `after_delete` 事件自动捕获所有模型变更。

**理由**:
- Service 层装饰器方案需要修改每个 service 方法，容易遗漏
- Event hook 在 ORM 层面拦截，覆盖面最全
- 通过 `session.info` 传递上下文，不侵入业务代码

**Trade-off**:
- (+) 全自动覆盖，新增模型自动纳入审计
- (+) Service 层代码零改动
- (-) 需要正确传递 audit_context 到 session
- (-) 批量操作（bulk insert）不触发事件，需手动记录

### AD-2: Spec Guardian 扩展方式 → 注册到现有 _GUARD_RULES

**决策**: 新增 3 个 async checker 函数，注册到 `_GUARD_RULES` 字典。

**理由**: 现有框架已支持规则注册模式，扩展点清晰。

**Trade-off**:
- (+) 一致的规则注册模式
- (+) 独立可测试
- (-) 每条规则独立查询 DB，无批量优化（可接受，状态转移是低频操作）

### AD-3: 文档字数存储 → ChangeDocument.word_count 新增字段

**决策**: 在 `ChangeDocument` 表新增 `word_count: int | None` 字段，文档解析时计算并存储。

**理由**: 避免每次 guard 检查时重新读取文件内容计算字数。

**Trade-off**:
- (+) 查询性能好
- (-) 需要数据迁移（对已有记录填充 word_count）
- (-) 文档内容变更后需重新计算

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `backend/app/core/audit_hooks.py` | **新增** | SQLAlchemy event hook + AuditContext 管理 |
| `backend/app/core/db.py` | 修改 | get_session 注入 audit_context |
| `backend/app/modules/workflow/spec_guardian.py` | 修改 | 新增 3 条 guard 规则 |
| `backend/app/modules/workflow/service.py` | 修改 | datetime.utcnow → now(UTC) |
| `backend/app/modules/workflow/model.py` | 修改 | datetime.utcnow → now(UTC) |
| `backend/app/modules/change/model.py` | 修改 | ChangeDocument 新增 word_count 字段 |
| `backend/app/modules/task/model.py` | 修改 | datetime.utcnow → now(UTC) |
| `backend/app/modules/change/service.py` | 修改 | 文档解析时计算 word_count |
| `backend/app/modules/workflow/tests/test_spec_guardian.py` | 修改 | 新增 guard 规则测试 |
| `backend/app/modules/workflow/tests/test_router.py` | 修改 | 修复失败测试 + audit hook 测试 |
| `backend/app/modules/workflow/tests/test_audit_hooks.py` | **新增** | Audit hook 单元测试 |
| `backend/migrations/versions/xxx_add_word_count.py` | **新增** | Alembic migration |

## 数据模型变更

### ChangeDocument 表新增字段

```python
# backend/app/modules/change/model.py
class ChangeDocument(BaseModel, table=True):
    # ... 现有字段 ...
    word_count: int | None = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
    )
```

### AuditContext 数据结构

```python
# session.info["audit_context"] 结构
{
    "actor_id": uuid.UUID,       # 当前用户 ID
    "workspace_id": uuid.UUID,   # 当前工作区 ID（可选）
}
```

### AuditLog 自动记录格式

| 场景 | action | resource_type | details_json |
|------|--------|---------------|--------------|
| Change 创建 | `change.insert` | `change` | `{"fields": {"title": "...", "status": "draft"}}` |
| Task 状态更新 | `task.update` | `task` | `{"changed_fields": ["status"], "from": {"status": "draft"}, "to": {"status": "ready"}}` |
| Workspace 删除 | `workspace.delete` | `workspace` | `{"deleted_slug": "..."}` |

## API 设计

**无新增端点。** 现有 4 个端点不变：

| 端点 | 方法 | 说明 |
|------|------|------|
| `/workspaces/{ws}/changes/{id}/transition` | POST | Change 状态转移（Guard 规则增强） |
| `/workspaces/{ws}/changes/{id}/reviews` | POST | 提交 review |
| `/workspaces/{ws}/changes/{id}/reviews` | GET | 列出 reviews |
| `/workspaces/{ws}/audit` | GET | 查询审计日志 |
| `/workspaces/{ws}/tasks/{id}/transition` | POST | Task 状态转移 |

## Guard Rules 完整列表

| # | Transition | Rule | 检查逻辑 |
|---|-----------|------|----------|
| G1 | draft → proposed | MASTER.md exists | `ChangeDocument(doc_type="master", exists=True)` |
| G2 | proposed → reviewed | Proposal exists | `ChangeDocument(doc_type="proposal", exists=True)` |
| G3 | reviewed → approved | Requirements + Design exist | 两条 `ChangeDocument` 查询 |
| **G4** | **reviewed → approved** | **Docs non-trivial (≥100 words)** | `ChangeDocument.word_count >= 100` **[NEW]** |
| **G5** | **reviewed → approved** | **Components exist** | 验证 `affected_components` **[NEW]** |
| G6 | approved → in_progress | Plan exists | `ChangeDocument(doc_type="plan", exists=True)` |
| **G7** | **approved → in_progress** | **No unresolved reject reviews** | 查询 reject review + 审计日志 **[NEW]** |
| G8 | in_progress → completed | (none) | — |
| G9 | completed → merged | (none) | — |

## 风险登记

| 风险 | 影响 | 概率 | 缓解 |
|------|------|------|------|
| Audit hook 递归 | 无限循环 | 低 | 排除 AuditLog 模型 |
| Audit hook 性能 | 写入延迟 | 低 | 同事务写入，无额外 round-trip |
| word_count 迁移 | 已有数据为 NULL | 中 | nullable 字段 + 可选 backfill |
| SQLite 测试兼容 | 测试失败 | 中 | 修复外键约束问题 |

## 自审

- ✅ 不引入新的外部依赖
- ✅ 不改变现有 API 接口
- ✅ 向后兼容（新字段 nullable）
- ✅ 遵循现有 feature-slice 架构
- ✅ 遵循现有命名约定（snake_case, Schema 命名）
- ✅ 测试策略：单元测试（guard rules, FSM）+ 集成测试（router + DB）
