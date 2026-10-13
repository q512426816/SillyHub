---
change: 2026-10-13-session-change-files-hover
scale: large
tier: independent
author: qinyi
created_at: 2026-10-13
---

# 设计文档（Design）— 会话页面悬浮展示变更文件

## 背景

会话（SessionPanel）在跑轻量变更（thin flow）或全量变更时，agent 持续产出变更文件（`.sillyspec/changes/<变更名>/` 下的 design/tasks/代码 patch 等），但会话页面对变更的感知仅限预会话上下文行与 @ 联想绑定（`session-panel-page.tsx` L648-664），用户想看「agent 现在改了哪些文件、内容是什么」必须跳去变更详情页手动找变更，无法实时掌控。

用户需求（2026-10-13 原话）：会话页面在跑轻量/全量变更任意阶段时，**悬浮展示**该变更的文件（`GET /api/workspaces/{wid}/changes/{cid}/files` 数据），点击具体文件用**与变更文件页相同的展示组件**展示；一个会话内执行多个变更时，未归档优先（最新优先），已归档隐藏但可展开；展示形式经两轮确认定为「胶囊入口 + hover 下拉列表 + 点项开大弹窗」（decisions.md D-001@v2）。

关键现状（探索结论）：
- 会话 ↔ 变更关联的**唯一真相**是 `change_session_links` M:N 表（`backend/app/modules/change/model.py` L267-308），四条写通道（run_sync 命令解析主通道、会话创建绑定、inject @ 联想、agent-logs ctx）都写它；但**没有「会话 → 变更列表」反向查询端点**。
- 变更文件展示组件 `ChangeFileTree`（`frontend/src/components/change-file-tree.tsx` L366）自包含：props 仅 `workspaceId + changeId`（+ 可选 `lastSyncedAt/daemonOnline`），内部自拉文件树、pending「排队中」徽标、点击文件结构化预览（Markdown/diff/json/jsonl）、全屏 `FilePreviewModal`。**注意（Grill 修正）**：其内部唯一的 setInterval（L438）仅在保存后 `saveStatus==='pending'` 时 2s 轮询（5min 上限），文件树本身是挂载单次拉取 + 手动刷新按钮——「实时掌控」需本变更给组件加可选自动刷新 prop（见 FR-04），非零改造。
- 变更详情页已有「紧凑入口卡 + 大 Dialog」模式（`change-files-card.tsx`：shadcn Dialog `h-[85vh] max-w-6xl` 惰性 mount 装 ChangeFileTree），本设计对齐该规格。

## 设计目标

- **FR-01 会话关联变更列表端点**：`GET /api/workspaces/{wid}/changes/-/by-session/{session_id}` 返回该会话关联的全部变更摘要（复用 `ChangeSummary` DTO 含 `is_thin`/`current_stage`/`last_pushed_at` 投影），排除已删除（`location='deleted'`），排序「未归档优先 → created_at desc」。
- **FR-02 悬浮胶囊入口 + hover 下拉列表**：SessionPanel 聊天区右下角非圆圈胶囊入口（「🗂 变更文件 + 进行中数量徽标」，会话在跑时徽标呼吸），鼠标悬浮直接弹出下拉项形式的变更列表：进行中（轻量/全量徽标 + 阶段 pill + 时间）置顶，已归档默认折叠可展开；点击可固定展开（触屏无 hover 的兜底）。
- **FR-03 点项开大弹窗复用展示组件**：点下拉项打开 Dialog（对齐 ChangeFilesCard 规格 `h-[85vh] max-w-6xl`）内嵌 `ChangeFileTree`；弹窗头部下拉可切换变更（key=changeId 重挂载）；点击文件的结构化预览/全屏预览由组件自带。
- **FR-04 实时性（Grill 修正：组件加可选自动刷新 prop）**：给 `ChangeFileTree` 新增可选 prop `autoRefreshMs?: number`（默认 `undefined` = 不轮询，既有消费方 ChangeFilesCard/移动端行为不变）；设置时挂载起 `setInterval(refreshTree, autoRefreshMs)` + 卸载清除（复用组件内已有 `refreshTree`/`refreshPending`，与手动刷新钮同路径）。本变更弹窗内传 `autoRefreshMs={15000}`；Dialog 惰性 mount 保证关闭即停轮询。变更列表（新增变更/归档状态迁移）低频变化，悬浮下拉打开时 15s 轮询刷新（react-query refetchInterval）。
- **FR-05 显隐规则**：入口仅在会话存在关联变更（含已归档）时渲染；无关联变更不占位。

