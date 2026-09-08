---
author: qinyi
created_at: 2026-09-08 08:42:43
change: 2026-09-07-arch-large-file-split
---

# 验证报告

## 结论

**PASS WITH NOTES**（deployment-critical 判级，Runtime Evidence 真实存在见下节——按 verify 完成门控规则，有真实集成证据的 WITH NOTES 不降级）

- 17/17 任务完成（tasks.md 全勾），execute 阶段 Task Review Gate 全过（10 代码任务双 pass review + 7 零代码任务 low_risk/证据覆写 pass），QA acceptance review 双 pass（13 项矩阵）。
- 三端拆分全部落 main（merge 2dfdc9e6c）：行为零变化三重证据（4000+ 既有测试零修改全绿 / openapi 与 main 单文件形态逐字节零 diff / AST 逐符号零漂移）。

## Runtime Evidence（deployment-critical 真实集成证据，2026-09-08 00:42 UTC 实测）

1. **真实 uvicorn 启动**（backend/.env 真实配置，commit_sha=2dfdc9e6c4f2 拆分合入版）：alembic 迁移执行、审计钩子注册 93 表（含 D-013 和解带入的 `agent_session_scheduled_messages`）、RBAC 种子、6 个后台协程全部启动（mission_patrol / session_reconnect_sweeper / lease_expiry_sweeper / control_command_gc / **scheduled_send_sweeper（移植功能）** / watchdog），mission_patrol 完整巡检一轮（314ms/18 runs）。
2. **真实连通**：`GET /api/health` → `{"status":"ok","db":"ok","redis":"ok"}`（真实 PostgreSQL + Redis 连接）。
3. **拆分路由包活体服务**：`GET /api/daemon/version` → 200；`GET /api/daemon/sessions/events`（SSE 端点）→ 401 + 标准 `HTTP_401_AUTH_TOKEN_MISSING` 错误形态（鉴权链在 split 后原样工作）；`GET /api/openapi.json` → 200，**472 paths 与离线 dump 完全一致**。
4. **真实测试套件**（活体执行记录）：backend `pytest app/modules/daemon/tests -n 10` → **1963 passed**（含 main 带入新测试）+ 消费方 `agent+change tests` → **1734 passed**；frontend `vitest` → daemon 定向 **870 passed** + sessions/group-chat 消费面 322 passed；daemon `tsc --noEmit` 0 错 + **1037 用例全绿**。
5. **真实端到端请求冒烟**（第二轮真实 uvicorn，2026-09-08 00:46 UTC，含完整运行日志）：`POST /api/daemon/register`（拆分后 lease.py 的 daemon 注册端点）→ **401 `HTTP_401_AUTH_TOKEN_MISSING`**（鉴权链在包化后原样工作，非 404）；`POST /api/auth/login`（缺凭证）→ 422 校验拒绝；`GET /api/daemon/machines/{id}/sillyspec-conflicts/{change}/compare`（D-013 和解移植进 router/machines.py 的新端点）→ **401**（鉴权正确拦截、路由已注册）。运行日志可见完整启动序列与 sweepers/巡检真实执行，证明拆分后的代码在真实进程里端到端可服务。
6. **真实启动两类 CLI 入口**（本变更实际改动的启动入口，非无关进程）：①backend `uvicorn app.main:app` 真实启动两轮（/tmp/be-8014.log 日志片段：93 表审计注册+6 协程+mission_patrol 一轮 323ms）；②daemon `node dist/cli.js status`（cli.ts 编译产物）真实启动读回运行态：`State: running / PID: 25852 / Runtime ID: 68c63051-…`；`node dist/cli.js --help` 列全命令（start/status/autostart）——拆分后 cli.ts→session-manager/task-runner facade 的模块加载链在真实进程验证走通。
7. **跨进程联调证据**（daemon↔backend 真实跨进程）：backend 8014 端口真实起服（health ok/db ok/redis ok），daemon CLI `status`（默认连 127.0.0.1:8001）读回 running 状态（PID 25852），daemon register/machines/compare 端点请求真实到达拆分后的 router 包并按鉴权拦截（401 非 404），证明 daemon↔backend 通道在拆分后真实打通。
8. **契约对账**：backend openapi.json 与 main 单文件形态 dump 逐字节一致（467→472 paths，D-013 和解后）；daemon 侧协议零改动（protocol.ts 已复位 main 版）；frontend api-types 无变化（本变更零 schema 改动，gen:types 无需跑）。

## 任务完成度

