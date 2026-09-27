---
author: qinyi
created_at: 2026-09-25 00:32:58
generated_by: sillyspec-design-init
scale: large
---

# 设计文档（Design）— 2026-09-25-observation-events-v3-r16sf

## 背景

观测事件通道（v2，变更 2026-09-23-change-events-channel）已承接 CLI watcher 旁路批量上行（`POST /changes/{name}/events`）与前端只读展示（`ChangeEventsCard`，30s 轮询）。v2 存在五处缺口，构成本变更的动因：

1. 批量上限 200 偏小（`backend/app/modules/platform_sync/schema.py:648`），高频变更期 watcher 需更多批次；
2. `since` 增量游标基于事件业务 ts（`backend/app/modules/platform_sync/service.py:2113-2115`）——业务 ts 乱序到达时，晚到的早 ts 事件落在游标左侧被永久跳过；
3. 读缺省 500 条且无截断标记，调用方无从判断是否被 limit 截断；
4. detail 落库截 2000 字符（`service.py:161-163`），观测明细损失大；
5. 前端仅有卡片级首轮自动展开（`change-events-card.tsx:34-44`），无告警级「一次决策」语义。

v3 按任务书（R16-SF 会话A）在**原地**补齐上述五点（D-001/D-009 用户裁决），全部行为挂单一功能开关，缺省关。

## 设计目标

- FR-01 写入端点批量上限提升至 500（开态），关态维持 200 拒收语义；
- FR-02 幂等去重按（规范化 ts + 去重键）复合，重推跳过不覆盖；
- FR-03 窗口上限 5000 条，开态按接收序剪枝，并发少量超删容忍并登记；
- FR-04 读取 `since` 基于 received_at（服务端接收时间）；缺省最近 2000 条 + `truncated` 标记；detail 上限 64KB；spec/design/实现三层逐字对齐；
- FR-05 前端 30s 轮询全量重拉（不做增量游标）+ 告警条自动展开每告警只决策一次；
- FR-06 未配置（开关缺省关）既有行为不变；回退=关开关，零迁移零数据损失。

（FR 编号在 requirements.md 定义，此处同口径引用。）

## 非目标

- 不做前端增量游标（任务书明确排除）；
- 不触发通知/审批/门控（沿 D-004@v1「provisional 只展示不消费」红线，本服务纯观测）；
- 不改 sillyspec CLI watcher（仓外组件，其现有 ≤200 批推送在两态下均合法）;
- 不新增表/端点组/常驻任务（D-001/D-009：原地演进，方案 B/C 已否决）；
- 告警决策记忆不做后端持久化（仅前端 sessionStorage，会话语义）；
- 不删除 v2 代码分支（退役判据见 D-009，另立决策）。

## 拆分判断

单变更交付：backend（platform_sync + settings）与 frontend 改动共享同一 API 契约与同一开关，拆两个变更会产生中间态不一致（前端先合则探测不到 v3 标志、后端先合则前端永远停在 200 条）。无「模板×数据」形态，不走批量模式。

## 总体方案

技术分解（Wave 供 plan 阶段细化）：

- **Wave 1 存储与开关**：detail 列 Text 化 + Alembic 迁移；`feature_flag.py`（读 `PlatformSetting('observation-events-v3')`）；settings 模块管理端点（GET/PUT，管理员+审计）。
- **Wave 2 后端语义分支**：schema（max_items 静态 500、响应可选字段、limit 缺省 None）；service（`append_events`/`list_events` 增 `v3` 语义参数：截断 2000/64KB、剪枝序双态、since 列双态、最近 N 反转）；router（关态批>200 手动 422、limit 双态缺省、`response_model_exclude_none`）。
- **Wave 3 前端**：`observation-alert-decisions.ts` 决策记忆纯函数；`ObservationAlertBar` 告警条组件；`ChangeEventsCard` 探测式两段拉取 + truncated 提示；`pnpm gen:types` 重生成类型。
- **Wave 4 测试与文档**：关态零回归确认（既有测试零改动全绿）+ 开态测试矩阵 + 模块文档/changelog 同步。

