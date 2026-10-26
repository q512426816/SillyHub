---
author: qinyi
created_at: 2026-10-26T13:52:00
---
# 任务注册表（Tasks）— 2026-10-26-session-change-progress-hover

> brainstorm 初版（plan 阶段展开 Wave/TaskCard 后写回）。勾选证据口径：哨兵逐 task 核对提交 token/review.json 证据。

- [x] task-01: backend ChangeSummary 加 stage_progress/task_progress/thin_flow 三 DTO 与 optional 字段（schema.py，含子 DTO 定义与 openapi 产物）
- [x] task-02: backend _extract_stage_progress 提取器（stages/steps 分组计数+耗时秒数+revision，时钟注入；畸形 fail-open→None）+ test_progress_projection_ext.py 主路径/降级/畸形样本用例
- [x] task-03: backend _aggregate_task_progress 批量聚合（tasks 表 IN 查询防 N+1，total 排除 cancelled）+ 无 N+1 断言用例
- [x] task-04: backend thin_flow 读侧投影（change.stages JSON→ChangeSummary.thin_flow，缺键 None）+ 投影用例
- [x] task-05: backend heartbeat DaemonHeartbeatThinFlow 载荷 + 消费归一（phase 四枚举）落 stages["thin_flow"]（坏条目单条丢弃）+ test_heartbeat_thin_flows.py 主路径/坏条目/未知变更用例
- [x] task-06: daemon sillyspec-manager flow status 采集执行器（progress 同拍三态矩阵、失败静默）+ __tests__/sillyspec-flow-status-collector.test.ts 三态用例
- [x] task-07: daemon hub-client heartbeat 载荷加 thin_flows（白名单字段，仅活跃 thin）+ 载荷组装用例
- [x] task-08: frontend change-progress-row.tsx（全量 5 圈/轻量相位行双分支 + 异常态映射 + 升厚/分流标注 + 降级）+ __tests__ 双分支/异常/降级用例
- [x] task-09: frontend change-total-progress-ring.tsx（总圈双口径 + 最新进行中选取）+ __tests__ 口径/选取/缺失用例
- [x] task-10: frontend session-change-files-hover.tsx 接线（进度行内嵌/总圈挂载/计数徽标双色）+ 既有测试补断言
- [x] task-11: 双 gen:types 再生成提交（frontend + sillyhub-daemon api-types.ts + backend/openapi.json，CLAUDE.md 规则 21）
- [x] task-12: UI 原型真码产出（prototype-session-change-progress.html，R-06 计划）或登记复用留痕
