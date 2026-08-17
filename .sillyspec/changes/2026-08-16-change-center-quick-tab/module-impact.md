---
author: qinyi
created_at: 2026-08-17 00:55:00
change: 2026-08-16-change-center-quick-tab
---

# 模块影响分析（Module Impact）— 变更中心「快速修复」tab

> plan 阶段首版；execute 各 task 完成时更新状态，verify 阶段复核，archive 终审。

## 受影响模块

| 模块 | 影响等级 | 影响内容 | 涉及 task | 实际 |
|---|---|---|---|---|
| backend/platform_sync | 高 | 新增 `quicklog_entries` 表（model.py）+ alembic migration；`POST /api/quicklog-entries` 推送端点（router/service/schema，shpsync_ 鉴权 workspace 由 token 派生 + 幂等 upsert）；推送 pytest | task-01, task-02 | ✅ 已实现（worktree 41ecab5a：QuicklogEntryORM nullable=False + migration 20260817010000 + upsert_quicklog_entry + 7 用例含双 workspace 隔离/幂等/extra 吞） |
| backend/change | 高 | 新增 `quicklog_parser.py`（条目解析器+mtime 指纹缓存）+ `quicklog_service.py`（双源合并/enrich/模块推导/筛选分页）；`router.py`/`schema.py` 加 GET 列表/详情端点；3 个 pytest 文件 | task-03, task-04, task-05 | ✅ 已实现（worktree 0e393585+49784f3a：解析器 17 用例+真实语料 492 条冒烟零异常；service 12 用例；router 5 用例；stale/enrich/模块推导派生） |
| backend/migrations | 中 | quicklog_entries 表 migration（UNIQUE(workspace_id, ql_id)） | task-01 | ✅ 已实现（20260817010000，down_revision=20260816120000，单头核验过） |
| frontend/changes | 高 | 变更中心第三 tab（page.tsx）+ `quicklog-table.tsx`（列/筛选/轮询/空态）+ `quicklog-drawer.tsx`（四段/文件括注/原始 md）；变更详情页反向区块（[cid]/page.tsx）；vitest 用例 | task-08, task-09, task-10 | ✅ 已实现（worktree 9af90f6e+75433c49+04721c6f：table 11 用例 + drawer 4 用例 + 详情页反向卡 2 新用例 + 列表页 2 新用例；?tab=quicklog 初始 tab） |
| frontend/lib | 中 | `quicklog.ts`（API client）+ `api-types.ts`（gen:types 生成）；`backend/openapi.json` 同步 | task-07 | ✅ 已实现（worktree ddb02052：gen:types 368 paths，QuicklogEntryList/Read/PushRequest schemas 落 api-types.ts） |
| sillyspec 仓（跨仓） | 高 | `src/quicklog.js` 两触发点 best-effort 推送 + helper；`test/quicklog-push-platform.test.mjs` | task-06 | ✅ 已实现（sillyspec 仓 a815d69：allocate/complete 双触发点 + buildPushPayloadFromRaw 落盘终态组装 + 6 用例；npm test 216 文件零回归） |

## 对外契约变更

| 契约 | 变更 | 兼容性 |
|---|---|---|
| `POST /api/quicklog-entries` | 新端点（platform_sync，shpsync_ 令牌鉴权） | 纯新增，旧调用不受影响 |
| `GET /api/workspaces/{id}/quicklog-entries` | 新端点（workspace 成员鉴权） | 纯新增 |
| `GET /api/workspaces/{id}/quicklog-entries/{ql_id}` | 新端点 | 纯新增 |
| `quicklog_entries` 表 | 新表 + UNIQUE(workspace_id, ql_id) | 纯新增表，既有表零影响 |
| QUICKLOG 文件格式 | 不变（CLI 推送是旁路副作用，不修改落盘格式） | 旧 CLI 零回归 |
| sillyspec CLI | 新增 best-effort 推送（local.yaml platform 段驱动） | 无 platform 配置时静默跳过，旧行为零回归 |

## 明确不受影响

- 知识&日志页现有快速日志 tab（NG-03 保留并存，不删不改）
- daemon（本变更不触 daemon 源码；文件同步链路照旧）
- 变更中心进行中/已归档两 tab 的既有列与行为（task-08 约束不改）
- change 模块既有 parser（`parser.py` 只读复用 module-map 匹配逻辑，不修改其函数）
- PPM 域、认证/权限体系（quicklog 端点复用既有 workspace 成员鉴权，无新权限项）

## 文档同步清单（archive 时核对）

- [ ] `.sillyspec/docs/multi-agent-platform/modules/backend.md`（quicklog 端点/解析器/表变更索引）
- [ ] `.sillyspec/docs/multi-agent-platform/modules/frontend.md`（快速修复 tab/抽屉/反向区块变更索引）
- [ ] ROADMAP 活跃变更条目
