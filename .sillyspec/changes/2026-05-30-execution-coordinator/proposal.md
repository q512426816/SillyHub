---
author: qinyi
created_at: 2026-05-30T23:17:00
---

# Proposal — Execution Coordinator 执行可靠性保证

## 动机

当前 `Change → Task → AgentRun` 链路在执行可靠性方面存在 6 个关键缺陷：

1. **执行中断无法恢复**：Agent 进程被 OOM kill 或超时后，无法从断点继续，只能重新开始
2. **长任务无进度快照**：一个 AgentRun 包含多步操作，中途失败后不知道执行到哪一步
3. **重复提交导致重复执行**：前端重试或网络抖动可能导致 `start_run` 被调用多次
4. **并发修改状态覆盖**：两个协调器同时更新同一个 AgentRun 的状态，后者覆盖前者
5. **高风险操作无审批门**：shell_exec 删除文件、http_get 访问敏感 API 等操作缺乏人工审批机制
6. **上下文变更导致结果失效**：Agent 执行期间 proposal/design 等文档被修改，执行基于过期上下文

这 6 个问题高度内聚，同属"执行可靠性"问题域，共享相同技术模式（UUID token / hash fingerprint / DB 列 + 索引），统一解决比分散处理更高效。

## 关键问题

1. **无恢复机制（resume_token）**：AgentRun 一旦中断，只能重新创建。长时间运行的任务（如大规模代码迁移）需要从断点恢复。
2. **无进度快照（checkpoint_version）**：Agent 执行多步操作时，无法记录中间状态。失败后重试无法跳过已完成的步骤。
3. **无幂等保证（idempotency_key）**：相同的 start_run 请求可能被重复处理，导致同一任务被多个 Agent 并行执行。
4. **无并发控制（optimistic_lock）**：AgentRun 的 status/exit_code 等字段缺少版本控制，并发更新可能导致数据不一致。
5. **无审批门（approval_token）**：高风险操作（如 file_write 到关键文件、shell_exec 危险命令）缺乏人工确认环节。
6. **无上下文一致性校验（context_fingerprint）**：Agent 执行期间，输入上下文（proposal/design/plan）可能被修改，导致执行结果与最新文档不匹配。

## 变更范围

- AgentRun 模型新增 6 个字段（均可 NULL，向后兼容）
- 新建 `ExecutionCoordinatorService` 封装可靠性逻辑
- AgentRun API 扩展（新增 resume、approve 端点）
- 现有 `start_run` 流程集成幂等检查和上下文指纹
- Alembic 迁移
- 完整测试覆盖（≥15 新测试）

## 不在范围内（显式清单）

- 不做分布式锁（optimistic lock 已足够，当前单实例部署）
- 不做事件溯源（与现有 FSM 模式不兼容，过度设计）
- 不做 checkpoint 独立存储表（数据量小，存在 AgentRun JSON 列即可）
- 不做前端 UI
- 不修改 workflow FSM 定义（保持 Change/Task 状态机不变）
- 不修改 tool_gateway 模块（审批 token 由 coordinator 管理，不侵入 tool_gateway）

## 成功标准（可验证）

- 相同 idempotency_key 的 start_run 请求返回已有 AgentRun（不重复创建）
- 执行中断后，通过 resume_token 可恢复执行
- checkpoint_version 正确递增，快照数据可读取
- 并发更新 AgentRun 时，optimistic lock 检测到冲突并抛出 409
- approval_token 校验通过后才执行高风险操作
- context_fingerprint 不匹配时返回 409 CONTEXT_MISMATCH
- 所有新字段向后兼容（现有 AgentRun 无需迁移数据）
- 后端测试 ≥ 15 新增，全套无回归