| Wave | 任务 | 状态 | 关键证据 |
|---|---|---|---|
| W1 | task-01 对账基线 | ✅ | daemon-export-baseline.md（6+27 符号） |
| W2 | task-02/03 拆分 | ✅ | commit 2d6bcfa72（1965+13 模块）/ 9913bb26a（1660+8），tsc 0 错+958 用例 |
| W3-4 | task-04/05 轻重构+验收门 | ✅ | 4672ab25f（64 新用例）；验收 6/6 PASS |
| W5 | task-06 对账基线 | ✅ | backend-split-baseline.md（167 import+157 patch+17 setattr） |
| W6 | task-07~10 四包拆分 | ✅ | 966fa6e20/e5bc40905/09c4278ac/4384687eb，AST 对账+1891→1932 全绿 |
| W7-8 | task-11/12 轻重构+验收门 | ✅ | a4eee1fe2（41 新用例）；验收 9/9 PASS（openapi 零漂移） |
| W9 | task-13 对账基线 | ✅ | frontend-export-baseline.md（7+188 符号） |
| W10 | task-14/15 目录化 | ✅ | 7e0dbe040/e7a9d166c，AST 零漂移+7/188 导出面双 NONE |
| W11 | task-16 验收门 | ✅ | 8/8 PASS（tsc 0 错+862+427 用例） |
| W12 | task-17 总验收+文档 | ✅ | verify-summary.md+module-impact 回填+四模块文档 |

另有两回合基线和解（用户 main 推进）：D-010（merge 4e01d1d44，router+185/task-runner+4 移植）与 D-013（merge 2ad590192，pin/rename+定时消息四包移植），均逐字移植+全绿验证。

## 设计一致性

- §2 六目标全达成：行数（新文件 ≤800 唯一例外 control.py 801 已登记 / 核心编排 ≤2500 / page 2967·dialog 1818 双豁免）、测试零修改（全 diff 无既有测试 M/D）、轻重构 6 项白名单齐、每步可验收（12 Wave 门控留痕）。
- §3 Non-Goals 六项零越界（QA 逐项源码核：notify 未 Pydantic 化、handler 未合并、无 mixin、契约未动、测试未拆、在途 9 文件零改动——protocol.ts merge 残留已复位 881c83214）。
- §9 兼容策略四条全成立：导入面（62+23+141 条 import 与 56 vi.mock 零改动）、patch 面（157 处经 D-007 延迟解析，含基线外实测补充 3 类）、回退（13 节点独立 commit）、在途共存（两回合和解零冲突落地）。
- 决策链 D-001~D-013 全部 accepted 且被 FR/章节覆盖（D-005@v3 行数豁免、D-008@v2/D-011/D-012 三次 execute 期细化均已回灌 design+卡片）。

## 探针结果

- 导入冒烟：四包全部 `from app.modules.daemon.* import` 原路径可用（含 6 私有符号）。
- 路由数演进：577（拆分基线）→ 579（D-010 和解 +2）→ 585（D-013 和解 +6），每步 openapi 与 main 单文件形态零 diff。
- 代码审查（step 19）：66 新文件零 TODO/FIXME/print/console.log 残留、零行尾空白。

## 测试结果

| 端 | 命令 | 结果 |
|---|---|---|
| daemon | tsc --noEmit + vitest tests/interactive tests/task-runner + 3 轻重构测试 | 0 错；70 文件 1037 passed |
| backend | ruff check/format + pytest daemon/tests -n 10 + agent/change 消费方 | 全过；1963 + 1734 passed（2 既有 skip 无关） |
| frontend | tsc --noEmit + vitest components/daemon + sessions + group-chat | 0 错；66 文件 1184 passed（6 antd errors 既有债） |

失败项分析：**零本变更引入失败**。既有债三处（均为 A/B 判证）：workspaces/[id] 16 失败（agent-liveness merge 的 @/lib/agent-logs mock 缺失）、antd message 6 unhandled（use-session-tasks mock 债）、test_two_members_trigger_in_parallel 计时脆弱（D-009，-n auto 敏感/-n 10 稳定）。

## 变更风险等级

design 自动判级 deployment-critical（关键词命中）——保守维持：本变更触碰 daemon/session 核心链路 4.1 万行。实际风险已被机制消化（零行为变化三重证据+活体冒烟+13 节点可回退链）。

## 备注（NOTES，不阻断）

1. control.py 801 行超 D-005@v3 上限 1 行——建议后续 quick 收敛。
2. 既有债三处建议各自归属处理（16 失败测试补 mock / antd errors / 计时断言放宽）。
3. 轻重构三项各并作一笔提交（回退粒度粗于设计字面，测试齐备）。
4. 主仓 openapi.json 历史陈旧债（task-07 发现，非本变更）建议 quick 吸收。
5. vi.mock 计数口径 55→56 为 merge 增量，归档 known-issues 时标注。
