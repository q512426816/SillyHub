---
author: qinyi
created_at: 2026-11-06 22:34:10
generated_by: sillyspec-design-init
scale: large
---

# 设计文档（Design）— 2026-11-06-session-reopen-no-cwd

## 背景

平台上不挂工作区创建的会话（闲聊）在结束/超时回收后点「重新开启」必报 `HTTP_409_DAEMON_SESSION_NO_CWD`（该会话无关联工作目录，无法恢复对话记录），历史可看但会话永久不可续。

根因链（2026-11-06 逐条代码核实）：

1. 非工作区会话创建时不写 cwd——backend/app/modules/daemon/session/service/inject_gates.py:320-362 仅在传 `workspace_id` 时落 `cwd = workspace.root_path`；
2. reopen 前置校验对空 cwd 提前 409——backend/app/modules/daemon/session/service/session_lifecycle.py:133-139（2026-08-21-session-reopen-resume 设计决策 DS-7，当时语境认定无 cwd 会话均为 scan/bootstrap 一次性会话）；
3. 但事实是：daemon 侧创建此类会话时空 rootPath 回落 `config.workspace_dir` 兜底（sillyhub-daemon/src/daemon.ts:10139-10146，注释明确「空串与 undefined/null 一律回落」）——**transcript 实际存在且归档目录确定**，只是 backend 未记录；daemon 本地 sessions.json 持久化快照也含真实 cwd（sillyhub-daemon/src/interactive/session-store-persistence.ts:181）。

用户闲聊会话撞上 DS-7 这扇为 scan/bootstrap 设计的门。2026-11-06 用户报障并要求根治，兼容存量已 409 会话。

## 设计目标

1. 非工作区（无 cwd）会话结束后可重新开启并续聊——含存量已 409 会话（零迁移救回）。
2. 新建非工作区会话在创建成功后即将实际工作目录回报 backend 落库（`session.cwd`），后续 reopen 直查、会话面板可展示目录。
3. 协议演进全部键位可选、前后向兼容，灰度期无双向破坏。

## 非目标

- 不引入 backend 侧 cwd 推导/分配逻辑（D-003/D-005：backend 无可靠数据源，平台不规定运行目录）。
- 不做 transcript 线性扫描预验证（D-002@v2：三级链天然指向正确目录，错配由既有 resume 失败链收敛）。
- 不按会话来源（origin）分流放行（D-006：origin 列对 chat/scan 同值，区分不了）。
- 不改动会话空闲回收/挂起/巡检等生命周期时序（本变更只动 reopen 门与 cwd 流向）。
- 不做前端界面改动（409 场景整体消失，工作目录徽标为数据驱动的被动展示）。

## 拆分判断

单一功能面（reopen 链路的 cwd 供给），无独立交付子模块、无批量模式形态，不拆分。跨 backend + sillyhub-daemon 两模块但协议键紧凑（3 个可选键），Wave 划分按模块边界（见总体方案），无需 MASTER。

## 总体方案

三段联动，发版顺序**先 daemon、后 backend**（R-02）：

### Wave 1 · daemon 侧（先行）

1. **resume 记录三级同源兜底链**（sillyhub-daemon/src/daemon.ts `_routeSessionResume` 构造恢复记录处，现 :9503 `cwd: (raw.cwd as string | undefined) ?? ''`）：
   `cwd = payload.cwd（非空串） || 本地 sessions.json 快照该 sessionId 的 record.cwd || config.workspace_dir`。第三级与 create 兜底（:10145）是同一条规则——快照被清后依然直指原 transcript 归档目录。
2. **回报携带**（三处发送点）：
   - `notifySessionReady` create 路径（daemon.ts:10782，`_startInteractiveSession` 内）携带本次会话最终生效 cwd（即三级解析前的实际运行目录 `cwd` 局部变量）；
   - `notifySessionReady` recover 路径（daemon.ts:9581）携带 record.cwd（三级解析结果）；
   - `confirmReconnected`（daemon.ts:9567）在 options 中加 `cwd` 键，值为三级解析结果。
   - hub-client.ts 对应方法加可选参数（不传不发键，老 backend 零感知）。