## 非目标

- 不重构 `ChangeFileTree` 组件（仅加一个可选 `autoRefreshMs` prop，默认 `undefined` 行为与现状逐字节一致；其余能力——预览/编辑保存/pending——原样继承，不裁剪不扩展）。
- 不新增数据库表/列（零 migration，复用 `change_session_links` + `changes` 既有结构）。
- 不改会话 DTO（`AgentSessionRead`/`AgentSessionListItem` 不加字段——落选方案 C 的 DTO 内嵌路线已否决，decisions.md D-003）。
- 不做 SSE 推送式变更列表刷新（轮询已满足「实时掌控」，事件驱动列为未来增强，YAGNI）。
- 不做移动端独立页面适配（`m/` 路由不动）；移动端仅保证悬浮入口可点开可用（fixed 定位避开输入条）。
- 不改变更文件的写通道（pending 列表、保存逻辑沿用现状）。

## 拆分判断

单一功能模块（会话页悬浮变更文件面板）+ 一个后端反向查询端点，前后端两个 Wave 即可交付；无批量模式特征（非「模板×数据」）；不拆分。变更名 `2026-10-13-session-change-files-hover`。

## 总体方案

### Wave 1（backend）：会话关联变更反向查询端点

路由挂 `change` 模块（与既有 `GET /changes/{cid}/sessions` 正向端点同域对称；`-` 路径占位符写法与 platform_sync 端点同款——见 `.sillyspec/docs/SillyHub/scan/ARCHITECTURE.md`「进度投影」段 `GET /changes/-/spec-manifest`、`POST /changes/-/spec-sync`；新路径第二段为固定字面量 `by-session`，与 `/changes/{change_id}/xxx` 动态段不冲突）：

```
GET /api/workspaces/{workspace_id}/changes/-/by-session/{session_id}
权限：require_permission(Permission.CHANGE_READ)（对齐 list_change_sessions，跨成员可见）
响应：list[ChangeSummary]
```

实现分层（router 薄 + service 查询）：
1. router 校验会话存在：查 `AgentSession`（含 `workspace_id == wid` 匹配校验），不存在或不属于该工作空间 → 404 中文文案（项目无 `SessionNotFound` 领域错误类，daemon 域既有 `DaemonSessionNotFound` 不跨域复用——本端点直接 `HTTPException(404, detail="会话不存在或不属于该工作空间")`，l10n 守护测试把关中文；执行时对齐 change 模块既有 404 模式）。
2. service 新增 `list_changes_for_session(workspace_id, session_id)`：`select(Change).join(ChangeSessionLink, link.change_id == Change.id).where(link.session_id == session_id, Change.workspace_id == workspace_id, Change.location != 'deleted')`，取数窗口 limit `_SESSION_CHANGES_MAX = 100`（对齐 `_CHANGE_SESSIONS_MAX = 200` 惯例，会话挂变更数远低于此）。
3. 复用 `ChangeService.enrich_summaries(changes)`（service.py L2154，签名 `list[Change] -> list[ChangeSummary]`）批量投影 `is_thin`/`current_stage`/`last_pushed_at`/`pending_review`/`step_progress`（R-03 禁 N+1，复用管道零新增查询）。
4. Python 排序（规避 PG/SQLite 方言差异，对齐 list_change_sessions 做法）：`location != 'archive'`（未归档）优先 → `created_at` desc。

### Wave 2（frontend）：悬浮胶囊入口 + hover 下拉 + 大弹窗

