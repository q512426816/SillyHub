---
author: qinyi
created_at: 2026-08-27 09:24:00
change: 2026-08-27-background-subagent-progress
plan_level: full
estimated_files: 17
cross_module: true
has_schema_change: true
has_state_machine_change: false
needs_parallel_execution: true
needs_human_review: true
---

# 实现计划（Plan）· 后台异步子代理进度可视化

> 本文件是 execute 阶段唯一真相源。任务蓝图卡片：`tasks/task-01.md` ~ `tasks/task-15.md`（编号连续不跳号）。
> 对应 brainstorm 雏形重编号说明：雏形 task-00 spike → 本文 task-01（Wave 1 最前，编号契约从 task-01 起连续）。

## 1. 总览

按"契约先行、共享文件分 Wave、三端并行"组织 15 个任务、6 个 Wave：

- **契约层先行**（Wave 2）：daemon 载荷类型（task-02）与 backend schema（task-05）先定契约，后续实现消费。
- **共享文件隔离**：`session-manager.ts`（task-01→task-03）、`run_sync/service.py`（task-05→task-06）、`session-panel.tsx`（task-12→task-14）各拆不同 Wave，防同 Wave 并行互覆。
- **spike 定参**（Wave 1）：task-01 实测 CLI task_* 发射与频率，回填 design.md §10，输出 task-03 节流参数与兜底权重决策。

## 2. Wave 分组与依赖

## Wave 1（spike 定参，独占）

- task-01

## Wave 2（契约先行，两端并行）

- task-02
- task-05

## Wave 3（核心行为，三端并行，依赖 Wave 1/2）

- task-03
- task-06
- task-07
- task-09

## Wave 4（测试与分发，依赖 Wave 3）

- task-04
- task-08
- task-10
- task-11

## Wave 5（用户可见 UI，依赖 Wave 4）

- task-12
- task-13

## Wave 6（收口，依赖 Wave 5）

- task-14
- task-15

### Wave 编排说明

- **契约层先行**（Wave 2）：daemon 载荷类型（task-02）与 backend schema（task-05）先定契约，后续实现消费。
- **共享文件隔离**：`session-manager.ts`（task-01 W1 / task-03 W3）、`run_sync/service.py`（task-05 W2 / task-06 W3）、`schema.py`（task-05 W2 / task-07 W3）、`session-panel.tsx`（task-12 W5 / task-14 W6）各拆不同 Wave，防同 Wave 并行互覆。
- **spike 定参**（Wave 1）：task-01 实测 CLI task_* 发射与频率，回填 design.md §10，输出 task-03 节流参数与兜底权重决策。

## 3. 任务清单（对照 tasks.md 注册表）

| ID | 名称 | 关键文件 | depends_on | 覆盖 |
|---|---|---|---|---|
| task-01 | spike：验证 CLI 0.3.181 task_* 发射与频率 | `sillyhub-daemon/src/interactive/session-manager.ts`（临时 debug）+ 本变更 `design.md` §10 | — | FR-09 / R-01 / R-03 |
| task-02 | daemon 事件载荷契约 | `types.ts` + `hub-client.ts` + `cli.ts` | — | FR-01/04 |
| task-03 | session-manager 综合改造（任务表+拦截+回执兜底+[TASK_*] 行+节流） | `session-manager.ts` | task-01, task-02 | FR-01/02/03 |
| task-04 | daemon 单测 | `interactive/__tests__/`（新增） | task-03 | FR-01/02/03 |
| task-05 | backend schema 扩展 + notify 透传 + publish | `schema.py` + `router.py` + `run_sync/service.py`（publish 段） | — | FR-04 |
| task-06 | submit_messages 跨轮归位 | `run_sync/service.py`（落库段） | task-05（同文件隔 Wave） | FR-05 / D-003@v1 |
| task-07 | 空 prompt inject 422 | `daemon/session/service.py` | — | FR-08 / D-004@v1 |
| task-08 | backend 单测 | `daemon/tests/` | task-05, task-06, task-07 | FR-04/05/08 |
| task-09 | gen:types 重生成 | `frontend/src/lib/api-types.ts` + `backend/openapi.json` | task-05 | FR-04 / NFR-03 |
| task-10 | 前端事件类型与 SSE 分发 | `frontend/src/lib/daemon.ts` | task-09 | FR-04 |
| task-11 | assembler [TASK_*] 解析 | `session-log-assembler.ts` | task-03 | FR-03/07 |
| task-12 | 后台卡片全生命周期 + agentTasks state | `agent-task-card.tsx` + `session-panel.tsx` | task-10 | FR-06 / D-005@v1 |
| task-13 | 目录/状态栏/会话块异步感知 | `subagent-catalog.tsx` + `turn-status-bar.tsx` + `turn-segment-views.tsx` | task-10, task-11 | FR-07 / D-005@v1 |
| task-14 | 发送按钮空内容禁点 | `session-panel.tsx`（同 task-12 文件隔 Wave） | task-12 | FR-08 |
| task-15 | frontend 单测 | `daemon/__tests__/`（扩展） | task-11, task-12, task-13 | FR-06/07 |

## 4. 跨任务契约（provides / expects_from 对账）

| 契约 | provider | 消费字段 | consumers |
|---|---|---|---|
| `sse_payload_contract` | task-02 | status(4 值)/task_id/tool_use_id/summary/last_tool_name/elapsed_ms/total_tokens/tool_uses/async | task-03 |
| `task_log_line_format` | task-03 | [TASK_STARTED/PROGRESS/NOTIFICATION] 前缀 + 单行 JSON 字段（task_name 统一键名）+ 节流口径 | task-04, task-11 |
| `api_schema` | task-05 | notify_agent_task_status 扩展字段 + openapi（async alias） | task-08, task-09 |
| `attribution_behavior` | task-06 | parent 行 run_id 归位 + LRU + 冷启动反查 + 兜底口径 | task-08 |
| `api_types_regenerated` | task-09 | frontend api-types.ts 含新事件字段 | task-10 |
| `frontend_dispatch` | task-10 | onAgentTaskStatus 回调携带全部扩展字段 | task-12, task-13 |
| （被测对象存在性） | task-05/06/07 | — | task-08 |
| （被测对象存在性） | task-11/12/13 | — | task-15 |

## 5. 验收与验证策略

- 每任务卡含 acceptance（可验证验收条件）+ verify（TDD/验证步骤）。
- 集成验收（execute 后期人工/verify 阶段）：本地起 daemon 跑一个 run_in_background Agent 会话，观察卡片 running（含进度行/走秒）→ 终态定格；空 prompt 被拒；刷新后状态从 [TASK_*] 行重建。
- 回归红线：前台（阻塞式）子代理状态推导不变；旧日志（无 [TASK_*] 前缀）渲染不变；theme 三主题取色走 brand-* 语义阶。

## 6. 风险与对策（承接 design §9）

- R-01/R-03 由 task-01 spike 前置消解；spike 结论为"不发"时 task-03 的回执兜底升为 primary（design 已留口径，无需改契约）。
- R-02 god 文件：task-03 单任务集中改 session-manager.ts，task-04 单测全覆盖后其余任务不再碰该文件。
- R-04 归位语义：task-08 归位单测 + task-15 前端会话视图回归测试双保险。

## 7. 生产接线路径说明

design 提到入口文件 `sillyhub-daemon/src/cli.ts`（事件透传 case），由 task-02 的 allowed_paths 覆盖（修改而非新增接线：现有 `case 'agent_task_status'` 扩展字段透传）。backend `main.py` 与前端入口不涉及改动。
