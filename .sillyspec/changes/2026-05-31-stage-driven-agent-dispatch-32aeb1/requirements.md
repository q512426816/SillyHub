---
author: hermes
created_at: "2026-05-31T16:10:00Z"
---

# 需求文档：Stage-Driven Agent Dispatch

## 功能需求

### FR-1: 自动 Agent 派发
- 当 change 执行 transition 到特定阶段时，系统自动派发 Claude Code Agent
- 派发为异步操作，不阻塞 transition API 响应
- transition API 响应中包含 `agent_dispatched: boolean` 字段

### FR-2: 阶段→Agent 映射配置
- 6 个阶段配置了 Agent 任务：clarifying, design_review, ready_for_dev, in_dev, technical_verification, business_review
- 配置可通过 Python dict 修改，无需重启（首次加载时读入）
- 每个配置包含：prompt 模板、是否需要 worktree、phase 标识

### FR-3: 并发控制
- 同一 change 同一时间最多 1 个 agent run
- 检查 AgentRun 表中关联该 change 且 status 为 pending/running 的记录
- 已有运行中 agent 时，不派发，返回 `agent_dispatched: false` + `agent_already_running: true`

### FR-4: Worktree 管理
- 写操作阶段（in_dev, technical_verification）需要 worktree
- 自动创建 worktree lease，使用 `sillyspec/<change_key>-<stage>` 命名
- 只读阶段不需要 worktree，Agent 直接读取 spec 文件

### FR-5: 前端 Agent 状态展示
- Change 详情页显示 Agent 运行状态 badge
- 已有 EventSource 基础设施可复用
- 状态：idle → dispatched → running → completed/failed

### FR-6: 手动重试
- 提供 POST API `/api/workspaces/{wid}/changes/{cid}/dispatch` 用于手动触发 agent
- 前端显示 "重新派发" 按钮（仅在 failed 状态可用）

## 非功能需求

### NFR-1: 性能
- transition API 响应时间不受 agent 派发影响（异步 fire-and-forget）
- Agent 启动延迟 < 5 秒

### NFR-2: 可靠性
- Agent 派发失败不回滚 transition
- 错误记录到 change 的 stages JSON 中
- 支持 dispatch 重试

### NFR-3: 可观测性
- Agent 派发事件记录到 audit log
- stages JSON 中记录 `last_dispatch` 信息
- SSE 流式推送 agent 日志

## 验收标准

1. 创建 change (draft)，点击 "提交审核" → draft→clarifying → Agent 自动启动分析需求
2. 前端可看到 Agent 运行状态和实时日志
3. Agent 完成后，change detail 更新（如 clarifying.md 内容）
4. 同一 change 不能同时运行两个 agent
5. Agent 失败不影响 transition 状态，可手动重试
