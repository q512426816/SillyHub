---
author: qinyi
created_at: 2026-08-10 23:22:56
---

# 决策台账 — 2026-08-10-sillyhub-platform-sync

本次变更的实现/验收影响决策记录。非长期术语表（术语在 archive/scan 时提升到 glossary.md）。依据：跨仓契约 `docs/sillyspec/sillyhub-progress-sync-contract.md` + 客户端源码 `sillyspec/src/sync.js`。

## D-001@v1: 端点路径无 workspace 前缀，按 change name 寻址
- type: architecture
- status: accepted
- source: docs（契约 §1）+ code（sync.js:305,543,581 真实请求路径）
- question: SillyHub 端点路径用什么形态？是否复用现有 `/api/workspaces/{wid}/changes/{change_key}/progress`？
- answer: 新建独立路径 `/api/changes/{name}/progress`（无 workspace 前缀，按 SillySpec change **name** 字符串寻址），与现有 workspace-scoped change 端点互不干涉（契约 D-004）。
- normalized_requirement: POST `/api/changes/{name}/progress`、GET `/api/changes`、GET `/api/changes/{name}/progress` 三端点独立挂载，不碰现有 `/api/workspaces/{wid}/changes/*`。
- impacts: FR-01, §5.2 P4, §7, 文件清单 router.py + main.py
- evidence: 契约 §1 端点表；sync.js:305 `${url}/api/changes/${changeName}/progress`、:543 `${url}/api/changes`、:581 `${url}/api/changes/${changeName}/progress`；现有 change/router.py:58 prefix=`/workspaces/{workspace_id}` 是不同系统
- priority: P0

## D-002@v1: 鉴权复用 API Key（shk_live_），Bearer=APIKey 优先/JWT 回退
- type: architecture/auth
- status: accepted
- source: docs（契约 §2）+ code（sync.js:296 固化 `Authorization: Bearer`）+ code（auth_deps.py 双路径 + api_key_service.py）
- question: platform.token 用什么鉴权？新建 token 体系还是复用现有？
- answer: 复用现有 API Key（`shk_live_` 前缀，长生命周期，绑定 User）。新写 `require_platform_sync` 依赖从 `Authorization: Bearer` 取 token，识别 `shk_live_` 前缀走 `ApiKeyService.authenticate`，否则回退 JWT（`get_current_user`）。platform sync 端点只验 token 合法，不做 workspace 权限检查。platform.token = 一个 SillyHub API Key。
- normalized_requirement: `require_platform_sync` 接受 `Authorization: Bearer <shk_live_...|jwt>`，非法/过期/吊销 → 401；不做 workspace 权限检查。
- impacts: FR-02, §5.2 P2, §1.2, 文件清单 auth.py
- evidence: 契约 §2「token 来自客户端 local.yaml 的 platform.token」；sync.js:296 `Authorization: Bearer ${platform.token}`；api_key_service.py:34 API_KEY_PREFIX=`shk_live_` + :179 `authenticate(self, *, plaintext: str) -> User|None` 签名匹配 + :206 内置 startswith 前缀兜底。注意：auth_deps.py:140 `get_current_principal` 是 Bearer=JWT / X-API-Key=APIKey（:156/:168），**不接受 Bearer 装 APIKey**，故 `require_platform_sync` 是新逻辑（非复用 get_current_principal），可行性来自 ApiKeyService.authenticate 可独立调用 + 前缀分流。
- priority: P0

## D-003@v1: 存储新建独立表 platform_change_progress
- type: architecture
- status: accepted
- source: docs（契约 §0/§3/§4.2）
- question: latest_progress 存哪？复用现有 Change 表还是新建？
- answer: 新建独立表 `platform_change_progress`（change_name PK + latest_progress JSON + last_pushed_at + last_pusher + updated_at）。契约 §0「sillyhub 是权威聚合点」、§3「按裸 JSON 存即可」、§4.2「每 change 持久化三项 latest_progress/last_pushed_at/last_pusher」。现有 Change 表是 workspace-scoped + uuid PK + change_key，platform sync 按 name 寻址跨 workspace，混入会污染。
- normalized_requirement: 新表 `platform_change_progress` 按 change_name 聚合，存裸六表 JSON 透传（不强类型化）+ last_pushed_at + last_pusher。
- impacts: FR-03, §5.2 P1, §8.1, 文件清单 model.py + 迁移
- evidence: 契约 §0/§3/§4.2；现有 change/model.py Change 表 workspace_id FK + uuid PK 不适配 name 聚合
- priority: P0

