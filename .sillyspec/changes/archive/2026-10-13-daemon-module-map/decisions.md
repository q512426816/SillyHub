---
author: flow-machine-draft
created_at: 2026-10-13T00:15:07.108Z
---
# 决策记录（Decisions）— 2026-10-13-daemon-module-map

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：答：最大风险：手改 fr 文件违反文件头「机械解析契约勿手改」告示的字面——但迁移本身是工具 advisory 明示的 sanctioned 动作（「确认后可迁移」），且字段逐字保持 + FR-04 validate/digest 自检兜底；若未来 fr-index 重提炼按归档重放覆写，条目会以新域重新落位（我们已把域修对），重放与迁移结果一致。次风险：根图与项目图双处登记造成 paths 并集冗余——只在项目图登记避免（task-runner 模块本体在项目图）。 试过但放弃的方案：① 按告警字面把 5 条 FR 迁 fr/daemon.md（daemon 模块=daemon.ts WS 核心，测试目录登记进该模块语义错位；且登记若进 task-runner 模块则未来变更落 task-runner 域、与存量 daemon 域分裂，放弃）；② 在根图 docs/multi-agent-platform/modules/_module-map.yaml 登记（根图头部自述细粒度模块归各自项目图，task-runner 模块本体在项目图，跨图重复登记徒增并集冗余，放弃）；③ 给 tests 目录另铸新模块卡（如 task-runner-tests，新造伪模块 id 无对应域文件与语义，过度工程，放弃）。
