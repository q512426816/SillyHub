---
author: WhaleFall
created_at: 2026-08-10 12:06:19
change: 2026-08-07-inject-wait-session-ready
---

# 模块影响分析（Module Impact）— backend inject 等 daemon session ready

## 变更简述

修复 interactive 会话 `/model` 等 inject 偶发空白轮次（根因：inject 在 daemon `create_session` 完成前到，被 daemon `_routeSessionControl` 静默丢弃）。C 方案：daemon create 完成（fresh + recover 双路径）HTTP 上报 session ready → backend 内存 `SessionReadiness`（per-session `asyncio.Event`）→ `inject_session` 发 SESSION_INJECT 前阻塞等 ready（超时 30s fallback 仍发，兼容旧 daemon）。无 DB migration。

## 三重交叉验证

- **声明范围**（design.md 文件变更清单）：6 代码文件 + 2 测试 = 8 项
- **任务范围**（tasks.md task-01..task-12）：文件路径覆盖上述清单
- **真实变更**（git diff）：⚠️ 本变更实现经 worktree execute 后 apply 回 main，commit hash 改写，原 `0f70ce06/d06a4781/7706c4a7/837bcc72` 已不在 main 历史，`git diff HEAD~1` 取不到本变更范围。改以 **ripgrep 实锤关键符号** 替代：`SessionReadiness`（service.py:219）、`get_session_readiness` 单例（service.py:295）、POST `/sessions/{id}/ready`（router.py:1329）、`mark_ready`（router.py:1345）、`notifySessionReady`（hub-client.ts:708 + daemon.ts:2784/3343）、两测试文件均存在 → 代码本体完整落地，与声明范围一致。

> 结论：声明 = 任务 = 实锤代码，三方一致，无遗漏文件。

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|------|----------|----------|-------------|:------------:|
| daemon | 接口变更 + 调用关系变更 + 逻辑变更 | `backend/app/modules/daemon/router.py` | 新端点 POST `/api/daemon/sessions/{id}/ready`（daemon auth，调 `mark_ready`，返回 200+JSON 对齐 daemon `_request` 的 JSON.parse 契约） | false |
| daemon | 逻辑变更 + 数据结构变更 | `backend/app/modules/daemon/session/service.py` | 新增 `SessionReadiness`（模块级单例：`ready` set + per-session `asyncio.Event`，`mark_ready`/`wait`/`clear`）；`inject_session` 发 SESSION_INJECT 前 `await wait(timeout=30)`，超时 fallback 仍发 + warn；`end_session`/failed → `clear`；`confirm_session_reconnected`（reconnecting→active）→ `mark_ready`（recover 主路径双保险） | false |
| daemon | 调用关系变更 + 逻辑变更 | `sillyhub-daemon/src/daemon.ts` | fresh `_startInteractiveSession` create 完成（@3343）+ recover `restoreAndReconnect`（@2784）双路径调 `hubClient.notifySessionReady`（best-effort，失败 warn 不阻塞主循环）；`ClientLike` 接口加方法声明 | false |
| daemon | 接口变更 | `sillyhub-daemon/src/hub-client.ts` | 新增 `notifySessionReady`（HTTP POST session/ready，best-effort） | false |
| daemon | 接口变更 | `sillyhub-daemon/src/api-types.ts` | gen:types 同步 `/ready` 端点类型 | false |
| daemon | 新增（测试） | `backend/app/modules/daemon/tests/test_session_readiness.py` | 16 例：SessionReadiness mark/wait/clear/超时/并发 + inject 直通 + inject 超时 fallback + POST /ready 200/401 + confirm mark_ready 翻转/幂等/rejected | false |
| daemon | 新增（测试） | `sillyhub-daemon/tests/interactive/daemon-notify-session-ready.test.ts` | 6 例：fresh create 上报 / recover 上报 / best-effort reject 不崩 / 失败不上报 | false |
| frontend_lib | 接口变更（类型同步副产物） | `frontend/src/lib/api-types.ts` | gen:types 同步 `/ready` 端点类型（CLAUDE.md 规则 20 gen 副产物，零逻辑改动） | false |

## 未匹配文件

| 文件 | 原因 | 归属判定 |
|------|------|----------|
| `backend/openapi.json` | 全局 OpenAPI dump 文件，位于 `backend/` 根，不在任何模块 `paths` glob 内（daemon 模块 glob 仅 `backend/app/modules/daemon/**`） | 内容属 daemon 新端点 schema dump，逻辑归属 daemon；仅 dump 产物，非逻辑改动 |

## 影响汇总

- **核心影响模块**：`daemon`（8 文件）—— daemon↔backend session ready 时序握手，属 integration-critical 运行时集成。
- **连带影响模块**：`frontend_lib`（1 文件）—— 纯类型同步副产物，无逻辑改动。
- **影响类型分布**：接口变更（新 POST /ready 端点 + 类型同步）、调用关系变更（inject↔ready 握手 + daemon 上报）、逻辑变更（SessionReadiness 单例 + inject 阻塞等待+超时 fallback + 生命周期 clear + recover 双保险）、数据结构变更（内存 ready set + per-session Event）、新增测试。
- **needs_review**：全部 false（verify PASS 12/12 + ruff/tsc 零错 + 22 单测全绿 + /model 端到端实测正常）。
- **无 DB migration / 无破坏性接口变更**（新端点纯增量，旧 daemon 走超时 fallback 兼容）。

## 验收依据

- verify-result.md verdict: PASS（2026-08-07 23:30），12/12 task。
- 代码本体 ripgrep 实锤完整在 main（见三重交叉验证）。
- /model 端到端实测正常（用户 2026-08-10 确认）。

## 更新结果（sync-module-docs 回填）

| 目标 | 更新内容 | 状态 |
|------|----------|------|
| `_module-map.yaml: daemon` | main_symbols 追加 `SessionReadiness`（导出符号变化） | ✅ 已写入 |
| `modules/daemon.md` | 契约摘要（session 端点 +`/ready` + `SessionReadiness` service 说明）+ 关键逻辑（session ready 握手）+ 变更索引追加 `2026-08-07-inject-wait-session-ready` 条目 | ✅ 已写入 |
| frontend_lib | 纯类型副产物（gen:types），按规则「内部实现变化通常不更新卡片」跳过 | ⏭️ 跳过 |
