---
author: qinyi
created_at: 2026-05-30 15:07:31
---

# Proposal: 写入 Change 包

## 动机

SillyHub 平台需要让用户通过 API 完整创建 SillySpec Change 包，并将变更提交到 Git 分支、创建 Pull Request。当前 `change_writer/` 模块已完成 Phase A 的基础实现（创建目录 + MASTER.md + 批量生成模板 + 14 个测试全绿），但存在以下不足需要补齐。

## 关键问题

### 1. 文档模板不完整

`markdown_builder.py` 只有 4 种模板（proposal/requirements/design/plan），但 SillySpec Change 包标准结构还需要 `tasks.md`（Wave/Task 分组）和 `verification.md`（验收标准）。`build_master_md` 也缺少 `author` 和 `change_key` 字段，与已有变更包的 MASTER.md 格式不对齐。

### 2. batch-generate 端点缺少 lease_id 传递

`batch_generate_documents` router 调用 service 时没有传 `lease_id`，导致在无 lease 的 workspace root 模式下才能正常工作。但实际上 batch 操作应该在 lease 隔离环境内执行。

### 3. 没有 Git 提交和 PR 能力

Change 包创建完成后，无法通过 API 将变更提交到 Git 分支并创建 PR。这是实现「平台驱动开发」闭环的关键缺失环节。execution-plan-v2-v5.md 的 Goal 3 Phase B 明确要求此能力。

## 变更范围

1. **Phase A 增强**:
   - `markdown_builder.py`: 新增 `build_tasks_md`, `build_verification_md`，增强 `build_master_md`
   - `router.py`: 修复 `batch-generate` 端点的 `lease_id` 传递
   - `schema.py`: `BatchGenerateRequest` 增加 `lease_id` 字段

2. **Phase B 新增**:
   - `service.py`: 新增 `git_commit_and_push()` 和 `create_pull_request()`
   - `schema.py`: 新增 `GitCommitRequest/Response`, `PRCreateRequest/Response`
   - `router.py`: 新增 `POST /changes/{id}/commit` 和 `POST /changes/{id}/pr` 端点
   - `test_service.py`: 新增 service 层单元测试

## 不在范围内（显式清单）

- 不做前端 Change 创建向导（前端任务独立安排）
- 不做 Change 状态机（task-13 的范围）
- 不做 Spec Guardian 自动检查（task-13 的范围）
- 不做 SSH key 认证方式的 Git 操作（仅 PAT）
- 不做 GitLab/Bitbucket PR 创建（仅 GitHub）
- 不做 PR 自动 merge
- 不做分支冲突自动解决

## 成功标准（可验证）

- `markdown_builder` 能生成全部 6 种文档模板（proposal/requirements/design/plan/tasks/verification）
- `build_master_md` 输出包含 author、change_key、affected_components
- `batch-generate` 端点正确传递 lease_id
- `POST /changes/{id}/commit` 能在 lease worktree 内执行 add → commit → push
- `POST /changes/{id}/pr` 能调用 GitHub API 创建 PR
- Git 操作经过 GitGateway 白名单审计
- PAT 在内存中使用后不落日志
- 新增测试 ≥ 15，全套后端测试无回归
