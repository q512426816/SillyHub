---
author: qinyi
created_at: 2026-08-29 20:48:03
---
# 需求规格（Requirements）

## 角色
| 角色 | 说明 |
|---|---|
| 主 agent（orchestrator） | mission 的主会话，派发 worker、汇总结果 |
| worker 子会话 | mission 分身（arch/impl/test 等），由 dispatch_worker 派发的临时会话 |
| daemon | 本地守护进程，daemon 掉线是本变更的触发条件 |
| backend | 挂起分流+重派编排方 |

## 功能需求

### FR-01: worker/主会话分流挂起
覆盖决策：D-005@v1
Given daemon 停止或掉线，该 daemon 名下有 active 会话
When suspend_sessions_for_daemon 或 session_offline_sweep_once 执行
Then **worker 子会话**（parent_session_id 非空）→ session failed(error_code=daemon_interrupted)+中断 run failed+lease cancelled；**主会话**（parent IS NULL）→ suspended（语义逐字不变）

Given 主会话（无 parent）被挂起
When daemon 回来
Then 走既有 recover→reconnecting→active 链（零改动回归锁定）

### FR-02: worker 自动重派
覆盖决策：D-001@v1, D-005@v1
Given worker 子会话被分流标 failed
When 挂起事务提交后
Then 异步触发重派：从 AgentSession 行重建 dispatch 上下文（provider/model/workspace_id/worktree_branch/mission 上下文）+ 经 dispatch_to_daemon 新 lease + metadata 注入 resume_session_id=agent_session_id（SDK resume id）

Given 同一 worker attempt>=3
When 挂起再次触发
Then 不再重派，session 终态 failed，mission converge/patrol 既有兜底收敛

Given 重派 dispatch 失败（无在线 daemon 等）
Then 记日志不阻塞挂起主路径；下轮 offline sweep 重试（60s 周期自愈）

### FR-03: daemon 消费 resume 续会话
覆盖决策：D-001@v1
Given worker lease 被 claim 且 payload 含 resume_session_id
When daemon _startInteractiveSession 执行
Then SessionManager.create 传 resume key → SDK --resume 续会话（历史延续；等 inject 才跑新 turn——对齐 restoreAndReconnect 语义）

Given payload 不含 resume_session_id（首派/旧 backend）
Then create 照常 fresh（向后兼容）

### FR-04: resume 失败自动降级
覆盖决策：D-002@v1
Given create 带 resume key 后 SDK 启动报 session 损伤（session not found/no conversation/unable to resume 类模式）
When daemon 检测命中
Then 清 resume key 重建 fresh 会话一次 + 事件上报 resume_downgraded（终态 metadata 备查）；再失败→普通 create 失败走 worker failed

### FR-05: claim 白名单 interactive 补透传
覆盖决策：D-005@v1
Given lease metadata 含 resume_session_id 且 lease kind=interactive
When build_claim_payload 走 interactive 分支
Then payload 透传 resume_session_id（当前仅 batch 分支透传——Grill C-02 修复点）

## 非功能需求
- 兼容性：主会话语义零改动（daemon-platform-resilience 全部用例回归锁定）；claim 新字段可选向后兼容；老 worker 行 role=NULL 靠 parent_session_id 识别
- 可测试：分流/重派/resume 消费/降级/节流/主会话回归各有集成用例
- 重派风暴防护：attempt 上限+异步 fire 节流+mission patrol 三层

## 决策覆盖矩阵
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-02, FR-03 | 仅 infra 中断继承 |
| D-002@v1 | FR-04 | resume 失败自动降级 |
| D-003@v1 | 全部 | 最小闭环（零新端点） |
| D-004@v1 | — | 原设计确认（已被 D-005 supersede 触发路径） |
| D-005@v1 | FR-01, FR-02, FR-05 | P0 方向重定位 worker 重派继承 |