新组件 `session-change-files-hover.tsx` 挂在 `session-panel-page.tsx` 聊天列容器内（聊天区右下角，输入条上方，absolute 定位）：

1. **数据层**（`lib/changes.ts`）：`listSessionChanges(workspaceId, sessionId)` fetch 函数（GET 新端点，返回 `ChangeSummary[]`）+ `useSessionChanges(workspaceId, sessionId, options)` hook：react-query，queryKey `["sessionChanges", workspaceId, sessionId]`（注册进 `lib/query-keys.ts` 工厂），`staleTime 10s`；`refetchInterval` = 下拉/弹窗打开时 15000，否则 `false`（面板加载即 enabled——悬浮入口显隐与徽标数需要数据，列表低频变化）。
2. **胶囊入口**：shadcn Button 样式（border + rounded-lg，非圆圈）+ 进行中（`location != 'archive'`）变更数徽标；`running` prop（session-panel-page 已有 `running = turnState.currentRunId != null`）为 true 且有进行中变更时徽标呼吸动画（CSS animation，对齐原型 `.pillPulse`）。
3. **hover 下拉列表**（antd Popover `trigger=["hover","click"]` 或等价 radix 实现，执行时对齐项目依赖现况——项目以 antd Popover 为控件类首选）：内容为分组列表——「进行中 N」组（置顶）：每项 change_key + `is_thin` 徽标（轻量/全量）+ 阶段 pill（`current_stage` 映射中文，复用 `WORKFLOW_STAGE_LABELS` 口径）+ 相对时间（`updated_at`）；「已归档 N」组默认折叠（antd Collapse 或自定义 disclosure），点击展开；当前选中项高亮。移动端点击入口切换固定展开（hover 不可用的兜底）。
4. **大弹窗**：shadcn Dialog（对齐 `change-files-card.tsx`：`DialogContent h-[85vh] max-w-6xl flex-col p-0` 惰性 mount）——头部：标题「变更文件实时预览」+ 变更切换 Select（antd Select，选项 = 全部关联变更，含归档，轻量/全量/归档后缀标注）+ 关闭钮；body：`<ChangeFileTree key={selectedChangeId} workspaceId changeId autoRefreshMs={15000} />`（key 切换即重挂载重拉；autoRefreshMs 驱动树周期刷新，Dialog 关闭卸载即停）。默认选中：进行中组第一个；全归档时选中归档组第一个。
5. **挂载点**：`session-panel-page.tsx` 聊天列容器（L969-1088 中栏会话分支）内、输入条上方右下角；传 `workspaceId`（会话所属工作空间）、`sessionId`、`running`。

### 测试（两 Wave 各自完成）

