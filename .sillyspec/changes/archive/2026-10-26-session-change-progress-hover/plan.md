---
plan_level: full
execution_mode: main  # 缺省 main 直写（R7/R8 对撞实证派发税 3.6×；本变更每任务单卡上下文均可吞吐，无分片需求）
---

# 实现计划（Plan）— 会话悬浮变更进度展示

## Spike 前置验证

不需要——关键假设已由 Design Grill S2 独立评审源码实证（enrich_summaries 复合 IN 先例 / latest_progress 六表 JSON 形态 / heartbeat 整包直写语义 / sillyspec_status_map 级化 / themes token 键名，见 review.json brainstorm-review-2026-10-26-134910）。唯一留核对项（thin phase 归一与 sillyspec src/flow.js:3284-3296 逐字对齐）归入 task-05 实现首步，非技术不确定性。

## Wave 1（并行，无依赖）
- task-01

## Wave 2（依赖前序 Wave）
- task-02
- task-05
- task-06
- task-08
- task-09

## Wave 3（依赖前序 Wave）
- task-03
- task-07
- task-10

## Wave 4（依赖前序 Wave）
- task-04
- task-12

## Wave 5（依赖前序 Wave）
- task-11

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | backend DTO 契约定稿 | W1 | P0 | — | FR-01, FR-03, FR-06, D-004, D-008@v2 | schema.py 三子 DTO（StageProgressEntry/TaskProgressSummary/ThinFlowProgress）+ ChangeSummary 三 optional 字段 + openapi 导出；本步即契约面（daemon/backend/frontend 三端后续全按此对齐） |
| task-02 | stage_progress 提取器 | W2 | P0 | task-01 | FR-01, D-004 | service.py _extract_stage_progress（stages/steps 分组计数+耗时秒数+revision，时钟注入）+ test_progress_projection_ext.py 主路径/降级/畸形用例 |
| task-03 | task_progress 批量聚合 | W3 | P0 | task-01 | FR-02, D-005 | _aggregate_task_progress（tasks 表 IN 单查询防 N+1，done 计分子/排除 cancelled 计分母）+ 无 N+1 断言用例 |
| task-04 | thin_flow 读侧投影 | W4 | P1 | task-01 | FR-03, FR-07 | change.stages JSON→ChangeSummary.thin_flow（缺键 None fail-open）+ 投影用例 |
| task-05 | heartbeat 载荷与逐变更写入 | W2 | P0 | task-01 | FR-03, FR-06, D-008@v2, D-014 | DaemonHeartbeatThinFlow（含 workspace_id）+ 消费归一 phase 四枚举 + 行锁事务 SELECT FOR UPDATE→merge stages["thin_flow"]→UPDATE（不刷 updated_at）+ test_heartbeat_thin_flows.py；实现首步逐字核对 flow.js:3284-3296 归一口径 |
| task-06 | daemon flow status 采集器 | W2 | P0 | task-01 | FR-03, FR-06 | sillyspec-manager.ts 采集执行器（progress 同拍三态矩阵、失败静默、仅活跃 thin）+ collector.test.ts 三态用例 |
| task-07 | daemon heartbeat 载荷组装 | W3 | P0 | task-01, task-06 | FR-03, FR-06 | hub-client.ts thin_flows 键（workspace_id + 白名单字段）；组装断言并入 task-06 的 sillyspec-flow-status-collector.test.ts 同文件（design 清单无独立 hub-client 测试文件）；daemon 侧类型可手写载荷 interface 过渡，task-11 统一 gen:types 收口 |
| task-08 | 前端进度行组件 | W2 | P0 | task-01（gen:types 首跑） | FR-01, FR-02, FR-03, FR-04, D-002, D-005~D-007 | change-progress-row.tsx 双分支（is_thin && !upgraded 单源规则）+ 异常态映射 + 升厚/分流标注 + 降级 + 测试；开工前 pnpm gen:types 拉新类型 |
| task-09 | 入口总进度圈组件 | W2 | P0 | task-01（gen:types 首跑） | FR-05, D-003, D-013 | change-total-progress-ring.tsx（双口径单源函数 + updated_at 显式重排选取）+ 测试 |
| task-10 | 悬浮框接线 | W3 | P0 | task-08, task-09 | FR-05, FR-08, D-009, D-012@v2 | session-change-files-hover.tsx（进度行内嵌/总圈挂载/徽标双态 blue 固定阶/归档不挂）+ 既有测试补断言 |
| task-11 | 双 gen:types 收口 | W5 | P0 | task-01~task-10 | FR-06, 规则 21 | pnpm gen:types + pnpm -C sillyhub-daemon gen:types + backend/openapi.json 同提交核对（schema 定稿后最终态） |
| task-12 | UI 原型真码产出 | W4 | P1 | task-08~task-10 | R-06 | prototype-session-change-progress.html 真码管线产出（组件方言同源）或登记复用留痕 |

