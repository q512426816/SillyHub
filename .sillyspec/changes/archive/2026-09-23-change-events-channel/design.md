---
author: qinyi
created_at: 2026-09-23 04:11:50
generated_by: sillyspec-design-init
scale: large
---

# 设计文档（Design）— 2026-09-23-change-events-channel

## 背景

sillyspec CLI 侧 watcher/哨兵（`watcher.js`，3.29.x 起）已在 change 启动时拉起 detached 观测旁路，从产物签名（文件/git HEAD/质量扫描记录）推断阶段并产生 provisional 事件流（本地 `.sillyspec/.runtime/watcher-events-<change>.jsonl` 是 CLI 侧唯一真相源），并 best-effort 推送到 `{platform.url}/api/changes/{name}/events`（watcher.js:608-640 `pushEventsToPlatform`：`POST {events: [...]}`，`Authorization: Bearer <shpsync_ token>`，5s 超时，非 2xx 静默降级）。但平台侧该端点不存在，推送恒 404（CLI 只 warn 不阻断，但观测面在平台缺失）。

本件在平台侧补消费端点 + 面板展示：后端建 append-only 事件表与 POST/GET 两端点，前端变更详情页加只读「观测事件」折叠区。

**红线（用户规格）**：平台对 provisional 事件**只展示不消费**——sillyspec 侧单写者纪律，`--done` 才是流程真相，事件仅观测面（D-004@v1）。

## 设计目标

1. watcher 推送不再 404：POST 端点接收批量事件落库，幂等去重，上限保护。
2. 面板可观测：GET 端点按时间正序 + since 增量；详情页折叠区展示时间线，warning 高亮。
3. 零业务消费：事件全链路（存储/读取/展示）无任何流程判定逻辑。

## 非目标

- 不做 SSE 推送通道（/sessions/events 先例可后续升级，非本件必须）。
- 不做事件触发的通知/告警联动/审批门控（D-004@v1 红线）。
- 不改 sillyspec 工具侧（CLI watcher 已就绪，只动平台仓）。
- 不做跨变更事件聚合页/事件检索（仅单变更详情页内嵌区）。

## 拆分判断

不适用（单变更直做，无多变更包拆分）。

## 总体方案

**Wave 1（后端）**：platform_sync 模块内新增 ORM 表 `platform_change_events` + alembic 建表迁移 + Pydantic schema + service（upsert_events/list_events）+ router 两端点 + pytest 五组。全链路复用 platform_sync 既有鉴权（`require_platform_sync_write` / `require_platform_sync`，backend/app/modules/platform_sync/auth.py:153-176）与 `_read_args` scope 翻译（backend/app/modules/platform_sync/router.py:93-101）。

**Wave 2（前端）**：`pnpm gen:types` 再生成 api-types（后端 schema 落 openapi.json 后）；新建 `ChangeEventsCard` 自取数组件（useQuery 30s 轮询，QuicklogLinkedCard 先例 frontend/src/components/changes/detail/quicklog-linked-card.tsx:31-47）挂详情页 aside；vitest 四组。

**Wave 3（验收收口）**：本地 dev 后端 curl 模拟 watcher 推 5 条（含 2 warning）→ GET 正序去重 → 面板渲染核对；gen:types 产物（api-types.ts + openapi.json）随提交。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/platform_sync/model.py | 新增 `PlatformChangeEventORM`（append-only 表，D-002@v1） |
| 新增 | NEW:backend/migrations/versions/20260923040000_add_platform_change_events.py | 建表迁移（down_revision=20260920220000 当前 head） |
| 修改 | backend/app/modules/platform_sync/schema.py | 新增 `ChangeEventPushRequest`/`ChangeEventItem`/`ChangeEventPushOk`/`ChangeEventListResponse`（D-007@v1 宽松接收） |
| 修改 | backend/app/modules/platform_sync/service.py | 新增 `append_events`（去重+上限修剪 D-005@v1）与 `list_events`（正序+since 增量） |
| 修改 | backend/app/modules/platform_sync/router.py | 新增 `POST /changes/{name}/events`（写鉴权）与 `GET /changes/{name}/events`（读鉴权+scope） |
| 修改 | backend/app/modules/platform_sync/tests/conftest.py | `ensure_platform_sync_table` 建表清单加新表 |
| 新增 | NEW:backend/app/modules/platform_sync/tests/test_change_events.py | pytest 五组：收/取/去重/鉴权/上限 |
| 修改 | frontend/src/lib/changes.ts | 新增 `listChangeEvents`（GET，since 增量参数）+ 类型 re-export |
| 修改 | backend/openapi.json | gen:types 再生成产物（后端 schema 变更联动，CLAUDE.md 规则 21） |
| 修改 | frontend/src/lib/api-types.ts | gen:types 再生成产物（同上） |
| 新增 | NEW:frontend/src/components/changes/detail/change-events-card.tsx | 观测事件折叠区组件（D-006@v1） |
| 新增 | NEW:frontend/src/components/changes/detail/__tests__/change-events-card.test.tsx | vitest 四组：渲染/告警高亮/空态/角标计数 |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx | aside 挂载 `ChangeEventsCard`（传 workspaceId + change_key） |

