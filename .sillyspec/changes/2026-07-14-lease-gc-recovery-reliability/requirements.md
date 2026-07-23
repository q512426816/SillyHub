---
author: qinyi
created_at: 2026-07-14 10:32:29
---

# 需求规格（Requirements）— lease/GC/恢复机制可靠性提升

## 角色
| 角色 | 说明 |
|---|---|
| 平台开发者 | 维护 lease/GC/恢复机制的后端/daemon 工程师 |
| 平台运维 | 通过 env 开关控制 GC、排查误杀 |
| 平台用户 | 使用平台的开发者（看 session daemon 状态、重试 failed 任务） |

## 功能需求

### FR-01: lease GC 周期调度接线
覆盖决策：D-006@v1
**Given** APScheduler AsyncIOScheduler 集成进 FastAPI lifespan 且 GC_LEASE_ENABLED=true
**When** daemon 断开导致 batch lease 的 lease_expires_at < now
**Then** LeaseReaperService 周期（默认 60s）调 handle_expired_leases_batch 回收（attempt<max 重派 / >=max 标 failed）

**Given** GC_LEASE_ENABLED=false（排查关停）
**When** lease 过期
**Then** 不回收（行为同现状）

### FR-02: interactive lease 永不被 GC（红线）
覆盖决策：历史 interactive-idle-timeout-fix D-003
**Given** interactive lease 的 lease_expires_at=NULL
**When** GC 扫描运行
**Then** NULL<now 永为 false，interactive lease 不被扫到（对话式 session 靠手动 end/cancel 收尾）

### FR-03: worktree GC 加 agent_run_id 外键改判据
覆盖决策：D-003@v2
**Given** WorktreeLease 关联 agent_run 且 AgentRun 非终态（pending/running）
**When** worktree GC 扫描即使 expires_at<now
**Then** 不回收（长任务 worktree 保留）

**Given** 关联 AgentRun 已终态（completed/failed/killed/cancelled）且 expires_at<now
**When** worktree GC 扫描
**Then** 回收（expired + cleanup 目录）— cancelled 必须纳入终态防泄漏

**Given** WorktreeLease.agent_run_id IS NULL（孤儿，HTTP 手动 acquire）
**When** expires_at<now
**Then** 按原 expires_at 判据回收

**Given** _try_acquire_lease acquire 时 AgentRun 尚未创建
**When** acquire 后建 run
**Then** commit 前同事务回填 lease.agent_run_id=run.id

### FR-04: 心跳窗口放宽 + attempt 可配
覆盖决策：D-006@v1
**Given** config lease_heartbeat_ttl_sec=300（默认，原 60s）
**When** daemon heartbeat（:266）/ claim_lease（:187）/ start_lease（:224）
**Then** lease_expires_at 三处统一读 config 续期（含原遗漏的 start_lease）

**Given** config lease_max_attempts 可配（默认 3）
**When** lease 第 max 次过期
**Then** AgentRun 标 failed

### FR-05: failed run 重试入口
覆盖决策：D-005@v1
**Given** AgentRun status ∈ {failed, killed}
**When** 用户 POST /workspaces/{ws}/agent/runs/{id}/retry
**Then** 建新 AgentRun（attempt=1，同 change/stage/workspace，不继承产物/日志），触发 dispatch；旧 lease 残留无影响

### FR-06: 悬空 session 可见性
覆盖决策：D-004@v1
**Given** session 关联 runtime 的 last_heartbeat_at < stale_seconds（daemon 离线）
**When** 前端请求 list/get session
**Then** AgentSessionRead.runtime_online=false，前端显示"daemon 离线"徽标（不自动操作，用户手动 end/reopen）

### FR-07: lease service 死代码清理
覆盖决策：D-002@v1
**Given** DaemonLeaseService 上有 expire_overdue_leases（:239）+ 残留正向 claim/heartbeat 方法
**When** 清理执行
**Then** 删除死代码；保留 cancel_lease（:281）/_send_interactive_cancel（:461）；**保留** lease/service.py:706 expire_leases（活代码，被 batch:861 调用）

### FR-08: 守护测试（防回归）
**Given** 各 GC 行为
**When** 测试运行
**Then** 钉死：心跳续期→30min 长任务 lease 不过期 / interactive NULL 不被扫 / worktree 关联任务非终态不误删、终态(含cancelled)回收 / 各 env 开关生效 / retry 建新 run / runtime_online 计算正确

## 非功能需求
- **兼容性**：env 全关时行为同现状；worktree agent_run_id nullable 零回归；migration 可逆（项目未上线）
- **可回退**：GC env 单独开关（排查可关停单类）；config 心跳窗口/attempt 可配回原值（60s/3）
- **可测试**：每个 FR 有 GWT 守护测试，含"不被误杀"反向用例
- **跨平台**：APScheduler/reaper 兼容 Win/Linux/macOS（CLAUDE.md 规则 13）
- **不违背哲学**：GC 只收失联（心跳断/任务终态），绝无"任务跑了多久"自动超时

## 决策覆盖矩阵
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | （非目标） | cancel 真停已具备不做 |
| D-002@v1 | FR-07 | 死代码清理（保留 cancel + 活 expire_leases） |
| D-003@v2 | FR-03 | worktree 外键 + acquire 回填 + 终态集含 cancelled |
| D-004@v1 | FR-06 | 悬空可见性（不加自动兜底） |
| D-005@v1 | FR-05 | retry 建新 run，不保进度靠工具幂等 |
| D-006@v1 | FR-01 / FR-04 | APScheduler 骨架 + 心跳/attempt 可配 |
