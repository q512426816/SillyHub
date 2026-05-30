---
author: qinyi
created_at: 2026-05-30T09:05:00
---

# Requirements: Workflow State Machine Enhancement

## 角色

| 角色 | 说明 |
|------|------|
| 变更作者 | 创建和提交 Change，编写文档 |
| 审阅者 | 对 Change 进行 review，给出 approve/reject verdict |
| 平台管理员 | 查看审计日志，管理平台设置 |
| 系统 | Spec Guardian 自动检查、Audit Hook 自动记录 |

## 功能需求

### FR-01: 文档内容非空检查

**规则名**: `check_docs_non_trivial`

Given 一个 Change 处于 `reviewed` 状态
When 尝试转移到 `approved` 状态
And 该 Change 关联的 requirements 或 design 文档 `word_count < 100`
Then Guard 违规：`"{doc_type} document content is too short (word count < 100)."`

Given 一个 Change 处于 `reviewed` 状态
When 尝试转移到 `approved` 状态
And 所有必需文档 word_count ≥ 100
Then Guard 通过

**实现说明**: 需在 `ChangeDocument` 表新增 `word_count` 字段（nullable int），解析文档时计算并存储。Guard 规则检查 `word_count >= 100`。

### FR-02: 关联组件存在性检查

**规则名**: `check_components_exist`

Given 一个 Change 处于 `reviewed` 状态，`affected_components = ["backend", "frontend"]`
When 尝试转移到 `approved` 状态
And 工作区下存在名为 "backend" 和 "frontend" 的组件
Then Guard 通过

Given 一个 Change 处于 `reviewed` 状态，`affected_components = ["backend", "nonexistent"]`
When 尝试转移到 `approved` 状态
Then Guard 违规：`"Component 'nonexistent' does not exist in workspace."`

Given 一个 Change 的 `affected_components` 为空列表
When 尝试转移到 `approved` 状态
Then Guard 通过（空列表不检查）

### FR-03: 未解决 Review 检查

**规则名**: `check_no_unresolved_reviews`

Given 一个 Change 处于 `approved` 状态
When 尝试转移到 `in_progress` 状态
And 该 Change 存在 `verdict="reject"` 的 ChangeReview
And Change 当前状态不为 `rejected`（即 reject review 已被处理并 rework 过）
Then Guard 通过

Given 一个 Change 处于 `approved` 状态
When 尝试转移到 `in_progress` 状态
And 该 Change 存在 `verdict="reject"` 的 ChangeReview
And Change 的状态转换历史中没有 `rejected → draft` 的记录（即 reject review 未被处理）
Then Guard 违规：`"Change has unresolved reject reviews."`

**实现说明**: 通过审计日志查询 `change.transition` action 中 `rejected → draft` 的记录来判断 rework 是否已发生。

### FR-04: 审计日志自动记录

Given 任意 BaseModel 子类实例通过 Session 写入（insert/update/delete）
When SQLAlchemy after_insert / after_update / after_delete 事件触发
And `session.info["audit_context"]` 已设置（含 actor_id, workspace_id）
And 被操作的模型不是 AuditLog 自身
Then 自动创建 AuditLog 记录，action 格式为 `{model_name}.{operation}`

Given 一个 Session 写入操作
When `session.info["audit_context"]` 未设置
Then 不记录审计日志（静默跳过，不报错）

Given AuditLog 模型自身被写入
When SQLAlchemy after_insert 事件触发
Then 不记录审计日志（避免无限递归）

Given 一个 Session 操作设置了 `session.info["audit_skip"] = True`
When SQLAlchemy 事件触发
Then 不记录审计日志

### FR-05: Audit Context 自动注入

Given 一个需要认证的 API 请求
When `get_session` 依赖被调用
And 当前用户已通过 JWT 认证
Then `session.info["audit_context"]` 自动设置为 `{"actor_id": user.id, "workspace_id": workspace_id}`

### FR-06: datetime.utcnow Deprecation 清理

Given 代码中存在 `datetime.utcnow()` 调用
When 执行此变更
Then 全部替换为 `datetime.now(timezone.utc)`，涉及文件：
- `workflow/model.py`
- `workflow/service.py`
- `change/model.py`
- `task/model.py`

### FR-07: 测试修复

Given `test_change_transition_draft_to_proposed` 测试
When 在 SQLite 内存数据库中运行
Then 测试通过（当前因 AuditLog 外键约束失败）

**根因分析**: 测试中 `_setup()` 创建 workspace/user/change 后 commit，但 transition 操作在新 session 中执行，audit_log 写入时的外键检查因 SQLite 事务隔离问题失败。修复方案：确保 `_setup` 中的数据在同一 DB 文件中持久化。

## 非功能需求

- **兼容性**: 现有 API 接口不变，`ChangeDocument` 表新增 `word_count` 字段需要 DB migration
- **可回退**: 所有改动向后兼容，新字段 nullable，新规则只增加限制不放宽
- **可测试**: 所有新规则和 hook 有独立的单元测试和集成测试
- **性能**: Audit hook 在同一事务中写入，不增加额外 DB round-trip。通过 `audit_skip` 可跳过批量操作
- **安全**: AuditLog 不可篡改（append-only），无 delete/update API