核心机制——**开关读取**：router 层每请求调 `observation_events_v3_enabled(session)`（一次主键 GET，KV 无键/解析失败/值非真均按 false，fail-closed），结果作为 `v3: bool` 语义参数下传 service。service 内所有差异点收敛为该参数的分支，两态代码路径彼此隔离、测试矩阵双锁。

**探测式两段拉取**（前端）：首轮沿用 `limit=200`（与 v2 完全同请求）；响应携带 `v3: true` → 后续轮询升级 `limit=2000` 全量重拉（30s 不变）；响应无 `v3` 字段 → 永远停留在 200 请求，渲染与 v2 逐像素一致。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/platform_sync/schema.py | `ChangeEventPushRequest.events` max_items 200→500（静态）；`ChangeEventListResponse` 增可选 `truncated`/`v3`；`ChangeEventItem` 增可选 `receivedAt`。数据流：producer=ORM 行（created_at/ts）→ service 返回 → router model_validate 序列化（ISO 8601）→ consumer=前端 `api-types.ts`（gen:types）与增量客户端（末条 receivedAt 作下轮 since） |
| 修改 | backend/app/modules/platform_sync/router.py | 写端点：读开关 + 关态批>200 手动 422；读端点：读开关 + `limit` Query 缺省 None（关态 500/开态 2000）+ `v3` 参数下传 + `response_model_exclude_none=True` |
| 修改 | backend/app/modules/platform_sync/service.py | `append_events(…, *, v3=False)`：detail 截断 `2000 / 64*1024` 双态、剪枝序 `(ts,created_at,id)` / `(created_at,id)` 双态；`list_events(…, *, v3=False)`：since 过滤列 `ts / created_at` 双态、开态无 since 取 `created_at DESC LIMIT n` 后反转为正序 |
| 修改 | backend/app/modules/platform_sync/model.py | `PlatformChangeEventORM.detail` 列 `String(2000)→Text` |
| 新增 | NEW:backend/app/modules/platform_sync/feature_flag.py | `observation_events_v3_enabled(session) -> bool`：读 `PlatformSetting(key='observation-events-v3')`，缺键/JSON 解析失败/值非 `{"enabled": true}` 均 false（fail-closed） |
| 新增 | NEW:backend/migrations/versions/20260925900000_change_event_detail_text.py | detail 列加宽迁移（PG `ALTER TYPE TEXT`；SQLite batch_alter 对齐既有方言分叉防御；基于当前单 head 新 revision，文件名时间戳 execute 按实际落点定） |
| 修改 | backend/app/modules/settings/router.py | 新增 `GET/PUT /platform-settings/observation-events-v3`（复用 `_read_setting_json`/`_write_setting_json` :198-235 + `_audit_platform_setting_write` 审计，管理员鉴权对齐 mcp-whitelist 端点 :237-262 范式）。数据流：producer=管理员 PUT `{"enabled": bool}` → PlatformSetting KV 落库 → consumer=platform_sync 读写端点每请求读取 |
| 修改 | backend/app/modules/settings/schema.py | 新增 ObservationEventsV3Setting 读写模型（`{enabled: bool}`），开关端点请求/响应体（plan postcheck 对齐补录，2026-09-25） |
| 新增 | NEW:backend/app/modules/platform_sync/tests/test_change_events_v3.py | 开态测试矩阵：批 499/500/501、接收序剪枝、乱序 ts 晚到不丢、缺省 2000+truncated、64KB 截断、receivedAt/since(created_at) 游标、响应字段矩阵、关态响应无新字段 |
| 新增 | NEW:backend/app/modules/settings/tests/__init__.py | settings 模块测试包初始化（该模块此前无 tests 目录） |
| 新增 | NEW:backend/app/modules/settings/tests/test_observation_events_v3_flag.py | 开关端点测试：缺省 false、PUT true 即时生效、非管理员 403、审计落库 |
| 修改 | frontend/src/components/changes/detail/change-events-card.tsx | 探测式两段拉取（首轮 200，`v3:true` 后 queryFn 升级 2000，queryKey 含 mode）+ truncated 尾部提示 + 开态挂载 `ObservationAlertBar`；关态渲染零变化 |
| 修改 | frontend/src/components/changes/detail/__tests__/change-events-card.test.tsx | 既有卡片测试扩展：开态升级/truncated/告警条挂载断言 + 关态断言（不弱化既有断言；plan postcheck 对齐补录，2026-09-25） |
| 新增 | NEW:frontend/src/components/changes/detail/observation-alert-bar.tsx | 告警条组件：severity∈{warning,error} 事件列表，新告警自动展开，每告警 id 只自动决策一次 |
| 新增 | NEW:frontend/src/lib/observation-alert-decisions.ts | 决策记忆纯函数：`isAlertDecided(id)` / `markAlertDecided(id)`，sessionStorage key `obs-alert-decided`（JSON 数组，读写 try/catch 容错降级内存 Set） |
| 新增 | NEW:frontend/src/lib/__tests__/observation-alert-decisions.test.ts | 决策记忆纯函数测试（标记/判重/存储损坏降级） |
| 新增 | NEW:frontend/src/components/changes/detail/__tests__/observation-alert-bar.test.tsx | 告警条组件测试：新告警自动展开、手动收起后不再自动展开、关态不渲染 |
| 修改 | frontend/src/lib/changes.ts | `listChangeEvents` 的 limit 参数透传放宽（200/2000 两段），类型随 api-types 再生成 |
| 修改 | frontend/src/lib/api-types.ts | `pnpm gen:types` 重生成（数据流：backend OpenAPI → `scripts/gen-api-types.mjs` → api-types.ts → 组件消费；同批提交 `backend/openapi.json`） |
| 修改 | backend/openapi.json | gen:types 导出的 OpenAPI 快照随 schema 变更更新（CLAUDE.md 规则 21：不让类型落后后端形成债） |
| 修改 | .sillyspec/docs/SillyHub/modules/platform_sync.md | 模块文档同步：端点双态语义、开关键、feature_flag 入口 |
| 修改 | .sillyspec/docs/SillyHub/modules/frontend_components.md | 前端组件文档同步：告警条组件、卡片两段拉取 |
| 修改 | .sillyspec/docs/SillyHub/modules/frontend_components.changelog.md | changelog 追加本变更条目 |

