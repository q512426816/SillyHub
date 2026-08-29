---
author: qinyi
created_at: 2026-08-29 21:05:00
plan_level: full
---

# 实现计划（Plan）：worker 会话中断重派继承

## Wave 1（backend 分流+claim 透传，文件正交并行）
- task-01
- task-03

## Wave 2（backend 重派编排）
- task-02

## Wave 3（daemon resume 接线）
- task-04

## Wave 4（daemon 损伤降级）
- task-05

## Wave 5（集成回归）
- task-06

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | backend 分流挂起 | W1 | P0 | — | FR-01, D-005@v1 | suspend_sessions_for_daemon 与 session_offline_sweep_once 按 parent_session_id 分流：worker 子会话→session failed+中断 run failed(**error_code=daemon_interrupted 落 AgentRun.error_code，session 行仅 status=failed+ended_at——session 无 error_code 列零迁移**)+lease cancelled+重派种子（返回 worker 列表供 S2 异步 fire；router 响应契约不变新字段仅内部消费防 test_session_suspend.py:363 断言破）；主会话→suspended 语义不变（回归锁定） |
| task-02 | backend worker 自动重派 | W2 | P0 | task-01 | FR-02, D-001@v1, D-005@v1 | 重派函数：prepare_interactive_dispatch 复用原 session 行（翻回 active+清 ended_at+turn_count 归位）+双表上下文重建（session 行 provider/cwd/tree_depth/profile_id + 首 run 行 model/objective/role/read_only/mission_id/worktree_branch）+ prompt 按 objective 重渲染 build_worker_briefing + resume_session_id=agent_session_id（NULL 回退最新 run.session_id）注入 lease metadata + attempt>=3 节流 + 三互斥守卫（mission converged/cancelled 检查+patrol ④排除 daemon_interrupted+⑦30min 窗口对齐）；suspend/sweep 事务后异步 fire；placement.py prepare_interactive_dispatch 加 resume_session_id 形参；patrol.py 职责④候选排除 |
| task-03 | backend claim interactive 透传 | W1 | P0 | — | FR-05 | build_claim_payload interactive 分支补 resume_session_id 白名单透传（context.py:447-494 补键，batch 分支 :795 已有先例）；测试扩展现有 test_build_claim_payload.py（不与 01 同文件防 W1 冲突） |
| task-04 | daemon resume 接线 | W3 | P0 | task-03 | FR-03 | daemon.ts payload 归一化 resumeSessionId → CreateSessionInput.resume 新字段 → _startInteractiveSession 传 SessionManager.create（session-manager spec.resume → driverOpts.resume 既有链激活）；不含 resume 时行为零变化 |
| task-05 | daemon 损伤降级 | W4 | P0 | task-04 | FR-04 | SessionManager.create 带.resume 后 SDK 启动报损伤（session not found/no conversation/unable to resume 正则）→ 清 resume 重建 fresh 一次+resume_downgraded 事件上报；再失败走普通 create 失败 |
| task-06 | 集成回归 | W5 | P0 | task-01~05 | 全 FR | 全链：daemon 停止→worker failed+重派→claim resume→SDK 续会话→10s fallback 首轮驱动；主会话回归锁定（resilience 用例零破坏）；节流 attempt>=3 终态；降级重建+披露；互斥守卫（converged mission 不重派/patrol ④不捞 daemon_interrupted） |

## 关键路径
task-01/03 → task-02 → task-04 → task-05 → task-06

## 全局验收标准
1. backend/daemon 相关单测全绿（仅本变更相关，全量留 CI）；mypy/tsc/ruff 0 新增
2. integration-critical 集成冒烟：worker 掉线→failed→重派→claim resume→续会话全链；主会话零破坏；三互斥守卫各有用例
3. 旧行为不变：主会话挂起/恢复语义、worker 首轮 10s fallback、claim 无 resume 字段向后兼容

## 覆盖矩阵
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-02, task-04 | 仅 infra 中断继承+resume 续会话用例 |
| D-002@v1 | task-05 | 损伤降级+披露用例 |
| D-003@v1 | task-02, task-03 | 最小闭环零新端点 |
| D-005@v1 | task-01, task-02, task-03, task-06 | worker 分流+重派+透传+全链 |
| FR-01 | task-01, task-06 | 分流挂起+主会话回归 |
| FR-02 | task-02, task-06 | 重派+节流+守卫 |
| FR-03 | task-03, task-04, task-06 | claim 透传+daemon 消费 |
| FR-04 | task-05, task-06 | 降级+披露 |
| FR-05 | task-03 | interactive 白名单补透传 |
