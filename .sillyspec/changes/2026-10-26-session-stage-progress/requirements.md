---
author: qinyi
created_at: 2026-10-26 03:29:06
generated_by: sillyspec-fourpiece-init
---
# 需求规格（Requirements）

## 角色
| 角色 | 说明 |
|---|---|
| 会话用户 | 在 Web 会话面板发送消息、等待 AI 响应的普通成员/管理员——阶段进度的最终受众 |
| 平台后端（backend） | 会话编排中枢：发布转发段阶段事件、承接 daemon 上报并转发到会话 SSE 流 |
| 本机执行器（sillyhub-daemon） | 用户机器上的守护进程：会话启动各步骤的真实执行方，上报启动阶段 |

## 功能需求

### FR-01: 转发段阶段发布（backend 自产，零 daemon 依赖）
Given 用户在会话发送消息（create/inject 均适用），backend 已创建控制指令
When 控制指令下发 WS 成功（dispatched）/ daemon ack 回执到达（delivered——以 daemon 真实确认为准，非 mark_delivered 的 push 成功点，D-011）
Then backend 分别向 `agent_session:{id}` 发布 `phase=dispatched` / `phase=delivered` 的 `turn_phase` 事件（含 session_id/run_id/timestamp）；发布失败仅记 warning，不阻断指令状态机

### FR-02: 启动准备段阶段上报（daemon → backend 新端点）
Given daemon 领取租约开始创建交互式会话（新会话首轮），run_id 已定（firstRunId 恒非空）
When skills 链接 / spec 拉取 / MCP 预取 / AI 进程启动 / 就绪五个步骤边界到达（SWR 命中跳过的步骤不发事件）
Then daemon 经 `POST /api/daemon/sessions/{session_id}/turn-phase` 上报（run_id 必填）；任一上报失败仅记 daemon 日志，不重试、不阻塞会话创建主流程

### FR-03: 轮内段阶段上报（daemon）
Given 消息注入既有会话（追问轮）或 AI 产出首个事件
When InputQueue push 完成 / onMessage 撤看门狗处
Then daemon 分别上报 `inject_received` / `first_event`；`first_event` 每轮至多一次（防重键 `(session_id, run_id)`，新 AgentRun 自然重置）

### FR-04: 状态条阶段文案（frontend 消费与展示）
Given 会话面板运行中轮收到 `turn_phase` 事件（词表 9 值，含 backend 发布的 `dispatched`/`delivered`；payload 键 `phase`/`detail`/`timestamp` 与信封逐字对齐，D-012）
When 事件按 run 归属路由到当前轮（缺失/null run_id 的事件防御性丢弃；at=本地到达时刻 Date.now()）
Then 状态条状态标签位显示词表对应中文文案（`PHASE_LABEL` 映射），替代笼统「排队中/执行中」；`first_event` 之后标签退位、右侧活动摘要接管（既有派生链零改动）；轮终态（turn_completed/failed/killed）清空 currentPhase（防断线假超时警示，D-013）；无 phase 信号时渲染路径与现状完全一致（零回归）

### FR-05: 阶段超时警示（frontend 本地计时）
Given 当前轮存在 `currentPhase` 且未到 `first_event` 退位
When 当前阶段停留时长 ≥ 30 秒（前端常量，每秒 tick 判定）
Then 状态条整条切警示样式（warning token 边框/底色/文字）并追加「已等待 N 秒」；不弹窗、不阻断正常阶段推进展示

### FR-06: 事件协议与类型同步
Given `TurnPhaseReportRequest` DTO 进入 OpenAPI
When 后端 schema 变更落库
Then 同一变更内跑 `pnpm gen:types` 与 `pnpm -C sillyhub-daemon gen:types` 并提交两处 api-types；前端 SSE 信封 `SessionEventKind` 增加 `"turn_phase"` + `phase`/`detail` 可选字段（`timestamp` 复用既有字段名，三键与 payload 逐字对齐 D-012；手写信封，不走 OpenAPI）

## 非功能需求
- 兼容性：老版本 daemon 不上报冷启动段时，backend 派发段照发、前端回退现状文案（部分生效而非报错）；未知 phase 值显示原始字符串兜底；既有端点/事件/表结构零改动（零 migration）。
- 性能：阶段事件每边界一次（低频），复用既有 Redis 发布通道；前端超时判定复用状态条既有每秒 tick，不新增定时器。
- 可靠性：阶段展示为纯增强——上报/发布/展示任一环节失败均静默降级，不影响会话主流程。

## 决策覆盖矩阵（如存在 decisions.md）
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-04 | 轻量单行形态：状态条文案增强，不新增区域、不留痕 |
| D-002@v1 | FR-01/02/03/04 | 盲区补齐+统一阶段轴：词表覆盖三段盲区与轮内映射 |
| D-003@v1 | FR-05 | 超时变色提示，不弹窗 |
| D-004@v1 | FR-01/02/03/06 | 方案 A：新增 SSE 事件 kind 走既有通道，不新增 WS 消息类型 |
| D-005@v1 | — | 落选方案（推断式）存档防复潮，无 FR 承接 |
| D-006@v1 | — | 落选方案（心跳轮询）存档防复潮，无 FR 承接 |
| D-007@v1 | FR-05 | 超时阈值 30s 前端常量，非配置项 |
| D-008@v1 | FR-04 | 轮内文案客户端映射，first_event 后标签退位 |
| D-009@v1 | FR-02/03 | 上报失败静默降级，不阻塞主流程 |
| D-010@v1 | FR-04 | 断线/刷新 phase 未知回退现状文案，不持久化 |
| D-011@v1 | FR-01 | delivered 挂 ack 回执点（Grill 阻断①修复） |
| D-012@v1 | FR-04, FR-06 | SSE 键名三端逐字对齐 phase/detail/timestamp（Grill 阻断②修复） |
| D-013@v1 | FR-02, FR-03, FR-04 | 精度包：at 时钟源/run_id 必填/终态清理/防重键/并行边界（Grill 阻断③+gap 修复） |

## 测试绑定（每条 FR 至少一行：`FR-NN: test/路径「用例名」`；不适用要写理由；flow done 空行拒收）

FR-01: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-02: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-03: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-04: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-05: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
FR-06: （待填——哪个测试文件/用例覆盖这条 FR；无测试面写「不适用：理由」）
