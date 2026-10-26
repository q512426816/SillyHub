---
author: qinyi
created_at: 2026-10-26 13:45:56
generated_by: sillyspec-design-init
scale: large  # Step 8 评估：三端 12 任务（backend 投影 4 + daemon 2 + frontend 3 + 生成物/原型 3）；Wave 证据——线 1 backend 投影（task-01~05）与线 2 daemon 采集（task-06~07）无相互依赖可真并行，线 3 frontend（task-08~10）依赖两线字段定稿；单上下文吃下全量需同时握 Python 投影/TS 采集器/React 组件三套栈
---

# 设计文档（Design）— 2026-10-26-session-change-progress-hover

## 背景

会话页面悬浮变更面板（frontend/src/components/daemon/session-change-files-hover.tsx）当前每项只展示变更名 + 轻量/全量徽标 + 单个阶段标签（轻量恒显"干活中"）+ 时间，没有任何进度细节。用户看一个进行中的变更，不知道：走到了哪个阶段、阶段内完成多少、execute 干了几个任务、等了多久、轻量变更是否已批准、收口子步跑到第几个。

数据面现状（2026-10-26 调研确认）：

- 全量变更：sillyspec 六表上行载荷已含 stages（started_at/completed_at/revision/stale_reason）与 steps（status/completed_at/wait_reason）完整明细（sillyspec src/progress.js:628-676 serializeForSync），平台 `platform_change_progress.latest_progress` 已落库；但 backend 只提取了全局步骤汇总 `step_progress`（backend/app/modules/change/schema.py:26-42），每阶段分组计数与耗时未提取。execute 阶段 CLI 步骤是 Wave 粒度（sillyspec src/stages/execute.js:1606 `Wave ${i+1} 执行`），非任务粒度；平台 `tasks` 表（backend/app/modules/task/model.py:17）有任务级状态（status 6 值，done=勾选完成）。
- 轻量变更：CLI 红线"状态落 flow-state.yaml 不落数据库"，平台侧仅有 current_stage='thin' 一个值；`flow status --json` 机器面字段齐全（phase 推断/specApproved/tasksChecked+Total/substeps n/8/legacyFallback，sillyspec src/flow.js:3330-3338），但 daemon 采集器（sillyhub-daemon/src/sillyspec-manager.ts:948 progress 采集）只跑 `progress show --json`，flow status 数据全链路缺失。
- flow-state.yaml 仅有 updatedAt 一个时间戳，无相位级起止时间。

## 设计目标

- FR-01 全量下拉项内嵌 5 阶段进度圈行：头脑风暴/计划/执行/验证/归档五圈横排，圈按阶段内步骤完成占比填充（steps_completed/steps_total），阶段 completed 打勾；圈下标耗时（已完成=completed_at−started_at，进行中=快照时刻−started_at）；异常态（waiting/blocked/revising/stale/failed）异色圈+状态字。
- FR-02 execute 圈特殊口径：用 tasks 聚合 n/m（done/总数）展示"n/m 任务"，不用 Wave 步骤数。
- FR-03 轻量下拉项内嵌 ①→②→③ 相位行：相位指示器（①spec→②执行→③归档，①含"待批准"子态）+ 批准态标识（已批准/autopilot 豁免/未批准）+ 执行阶段显示 tasks n/m + 收口阶段显示子步 n/8 + 总时长（创建→最后活跃）。
- FR-04 升厚与分流：升厚变更（tier=thick/legacy_fallback）显示"已升厚→走全量"并切换全量 5 圈渲染；brainstorm→thin 分流变更归轻量渲染 + "自头脑风暴转入"小字标注。渲染分支优先级单源：**is_thin && !upgraded → 轻量相位行；否则（含 is_thin 但 upgraded，`_is_thin_lineage` 的 change_type=='quick' 分支独立判 thin 的场景，backend/app/modules/change/service.py:2277）→ 全量 5 圈行**。
- FR-05 入口总进度圈：悬浮框"变更"按钮旁仅露**单个总进度圈**（圆环+百分比），只展示最新进行中（updated_at 最新非归档）的一个变更——**前端显式按 updated_at 取 max 重排选取**（后端列表序是"未归档优先+created_at desc"，frontend/src/components/daemon/session-change-files-hover.tsx:63——active[0] ≠ updated_at 最新，禁用列表序直接取首，D-013@v1）；全量=steps_completed/step_total，轻量=相位加权总完成度（口径见接口定义）。
- FR-06 数据链路（方案 A）：全量细度 backend 投影提取（零 migration 计算字段）；轻量经 daemon 补采集 `flow status --json` → heartbeat `sillyspec_status` 载荷扩展上行 → backend 归一落 `change.stages` JSON（thin_flow 子对象）→ ChangeSummary 投影；前端单点消费现有 15s 轮询（frontend/src/lib/changes.ts:151 useSessionChanges），零新增请求。
- FR-07 兼容降级：所有新字段 optional，缺失时前端降级现状渲染；旧 daemon 无新键、存量 latest_progress 无 steps 明细、CLI 版本过老无 flow 命令——均 fail-open 不报错。
- FR-08 计数徽标双色：悬浮框「变更」按钮计数徽标（frontend/src/components/daemon/session-change-files-hover.tsx:211-218）由恒绿改双态——active>0 蓝（**blue-* 固定阶，本场景是 CLAUDE.md 规则 20 的"真信息蓝"语义，不随主题换肤**——semantic.info 在两主题下均为青（themes.ts D-003@v2"info 不再是蓝"），不可用；D-012@v2）、active=0 保持绿（完成态）。