## 接口定义

本变更接口面：2 端点。

| 方法 | 路径 | 鉴权 | 说明 |
|---|---|---|---|
| POST | /api/changes/{name}/events | 仅 shpsync_（写） | 批量事件上行（幂等去重+上限修剪） |
| GET | /api/changes/{name}/events | shpsync_ / JWT·shk_live_（读 scope） | since 增量正序拉取 |

### POST /api/changes/{name}/events（写端点，仅 shpsync_）

请求（CLI watcher.js:618-624 实际形态）：

```json
{
  "events": [
    { "ts": 1758566000000, "kind": "file", "stage": "design",
      "detail": "design.md 出现", "provisional": true },
    { "ts": 1758566003000, "kind": "commit", "stage": null,
      "detail": "1d33bda", "provisional": true, "id": "evt-42",
      "rule": "p2-tests-red", "severity": "warning" }
  ]
}
```

- 每条：`kind` str 必填；`ts` epoch 毫秒 number 必填（值域 ≥1e12 校验，D-003@v1）；`stage`/`detail`/`rule`/`severity`/`id`/`provisional` 可选；未知字段 `extra=ignore`（D-007@v1）。
- `provisional` 落库恒 True（无论请求值——D-004@v1 红线数据层落地）。
- 批量上限 200 条/请求（超限 422）；`detail` 服务端截 2000 字符。
- 响应 200：`{ "accepted": <int>, "deduplicated": <int> }`；同 dedup_key 跳过计数入 deduplicated。
- 鉴权矩阵：无凭据 401 / shk_live_·JWT 403（写通道仅 shpsync_，platform_sync auth.py D-004 先例同款）/ shpsync_ 200。
- `workspace_id` 从 token 派生唯一通道，body 不含 workspace 字段（G6 同款）。

### GET /api/changes/{name}/events?since=<iso8601>&limit=<int>（读端点）

- 鉴权：`require_platform_sync` + `_read_args(scope)` scope 翻译（shpsync_ token 绑定 workspace / JWT·shk_live_ CHANGE_READ 并集，router.py:93-101 复用）。
- `since`：ISO 8601 可选；`ts > since` 严格大于（增量不含边界）；无效格式 422。
- `limit`：默认 500 上限 5000（单变更上限内的全量窗口）。
- 排序：`ts ASC, id ASC` 稳定正序。
- 响应 200：`{ "items": [ChangeEventItem...], "total": <int> }`；ChangeEventItem = `{ id, ts, kind, stage, detail, rule, severity, provisional, created_at }`（ts/created_at 序列化为 ISO 8601 字符串）。
- change 无事件 → 200 空列表（不 404——事件表独立于 change 行存在，观测面宽松）。

## 生命周期契约表

不涉及生命周期契约——本件为无状态 HTTP 收发端点（事件是一次性写入的 append-only 观测数据，无 session/lease/claim/heartbeat/state transition；watcher 进程生命周期完全由 CLI 侧管理，平台不感知）。

## 数据模型

新表 `platform_change_events`（SQLModel，append-only）：