- backend pytest（`backend/app/modules/change/tests/test_session_changes_endpoint.py`）：空关联返回 `[]`；多变更排序（未归档优先/created_at desc）；deleted location 排除；归档变更含 `archived` location 正常返回；404（会话不存在）；跨工作空间隔离（wid 不匹配时空/404，执行时按实现定）；enrich 投影字段非空（is_thin 等）。
- frontend vitest（`frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx`）：无关联变更不渲染入口；分组渲染与排序（进行中置顶/归档折叠默认收起）；归档组展开交互；点项开弹窗且传参 changeId 正确；切换变更 Select 重挂载（key 变化）；running 时徽标呼吸类名。
- frontend vitest（`frontend/src/components/__tests__/` 或组件同目录测试，执行时对齐既有测试位置）：`ChangeFileTree` 新增 `autoRefreshMs`——不传时无额外定时器（既有行为回归守护）；传 15000 时周期调用 refreshTree（fake timers 推进断言）。
- `pnpm gen:types` 后提交 `frontend/src/lib/api-types.ts` + `backend/openapi.json`（规则 21）。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/change/router.py | 新增 `list_session_changes` 端点（GET `/changes/-/by-session/{session_id}`，权限 CHANGE_READ，响应 `list[ChangeSummary]`）。**数据流**：producer=ChangeSessionLink JOIN changes 查询 → `ChangeService.list_changes_for_session` → `enrich_summaries` 投影（is_thin/last_pushed_at 等）→ FastAPI 序列化 `list[ChangeSummary]` → OpenAPI（backend/openapi.json 刷新）→ 消费方=前端 api-types 生成物 + `listSessionChanges` |
| 修改 | backend/app/modules/change/service.py | 新增 `list_changes_for_session(workspace_id, session_id)` 查询方法（link JOIN + deleted 过滤 + limit 100 + enrich_summaries 复用 + Python 排序未归档优先/created_at desc） |
| 新增 | NEW:backend/app/modules/change/tests/test_session_changes_endpoint.py | 端点测试：排序/分组/软删排除/404/工作空间隔离/enrich 投影 |
| 修改 | frontend/src/lib/api-types.ts | `pnpm gen:types` 再生成（新端点路径与 ChangeSummary[] 响应型），禁止手写 |
| 修改 | backend/openapi.json | gen:types 数据源随端点新增刷新，与 api-types.ts 同批提交 |
| 修改 | frontend/src/lib/changes.ts | 新增 `listSessionChanges(workspaceId, sessionId)` fetch + `useSessionChanges` hook（refetchInterval 15s 仅打开时）；**数据流**：消费 api-types `ChangeSummary` schema → react-query `["sessionChanges", wid, sid]` 缓存 → 组件消费 |
| 修改 | frontend/src/lib/query-keys.ts | sessionChanges 工厂注册：`sessionChanges: (wid, sid) => ["sessionChanges", wid, sid]` |
| 新增 | NEW:frontend/src/components/daemon/session-change-files-hover.tsx | 悬浮胶囊入口 + hover 下拉分组列表 + 大弹窗（头部 Select 切换 + ChangeFileTree 复用 key=changeId 重挂载 + autoRefreshMs=15000） |
| 修改 | frontend/src/components/change-file-tree.tsx | 新增可选 prop `autoRefreshMs?: number`（默认 undefined 不轮询，既有消费方零影响）；设置时挂载起 setInterval 调用组件内已有 refreshTree/refreshPending、卸载清除。**数据流**：producer=本组件 props（弹窗传 15000）→ 内部 effect interval → 消费方=refreshTree 既有拉取路径（与手动刷新钮同源） |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-page.tsx | 聊天列容器内挂载 `<SessionChangeFilesHover workspaceId sessionId running>`（输入条上方右下角，absolute） |
| 新增 | NEW:frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx | 组件测试：显隐/分组排序/归档折叠/点项传参/切换重挂载/呼吸徽标 |

## 接口定义

### GET /api/workspaces/{workspace_id}/changes/-/by-session/{session_id}

- 权限：`Permission.CHANGE_READ`（对齐 `list_change_sessions` 跨成员可见口径）。
- 路径参数：`workspace_id`（uuid）、`session_id`（uuid，`-` 为路径占位符惯例非参数）。
- 200 响应：`list[ChangeSummary]`（字段集与变更列表一致：`id/change_key/title/status/location/change_type/is_thin/affected_components/current_stage/pending_review/step_progress/owner_name/last_pushed_at/usage/updated_at/…`），按「未归档（location != 'archive'）优先 → created_at desc」排序。
- 404：会话不存在或不属于该工作空间（中文文案，如「会话不存在或不属于该工作空间」；对齐 AgentSession 校验现有模式）。
- 错误码语义与既有 change 端点一致（AppError 体系）。

## 数据模型

零新增/零修改。查询路径：`change_session_links`（`change_id` + `session_id`，unique 二元组）JOIN `changes`（`workspace_id`/`location`/`created_at`/`archived_at` 既有列）。排序分组所需的 `location`/`created_at` 均为既有列，无需回填。

生命周期契约：无/N/A（纯只读查询 + 展示组件，不产生任何事件/状态迁移/lease/心跳；文档中的 session 字样仅指既有 agent_sessions 表的只读关联查询）

## 兼容策略（brownfield）

