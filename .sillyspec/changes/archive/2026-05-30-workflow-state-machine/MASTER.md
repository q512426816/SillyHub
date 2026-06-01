---
change: 2026-05-30-workflow-state-machine
author: qinyi
created_at: 2026-05-30T09:05:00
archived_at: 2026-05-30T19:00:00
status: archived
verification: PASS WITH NOTES
tests: 608 passed, 0 failed
---

# Archive: Workflow State Machine Enhancement

## 概要

SillyHub 工作流审批系统增强（Goal 4, Task 13）：Spec Guardian 规则扩展、审计日志全覆盖、已知 bug 修复。

## 变更范围

- **Spec Guardian**: 新增 G4（文档字数 ≥100）、G5（关联组件存在性）、G7（未解决 reject review 检查）
- **审计日志**: 新建 `core/audit_hooks.py`，使用 SQLAlchemy event hook 自动记录所有模型变更
- **Bug 修复**: `test_change_transition_draft_to_proposed` 外键约束修复
- **清理**: `datetime.utcnow()` → `datetime.now(timezone.utc)` 全量替换
- **数据模型**: `ChangeDocument` 新增 `word_count` 字段 + Alembic migration

## 模块影响

| 模块 | 影响文件 | 变更类型 |
|------|---------|---------|
| core | audit_hooks.py (新), db.py, errors.py, main.py | 审计钩子 + session 注入 |
| change | model.py, service.py | word_count 字段 |
| task | model.py | datetime 清理 |
| workflow | model.py, service.py, spec_guardian.py + 3 测试文件 | Guard 规则 + FSM |
| migrations | 202605301700_add_word_count_to_change_documents.py | schema 变更 |
| conftest | backend/conftest.py | 测试配置 |

## 文件清单（15 files, +1036 lines）

### 新增
- `backend/app/core/audit_hooks.py` — SQLAlchemy event hook 审计日志
- `backend/app/modules/workflow/tests/test_audit_hooks.py` — 审计钩子测试
- `backend/migrations/versions/202605301700_add_word_count_to_change_documents.py`

### 修改
- `backend/app/core/db.py` — get_session 注入 audit_context
- `backend/app/core/errors.py` — 新增错误码
- `backend/app/main.py` — 注册 audit event hooks
- `backend/app/modules/change/model.py` — word_count 字段
- `backend/app/modules/change/service.py` — 计算 word_count
- `backend/app/modules/task/model.py` — datetime 清理
- `backend/app/modules/workflow/model.py` — datetime 清理
- `backend/app/modules/workflow/service.py` — datetime 清理
- `backend/app/modules/workflow/spec_guardian.py` — G4/G5/G7 规则
- `backend/app/modules/workflow/tests/test_router.py` — 测试补充
- `backend/app/modules/workflow/tests/test_spec_guardian.py` — Guard 测试
- `backend/conftest.py` — 测试配置

## 验证结果

- 全量测试：**608 passed, 0 failed**（45.77s）
- 变更模块测试：**108 passed, 0 failed**
- 任务完成率：**10/10 (100%)**
- 未实现标记：**0 个** TODO/FIXME/HACK
- 结论：**PASS WITH NOTES**

## 遗留项

| # | 级别 | 描述 |
|---|------|------|
| 1 | P2 | `audit_skip` session 级跳过机制未实现（FR-04） |
| 2 | P3 | G7 函数名 `_check_no_unresolved_reject` vs design `check_no_unresolved_reviews` |
| 3 | P3 | 其他模块仍有 `datetime.utcnow()` 遗留（auth, workspace, worktree） |

## 规范文档

| 文档 | 路径 |
|------|------|
| Proposal | `proposal.md` |
| Design | `design.md` |
| Requirements | `requirements.md` |
| Tasks | `tasks.md` |
| Plan | `plan.md` |
| Verification | `verification.md` |
| Tasks 蓝图 | `tasks/task-01.md ~ task-10.md` |
| FSM 原型 | `prototype-fsm-diagrams.html` |