3. resume 失败路径零新增：解析出的目录若错，SDK `driver.start({resume})` throw → 既有 `markRecoveryFailed`（backend/app/modules/daemon/session/service/recovery.py:627-633）翻 failed。

### Wave 2 · backend 侧

1. **DS-7 门放宽**（session_lifecycle.py:133-139）：删除「cwd 为空 → DaemonSessionNoCwd」拒绝块；`agent_session_id` 自愈链（:115-132）与其它前置校验不变——无可恢复 SDK 标识的会话仍被 `DaemonSessionNoAgentSession` 拒绝。
2. **resume payload cwd 条件键**（session_lifecycle.py:296-303 `"cwd": session.cwd`）：改为 `session.cwd` 非空才写入键；为空则整键省略（JSON 不发 null），daemon 三级链自然落到第二/三级。sweep.py 恢复路径的 payload 构造（sweep.py:611-755 内同款字段）同步修改。
3. **cwd 落库**（backend/app/modules/daemon/router/notify.py）：
   - `confirm_session_reconnected`（:140，请求体 `SessionRuntimeRequest`）解析可选 `cwd` 键；
   - `notify_session_ready`（:248，POST /sessions/{session_id}/ready）增加可选请求体（或复用既有 body schema 加可选字段，execute 时按现状落位）解析可选 `cwd` 键；
   - 两端点：`cwd` 键非空字符串才写 `session.cwd`（daemon 为目录真相源 D-003，异值以 daemon 回报为准覆写；缺键/空值 no-op）。落库随端点既有事务提交。
4. **错误类退役**：`DaemonSessionNoCwd`（backend/app/modules/daemon/session/service/errors.py）删除；对应测试用例随行为变更改写。
5. **schema 义务**：请求体加可选字段进 OpenAPI → 同一变更内跑前端 `pnpm gen:types` 与 daemon `pnpm -C sillyhub-daemon gen:types` 双端生成并提交 `api-types.ts` ×2 + `backend/openapi.json`（仓规则 21/⑨）。

### Wave 3 · 测试收口

backend：test_session_reopen.py DS-7 用例改写（空 cwd + agent_session_id 有 → 放行并下发无 cwd 键 payload；agent_session_id 无 → 仍 409 DaemonSessionNoAgentSession）+ notify 端点 cwd 落库用例（含缺键 no-op / 空串 no-op / 覆写）。daemon：resume 路由三级链用例（payload 有/快照有/双无退 workspace_dir）+ 回报携带用例。仅跑聚焦测试。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/daemon/session/service/session_lifecycle.py | 删 DS-7 空 cwd 拒绝块（:133-139）；resume payload cwd 条件键（:296-303） |
| 修改 | backend/app/modules/daemon/sweep.py | 恢复路径 resume payload 同步 cwd 条件键（:611-755 内构造处） |
| 修改 | backend/app/modules/daemon/session/service/errors.py | `DaemonSessionNoCwd` 错误类退役删除 |
| 修改 | backend/app/modules/daemon/router/notify.py | confirm（:140）与 ready（:248）端点解析可选 cwd 键落 session.cwd。数据流：producer=daemon daemon.ts 三处发送点（cwd=实际生效目录）→ HTTP body（可选键，snake_case `cwd`）→ consumer=backend 两端点写 agent_sessions.cwd |
| 修改 | backend/app/modules/daemon/schema.py | SessionRuntimeRequest（及 ready 端点 body schema，按现状落位）加可选 `cwd` 字段——producer=daemon hub-client → OpenAPI → consumer=前端/daemon 双端 gen:types 产物 |
| 修改 | backend/app/modules/daemon/tests/test_session_reopen.py | DS-7 用例改写 + 回报落库/放行用例 |
| 修改 | backend/app/modules/daemon/tests/test_session_reconnect_sweep.py | sweep 恢复路径 payload 条件键用例（plan 阶段对齐补充） |
| 修改 | sillyhub-daemon/src/daemon.ts | record.cwd 三级链（:9503）；三处发送点携带 cwd（:9567/:9581/:10782）。数据流：三级链解析（payload→快照→workspace_dir）→ 发送点携带 → backend 落库 |
| 修改 | sillyhub-daemon/src/hub-client.ts | `notifySessionReady`/`confirmReconnected` 加可选 cwd 参数（不传不发键） |
| 修改 | sillyhub-daemon/tests/daemon-session-resume-route.test.ts | 三级链用例 + 回报携带用例 |
| 生成 | frontend/src/lib/api-types.ts | `pnpm gen:types` 产物（schema 加可选字段联动） |
| 生成 | sillyhub-daemon/src/api-types.ts | `pnpm -C sillyhub-daemon gen:types` 产物（同上） |
| 生成 | backend/openapi.json | OpenAPI 导出产物（同上） |

