---
author: qinyi
created_at: 2026-10-25 09:48:17
generated_by: sillyspec-fourpiece-init
---
# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 会话使用者 | 在轨迹视图查看一轮对话的输入/模型/工具时间分布与逐条记录 |
| 平台运维者 | 通过轨迹的「上下文/系统」行判断哪些消息是系统注入、配置何时变更 |

## 功能需求

### FR-01: 三类系统注入消息在数据层携带 turn_trigger 来源标记

- backend **必须**在三个注入点盖 `turn_trigger` 戳：主控简报轮 → `team_brief`、Worker 派发首轮 → `worker_dispatch`、后台通知（workers-done / child-wake）→ `agent_notice`；戳经 `_merged_turn_metadata` 落 `AgentRunLog.metadata_` 并随 SSE 透传。真实用户输入路径 **禁止** 盖这三类戳；存量无戳数据 **禁止** 回填（D-003）。

#### 场景：主路径

Given 会话存在活跃 mission 且用户发送首句（或续问）触发主控简报拼接；When 该轮 user_input 落库；Then `metadata_.turn_trigger === "team_brief"`，SSE 补发行带同值。

#### 场景：Worker 派发

Given 团队派发 Worker run；When 其会话首条 user_input 落库；Then `metadata_.turn_trigger === "worker_dispatch"`。

#### 场景：后台通知

Given 后台任务收敛触发 workers-done / child-wake 注入；When `inject_session_as_service` 落库；Then `metadata_.turn_trigger === "agent_notice"`。

### FR-02: daemon 在轮边界上报配置面请求头快照（仅 initial / change）

- daemon **必须**在轮边界采集 `{systemPrompt: 档案配置段, allowedTools, mcpServers 名称清单}`，与会话级缓存的上次快照做字段级比较：首条上报 `reason=initial`、与缓存不等上报 `reason=change`（metadata 携带）；相同 **禁止** 重复上报（D-010）。快照是配置面口径，**禁止** 声称引擎全文（D-002）。

#### 场景：主路径

Given 新会话首轮；When driver 启动完成；Then 落一条 `channel=session_header` 日志（reason=initial）。Given 其后某轮 allowedTools 变化；When 该轮边界比较不等；Then 落一条 reason=change 的 session_header 日志。

#### 场景：无变化

Given 连续多轮快照相同；When 轮边界比较；Then 不新增日志。

### FR-03: 前端按标记装配轨迹行

- 盖戳消息 **必须** 经既有 `classifyTurnTrigger` → `turn_trigger` 段 → 轨迹「上下文」行链路呈现（`TURN_TRIGGER_META` 补三行：team_brief/worker_dispatch/agent_notice，系统代笔 contentHidden）；`session_header` 日志 **必须** 装配为 `request_header` 段且 **禁止** 渲染进轮块流（D-011）；轨迹 **必须** 将 `request_header` 段派生为「系统」行，文案四态：初始系统提示词 / 系统提示词已更新 / 工具已更新 / 系统提示词与工具已更新（diff 分类在前端做，prev 取同会话前一条快照）。

#### 场景：主路径

Given 轮含 turn_trigger=team_brief 的消息；When 打开轨迹；Then 该消息行为「上下文」标签（团队派发形态）。Given 会话第二条 session_header 快照与首条 tools 不同；When 打开轨迹；Then 出现「工具已更新」系统行。

### FR-04: submit_steps metadata 通用透传（白名单键集）

- backend `submit_steps` **必须** 将 daemon 消息 metadata 按白名单键集（`turn_trigger`、既有 chain 键、`reason`）落 `metadata_`（现状只落 `_agent_event`）；白名单外键 **禁止** 落库。

#### 场景：主路径

Given daemon 提交带 `{channel: "session_header", metadata: {reason: "initial"}}` 的日志；When submit_messages 落库；Then `metadata_.reason === "initial"`。

### FR-05: revert 前端启发式代码

- 本变更 **必须** revert 提交 77ba0588b / c93aafc84 引入的启发式识别（`TEAM_DISPATCH_PREFIXES` / `isTeamDispatchText` / `meta.systemBrief` 及其用例）；revert 后无标记用户消息 **必须** 回落「用户」行（D-004/D-003）。

#### 场景：主路径

Given 存量会话的团队派发轮（无戳）；When 打开轨迹；Then 显示「用户」行（如实呈现，无启发式识别）。

### FR-06: 兼容与回归

- 旧 daemon / 旧 backend 组合 **必须** 零行为变化（无戳无快照按现状渲染）；新 daemon + 旧前端遇 `session_header` 未知 channel **必须** 走中性兜底不崩；既有三端测试 **禁止** 放宽或删除；`frontend` `tsc --noEmit`、daemon `tsc`、backend `mypy` **必须** 通过。

#### 场景：主路径

Given 变更落盘；When 跑三端相关测试与类型检查；Then 全部通过。

## 非功能需求

- 兼容性：日志读取 API / OpenAPI 形状不变（metadata 已是自由 dict）；无表结构变更。
- 性能：快照仅变更时落库（单会话个位数条）；前端 diff 为纯函数。
- 可维护性：新注入类型 = `TURN_TRIGGER_META` 加一行 + 注入点传参（配置表驱动）。

## 决策覆盖矩阵（如存在 decisions.md）

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | 全部 | dsh 机制全套跨三端 |
| D-002@v1 | FR-02 | 配置面快照口径 |
| D-003@v1 | FR-01/FR-05 | 存量如实呈现 |
| D-004@v1 | FR-05 | revert 启发式 |
| D-005@v1 | 全部 | 复用日志通道 |
| D-006@v1 | — | 落选：独立快照表 |
| D-007@v1 | — | 落选：不落库 |
| D-008@v1 | 全部 | 三段式定稿 |
| D-009@v1 | FR-01 | 归 turn_trigger 体系 |
| D-010@v1 | FR-02 | daemon 侧变更检测 |
| D-011@v1 | FR-03 | 系统行只进轨迹 |

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: `backend/app/modules/daemon/tests/`（inject/create/mission_context 盖戳用例，按实际文件归属落位）「主控简报轮盖 team_brief / Worker 首轮盖 worker_dispatch / 通知盖 agent_notice / 真实输入不盖」
FR-02: `sillyhub-daemon/tests/interactive/`（快照采集与上报用例）「首轮 initial / 变更 change / 相同不重复上报」
FR-03: `frontend/src/components/daemon/trajectory/__tests__/from-turn-views.test.ts`「request_header 段派生系统行四态文案 + prev diff 分类」+ `frontend/src/components/daemon/__tests__/turn-timeline-trajectory-view.test.tsx`「turn_trigger 新 kind 经既有链路进上下文行」
FR-04: `backend/app/modules/daemon/tests/`（submit_steps 透传用例）「白名单键落库 / 白名单外丢弃」
FR-05: `frontend/src/components/daemon/trajectory/__tests__/from-turn-views.test.ts`「无标记用户消息回落用户行（启发式已移除）」
FR-06: 不适用：类型检查无测试面（三端 tsc/mypy 直接验证退出码）；回归面由三端相关测试全量跑覆盖
