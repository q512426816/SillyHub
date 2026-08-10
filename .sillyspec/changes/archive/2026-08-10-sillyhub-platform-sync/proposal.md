---
author: qinyi
created_at: 2026-08-10 23:22:56
---

# 提案书（Proposal）

## 动机
SillySpec 客户端已实现一套进度同步层（`sillyspec/src/sync.js`，已 archive 的 `2026-08-10-platform-progress-sync` change）：把各用户本地 `sillyspec.db` 进度序列化成 JSON 投影，HTTP 上行到 SillyHub 聚合、下行 import 重建。客户端全链路（push/pull/冲突检测/resolve 三选一）已落地并经 71 断言 mock 测试固化。但 **SillyHub 后端尚未实现对应端点**（契约状态 `client-landed-backend-pending`），导致多用户进度同步功能完全不工作——客户端 push/pull 全部收到 404/超时降级，本地虽不崩但聚合失效。本提案实现 SillyHub 后端三个端点，让跨用户进度同步真正闭环。

## 关键问题
1. **三个端点缺失**：契约 §1 要求的 `POST /api/changes/{name}/progress`（增强）、`GET /api/changes`（轻量列表）、`GET /api/changes/{name}/progress`（完整 JSON）SillyHub 后端均无实现（grep 确认无 `X-SillySpec`/`platform.token` 基建）。
2. **base_ts 冲突检测缺失**：契约 §4.2 的乐观锁算法（`stored > baseTs` 字典序 → 409）未实现，否则多用户 last-writer-wins 丢更新。
3. **鉴权无 platform 口径**：现有鉴权是 workspace-scoped 登录用户权限（`require_permission`），SillySpec 客户端只有 `platform.token`（Bearer），无登录态、无 workspace 语义。

## 变更范围
- 新增 `backend/app/modules/platform_sync/`：model（`platform_change_progress` 表 ORM）+ auth（`require_platform_sync` 依赖，复用 API Key）+ service（§4.2 冲突检测 + 列表 + 取详情）+ schema + router（3 端点）+ tests。
- 新增 alembic 迁移建 `platform_change_progress` 表。
- 修改 `backend/app/main.py` 挂载 platform_sync router（`prefix="/api"`）。
- 修改 `.sillyspec/local.yaml` 补 platform_sync 的 test 配置（test_strategy=module 命中需要）。
- gen:types 同步 `backend/openapi.json`。
- 模块文档同步。

## 不在范围内（Non-Goals）
- **不做** platform.token 签发/管理 UI——复用现有 API Key 体系（admin 已有签发/吊销 UI）。
- **不做** 字段级 auto-merge（契约 §9 D-002）——冲突返回 409 让客户端 human-in-loop。
- **不做** 实时推送（WebSocket/SSE）/分布式锁/连客户端 SQLite。
- **不做** 碰派发层（`create_mission`/`dispatch_worker`/`converge_mission`，契约 D-004）。
- **不做** change name 跨项目去重（契约 §3 按 name 全局聚合，NG-5/R-01）。
- **不做** `serializeForSync` 六表结构强类型化（契约 §3 按裸 JSON 透传，NG-6）。
- **不改** 前端 / daemon / 现有 change 模块（契约 D-004 互不干涉）。

## 成功标准（可验证）
- 契约 §13 校验清单 8 项全部通过（POST 读 3 header / base_ts 冲突算法 / 409 响应可 import / GET 列表字段 / GET 单 change 形态 / 字典序比对 / 老 body 零回归 / 不 auto-merge）。
- SillySpec 客户端用真实 SillyHub 端点替换 mock server 后，`test/platform-sync-conflict.test.mjs`（task-12，33 断言）+ `test/sync-conflict-statemachine.test.mjs`（task-15，38 断言）可联调通过（契约 §12）。
- 现有 `/api/workspaces/{wid}/changes/*` 路由 + 本变更新 3 端点 **零回归**（documents/approval 无前缀路径是 client↔backend 预存缺口，NG-7 范围外，不在零回归对象内）。
- ruff format + ruff check + mypy 全过；platform_sync 测试全绿。