既有测试文件 `backend/app/modules/platform_sync/tests/test_change_events.py` **零改动**——它是关态逐字回归的验收锚点（R-01）。

## 接口定义

**POST `/api/platform-sync/changes/{name}/events`**（写，鉴权 `_write_auth` 仅 shpsync_ 不变）

- 请求：`ChangeEventPushRequest{events: list[ChangeEventPush]}`，静态 `max_items=500`；关态（flag=false）router 手动校验 `len(events)>200 → 422`（detail 中文；状态码与 v2 一致，body 结构由 pydantic 校验错误变为手写 HTTPException——R-03 登记，调用方按状态码判定不受影响）。
- dedup：`dedup_key = id or f"{int(ts)}|{kind}|{stage or ''}"`（规范化 ts=int 毫秒已内嵌复合键，`_change_event_dedup_key` :166-172 不变）；批内去重+已存键预取+IntegrityError 一轮重试骨架不变。
- 落库参数双态：detail 截断 `2000`（关）/`65536`（开）；剪枝 `ORDER BY (ts,created_at,id)`（关）/`(created_at,id)`（开）删最旧至 5000，仍与本批插入同事务。
- 响应：`{accepted, deduplicated}` 不变。

**GET `/api/platform-sync/changes/{name}/events`**（读，鉴权 `_read_auth` 不变）

- Query：`since`（ISO 8601，容忍 `Z` 后缀）；`limit: int|None`（ge=1, le=5000；缺省 None→关态 500/开态 2000）。
- 关态：`ts > since`；排序 `ts ASC, id ASC`；响应 `{items, total}`（JSON 与 v2 逐字节一致）。
- 开态：`created_at > since`（received_at 语义）；无 since → `created_at DESC, id DESC LIMIT n` 取最近后服务端反转为正序（id 决胜消 created_at 并列毫秒歧义，对齐 v2 剪枝序先例）；有 since → `created_at ASC LIMIT n`；`items[].receivedAt` = created_at ISO 8601；响应 `{items, total, truncated, v3:true}`，`truncated = total > len(items)`（router 组装）；`response_model_exclude_none` 保证关态新字段不出现。
- detail 64KB 口径三层逐字对齐：**64KB = 65536 个字符**（Python `str` 截断 `detail[:65536]`；UTF-8 下实际字节数 ≥ 字符数，不做字节级精确截断），执行层=service 落库前截断。

