---
plan_level: full
execution_mode: main  # 缺省 main 直写（R7/R8 对撞实证派发税 3.6×；本变更单卡上下文均可吞吐，无分片需求）
---

# 实现计划（Plan）— 会话阶段化进度展示

## Spike 前置验证

不需要——技术方案零不确定性底座：全部机制（SSE 透传/HTTP 上报/状态机翻转点/endStep 钩子）均经 Grill 两轮源码实证（D-004/D-011/D-012/D-013 锚点）。

## Wave 1（协议层，串行）
- task-01

## Wave 2（三端并行，依赖 W1 契约；main 模式下按序直写——**拓扑定序：task-04 先于 task-03**（task-03 透传 currentPhase prop 前 TurnStatusBar 须已有该 prop，否则 tsc 红；plan review G1））
- task-02
- task-04
- task-03

## Wave 3（收尾）
- task-05

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | backend 协议与发布全集 | W1 | P0 | — | FR-01, FR-06, D-004, D-011, D-012 | DTO+helper+端点+状态机发布点+聚焦测试+openapi 导出（backend 全部文件） |
| task-02 | daemon 信号源全集 | W2 | P0 | task-01 | FR-02, FR-03, D-009, D-013 | notifyTurnPhase+五冷启动阶段+inject_received+first_event 防重+聚焦测试+daemon gen:types |
| task-03 | frontend 数据层与接线 | W2 | P0 | task-01, task-04 | FR-04, FR-06, D-008, D-010, D-012, D-013 | sse 信封+stream 分发/白名单+turn-state 终态清理+双面板 handler+timeline 透传+聚焦测试+frontend gen:types |
| task-04 | frontend 状态条展示 | W2 | P0 | task-01 | FR-04, FR-05, D-001, D-003, D-007, D-008 | PHASE_LABEL 词表+超时警示+first_event 退位+零回归分支+聚焦测试 |
| task-05 | 收尾验收与文档同步 | W3 | P1 | task-02, task-03, task-04 | 全 FR | design 成功标准逐条验收+模块文档登记+原型同源提交 |

## 关键路径
task-01 → task-04 → task-03 → task-05（协议定稿 → 状态条 prop → 数据层接线 → 收尾；task-02 与前端两任务文件正交可插空）

## 全局硬约束（从 design.md 逐字抄录，绑定所有 task）

- SSE 键名三端逐字对齐为 `phase` / `detail` / `timestamp`——透传层原样转发不改名，禁止出现 `phase_detail`/`ts` 等变体键名（D-012）。
- `delivered` 事件仅在 daemon ack 回执处理路径发布（非 mark_delivered 的 WS push 成功点）；`dispatched` 在下发成功点照发、daemon 离线待补拉时照发（D-011）。
- `run_id` 必填（daemon 恒带 firstRunId）；`turn_phase` 加入前端 run_id 必填白名单（缺失即丢弃=D-013 防御丢弃实现点）。
- 轮终态（turn_completed/failed/killed）必须清空 `currentPhase`（D-013③，R-01 兑现点）。
- daemon 上报任何失败仅记日志（try-catch 吞噬），不得抛出到会话创建/注入调用链（D-009）；backend 发布失败不阻断控制指令状态机（异常吞噬+warning）。
- `first_event` 防重键 `(session_id, run_id)`，每 run 至多一次（D-013④）。
- 不新增 daemon↔backend WS 消息类型；不改 SSE 透传层；不改既有事件语义；零表结构变更（零 migration）（D-004 + 非目标）。
- 超时阈值=前端常量 `30_000`ms，不做配置项（D-007）；警示样式用 warning token（`border-warning/40 bg-warning/10` + `text-warning`），零硬编码色。
- 无 phase 信号的轮渲染路径与现状完全一致（零回归）；未知 phase 值显示原始字符串。
- 后端 schema 变更同一变更内必须跑 `pnpm gen:types` + `pnpm -C sillyhub-daemon gen:types` 并提交两处 api-types + backend/openapi.json（仓库规则 21）。
- 兼容 Windows / Linux / macOS（CLAUDE.md 规则 13）。

## 全局验收标准
1. 全部聚焦测试通过（backend pytest / daemon vitest / frontend vitest 各自聚焦文件，禁全量——CLAUDE.md 规则 0）。
2. 三端契约测试对齐：`protocol-session-contract.test.ts` 等既有断言面测试零回归（改契约必须同步钉子测试——knowledge/testing-gotchas 共享断言面）。
3. brownfield 兼容：老版本 daemon 场景（无冷启动上报）前端回退现状文案，不报错。

## Review Focus 盲区清单（隐含面）

| # | 输入/条件 | 合理人预期行为 | 承接落点 |
|---|---|---|---|
| 1 | 群聊/多轮排队场景：同会话 B 轮 inject 在 A 轮运行中入队（queue 路径无控制指令？） | `dispatched/delivered` 仅对真下发的指令发布；A 轮 phase 不被 B 轮事件覆盖（按 run_id 归属路由） | task-03（run_id 白名单+归属路由断言）、task-01（enqueue 路径仅 dispatched） |
| 2 | daemon 上报 turn_phase 与 submit_messages 微批并发（同 run 两类事件交错到达） | phase 事件不进微批管道（独立 HTTP），乱序到达时 currentPhase 按事件序覆盖、last-write-wins | task-03（乱序到达测试） |
| 3 | 用户切走会话再切回（面板重挂载，SSE 未断） | currentPhase 从轮状态重读不丢失（状态在 turn 对象，非组件局部） | task-03（currentPhase 挂 turn-state 而非组件 state，验收含重挂载） |
| 4 | `first_event` 丢失（daemon 在首个事件前崩溃重启） | 轮恢复后 first_event 补报或活动摘要自然接管，标签不卡「已就绪·等待 AI 响应」 | task-02（run 级防重键=崩溃重启后新 run 重置）、task-04（first_event 退位与活动摘要互斥可达） |
| 5 | SSE keepalive 帧与 turn_phase 事件交错（25-30s keepalive） | keepalive 非 JSON 信号不触发 onTurnPhase；游标 lastLogTs 不受 phase 事件污染 | task-03（仅 log 事件推进游标，既有逻辑零改动） |

## 覆盖矩阵（如存在 decisions.md）
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-04 | 状态条单行文案（无新增区域） |
| D-002@v1 | task-01/02/03/04 | 词表 9 值全链路（盲区+轮内） |
| D-003@v1 | task-04 | 超时变色+已等待秒数 |
| D-004@v1 | task-01/02/03 | SSE 事件走既有通道，零 WS 新消息 |
| D-005@v1 | — | 落选存档（无承接） |
| D-006@v1 | — | 落选存档（无承接） |
| D-007@v1 | task-04 | 30_000 前端常量 |
| D-008@v1 | task-03/04 | first_event 退位+活动摘要接管 |
| D-009@v1 | task-01/02 | 吞噬断言（helper/上报） |
| D-010@v1 | task-03 | 缺 phase 零回归分支 |
| D-011@v1 | task-01 | delivered 挂 ack 回执点 |
| D-012@v1 | task-01/03 | 键名逐字对齐三处 |
| D-013@v1 | task-02/03 | at 时钟源/终态清理/防重键/并行边界 |
