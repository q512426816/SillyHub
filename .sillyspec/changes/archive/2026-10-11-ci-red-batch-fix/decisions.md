---
author: flow-machine-draft
created_at: 2026-10-11T14:31:24.610Z
---
# 决策记录（Decisions）— 2026-10-11-ci-red-batch-fix

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：daemon api-types.ts 的 872 行漂移里除已核实的改名外还可能藏其它 schema 形态变化，daemon 源码若引用了被改窄的类型会 typecheck 红灯——已用 `pnpm -C sillyhub-daemon typecheck`（0 错）实测兜住，残余风险由 daemon-ci 的 typecheck+test 复核。放弃的方案：给 PublishIntent.duration_api_ms 补默认值 `= None`（需移动字段位置避开 dataclass 非默认位序约束，会改变既有位置参数语义，波及 production 构造点，收益仅省一处夹具参数——不做）；让迁移锚测试改为不锚具体 revision（已有 test_migration_single_head.py 动态断言单头，本锚的价值恰在钉具体链尾，按惯例前移即可）。