1. 纯新增只读端点：不改任何既有端点签名/DTO/表结构，旧客户端（含 daemon 端 api-types 消费方）零影响。
2. 前端入口显隐由数据驱动（关联变更数为 0 不渲染），存量会话（无关联变更）界面与现状逐像素一致。
3. `ChangeSummary` 复用不动：字段可选语义（`is_thin` default False、`last_pushed_at` None）对旧消费方保持 brownfield 安全（schema.py 既有注释约定）。
4. gen:types 再生成只增不改：新 path 追加，既有类型零漂移（CI `gen:types:check` 守护）。

## 风险登记

| 风险 | 等级 | 缓解 |
|---|---|---|
| enrich_summaries N+1 / 慢查询 | 中 | 复用既有批量管道（复合 IN join，零新增查询模式）；limit 100 取数窗口有界 |
| 会话挂变更数溢出（>100） | 低 | 罕见（一个会话百个变更）；limit 100 覆盖后按排序丢弃最旧归档项，弹窗 Select 同数据源；如未来需要再加分页（YAGNI） |
| ~~文件树为挂载快照不自动刷新（Grill 抓出：组件唯一轮询仅保存 pending 态）~~ 已修 | — | FR-04 改为组件加可选 `autoRefreshMs` prop（默认不轮询），弹窗内 15s 刷新；既有消费方默认行为不变 |
| autoRefreshMs 定时器泄漏 / 与保存 pending 轮询叠加 | 低 | effect 卸载清除（对齐组件内既有 pollRef 清理模式）；两定时器职责正交（树刷新 vs 保存状态收敛）互不干扰 |
| 触屏设备无 hover | 中 | 入口点击切换固定展开（click trigger 兜底，原型已验证交互） |
| 下拉浮层遮挡输入条 | 低 | 浮层向上弹出（bottom 定位），max-height + 内滚动 |
| hover 抖动（enter/leave 闪烁） | 低 | antd Popover 内置 hover 延迟缓冲；或受控 open + 定时器消抖（执行时按实现定） |

## 决策追踪

- D-001@v2 胶囊入口 + hover 下拉 + 点项开大弹窗（用户两轮确认；v1 悬浮球形态被否决）→ §总体方案 Wave 2。
- D-002@v1 rejected 详情列内嵌（窄列 + 互斥可见性不稳定）→ 非目标（不做详情列形态）。
- D-003@v1 rejected 纯前端拼凑（最多 2 变更丢 M:N 历史）→ §总体方案 Wave 1（新端点是必选项）。
- D-004@v1（Grill 修正）ChangeFileTree 实时性走可选 `autoRefreshMs` prop 而非「零改造」——源码实证组件无常驻树轮询（唯一 setInterval 仅保存 pending 态），「实时掌控」必须由本变更补自动刷新；默认值保持既有消费方行为不变。
- 知识库既有决策对齐：弹窗用 Modal 不用 Drawer（frontend.md 文件预览决策 + FRONTEND_PAGE_STYLE §6）→ 弹窗用 shadcn Dialog。

## 自审

- 背景与目标对齐用户原话四要素（跑变更时悬浮展示/同组件预览/多变更排序/归档可展开）：FR-01~FR-05 逐条覆盖 ✓。
- **Grill 修正已吸收**：FR-04 实时性机制改可选 autoRefreshMs prop（P1 阻塞项解除）；platform_sync 占位符引证补出处（ARCHITECTURE.md 进度投影段）；SessionNotFound 引证更正为 HTTPException 中文文案 ✓。
- 文件清单 NEW: 前缀 3 个新增文件已标；对外字段数据流（端点 → openapi → api-types → 前端消费）逐跳标注 ✓。
- 复用而非新造：ChangeFileTree（最小扩展）/ enrich_summaries / Dialog 规格 / `-` 占位符 / limit 惯例全部对齐既有代码 ✓。
- 非目标防 scope creep：组件仅加可选 prop、零 migration、不做 SSE 推送、不动移动端路由 ✓。
- 风险均有缓解且无阻塞性项；测试设计覆盖正常/边界/异常路径（含 autoRefreshMs 默认行为回归守护）✓。
