---
author: qinyi
created_at: 2026-08-10 23:22:56
---

# 需求规格（Requirements）

> 依据跨仓契约 `docs/sillyspec/sillyhub-progress-sync-contract.md` §1/§4/§5/§6/§7/§8/§9/§13。

## 功能需求

### FR-01：三端点路径契约（D-001）
SillyHub 后端实现三个 HTTP 端点，路径无 workspace 前缀、按 change name 寻址：
- `POST /api/changes/{name}/progress`（上行 + 冲突检测）
- `GET /api/changes`（轻量列表）
- `GET /api/changes/{name}/progress`（完整 JSON 下行）
独立挂载，不碰现有 `/api/workspaces/{wid}/changes/*`。验收：三端点存在且与现有路由不冲突。

### FR-02：Bearer 鉴权（D-002）
三端点均要求 `Authorization: Bearer <token>`。`require_platform_sync` 依赖识别 `shk_live_` 前缀走 `ApiKeyService.authenticate`，否则回退 JWT。非法/过期/吊销 → 401。不做 workspace 权限检查。验收：无 token → 401；合法 API Key → 通过；非法 token → 401。

### FR-03：platform_change_progress 存储（D-003）
新建表 `platform_change_progress`（change_name PK + latest_progress JSON + last_pushed_at String + last_pusher String + updated_at DateTime）。按 change_name 聚合，裸六表 JSON 透传。验收：alembic upgrade/downgrade 对称可逆；ORM 可 import。

### FR-04：base_ts 冲突检测算法（D-004 / 契约 §4.2）
POST 处理逻辑：
- base_ts 空/缺失 → 无条件接受（首次同步）。
- `stored_last_pushed_at > base_ts`（字符串字典序）→ 409 冲突。
- 否则接受 upsert。
验收：缺 header 接受；stored>baseTs 返回 409；stored≤baseTs 接受；比对用字典序不转 Date。

### FR-05：元字段走 HTTP header（D-005 / 契约 §4.1）
POST 从 header 读 `X-SillySpec-User` / `X-SillySpec-Base-Ts` / `X-SillySpec-Pushed-At`（缺失/空均 None），body 保持裸 JSON。验收：3 header 缺失不崩；body 不含元字段。

### FR-06：冲突不 auto-merge（D-006 / 契约 §9）
冲突仅返回 409 `{conflict:true, platform_progress:<完整六表>, last_pushed_at}`，绝不合并字段。`platform_progress` 必须完整可被客户端 `resolve --take-platform` import。验收：409 响应 platform_progress 等于平台当前 latest_progress 完整内容。

### FR-07：GET 响应裸形态（D-007 / 契约 §5/§6）
- `GET /api/changes` → 裸数组 `[{name, current_stage, last_pushed_at, last_pusher}]`，current_stage 取自 `latest_progress.changes[0].current_stage`。
- `GET /api/changes/{name}/progress` → 裸六表 + 顶层 `last_pushed_at`；不存在 → 404。
验收：列表项字段齐全；单 change 响应含完整六表 + 顶层 last_pushed_at；不存在 404。

### FR-08：name 全局唯一寻址（D-008 / 契约 §3）
按 change_name 全局聚合，不按 project/workspace 隔离。已知限制：多项目同名互相覆盖（NG-5/R-01，本次不解决）。验收：同 name 多次 push 覆盖同一行。

## 非功能需求

### NFR-01：零回归（契约 §8）
- 老 body（裸 JSON 无 header）继续可解析。
- 客户端老版不发 header → base_ts 空 → 接受。
- 与现有 `/workspaces/{wid}/changes/*` 路径不冲突。
验收：上述场景测试通过。

### NFR-02：时间戳字典序（契约 §7）
所有时间戳比对用 ISO 8601 UTC 字符串字典序（Python `>`），不转 Date。`last_pushed_at` 存客户端原值字符串。验收：字典序比对单测。

### NFR-03：代码质量
ruff format + ruff check + mypy 全过；platform_sync 测试全绿；alembic 迁移 dialect 无关（SQLite 测试 + PG 生产对齐）。

### NFR-04：OpenAPI 完整
`backend/openapi.json` 经 `pnpm gen:types` 同步，platform_sync 三端点 schema 完整（CLAUDE.md 规则 20）。
