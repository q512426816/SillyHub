---
author: qinyi
created_at: 2026-10-28T00:40:00
---
# 需求规格（Requirements）— 2026-10-28-bg-task-status-report

## 功能需求

### FR-01: daemon 解析后台任务终态信号并上报

- daemon 必须解析 rollout 日志 user 消息内嵌的 `<task-notification>` 文本（task-id/tool-use-id/status/output-file 四字段），产 `bg_task_final` 事件经 onTurnMessage 桥→HubClient 新方法 notifyBgTaskFinal 上报平台（turn-phase 同款模式）；同 task-id 重复终态必须幂等（只上报一次）。

#### 场景：主路径

- Given daemon 管理的 CLI 会话中启动了 run_in_background Bash
- When 任务完成（CLI 注入 task-notification 到日志）
- Then daemon 在日志轮询节奏内解析并上报 bg_task_final（status=completed）

#### 场景：格式漂移降级

- Given task-notification 文本格式与预期不符
- Then 解析返回 null 静默跳过（不产事件、不报错、平台维持现状）

### FR-02: backend 事件模型扩展与 SSE 透传

- backend 必须接受 `bg_task_final` 事件类型（词表+负载可选字段校验，JSON 列零 migration）并经 SSE stream 透传前端。

#### 场景：主路径

- Given daemon POST 一条 bg_task_final 事件
- Then 落库 agent_run_logs 并经 SSE 推送给会话页前端

### FR-03: 前端条目终态翻转

- 前端收到 `bg_task_final` 后必须按 tool_use_id 配对「后台任务 · 运行中」条目并翻转为终态（completed/failed/stopped 三态，着色同既有状态标词表）；翻转必须幂等（会话刷新事件重放不重复翻转）。

#### 场景：主路径

- Given 活动流中存在后台任务启动条目（tool_use 含 run_in_background）
- When 收到同 tool_use_id 的 bg_task_final
- Then 该条目状态翻转为对应终态

#### 场景：旧 daemon 兼容

- Given 无 bg_task_final 事件的会话（旧版 daemon）
- Then 条目维持「运行中」现状显示，不误翻不报错

### FR-04: 会话空闲期后台任务运行中计数

- 前端必须由活动流事件配对（run_in_background 启动 ∪ bg_task_final 终态）推导运行中集合，会话空闲态状态区显示「后台任务 N 个运行中」（N=0 不显示）。

#### 场景：主路径

- Given 会话空闲且存在 1 个未配对终态的后台任务启动条目
- Then 状态区显示「后台任务 1 个运行中」

### FR-05: 三侧测试与兼容零回归

- 三侧新增单测/契约测试全绿；既有会话活动显示零回归；若后端 schema 面变化须 gen:types 双端同步（规则 21）。

## 非功能需求

- NFR-01: 三端兼容（Windows/Linux/macOS——纯文本解析无平台 API）。
- NFR-02: 仅跑相关测试面，全量归 CI。
- NFR-03: 平台实测全链路验收（启动后台任务→空闲计数→终态翻转）。

## 决策覆盖矩阵

| 决策 | 覆盖的 FR/章节 | 归属说明 |
|---|---|---|
| D-001@v1 | FR-01~04 全部（事件级上报路线） | 已采纳 |
| D-002@v1 | 非目标第 4 条（不做计数-only） | 落选防复潮 |
| D-003@v1 | 非目标第 4 条（不做超时猜测） | 落选防复潮 |

无未覆盖决策。剩余风险见 design.md R-01~R-05。

## 测试绑定（每条 FR 至少一行：`FR-NN: test/路径「用例名」`；不适用要写理由；flow done 空行拒收）

FR-01: sillyhub-daemon/tests/agent-log/parse-claude-code-jsonl.test.ts（新增 task-notification 解析用例——本会话 rollout 实录 fixture；daemon 测试布局惯例 tests/ 根）
FR-02: NEW:backend/app/modules/daemon/tests/test_session_bg_task_final.py（新端点契约用例：DTO 校验/越权防护/幂等索引）
FR-03: frontend/src/components/agent-log/__tests__/（条目翻转幂等用例，plan 定位精确组件）
FR-04: 同 FR-03 组件套件（计数推导纯函数用例）
FR-05: 三侧相关测试面全绿 + tsc/lint