## 接口定义

1. **SESSION_RESUME payload（backend → daemon WS，既有消息，字段语义变更）**：
   `{session_id, lease_id, agent_session_id, provider, runtime_id, [provider_config?], [cwd?]}`——`cwd` 由恒发改为**条件键**：`session.cwd` 非空才发；空则省略整键（不发 null）。
2. **POST /sessions/{session_id}/ready（daemon → backend，既有端点，body 增可选键）**：body 增 `cwd?: string`（非空字符串有效；缺省/空串 no-op）。
3. **confirm reconnected 端点（daemon → backend，既有端点，`SessionRuntimeRequest` 增可选键）**：`SessionRuntimeRequest` 增 `cwd: str | None = None`；非空才落库。
4. **daemon 内部解析函数**：`_routeSessionResume` 构造 record 处 cwd 取值改为三级链（payload → 快照 → `config.workspace_dir`），实现形态（内联三元 / 抽 helper）execute 时按该函数现状落位。

## 生命周期契约表

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| session_resume（reopen 主路径，session_lifecycle.py:296） | backend | daemon | session_id, lease_id, agent_session_id, provider, runtime_id；cwd 改**可选键**（session.cwd 非空才发） | session ended/failed → reconnecting |
| session_resume（sweep 恢复路径，sweep.py:755） | backend | daemon | 同上（cwd 同步可选化） | suspended → reconnecting |
| session ready | daemon | backend | session_id；**新增可选键 cwd**（实际生效目录，落 agent_sessions.cwd） | 无状态变化（ready 语义保持） |
| confirm reconnected | daemon | backend | session_id, lease_id, runtime_id；**新增可选键 cwd**（三级链结果，落库） | reconnecting → active |
| mark recovery failed（既有，本案复用） | daemon | backend | session_id, reason（cwd 解析错配致 resume throw 时经此路） | reconnecting → failed |

表内事件均有对应代码任务（Wave 1/2 各条）与测试任务（Wave 3）；必需字段与接口定义节一致。

## 数据模型

无 DB schema 迁移：`agent_sessions.cwd` 列已存在（backend/app/modules/agent/model.py:901-904，nullable String，注释即 "SessionManager working dir for resume"），本变更是**让该列对非工作区会话开始有值**。变更仅涉及请求 DTO（SessionRuntimeRequest / ready body）加可选字段，经 OpenAPI 生成物同步两端。

## 兼容策略（brownfield 必填）

