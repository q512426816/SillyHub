---
author: qinyi
created_at: 2026-05-30 15:07:31
---

# Requirements: 写入 Change 包

## 角色

| 角色 | 说明 |
|---|---|
| 开发者 | 通过 API 创建 Change 包、生成文档、提交到 Git、创建 PR |
| 平台系统 | 自动执行 Git 操作、调用 GitHub API、审计记录 |

## 功能需求

### FR-01: tasks.md 模板生成

**Given** 用户调用 `batch_generate_templates` 并包含 `"tasks"` 类型
**When** markdown_builder 生成文档内容
**Then** 生成包含 Wave 分组结构的 `tasks.md` 模板，包含占位符说明

**Given** 用户调用 `build_tasks_md(title="Feature X")`
**When** builder 返回内容
**Then** 内容包含 `# Tasks: Feature X` 标题和 `## Wave 1` 分组结构

### FR-02: verification.md 模板生成

**Given** 用户调用 `batch_generate_templates` 并包含 `"verification"` 类型
**When** markdown_builder 生成文档内容
**Then** 生成包含验收标准结构的 `verification.md` 模板

**Given** 用户调用 `build_verification_md(title="Feature Y")`
**When** builder 返回内容
**Then** 内容包含 `# Verification: Feature Y` 标题和验收检查项占位符

### FR-03: MASTER.md 格式增强

**Given** 用户调用 `build_master_md(title="Test", change_key="2026-05-30-test", author="qinyi")`
**When** builder 返回内容
**Then** 内容包含 `author: qinyi` 和 `change_key: 2026-05-30-test` 元数据字段

**Given** 用户调用 `build_master_md` 不传 author
**When** builder 返回内容
**Then** author 字段为空或不出现（向后兼容）

### FR-04: batch-generate 传递 lease_id

**Given** 用户调用 `POST /changes/{id}/documents/batch-generate` 带 `lease_id`
**When** service 执行批量生成
**Then** 文件写入在 lease worktree 目录内，而非 workspace root

**Given** 用户调用 `batch-generate` 不带 `lease_id`
**When** service 执行批量生成
**Then** 文件写入 workspace root（向后兼容）

### FR-05: Git 提交并推送

**Given** 用户有活跃的 WorktreeLease，且 lease 目录内有未提交的 Change 文件
**When** 用户调用 `POST /changes/{id}/commit` 传入 `{ lease_id, message, branch_name }`
**Then** 系统串行执行 `git add .` → `git commit -m {message}` → `git push origin {branch_name}`

**Given** commit 过程中 push 失败
**When** GitGatewayService 返回非零 exit code
**Then** 系统返回错误信息，已执行的 add 和 commit 操作保留在 lease worktree 内

**Given** 用户尝试 push 到 `main` 或 `master` 分支
**When** GitGatewayService 校验操作
**Then** 返回 403 错误（受保护分支）

### FR-06: 创建 Pull Request

**Given** 用户有有效的 GitIdentity（未撤销的 PAT），且代码已推送到远程分支
**When** 用户调用 `POST /changes/{id}/pr` 传入 `{ lease_id, title, body, head_branch, base_branch }`
**Then** 系统解密 PAT，调用 GitHub API `POST /repos/{owner}/{repo}/pulls` 创建 PR

**Given** 用户无有效 GitIdentity
**When** 调用创建 PR
**Then** 返回 400 错误提示「需要配置 Git 凭证」

**Given** PAT 已失效或权限不足
**When** GitHub API 返回 401 或 403
**Then** 系统返回 403 错误，不暴露 PAT 内容

**Given** GitHub API 返回 422（分支不存在）
**When** PR 创建失败
**Then** 透传 GitHub 的错误信息

### FR-07: PAT 安全处理

**Given** 系统解密 PAT 用于 GitHub API 调用
**When** API 调用完成
**Then** PAT 作为局部变量在函数退出时释放，不写入日志、不返回给客户端

**Given** API 返回错误信息
**When** 系统记录错误
**Then** 错误信息中不包含 PAT 明文

## 非功能需求

- **安全性**: Git 操作经过 GitGateway 白名单/黑名单校验，输出自动脱敏（移除 PAT/bearer token）
- **审计**: 所有 Git 操作通过 GitGatewayService 执行，自动写入 `git_operation_logs` 表
- **隔离**: 文件操作在 WorktreeLease 隔离环境内，不会影响其他 lease 或 workspace
- **可测试**: 所有新功能通过单元测试覆盖，mock 外部依赖（GitGateway、httpx、文件系统）
- **向后兼容**: 已有 API 端点的签名和行为不变，新增参数有默认值
- **错误可追溯**: 所有错误返回结构化的 JSON body，包含 error code 和 details
