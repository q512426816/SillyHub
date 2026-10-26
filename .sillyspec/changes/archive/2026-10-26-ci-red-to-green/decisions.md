---
author: flow-machine-draft
created_at: 2026-10-26T23:37:21.028Z
---
# 决策记录（Decisions）— 2026-10-26-ci-red-to-green

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：- **最大风险**：daemon 源码 try/catch 加固若吞掉本应上抛的错误——已核对 reportTurnPhase 唯一职责是 fire-and-forget 上报（后端 POST），失败本就设计为不可见（D-009 + 2026-10-26-turn-phase-prod-fix 观测首警兜底），吞同步异常不改变任何业务承诺；且加固后被影响测试断言的是「create 被调用」「pull 被调用」，不依赖上报失败外溢。 - **断言收窄的掩盖风险**：task-lifecycle 过滤收窄可能掩盖未来真实旁路消息污染——对策：收窄精确到 `type==='turn_phase_report'`（不放宽为白名单制），TASK 行数/形状断言原样保留。 - **importOriginal 风险**：真实 spec-sync.js 顶层执行若未来引入副作用（如启动定时器）会进测试——记为已知取舍，当前顶层纯声明（已核对 export 清单）。 - **试过放弃的方案**：① 给 SessionManager deps 增加独立 `onTurnPhaseReport` 回调取代带内 `turn_phase_report` 消息——属 2026-10-26-session-stage-progress D-013④ 已定桥协议的重构，超出本修复变更范围且要动 archived 变更的契约，放弃；② frontend 删/跳过 5 个慢文件——掩盖手法，违反 FR-03「不得删断言」，放弃；③ backend-ci 撞顶再抬 timeout-minutes 到 60——治标，若无挂死实证不先动，留待 FR-04 判定。
