---
author: flow-machine-draft
created_at: 2026-10-16T02:14:25.090Z
---
# 决策记录（Decisions）— 2026-10-16-session-run-status-realtime

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：run 状态回写时机依赖 daemon 回传（run 终态经 daemon RPC/清扫收敛落库）——daemon 半死时 run 可能滞留 running（转圈不停）。缓解：既有 lease 超时/清扫机制兜底收敛；且终态权威（ended/failed）与活性兜底信号不受影响。放弃的方案：a) 按用户最初设想做「交互触发按需查询 daemon 推导」——需要新 RPC + daemon 在线，平台派发会话本就有后端权威 run 状态，绕远路；保留为本地会话未来的可选增强。b) 前端单独拉每会话 run 列表端点——N+1 请求放大，列表批量注入一条 SQL 更优。c) run 状态直接写进 AgentSession.status 列——混淆会话生命周期与轮次执行两层语义（一轮跑完会话仍 active），动 ORM 需迁移。
