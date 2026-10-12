---
author: flow-machine-draft
created_at: 2026-10-12T00:35:55.558Z
---
# 决策记录（Decisions）— 2026-10-12-task-sweep-rpc-route-key

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：- 最大风险：现网若存在 `daemon_instance_id=NULL` 的 legacy runtime 行，其路由键回落 runtime_id——若 hub 恰也无该键连接，行为与修复前相同（伪离线跳过），不劣化于现状；D-007 迁移已完成（register 必绑定），存量 NULL 行按设计不可达。 - 放弃方案 A：在 `hub.send_rpc` 内做 runtime→instance 兼容映射——否，hub 是纯内存路由层，引入 DB 依赖破坏职责边界且掩盖调用方缺映射的事实；映射归调用方（`daemon_rpc.py:79` 先例）。 - 放弃方案 B：启动清扫挂 daemon 首次连接事件触发——需 hub 新增回调钩子，改动面大且首连早于多 runtime 就绪；固定 60s 延迟达成同等效果、零新耦合，常数可调。