- **存量已 409 会话**：零迁移即救回——reopen 放行 → daemon 三级解析（快照或 workspace_dir 命中）→ resume 续聊。
- **老 daemon + 新 backend**（backend 先发，违反建议顺序）：空 cwd 会话 reopen 放行，老 daemon `raw.cwd ?? ''` 得空串 → resume 失败 → markRecoveryFailed 翻 failed——明确失败不静默（R-02 已登记，发版文档写明顺序）。
- **新 daemon + 老 backend**（建议顺序）：daemon 新增 cwd 键老 backend 忽略（Pydantic 可选字段/extra 容忍，execute 时核实 ready 端点 body 容忍性）；backend 未放宽前空 cwd 会话仍 409——行为等同现状，无破坏。
- **回退路径**：backend 侧改动均为键位可选 + 单校验块删除，回滚 commit 即回 DS-7 现状；daemon 三级链第一级（payload cwd）对工作区会话零变化。
- **不改变的 API/表**：不新增端点、不删端点、不动 agent_sessions 表结构、不动 lease/claim 协议。
- **scan/bootstrap 会话**（D-004）：顺带获得可重开能力，接受为行为扩展（无破坏性；原设计是「不需要」非「不允许」）。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | `workspace_dir` 配置在会话存活期间被改过 → 三级链末级指错目录 | P1 | resume throw → markRecoveryFailed 翻 failed 明确报错（不静默错聊）；概率低，接受 |
| R-02 | 发版顺序颠倒（backend 先发）→ 空 cwd 会话明确 failed | P1 | 发版顺序文档写明先 daemon 后 backend；即便颠倒也只是明确失败，无数据损坏 |
| R-03 | ready/confirm best-effort 丢失 → session.cwd 暂空 | P2 | 最终一致：reopen 兜底链覆盖，行为不劣于纯兜底方案 |
| R-04 | daemon 回报 cwd 与工作区会话库中值不一致时的覆写 | P2 | daemon 为目录真相源（D-003）以回报为准；同值幂等；覆写仅影响展示与下次 payload，无状态风险 |
| R-05 | DS-7 用例改写被误读为「改测试凑通过」 | P2 | 行为变更为设计目标本身（D-002@v2），测试改写对应新契约并在 tasks 中逐条登记 |
| R-06 | ready 端点现无请求体 schema，加 body 的形态选择不当致老 daemon 兼容问题 | P1 | execute 时核实该端点现状（无 body 则以可选 body + Pydantic extra 容忍落位；Pydantic 默认忽略未知字段，老 daemon 不发 body 零影响） |

无长驻进程/外部资源，生命周期面不适用（三级解析即取即用，不引入定时器/句柄/子进程）。

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 组合方案（回报+兜底） | 总体方案 Wave 1+Wave 2；FR-01/FR-02 | 已覆盖 |
| D-002@v2 三级同源兜底链+DS-7 放宽 | 总体方案 Wave 1.1 / Wave 2.1-2.2；FR-02/FR-04 | 已覆盖 |
| D-003@v1 cwd 真相源在 daemon | 非目标第 1 条；Wave 2.3 落库语义；FR-05 | 已覆盖 |
| D-004@v1 scan/bootstrap 顺带可重开 | 兼容策略末条 | 已覆盖 |
| D-005@v1 否决 backend 分配目录 | 非目标第 1 条 | 已覆盖（rejected 留档） |
| D-006@v1 否决 origin 分流 | 非目标第 3 条 | 已覆盖（rejected 留档） |
| D-007@v1 回报捎带既有通道 | 总体方案 Wave 1.2 / Wave 2.3；FR-01/FR-02/FR-03 | 已覆盖 |
| D-008@v1 否决独立回报端点 | 兼容策略「不改变的 API」 | 已覆盖（rejected 留档） |

无未解决决策、决策追踪表状态列全部为「已覆盖」；rejected 条目（D-005/D-006/D-008）否决理由与复潮条件均已写入 decisions.md。

## 自审

- [x] 章节齐全（背景/设计目标/非目标/拆分判断/总体方案/文件变更清单/接口定义/生命周期契约表/数据模型/兼容策略/风险登记/决策追踪/自审）
- [x] frontmatter 字段齐全（author/created_at/scale=large——用户显式要求完整流程；Wave 证据：backend/daemon 两模块协议联动可并行、任务簇跨 3 Wave）
- [x] 引用所有当前版本 D-xxx@vN（D-001@v1/D-002@v2/D-003~D-008，见决策追踪）
- [x] 涉及生命周期关键词 → 含「生命周期契约表」（5 事件矩阵，与接口定义/文件清单对齐）
- [x] UI 原型分级：跳过——纯协议/后端变更，无布局/结构/流程/交互变化；唯一 UI 面变化为既有工作目录徽标组件从「不渲染」变「渲染」（数据驱动，session-config-bar.tsx:396-421 现状零改）
- [x] 无占位词残留；「⚠️ 自审存疑」项：无（R-06 的 ready 端点 body 形态为 execute 落位点而非未决设计问题，已在风险表登记核实动作）
