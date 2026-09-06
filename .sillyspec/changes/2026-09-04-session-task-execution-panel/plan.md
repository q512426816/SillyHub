---
author: qinyi
created_at: 2026-09-05 00:02:21
plan_level: full
---

# 实现计划（Plan）— 会话任务执行面板

## 复杂度分类

```
plan_level: full
reason: 10 任务/14 文件，跨 backend daemon 模块与 frontend 数据层/UI 层，含新表+新端点 schema 变更
estimated_files: 14
cross_module: true
has_schema_change: true
has_state_machine_change: false
needs_parallel_execution: false
needs_human_review: false
```

## Spike 前置验证

无 Spike——技术栈全部为仓内既有模式（SQLModel 建表/Alembic 迁移/FastAPI 端点/fetch-sse 消费/antd 折叠面板），无未经验证的集成点。唯一查证项 R-07（plan_mode_entered 历史回放）并入 task-07 实现前核对，不通过则总纲降级为「仅活跃轮显示」，不推翻任务结构。

## Wave 1（并行，无依赖）
- task-01
- task-05

## Wave 2（依赖前序 Wave）
- task-02

## Wave 3（依赖前序 Wave）
- task-03
- task-09

## Wave 4（依赖前序 Wave）
- task-04
- task-06

## Wave 5（依赖前序 Wave）
- task-07

## Wave 6（依赖前序 Wave）
- task-08

## Wave 7（依赖前序 Wave）
- task-10

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | agent_session_task 表 + Alembic migration | W1 | P0 | — | FR-05, D-006 | model.py 新表（18 列、(session_id,task_id) 唯一、run_id 索引、会话级联）；down_revision 锚定执行时 head |
| task-02 | AgentSessionTaskRead + GET /tasks 端点 | W2 | P0 | task-01 | FR-06 | schema.py 新 DTO（snake_case 18 字段）；router.py 新 GET 端点（鉴权同 runs：get_agent_session+TaskRunAgentUser，限 200 条） |
| task-03 | 上报端点 upsert 持久化 | W3 | P0 | task-02 | FR-05 | 新 agent_task_store.py（终态定格/started_at/finished_at）；notify_agent_task_status 接线，持久化旁路失败不影响 SSE 转发 |
| task-04 | 后端测试 | W4 | P0 | task-01,02,03 | FR-05, FR-06 | test_agent_session_tasks.py：upsert 语义/终态定格/端点鉴权与限条/会话删除级联 |
| task-05 | applyAgentTaskStatusEvent 抽出共享 | W1 | P0 | — | FR-02 | 等值重构：session-panel.tsx 归约抽到 agent-task-store.ts 并**保留 re-export**（agent-task-card-lifecycle.test.tsx:35 直接 import 该函数，不破坏既有引用）；ActivityCatalog 行为不变 |
| task-06 | useSessionTasks hook + listSessionTasks | W4 | P0 | task-02, task-09 | FR-02, FR-07 | 快照拉取（mount/重连）+ applyEvent 合并；daemon.ts 新函数对齐 listSessionRuns 先例（返回类型用 task-09 生成的 api-types） |
| task-07 | TaskExecutionPanel 组件 | W5 | P0 | task-05, task-06 | FR-01, FR-02, FR-03, FR-04, FR-07 | 折叠摘要行+三页签（任务清单/运行中复用三类卡/轮次历史 refreshSignal）；对照原型；实现前核对 R-07 |
| task-08 | session-panel 三挂载点接线 | W6 | P0 | task-05, task-07 | FR-01 | page（AgentLogCard 同层）/dialog/mobile 三处挂载 + SSE 分发处 applyEvent；R-01 回归红线 |
| task-09 | pnpm gen:types 同步 | W3 | P0 | task-02 | FR-06 | api-types.ts + openapi.json 重新生成；先验 node_modules 健康（R-06） |
| task-10 | 前端测试与回归 | W7 | P0 | task-07, task-08 | FR-01~FR-04, FR-07 | 面板三页签/折叠摘要/空态/hook 用例；回归点名 agent-task-card-lifecycle.test.tsx（直接 import 归约函数）+ session-panel 既有测试全绿（零回归硬约束） |

## 关键路径

task-01 → task-02 → task-06 → task-07 → task-08 → task-10（最长依赖链，决定交付周期；task-03/04/09 挂在旁支）

## 共享文件约束（Wave 划分依据）

- `backend/app/modules/daemon/router.py`：task-02（新 GET 端点）与 task-03（上报端点接线）共享 → 强制 W2/W3 串行。
- `frontend/src/components/daemon/session-panel.tsx`：task-05（归约抽出）与 task-08（挂载接线）共享 → 强制 W1/W6 串行。
- **类型产物次序**：task-09（gen:types 产出 AgentSessionTaskRead 类型，W3）先于 task-06（listSessionTasks 返回类型依赖该产物，W4）——拓扑重排已保证不同 Wave 串行。

## 全局验收标准

1. 后端 pytest：task-04 新增用例全绿；不跑全量（CLAUDE.md 规则 0，全量留 CI）。
2. 前端 vitest：task-10 新增用例全绿 + session-panel 既有测试零回归（/runtimes 弹窗硬约束）。
3. 刷新/切会话再回来，任务清单从快照恢复且终态定格显示（FR-02/FR-05 集成验收，verify 阶段真实集成证据——本变更判级 integration-critical）。
4. 无任务事件的会话：面板空态、无报错、对话流行为不变（FR-07 + brownfield 兼容）。
5. ActivityCatalog 旧入口与 SSE 转发主链路行为不变（可回退性）。
6. gen:types 产物提交（api-types.ts + openapi.json 不落后后端）。

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-02, task-03, task-06, task-07 | FR-01~FR-05 用例（任务清单/运行中/轮次/持久化四项内容） |
| D-002@v1 | —（约束） | 非目标：无会话列表改动任务（tasks 无 session-list-panel.tsx） |
| D-003@v1 | task-07, task-10 | 空态用例（FR-07） |
| D-004@v1 | task-07 | 折叠面板形态对照原型（⚠️ 自主决策待用户复核） |
| D-005@v1 | 全部任务 | 设计整体（⚠️ 自主决策待用户复核） |
| D-006@v1 | task-01, task-02, task-06 | 18 列/18 字段对齐事件契约（run_id/progress int/message） |
| FR-01 | task-07, task-08, task-10 | 面板形态用例 |
| FR-02 | task-02, task-03, task-05, task-06, task-07 | 清单持久化+实时用例 |
| FR-03 | task-07 | 运行中复用三类卡 |
| FR-04 | task-07 | 轮次列表+刷新信号 |
| FR-05 | task-01, task-03, task-04 | upsert/终态定格用例 |
| FR-06 | task-02, task-04, task-09 | 端点鉴权/限条/类型同步 |
| FR-07 | task-06, task-07, task-10 | 空态降级用例 |
