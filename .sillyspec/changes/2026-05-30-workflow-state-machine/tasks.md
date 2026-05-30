---
author: qinyi
created_at: 2026-05-30T09:05:00
---

# Tasks: Workflow State Machine Enhancement

## 任务列表

### Wave 1: 修复 + 清理（基础保障）

- **T1: 修复 test_change_transition_draft_to_proposed 失败**
  - 文件: `backend/app/modules/workflow/tests/test_router.py`
  - 说明: 修复 AuditLog 外键约束导致的测试失败

- **T2: datetime.utcnow → datetime.now(timezone.utc) 清理**
  - 文件: `workflow/model.py`, `workflow/service.py`, `change/model.py`, `task/model.py`
  - 说明: 全局替换已弃用的 datetime.utcnow()

### Wave 2: Spec Guardian 增强

- **T3: ChangeDocument 新增 word_count 字段**
  - 文件: `backend/app/modules/change/model.py`, 新增 Alembic migration
  - 说明: 新增 nullable int 字段，文档解析时计算填充

- **T4: Spec Guardian 规则 G4 — 文档非空检查**
  - 文件: `backend/app/modules/workflow/spec_guardian.py`, `tests/test_spec_guardian.py`
  - 说明: 检查 requirements/design 文档 word_count ≥ 100

- **T5: Spec Guardian 规则 G5 — 关联组件存在性**
  - 文件: `backend/app/modules/workflow/spec_guardian.py`, `tests/test_spec_guardian.py`
  - 说明: 验证 affected_components 中的组件在工作区中存在

- **T6: Spec Guardian 规则 G7 — 未解决 review 检查**
  - 文件: `backend/app/modules/workflow/spec_guardian.py`, `tests/test_spec_guardian.py`
  - 说明: 检查是否有未处理的 reject review

### Wave 3: 审计日志自动覆盖

- **T7: 新建 core/audit_hooks.py**
  - 文件: `backend/app/core/audit_hooks.py`
  - 说明: SQLAlchemy event hook 注册 + AuditContext 管理

- **T8: get_session 注入 audit_context**
  - 文件: `backend/app/core/db.py`
  - 说明: 从 request.state 获取当前用户信息，注入 session.info

- **T9: Audit hook 测试**
  - 文件: `backend/app/modules/workflow/tests/test_audit_hooks.py`
  - 说明: 测试自动审计、递归保护、context 缺失处理

### Wave 4: 验证

- **T10: 全量测试验证**
  - 说明: 运行全量测试确保 540+ 测试通过