## 关键路径

task-01 → task-02/03/04/05（backend 并行簇）→ task-08/09/10（前端，gen:types 后）→ task-11 → task-12；task-06/07（daemon 簇）与 backend 簇并行，在 task-11 前汇合。

## 全局硬约束（从 design.md 逐字抄录，绑定所有 task）

- DaemonHeartbeatThinFlow 必含 workspace_id（sillyspec_status 是实例级全局键，无此键无法定位变更行，D-008@v2）。
- heartbeat 逐变更写入：行锁事务 SELECT FOR UPDATE→merge stages["thin_flow"]→UPDATE；**UPDATE 只 set stages 列不刷 changes.updated_at**（D-014@v1）；坏条目/未匹配行单条丢弃整批不拒。
- 入口总圈选取：`[...active].sort(updated_at desc)[0]` 前端显式重排，**禁用后端列表序（未归档优先+created_at desc）直接取首**（D-013@v1）。
- 渲染分支单源规则：`is_thin && !upgraded → 轻量相位行；否则（含 service.py:2277 change_type=='quick' 独立判 thin 场景）→ 全量 5 圈行`。
- execute 圈口径=Task 表聚合 n/m（done 计分子、total 排除 cancelled），不用 Wave 步骤数（D-005@v1）。
- 计数徽标蓝=blue-* 固定阶真信息蓝（semantic.info 两主题均青不可用，D-012@v2）；其余色阶走主题语义 token（success/warning/error——themes.ts:46 实际键名），零硬编码 hex。
- 全部新字段 optional default None；三类旧环境（旧 daemon/存量 latest_progress/老 CLI）fail-open 降级现状渲染，不报错。
- 零表结构变更（零 Alembic migration）；唯一持久化落点 changes.stages JSON 的 thin_flow 子键。
- 后端 schema 变更同一变更内必须跑 `pnpm gen:types` + `pnpm -C sillyhub-daemon gen:types` 并提交两处 api-types + backend/openapi.json（CLAUDE.md 规则 21 双义务）。
- 只跑聚焦测试禁全量（CLAUDE.md 规则 0）；兼容 Windows / Linux / macOS（规则 13）；前端多主题铁律（规则 20）。

## 全局验收标准

1. 全部聚焦测试通过：backend pytest（test_progress_projection_ext.py / test_heartbeat_thin_flows.py）、daemon vitest（sillyspec-flow-status-collector.test.ts）、frontend vitest（change-progress-row / change-total-progress-ring / session-change-files-hover 三个测试文件）。
2. requirements.md 测试绑定 8 条 FR 全部落实到具体用例名。
3. brownfield 三降级场景（FR-07）实测：旧 daemon 无键/坏 JSON/CLI 无 flow 命令——前端与后端均不报错、降级现状。
4. 双 gen:types + openapi.json 同提交（task-11 核对）。

## Review Focus 盲区清单（隐含面）

| # | 输入/条件 | 合理人预期行为 | 承接落点 |
|---|---|---|---|
| 1 | latest_progress stages 行存在但 steps 空（阶段未初始化） | stage_progress 该阶段 steps_total=0、占比渲染空圈不除零 | task-02 + task-08 |
| 2 | 变更全部 task 被 cancelled（total=0） | execute 圈显示"—"不除零，不用 0/0 | task-03 + task-08 |
| 3 | thin_flows 条目 workspace_id 合法但变更行不存在（已删除） | 静默跳过不建行不报错 | task-05 |
| 4 | reparse 刚重建 stages 后 heartbeat 未到（自愈窗口内查询） | thin_flow=None→前端降级现状，≤1 心跳周期自愈 | task-04/task-05 + R-07 |
| 5 | is_thin=true 但 thin_flow=None（旧 daemon） | 轻量项现状渲染（徽标+干活中），不渲染空相位行 | task-08 降级分支 |
| 6 | 两个 active 变更 updated_at 完全相同 | 重排稳定（次序键回退 change_key），不闪烁 | task-09 |
| 7 | 归档组展开后点开条目 | 不渲染进度行/总圈（D-009），大弹窗照常 | task-10 |
| 8 | 轻量变更 tasks_total=0（spec 阶段未建 tasks） | 相位行不显示"任务 0/0"，只显示相位与批准态 | task-08 |
| 9 | 升厚变更 thin_flow 残留旧 phase 值 | 走全量分支忽略 thin_flow 展示值（upgraded 标注仍显） | task-08 单源规则 |
| 10 | stage 状态为未知新枚举值（CLI 升级新状态） | 圈按非 completed 渲染灰态+原值文字，不崩 | task-08 白名单外兜底 |