| 列 | 类型 | 约束 | 说明 |
|---|---|---|---|
| id | UUID | PK, default uuid4 | 行主键 |
| workspace_id | UUID | FK→workspaces(id) ON DELETE CASCADE, NOT NULL | token 派生唯一通道 |
| change_name | String(255) | NOT NULL | 变更名（URL 路径参数） |
| dedup_key | String(320) | NOT NULL | D-002@v1：id 优先，否则 `ts\|kind\|stage` |
| ts | DateTime(tz) | NOT NULL | 事件时间（epoch ms 归一，D-003@v1） |
| kind | String(64) | NOT NULL | 事件类型原样 |
| stage | String(64) | NULL | 阶段原样（可空） |
| detail | String(2000) | NULL | 详情原样（截断） |
| rule | String(128) | NULL | 哨兵规则名（扩展面） |
| severity | String(32) | NULL | warning 等 severity（扩展面） |
| provisional | Boolean | NOT NULL, 恒 True | D-004@v1 红线 |
| created_at | DateTime(tz) | NOT NULL, server_default now() | 服务端接收审计 |
| — | UniqueConstraint | (workspace_id, change_name, dedup_key) `uq_platform_change_events_dedup` | 幂等去重 |
| — | Index | (workspace_id, change_name, ts) `ix_platform_change_events_ws_change_ts` | 读路径主查询 |

无既有表结构变更（新表独立，alembic 单 head 接 20260920220000）。

## 兼容策略（brownfield 必填）

- 端点为纯新增：既有 platform_sync 端点与表零改动（router 追加路由不动既有函数）。
- CLI watcher 对 404 本就静默降级（本地 jsonl 兜底），本件上线前后 CLI 行为不变——非破坏性补齐。
- 前端：`ChangeEventsCard` 失败/无数据静默隐藏或空态，不阻断详情页既有内容（QuicklogLinkedCard 同款降级）。
- 老版本 CLI（无 id/rule/severity 字段）推送照常接收——可选字段缺省 None。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 路由注册顺序：`/changes/{name}/events` 参数路由与既有字面量 `-` 段冲突 | P2 | 不新增字面量段；新路由放既有参数路由区（`/changes/{name}/progress` 同区之后），注册顺序无新增冲突面 |
| R-02 | 同毫秒批量事件的去重误伤（D-002@v1 故障面） | P3 | 接受——观测面丢条无碍真相；CLI 侧本地 jsonl 完整 |
| R-03 | 修剪 DELETE 大量行的写放大（极端刷爆场景） | P3 | 5000 条上限内单事务修剪，量级可控；CLI 推送频率 3s 轮询粒度 |
| R-04 | gen:types 再生成暴露无关旧测试债 | P2 | 按 CLAUDE.md 规则 21 惯例：无关旧债顺手补字段修好，不为躲报错改回手写 |
| R-05 | UI 原型分级：本件前端为单卡片嵌入既有详情页布局（aside 次线），照 FRONTEND_PAGE_STYLE.md 既有卡片范式实现，不产出独立 prototype-*.html | P3 | 组件测试覆盖渲染/高亮/空态/角标；视觉与同页 quicklog 卡同款 |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | 总体方案 Wave 1；文件变更清单（全落 platform_sync） | 已确认 |
| D-002@v1 | 数据模型（dedup_key 列+唯一约束）；接口定义 POST 语义 | 已确认 |
| D-003@v1 | 数据模型 ts 列；接口定义 since 语义 | 已确认 |
| D-004@v1 | 接口定义（provisional 恒 True）；非目标（不做消费） | 已确认 |
| D-005@v1 | 接口定义（上限修剪）；service append_events | 已确认 |
| D-006@v1 | 文件变更清单（ChangeEventsCard）；总体方案 Wave 2 | 已确认 |
| D-007@v1 | 接口定义（schema 宽松面）；数据模型可选列 | 已确认 |

## 自审

- [x] 章节齐全（背景/设计目标/非目标/总体方案/文件变更清单/接口定义/风险登记）
- [x] frontmatter 字段齐全（author/created_at/scale=large）
- [x] 引用所有当前版本 D-xxx@v1（七条全覆盖于决策追踪）
- [x] 生命周期关键词豁免短语已紧邻「生命周期契约」标题书写
- [x] UI 原型分级核对：跳过原因记入 R-05（单卡片照既有范式，非新页面布局）
- [x] 无「⚠️ 自审存疑」项
