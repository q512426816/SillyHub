---
author: qinyi
created_at: 2026-08-29 20:48:03
---
# 提案书（Proposal）

## 动机

daemon 掉线后 mission worker 子会话被挂起（daemon-platform-resilience 的 suspend 语义一视同仁），但 worker 是临时会话无用户手恢复——只能等 24h GC 标 failed，期间 mission 卡住。源自 multica RecoverOrphanedTasks 调研：临时任务应自动重派继承原会话续跑。

## 关键问题

1. **worker 会话挂起无恢复路径**：suspend/sweep 不区分主会话与 worker——worker 标 suspended 后无 recover 触发者，等 GC 或人工 intervene
2. **中断后上下文归零**：即使手动重派 worker，无 session 继承（resume 链在 interactive claim 分支未透传）——SDK 会话历史丢失，worker 从零开始
3. **重派风暴风险**：daemon 反复掉线时 worker 批量重派需节流

## 变更范围

- **backend**：suspend_sessions_for_daemon 与 session_offline_sweep_once 按 parent_session_id 分流（worker→failed+重派种子/主会话→suspended 不变）；worker 自动重派（AgentSession 行重建 dispatch 上下文+resume_session_id 注入+attempt>=3 节流）；claim interactive 分支补 resume_session_id 白名单透传
- **daemon**：_startInteractiveSession 消费 resume_session_id 传 SessionManager.create；create 支持 resume key；SDK 损伤自动降级 fresh+披露
- 不改：主会话挂起/恢复语义、前端、mission converge/patrol、lease 过期 GC

## 不在范围内（显式清单）

- 不做 poison 黑名单体系（infra 中断=可续，内容失败不在恢复面）
- 不做前端「继承会话」标识展示
- 不做 batch lease 过期路径（生产不可达，Grill P0 证伪）
- 不做 mission converge/patrol 改动（worker 重派后收敛走既有链）
- 不改主会话（orchestrator/用户 chat）任何语义

## 成功标准（可验证）

- daemon 停止：主会话 suspended（现状不变）；worker 子会话 failed(daemon_interrupted)+自动重派（新 lease 带 resume_session_id）
- daemon 回来后 claim worker lease：SDK --resume 续会话（历史延续不归零）
- resume 失败（session 损伤）：自动降级 fresh 重建一次+resume_downgraded 披露
- 重派节流：attempt>=3 worker 终态 failed，mission patrol 兜底
- 主会话挂起/恢复回归：daemon-platform-resilience 全部既有用例零破坏