## D-004@v1: base_ts 冲突检测用 ISO 8601 UTC 字符串字典序比对
- type: compatibility
- status: accepted
- source: docs（契约 §4.2/§7）
- question: base_ts 冲突检测的 `stored > baseTs` 比对用什么语义？
- answer: 字符串字典序比较（与客户端 `>` 运算符一致）。ISO 8601 UTC 字典序 == 时间序，**不转 Date 对象**（时区/精度差异会误判）。后端 `last_pushed_at` 用 String 列存储客户端 `X-SillySpec-Pushed-At` 原值。
- normalized_requirement: `upsert_progress` 比对 `stored_last_pushed_at > base_ts` 用 Python 字符串 `>`；不转换时区/Date。
- impacts: FR-04, §5.2 P3, §7.1, §8.1, R-04
- evidence: 契约 §7「字符串字典序比较，不要转 Date 对象」；§4.2 算法 `stored > baseTs`
- priority: P0

## D-005@v1: 元字段走 HTTP header，body 保持裸 JSON
- type: compatibility
- status: accepted
- source: docs（契约 §4.1 D-015）
- question: user/base_ts/pushed_at 三个元字段放 body 还是 header？
- answer: 走 HTTP header（`X-SillySpec-User`/`X-SillySpec-Base-Ts`/`X-SillySpec-Pushed-At`），body 保持裸六表 JSON。契约 D-015：零回归——sillyhub 老版不读 header 也能解析 body，新版读 header 启用冲突检测。
- normalized_requirement: POST 端点从 `request.headers` 读 3 个元字段（缺失/空均 None），body 用 dict 接收裸 JSON 不掺元字段。
- impacts: FR-05, §5.2 P4, §7.1, §9, 文件清单 router.py + schema.py
- evidence: 契约 §4.1 D-015；sync.js:294-302 headers 设置
- priority: P0

## D-006@v1: 不做字段级 auto-merge，冲突 409 让客户端 human-in-loop
- type: boundary
- status: accepted
- source: docs（契约 §9 D-002）
- question: 冲突时后端要不要尝试合并 JSON 字段？
- answer: 不做。冲突就是冲突，返回 409 `{conflict:true, platform_progress, last_pushed_at}`，让客户端 `platform resolve` 三选一（keep-local/take-platform/abort）。契约 §9 D-002 铁律。
- normalized_requirement: 冲突仅返回 409 + 平台当前完整 progress，绝不合并字段。
- impacts: FR-06, §3 NG-2, §7.1
- evidence: 契约 §9「不做字段级 auto-merge」；sync.js:313-329 客户端读 409 platform_progress 写冲突文件
- priority: P0

## D-007@v1: GET 响应选裸形态（列表裸数组 / 单 change 裸六表 + 顶层 last_pushed_at）
- type: architecture
- status: accepted
- source: docs（契约 §5/§6）+ code（sync.js:554,592 客户端兼容裸/包裹两种）
- question: GET 列表 / GET 单 change 用裸形态还是包裹形态？
- answer: 选裸形态——列表裸数组 `[{name,current_stage,last_pushed_at,last_pusher}]`；单 change 裸六表 + 顶层 `last_pushed_at`。客户端兼容两种（裸数组 or `{changes:[...]}`、裸六表 or `{progress:{...}}`），裸形态更简单。
- normalized_requirement: GET `/api/changes` 返回裸数组；GET `/api/changes/{name}/progress` 返回裸六表 + 顶层 `last_pushed_at`。
- impacts: FR-07, §7.2, §7.3
- evidence: 契约 §5「形态 A 裸数组」§6「形态 A 裸六表+顶层 last_pushed_at」；sync.js:554 `Array.isArray(result) ? result : result.changes`、:592 兼容 `result.progress`
- priority: P1

## D-008@v1: change name 全局唯一聚合（不按 project/workspace 隔离）
- type: boundary
- status: accepted
- source: docs（契约 §3）
- question: 多项目/多仓库的同名 change 怎么隔离？
- answer: 按 name 全局唯一聚合（不隔离）。契约 §3 按 name 寻址，未要求按 project/origin 隔离。多项目同名风险记 R-01，本次不解决，留后续 change。
- normalized_requirement: `platform_change_progress` 以 change_name 为唯一 PK，不同来源同名 change 互相覆盖（已知限制，NG-5/R-01）。
- impacts: FR-08, §3 NG-5, §8.1, R-01
- evidence: 契约 §3「按裸 JSON 存，name 作 key」；X-SillySpec-User 区分推送者说明设计预期多用户共享聚合点
- priority: P2