## 非目标

- 不做轻量相位级耗时（CLI flow-state 无时间戳，D-001@v1；待 CLI 侧补数据后另立变更）。
- 不改 sillyspec CLI（六表协议/flow status 命令均零改动，D-008@v1）。
- 不做大弹窗（文件树实时预览）内的进度展示。
- 不做已归档项进度渲染（D-009@v1）。
- 不做 SSE/轮询频率调整（15s 维持现状）。
- 不做变更中心列表页（/changes）的进度改造——本变更只改会话悬浮框；ChangeSummary 扩字段对列表页是 additive 无害（旧字段不动），列表页是否跟进另议。

## 拆分判断

单变更跨三端但同一功能闭环（数据从产生到消费一条链），拆开会留半成品接口（backend 加了字段没人消费 / daemon 上行了没人落库），不走批量模式；内部按 Wave 分三线（backend 投影 → daemon 上行 → frontend 渲染），backend 与 daemon 两线可并行，frontend 依赖两者字段定稿。

## 总体方案

三线推进（plan 阶段定 Wave 划分）：

**线 1 — backend 全量投影**：`enrich_summaries` 管道扩展两个提取器：
- `_extract_stage_progress(latest_progress)`：遍历六表 stages[]+steps[]，输出主线 5 阶段各 `StageProgressEntry`（status/steps 计数/起止时间/revision），耗时在服务端算成 `duration_seconds`（进行中用服务器 now，注入时钟保测试确定性）。
- `_aggregate_task_progress(change_ids)`：tasks 表按 change_id IN 批量聚合（防 N+1，同 usage 聚合先例），done/total（total 排除 cancelled）。
- 挂到 `ChangeSummary.stage_progress` / `task_progress`（计算字段零 migration）。

**线 2 — daemon 轻量上行**：sillyspec-manager.ts 采集器在 progress 采集同拍补跑 `flow status --json`（逐活跃 thin 变更，失败静默降级同三态矩阵模式）；hub-client.ts heartbeat 载荷 `sillyspec_status` 加 `thin_flows[]`（**每条含 workspace_id 键**——`sillyspec_status` 是 daemon 实例级全局键且多工作区已 status_map 级化（backend/app/modules/daemon/router/heartbeat.py:264-268），无 workspace 维度无法定位变更行；flow status 原始字段白名单透传，不归一——CLI 文案变化不破坏链路）；backend 消费侧**新增逐变更写入路径**（现有 sillyspec_status 语义是 dict 整包直写 daemon_instances 快照列、不逐条改写 changes 表，backend/app/modules/daemon/runtime/service.py:462-468——本路径是全新逻辑）：按 `workspace_id+change_key` 匹配 changes 行，行锁事务内 read-merge-write `stages["thin_flow"]` 子键（**不刷 changes.updated_at**，防入口圈系统性偏向轻量——updated_at 语义保持"最后变更元数据变更"）；reparse 重建 stages 时 thin_flow 键丢失由下一跳 heartbeat 自愈（≤1 心跳周期）。enrich_summaries 读时投影到 `ChangeSummary.thin_flow`。

