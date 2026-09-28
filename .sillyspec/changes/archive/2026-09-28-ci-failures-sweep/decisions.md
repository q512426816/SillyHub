---
author: flow-machine-draft
created_at: 2026-09-28T04:57:15.756Z
---
# 决策记录（Decisions）— 2026-09-28-ci-failures-sweep

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：daemon 超时修复依赖「waitForSpawn 轮询 mock.calls」的既有 helper 语义，若未来 spawn 前路径再加真实 IO，waitForSpawn 本身仍稳（真实时间预算轮询）；但**同文件多轮 runLease** 的用例若忘传 minCalls 会复发第二轮丢事件——已在 helper docblock 写死该死锁链与用法。 放弃的方案：①给 applyClaudeSettings 打 mock 挡 unlink——放弃，撤下语义是有意产品行为，mock 会掩盖真实 IO 时序；②e2e 改用平台 admin 身份绕过菜单权限——放弃，N4 负向断言依赖非 admin 形态，且冒烟角色语义就是普通成员。 残留风险：e2e N2/N3 本机无 Docker 全栈未实证（e2e-ci 验证）；304eba982 冲掉 fed6e9e9a 的模式提示并行会话基于旧基线提交会回退他人已合入改动——本仓库已知协作形态，非本次可根治。