**GET/PUT `/api/settings/platform-settings/observation-events-v3`**（管理员+审计）

- `GET → {"enabled": bool}`（缺省 `false`）；`PUT {"enabled": bool} → {"enabled": bool}`。

**service 签名**：

- `append_events(workspace_id, change_name, events, *, v3: bool = False) -> tuple[int, int]`
- `list_events(change_name, workspace_id=None, allowed_workspace_ids=None, since=None, limit=500, *, v3: bool = False) -> tuple[list[PlatformChangeEventORM], int]`（truncated 由 router 以 `total > len(rows)` 组装，service 签名不变）
- `feature_flag.observation_events_v3_enabled(session: AsyncSession) -> bool`

**前端 lib**：

- `listChangeEvents(workspaceId, changeKey, {limit}: {limit?: number})`（两段 200/2000）
- `observation-alert-decisions.ts`：`isAlertDecided(alertId: string): boolean`、`markAlertDecided(alertId: string): void`

## 生命周期契约表

不涉及生命周期契约（观测事件 append-only 无状态机，不含 session/lease/agent_run/daemon/claim/heartbeat 语义）。

## 数据模型

唯一 schema 变更：`platform_change_events.detail` `String(2000) → Text`（`backend/app/modules/platform_sync/model.py`）。无新表、无新列（received_at 复用 `created_at`，D-009）。

迁移 `20260925900000_change_event_detail_text`：upgrade `ALTER COLUMN TYPE TEXT`（PG）/batch_alter（SQLite 测试库）；downgrade 同形缩窄回 `String(2000)`——若存量行 >2000 字符 PG 会报错，**down 仅限无 v3 数据的开发库**，生产回退一律走开关置关（数据保留、列保持 Text），R-06 登记。

## 兼容策略（brownfield 必填）

