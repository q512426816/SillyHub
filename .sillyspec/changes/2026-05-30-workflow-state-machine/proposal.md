---
author: qinyi
created_at: 2026-05-30T09:05:00
---

# Proposal: Workflow State Machine Enhancement

## 动机

SillyHub 的工作流审批系统（Goal 4, Task 13）是项目质量保障的核心。现有 `workflow/` 模块已实现 Change FSM、Task FSM、Review 和 AuditLog 的基础框架（V1 阶段），但存在以下不足：

1. **Spec Guardian 规则不完整** — 仅检查文档存在性，不检查内容质量（空文件也能通过）
2. **审计日志覆盖不全** — 仅 workflow 操作（transition/review）有审计，其他模型变更无记录
3. **已知 bug 未修复** — `test_change_transition_draft_to_proposed` 因 AuditLog 外键问题失败

## 关键问题

### 痛点 1：文档质量无法保障

当前 `spec_guardian.py` 只检查 `ChangeDocument.exists=True`，意味着一个 0 字节的空文件就能通过审批 gate。实际需要文档有实质内容（≥ 100 字）。

### 痛点 2：审计盲区

ChangeService 创建变更、TaskService 更新任务状态、WorkspaceService 删除工作区 — 这些操作都不记录审计日志。当出现问题时无法追溯"谁在什么时候做了什么"。

### 痛点 3：审批前缺乏完整性检查

`reviewed → approved` 转移时，不验证 `affected_components` 中的组件是否真实存在，也不检查是否有未处理的 reject review。导致审批可能基于错误前提。

## 变更范围

1. **Spec Guardian 增强** — 新增 3 条规则：文档字数≥100、组件存在性、无未解决 review
2. **审计日志自动覆盖** — 新建 `core/audit_hooks.py`，基于 SQLAlchemy event hook 自动记录所有模型变更
3. **Bug 修复** — 修复 AuditLog 插入外键约束问题 + `datetime.utcnow()` deprecation 清理
4. **测试补全** — 为新增规则和 audit hook 补充测试

## 不在范围内（显式清单）

- ❌ 前端 UI 改动（状态机可视化、审批页面）
- ❌ FSM 状态图变更（现有 7 状态 ChangeFSM 和 6 状态 TaskFSM 不变）
- ❌ 新增 API 端点（现有 4 个端点足够）
- ❌ RBAC 权限变更（现有权限体系不变）
- ❌ 消息队列 / 异步审计（同步写入即可）
- ❌ 审计日志归档 / 清理策略（后续考虑）

## 成功标准（可验证）

- [ ] `test_change_transition_draft_to_proposed` 通过
- [ ] 所有现有 44 个 workflow 测试通过
- [ ] 新增 spec_guardian 规则有对应测试
- [ ] SQLAlchemy event hook 对所有 BaseModel 子类自动记录审计
- [ ] AuditLog 不记录自身（避免递归）
- [ ] `datetime.utcnow()` 全部替换为 `datetime.now(timezone.utc)`
- [ ] 全量测试通过（540+）
