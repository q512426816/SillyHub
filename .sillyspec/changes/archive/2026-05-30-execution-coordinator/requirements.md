---
author: qinyi
created_at: 2026-05-30T23:17:00
---

# Requirements — Execution Coordinator 执行可靠性保证

## 角色

| 角色 | 说明 |
|------|------|
| 开发者 | 创建 AgentRun 时指定 idempotency_key，管理恢复和审批流程 |
| Agent | 在可靠性保证下执行任务，中断后可通过 resume_token 恢复 |
| 协调器 | ExecutionCoordinatorService 封装所有可靠性逻辑 |
| 平台管理员 | 通过 approval_token 审批高风险操作 |

## 功能需求

### FR-01: 幂等创建（idempotency_key）

Given 开发者调用 start_run 并提供 idempotency_key = "abc123"
When 该 key 不存在
Then 正常创建 AgentRun（201），记录 idempotency_key

Given 开发者调用 start_run 并提供 idempotency_key = "abc123"
When 该 key 已存在且对应 AgentRun 状态为 pending/running
Then 返回已有 AgentRun（200），不重复创建

Given 开发者调用 start_run 并提供 idempotency_key = "abc123"
When 该 key 已存在且对应 AgentRun 状态为 completed/failed/killed
Then 返回已有 AgentRun（200），附注说明已完成

Given 开发者调用 start_run 不提供 idempotency_key
When 正常请求
Then 跳过幂等检查，正常创建

### FR-02: 执行恢复（resume_token）

Given 一个 AgentRun 状态为 failed 或 killed
When AgentRun.resume_token 不为 NULL
Then 可通过 resume 端点恢复执行

Given 开发者调用 resume 端点并传入正确的 resume_token
When resume_token 匹配
Then AgentRun 状态重置为 pending → running，重新执行

Given 开发者调用 resume 端点并传入错误的 resume_token
When resume_token 不匹配
Then 返回 403 INVALID_RESUME_TOKEN

Given 开发者调用 resume 端点
When AgentRun 状态为 completed
Then 返回 409 RUN_ALREADY_COMPLETED

### FR-03: 进度快照（checkpoint）

Given 一个 AgentRun 正在执行（状态 running）
When 调用 save_checkpoint 并传入 data = {"step": 3, "files_modified": [...]}
Then checkpoint_version 递增，checkpoint_data 更新

Given 一个 AgentRun 已保存 checkpoint
When 调用 load_checkpoint
Then 返回最新的 checkpoint_data 和 version

Given 调用 save_checkpoint 时指定 expected_version = 5
When 当前 checkpoint_version != 5
Then 返回 409 VERSION_CONFLICT

### FR-04: 乐观锁（optimistic_lock）

Given 一个 AgentRun.version = 3
When 两个并发请求同时更新该 AgentRun
Then 第一个成功（version → 4），第二个检测到冲突返回 409

Given 并发冲突返回 409
When 客户端重新获取最新 version 后重试
Then 更新成功

### FR-05: 审批门（approval_token）

Given 一个 AgentRun 被标记为需要审批
When 执行到高风险操作前
Then AgentRun 状态变为 pending_approval，生成 approval_token

Given 管理员调用 approve 端点并传入正确的 approval_token
When token 匹配
Then AgentRun 状态恢复为 running，token 置 NULL（一次性）

Given 管理员调用 approve 端点并传入错误的 approval_token
When token 不匹配
Then 返回 403 INVALID_APPROVAL_TOKEN

Given AgentRun 状态为 pending_approval
When 超过审批超时（默认 1 小时）
Then AgentRun 状态变为 failed（审批超时）

### FR-06: 上下文一致性（context_fingerprint）

Given 开发者调用 start_run
When AgentSpecBundle 构建
Then 计算 proposal + design + plan + task_content 的 SHA-256 指纹，存入 context_fingerprint

Given 开发者调用 resume 端点
When 提供了 context_fingerprint 参数且与存储值不匹配
Then 返回 409 CONTEXT_MISMATCH，附注当前指纹值

Given 开发者调用 resume 端点
When 不提供 context_fingerprint 参数
Then 跳过指纹校验，直接恢复

### FR-07: 重试控制

Given 一个 AgentRun 执行失败
When retry_count < max_retries
Then 可通过 resume 自动重试，retry_count 递增

Given 一个 AgentRun 执行失败
When retry_count >= max_retries
Then 不允许自动重试，返回 409 MAX_RETRIES_EXCEEDED

## 非功能需求

- **向后兼容**：所有新字段可 NULL / 有默认值，现有 AgentRun 无需数据迁移
- **性能**：fingerprint 计算在 ms 级别完成，不影响创建延迟
- **安全性**：resume_token 和 approval_token 使用 UUID4 + 时间戳，不可猜测
- **可观测**：structlog 记录每次幂等命中、恢复、审批、指纹不匹配事件
- **可测试**：6 个能力点各有正向 + 异常测试用例