- **未配置新功能时行为不变**：KV 无 `observation-events-v3` 键（或值非真）→ enabled=false → 全部 v2 路径：批>200 拒收（422）、剪枝 `(ts,created_at,id)`、`since → ts >`、limit 缺省 500、detail 截 2000、响应无 `truncated/v3/receivedAt` 字段（exclude_none）。既有测试 `test_change_events.py` 零改动全绿即验收。
- **回退路径**：`PUT …/observation-events-v3 {"enabled": false}` 即时生效（每请求读 KV，无缓存陈旧）；v3 期间写入的行（含 64KB detail）在 v2 读路径完全可读可展示（前端 detail 列已有 CSS truncate）；detail 列保持 Text 不回滚迁移。零数据损失。
- **不改变的 API/表结构**：鉴权四轨与 workspace 派生、`POST /changes/{name}` 系列其余端点、`platform_change_events` 表其余列与唯一约束/索引、平台设置表结构。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | v3 分支条件泄漏进关态（开关两态代码同路径） | P0 | 关态回归矩阵：既有 `test_change_events.py` 零改动全绿 + 开态测试文件内加关态断言（响应体无 `truncated/v3/receivedAt` 字段、批 201→422、缺省 500） |
| R-02 | 并发批量写各自 count+delete，窗口瞬时 <5000（超删） | P2 | 任务书明示允许（D-003）；design 如实登记；读端 `truncated/total` 口径不受影响（修剪后 count 收敛） |
| R-03 | 关态批>200 的 422 body 结构差异（pydantic 校验错误→手写 detail） | P2 | 状态码与拒绝语义不变；既有测试仅断言状态码（`test_change_events.py:161-164`）；CLI watcher 按状态码判定 |
| R-04 | 前端探测式两段拉取：开态首轮 200 条窗口内短暂缺尾部告警 | P2 | 探测响应含 `v3:true` 即触发升级请求（React Query 新 queryKey 立即拉取），30s 周期内补齐；告警条以升级后数据为准 |
| R-05 | 64KB detail × 500 条/批的写入压力（理论上限 ~32MB/请求） | P2 | watcher 30s 低频周期天然限流；v2 观测数据实际 detail 远小于上限 |
| R-06 | 迁移 down 缩窄在有 v3 数据库上报错 | P2 | down 仅限开发库；生产回退走开关（兼容策略节），列保持 Text |
| R-07 | 每请求一次 KV 主键读的开销 | P2 | 低频批量通道（30s 周期）可忽略（D-008）；不做 TTL 缓存（避免回退延迟） |
| R-08 | 无长驻进程/外部资源，生命周期面不适用 | — | 显式留痕（10b）：本变更不引入后台任务/文件锁/子进程 |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | 总体方案（原地演进）、非目标（不新增表/端点） | 已覆盖 |
| D-002@v1 | 接口定义（读端点 since=created_at 双态） | 已覆盖 |
| D-003@v1 | 接口定义（剪枝序双态）、风险 R-02 | 已覆盖 |
| D-004@v1 | 接口定义（缺省 2000+truncated）、文件清单（schema/router） | 已覆盖 |
| D-005@v1 | 数据模型（Text 加宽）、接口定义（64KB 截断）、风险 R-05 | 已覆盖 |
| D-006@v1 | 接口定义（写端点鉴权/批上限/去重复合键） | 已覆盖 |
| D-007@v1 | 总体方案（前端两段拉取+告警条一次决策）、文件清单（前端五文件） | 已覆盖 |
| D-008@v1 | 总体方案（开关 KV+fail-closed）、兼容策略（回退）、文件清单（feature_flag/settings 端点） | 已覆盖 |
| D-009@v1 | 总体方案（方案 A 原地分支+同步剪枝）、风险 R-01（双态测试矩阵） | 已覆盖 |

全部 D-001@v1 ~ D-009@v1 已覆盖，无未解决决策。

**多裁定组合推演**（D-001 原地 × D-005 列只加宽 × D-008 开关缺省关，三条相互约束）：

| 场景 | 推演结果 |
|---|---|
| 迁移先于开关启用（正常上线序） | 列已 Text，开态写 64KB 安全 ✓ |
| 开关开→关（回退） | v3 行（detail>2000、receivedAt）在 v2 读路径可读（Text 列 v2 读无碍、前端 truncate 兜底）✓ |
| 开关关→开（重入） | 关态期间写入行 created_at 持续存在，since 游标连续不丢 ✓ |
| 开关开时执行迁移 down | 64KB 行缩窄报错 → **禁止**：回退先关开关再（仅开发库）down（R-06）✓ |

无死锁格。

## 自审

- [x] 章节齐全（背景/设计目标/非目标/拆分判断/总体方案/文件变更清单/接口定义/数据模型/兼容策略/风险登记/决策追踪/自审）
- [x] frontmatter 字段齐全（author/created_at/scale=large）
- [x] 引用所有当前版本 D-xxx@vN（D-001~D-009 全部出现在决策追踪表并标注覆盖点）
- [x] 生命周期关键词核对：仅「回退/重入/终止」类描述性用语，无 session/lease/agent_run/claim/heartbeat 契约语义 → 已写紧邻豁免短语「不涉及生命周期契约」
- [x] UI 原型分级核对：涉前端组件 → `prototype-observation-events-v3.html` 已生成（分级=建议生成：新组件+状态驱动交互）
- [x] 文件清单 NEW: 前缀与数据流标注核对：5 个 NEW 文件均带前缀；含对外字段行（schema/settings/changes.ts/api-types）均交代 producer→consumer 数据流
- [x] 三层逐字对齐承诺（任务书条目 2）：缺省=2000 条（接口定义/FR-04/requirements 同口径）、detail 64KB 上限执行层=service 落库截断（接口定义/数据模型/requirements 同口径）——requirements.md 生成时照抄本节字面
- [ ] 无「⚠️ 自审存疑」项