**线 3 — frontend 渲染**：新组件 `change-progress-row.tsx`（下拉项进度行：is_thin 分支轻量相位行/全量 5 圈行，含异常态映射与降级）+ `change-total-progress-ring.tsx`（入口总进度圈，选最新进行中一个）；session-change-files-hover.tsx renderItem 内嵌进度行、按钮旁挂总圈；色阶走主题语义 token（FRONTEND_PAGE_STYLE §0.5 多主题铁律）。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/change/schema.py | ChangeSummary 加 3 个 optional 计算字段：stage_progress: list[StageProgressEntry] \| None、task_progress: TaskProgressSummary \| None、thin_flow: ThinFlowProgress \| None；新增三个子 DTO（接口定义节）。producer=latest_progress/tasks 表 → enrich_summaries → 消费者=前端悬浮框 |
| 修改 | backend/app/modules/change/service.py | enrich_summaries 扩展：新增 _extract_stage_progress（stages/steps 分组计数+耗时秒数，时钟注入）、thin_flow 读 change.stages JSON 投影；_aggregate_task_progress 批量聚合（tasks 表 IN 查询防 N+1） |
| 修改 | backend/app/modules/daemon/router/heartbeat.py | DaemonHeartbeatSillySpecStatus 加 thin_flows: list[DaemonHeartbeatThinFlow] \| None；消费侧解析→归一→写 change.stages["thin_flow"]（按 workspace+change_key 匹配变更行）。producer=daemon flow status 采集 → heartbeat POST → 消费者=changes 表 stages JSON → ChangeSummary.thin_flow |
| 修改 | sillyhub-daemon/src/sillyspec-manager.ts | 采集器补 flow status --json 执行器（progress 同拍、同三态矩阵、exit 非零/JSON 解析失败静默降级），产出 thin flow 摘要供 heartbeat 取用 |
| 修改 | sillyhub-daemon/src/hub-client.ts | heartbeat sillyspec_status 载荷加 thin_flows 键（workspace_id 定位键 + flow status 原始字段白名单：change/phase/designFilled/frFilled/bindings/tasksChecked/tasksTotal/substeps/substepsTotal/specApproved/autopilot/legacyFallback） |
| 修改 | sillyhub-daemon/src/daemon.ts | 心跳调用点第 13 参（thinFlows，typeof 探测兜底）+ ClientLike 接口声明同步 |
| 修改 | sillyhub-daemon/tests/daemon-heartbeat-pending.test.ts | 平铺参长钉测试 12→13（共享断言面②，thin-flows 尾参） |
| 修改 | sillyhub-daemon/tests/daemon-heartbeat-sillyspec.test.ts | 同上（多处钉行 12→13） |
| 修改 | sillyhub-daemon/tests/sillyspec-platform-command.test.ts | 同上 |
| 修改 | sillyhub-daemon/tests/integration/selfupdate-scenarios.test.ts | 同上（两处钉行） |
| 新增 | NEW:frontend/src/components/daemon/change-progress-row.tsx | 下拉项进度行组件：全量 5 圈横排（占比/打勾/耗时/异常态异色+状态字）与轻量 ①②③ 相位行（批准徽标/tasks n/m/子步 n/8/总时长/升厚切换/分流标注）双分支 + 字段缺失降级现状 |
| 新增 | NEW:frontend/src/components/daemon/change-total-progress-ring.tsx | 入口总进度圈组件（单圆环+百分比，全量/轻量双口径；最新进行中选取逻辑由悬浮框侧传入） |
| 修改 | frontend/src/components/daemon/session-change-files-hover.tsx | renderItem 内嵌 ChangeProgressRow；按钮旁挂 ChangeTotalProgressRing（active 中按 updated_at 取 max 重排选取最新进行中，D-013@v1，禁用列表序取首）；计数徽标双态（active>0 蓝/0 绿，D-012@v2）；归档项不挂进度（D-009@v1） |
| 修改 | frontend/src/lib/api-types.ts | pnpm gen:types 再生成（CLAUDE.md 规则 21 前端义务，schema 改动同 change 内提交） |
| 修改 | backend/openapi.json | schema 改动产物随提交 |
| 修改 | sillyhub-daemon/src/api-types.ts | pnpm -C sillyhub-daemon gen:types 再生成（daemon 同款义务，断言面闸门⑨） |
| 新增 | NEW:backend/app/modules/change/tests/test_progress_projection_ext.py | stage_progress/task_progress/thin_flow 投影测试（含畸形 latest_progress fail-open、时钟注入确定性、批量聚合无 N+1） |
| 新增 | NEW:backend/app/modules/daemon/tests/test_heartbeat_thin_flows.py | thin_flows 载荷解析→归一→落库测试（含缺键/坏 JSON/未知变更降级） |
| 新增 | NEW:sillyhub-daemon/tests/sillyspec-flow-status-collector.test.ts | flow status 采集执行器测试（成功/CLI 不存在/输出畸形三态；落 tests/ 而非 src/__tests__/——daemon vitest include 只扫 tests/** 工程现实，execute 期实证） |
| 新增 | NEW:frontend/src/components/daemon/__tests__/change-progress-row.test.tsx | 双分支渲染+异常态映射+降级测试 |
| 新增 | NEW:frontend/src/components/daemon/__tests__/change-total-progress-ring.test.tsx | 总圈口径（全量 steps 比/轻量相位加权）+选取逻辑测试 |
| 修改 | frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx | 既有测试补：进度行挂载断言 + 计数徽标双态（active>0 蓝/0 绿）断言 |

## 接口定义

```python
# backend/app/modules/change/schema.py 新增子 DTO
class StageProgressEntry(BaseModel):
    stage: str                    # brainstorm|plan|execute|verify|archive
    status: str                   # CLI 原值：pending|in-progress|completed|failed|blocked|revising|stale
    steps_total: int              # 该阶段 steps[] 计数（含 waiting/blocked）
    steps_completed: int          # status=completed 计数
    started_at: str | None        # ISO 原文透传
    completed_at: str | None
    duration_seconds: int | None  # 已完成=completed−started；进行中=now−started（服务端注入时钟）；无 started_at → None
    revision: int | None          # revising 修订轮次

class TaskProgressSummary(BaseModel):
    total: int                    # 该变更 tasks 行数（排除 status=cancelled）
    done: int                     # status=done 计数

class ThinFlowProgress(BaseModel):
    phase: str                    # 归一枚举：spec|awaiting_approval|executing|closing
    approved: bool                # spec_approved 或 autopilot 任一
    autopilot: bool
    tasks_total: int              # flow status tasksTotal（thin 任务勾选，不依赖 reparse/Task 表）
    tasks_done: int
    substeps_done: int            # flow status substeps 长度
    substeps_total: int           # 恒 8（SUBSTEPS 定长）
    upgraded: bool                # tier=thick 或 legacy_fallback
    adopted_from: str | None      # 'brainstorm' 分流出身标注

# backend/app/modules/daemon/router/heartbeat.py 新增载荷
class DaemonHeartbeatThinFlow(BaseModel):
    workspace_id: str             # 变更所属工作区 UUID（sillyspec_status 是实例级全局键，无此键无法定位变更行）
    change: str                   # change_key
    phase: str                    # CLI 原文透传（backend 归一，daemon 不归一）
    design_filled: bool
    fr_filled: bool
    bindings_total: int
    bindings_filled: int
    tasks_total: int
    tasks_checked: int
    substeps: list[str]
    spec_approved: bool
    autopilot: bool
    legacy_fallback: bool
```

**thin phase 归一规则**（backend 消费侧，与 flow.js:3284-3296 推断逻辑同口径）：substeps 含 'ledger' → closing；否则 (design_filled && fr_filled && bindings 齐) 且 (spec_approved || autopilot) → executing；否则 bindings/design/fr 已齐而未批准 → awaiting_approval；否则 spec。

**入口总进度圈口径**（frontend，change-total-progress-ring.tsx 单源函数）：
- 全量：step_progress.steps_completed / step_progress.step_total（缺失 → 环不渲染）。
- 轻量：相位加权 phase_weight(spec=0.1, awaiting_approval=0.15, executing=0.33+0.34×tasks_done/max(tasks_total,1), closing=0.67+0.33×substeps_done/8)；无 thin_flow 数据 → 环不渲染（降级现状计数徽标）。
- 选取：active（非归档）中 updated_at 最新一个。

**本变更接口面：0 端点**（REST 端点零新增零语义变更；改动的面 = ChangeSummary DTO 加字段（additive）+ heartbeat 请求载荷加键（additive））

## 生命周期契约表

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| flow status 采集 | daemon sillyspec-manager 采集器（progress 同拍） | daemon 内部 thin flow 摘要槽 | workspace_id, change, phase, tasks_checked/total, substeps, spec_approved, autopilot, legacy_fallback | 采集三态矩阵（ok/stale/error），失败静默降级不阻塞 progress 采集 |
| heartbeat 上行 | daemon hub-client | backend POST /heartbeat | sillyspec_status.thin_flows[]（DaemonHeartbeatThinFlow 全字段含 workspace_id） | 无（载荷透传；现有 sillyspec_status 整包快照直写 daemon_instances 逻辑不变） |
| heartbeat 消费归一落库 | backend heartbeat router（**新增逐变更写入路径**，区别于既有整包快照直写） | changes 表 | thin_flows[].workspace_id+change 可解析且能匹配变更行 + 归一 phase 四枚举合法 | 行锁事务 read-merge-write stages["thin_flow"]；**不刷 changes.updated_at**（D-014@v1）；坏条目/未匹配行单条丢弃整批不拒；reparse 重建 stages 丢键由下跳自愈（≤1 心跳周期） |
| 悬浮框轮询消费 | frontend useSessionChanges（15s，开面板才轮询） | backend GET 会话关联变更 | ChangeSummary.stage_progress/task_progress/thin_flow（均 optional） | 纯读，无状态变化 |

## 数据模型

零表结构变更、零 Alembic migration。唯一持久化落点：`changes.stages` JSON 列新增 `thin_flow` 子键（backend/app/modules/change/model.py:196-198，JSON 列自由结构）；`platform_change_progress.latest_progress` 与 `tasks` 表均为既有数据源，只读消费。

## 兼容策略（brownfield 必填）

- 旧 daemon（无 thin_flows 键）：heartbeat 载荷 optional，缺省 None；stages.thin_flow 不写入不清除；前端 thin_flow=None → 轻量项降级现状（徽标+"干活中"）。
- 存量 latest_progress 无 steps 明细/字段畸形：_extract_stage_progress fail-open 返回 None → ChangeSummary.stage_progress=None → 前端该项不渲染进度行（现状保底）。
- CLI 版本过老无 flow 命令：daemon 采集 exit 非零 → 三态矩阵 error 态静默，不影响 progress 采集与 heartbeat 其他载荷。
- ChangeSummary 加字段对既有消费方（变更列表页/移动端）additive 无害：旧字段不动、新字段 optional default None。
- 归档变更：投影照算（有数据就带），前端归档组不渲染（D-009@v1），不改后端口径。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | latest_progress 存量畸形（zh-CN 旧时间戳/缺 stages 行）解析崩 | P1 | 解析全路径 try/except fail-open → None 降级；时间戳容错解析复用既有 `_dumpIso` 口径；测试覆盖畸形样本 |
| R-02 | tasks 表与 CLI tasks.md 勾选有时差（reparse 周期） | P2 | execute 圈口径标注"reparse 快照"；thin 任务勾选走 flow status 上行不受此影响 |
| R-03 | heartbeat thin_flows 载荷膨胀（多 thin 变更×高频心跳） | P2 | 白名单字段定长小对象；daemon 侧仅上行活跃（非归档）thin 变更 |
| R-04 | 进行中阶段耗时随轮询漂移、测试非确定 | P2 | 服务端时钟注入（now 由参数传入），测试用固定 now 断言 |
| R-05 | 圈/相位渲染无障碍与多主题色阶漂移 | P2 | aria-label 文本化进度；色阶走主题语义 token（success/warning/**error**——themes.ts:46 实际键名，非 danger；blue 固定阶仅 FR-08 真信息蓝一处），不硬编码 hex（FRONTEND_PAGE_STYLE §0.5） |
| R-06 | UI 原型：涉前端文件，execute 阶段以真码管线产出 prototype-session-change-progress.html（组件方言真码，非手绘），或登记复用 session-pill 既有原型 | P2 | 本节登记计划；产出前不进 verify |
| R-07 | heartbeat 逐变更写 changes.stages 与 reparse 重建 stages 的并发竞态（Grill 阻断 1 衍生） | P1 | 写入走行锁事务 read-merge-write（SELECT FOR UPDATE→merge thin_flow 键→UPDATE）；reparse 全量重建丢 thin_flow 键由下一跳 heartbeat 自愈（≤1 心跳周期，30s 级）；updated_at 不刷（D-014@v1）保持入口圈选取语义中立 |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | FR-03（总时长行）；非目标（相位级耗时不做） | 已覆盖 |
| D-002@v1 | FR-01（异常态异色圈+状态字）；change-progress-row.tsx | 已覆盖 |
| D-003@v1 | FR-05（入口单个总进度圈，最新进行中一个）；change-total-progress-ring.tsx | 已覆盖 |
| D-004@v1 | FR-06（方案 A 三线）；总体方案；D-010/D-011 rejected | 已覆盖 |
| D-005@v1 | FR-02（execute 圈 Task 表 n/m）；_aggregate_task_progress | 已覆盖 |
| D-006@v1 | FR-04（分流态归轻量+转入标注）；adopted_from 字段 | 已覆盖 |
| D-007@v1 | FR-04（升厚切全量渲染+标注）；upgraded 字段 | 已覆盖 |
| D-008@v2 | FR-06 线 2（daemon heartbeat 载荷扩展+条目 workspace_id+backend 新增逐变更行锁写入路径+不刷 updated_at）；生命周期契约表；R-07（supersedes D-008@v1——Grill 阻断 1：既有 sillyspec_status 是整包快照直写无逐变更匹配，落库路径须全新设计） | 已覆盖 |
| D-013@v1 | FR-05（入口圈前端显式 updated_at 重排选取，禁用后端 created_at desc 列表序）（Grill 阻断 2） | 已覆盖 |
| D-014@v1 | 生命周期契约表事件 3（heartbeat thin_flow 写入不刷 changes.updated_at，防入口圈偏轻量）（Grill 瑕疵 4） | 已覆盖 |
| D-009@v1 | 非目标（归档项不渲染进度）；兼容策略末条 | 已覆盖 |
| D-010@v1 | 方案 B rejected——非目标（零新增请求）反证 | 已覆盖（rejected 存档） |
| D-011@v1 | 方案 C rejected——非目标（15s 轮询维持）反证 | 已覆盖（rejected 存档） |
| D-012@v2 | FR-08（计数徽标双色，蓝=blue-* 固定阶真信息蓝——semantic.info 两主题均青不可用）；session-change-files-hover.tsx 变更行（supersedes D-012@v1 修正 token 口径，Grill 瑕疵 1） | 已覆盖 |

## 自审

- [x] 章节齐全（背景/设计目标/非目标/拆分判断/总体方案/文件变更清单/接口定义/生命周期契约表/数据模型/兼容策略/风险登记）
- [x] frontmatter 字段齐全（author/created_at/scale=large）
- [x] 引用所有当前版本 D-xxx@vN（D-001~D-007/D-009~D-011/D-013/D-014@v1 + D-008@v2 + D-012@v2，全部入决策追踪表）
- [x] 涉及 daemon/heartbeat 关键词 → 已含「生命周期契约表」（4 事件矩阵，含 workspace_id/行锁事务/不刷 updated_at 口径）
- [x] UI 原型分级核对：涉前端文件——execute 阶段真码管线产出或登记复用，计划已记入 R-06（不跳过、不手绘交付）
- [x] Design Grill（S2 独立评审，2026-10-26）2 阻断 5 瑕疵全部处置：阻断 1（thin_flows 落库路径全新设计：条目加 workspace_id + backend 新增逐变更行锁写入 + R-07 竞态口径）→ D-008@v2；阻断 2（入口圈显式 updated_at 重排）→ D-013@v1；瑕疵 1（FR-08 blue 固定阶）→ D-012@v2；瑕疵 2（R-05 error 键名）已改；瑕疵 3（FR-04 分支优先级单源）已补；瑕疵 4（不刷 updated_at）→ D-014@v1；瑕疵 5（笔误）已改。
- [x] 原自审存疑①（phase 归一边界）留 plan 阶段对 flow.js:3284-3296 逐字核对（不阻塞）；存疑②（change 匹配逻辑）**已由 Grill 实证澄清：既有逻辑不存在，走本设计新增路径**（D-008@v2）。
