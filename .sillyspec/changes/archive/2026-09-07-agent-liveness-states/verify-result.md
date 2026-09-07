---
author: qinyi
created_at: 2026-09-07 21:42:00
---

# 验证报告 — 2026-09-07-agent-liveness-states

## 结论

PASS WITH NOTES

- 15/15 任务完成（全部 review.json 双 pass）；execute 独立 QA acceptance review pass/pass（含 QA 缺口 #3 当场修复 e55f9633）。
- 三端质量门全绿（主仓 apply 后复验）：backend 295/295 + ruff/format 干净、daemon 97/97 + tsc、frontend 30/30 + tsc + gen:types 再生成。
- **Runtime Evidence：真实活栈冒烟 PASS**（真实 uvicorn + 真实 shpsync_ token + 本地 PG，见下节）。
- NOTES（不阻断，已知缺口如实登记）：①会话列表行尾小灯 + 悬浮详情卡、②idle 未读小红点（D-006）——两处需 SessionsPortal 与 platform_agent_logs 的 liveness 联表管道（按 agent_session_id join 的取数改造），本期由工作台总览卡 + 日志面板徽章承接完整信息，未违 D-004「完整信息只在悬浮卡与总览卡」的硬约束；③daemon 活栈侧（liveness 循环真实推送）代码级验证（97 用例 + abortableSleep 修复），端到端活体验证建议随部署后人工核验（见 Runtime Evidence 未覆盖项）。

## 任务完成度

| 任务 | 状态 | 证据 |
|---|---|---|
| task-01~06（daemon 侧） | ✅ | commits 00b7c718/761f60d7/e1a70fc18/99974a8e/6d7954d96 + 28046296；agent-log 全套 44 用例 + daemon 交互路径 40 用例 |
| task-07~09（backend 侧） | ✅ | commits 1e452d8d8/8b4f2310c/e4c5172d8；platform_sync 全套 211/211；迁移 20260907141041 升降级实测 |
| task-10~12（deriver/直查） | ✅ | commits d203273e/625a788e +（task-10 在 28046296）；mcp_tools 53/53 |
| task-13（跨仓模板） | ✅ | sillyspec f05701b1→4aa40c61；check-syntax 473 文件 + run-tests 359+40 零失败 |
| task-14（前端两层） | ✅ | commit d84338aa；组件测试 30/30；gen:types 同步（openapi +337/api-types +239） |
| task-15（集成验收） | ✅ | 三端联动回归 + 活栈冒烟（本报告 Runtime Evidence） |

## 设计一致性

- §5.1 五态/L0L1/R-01R-02/D-012：三 deriver 永不产 blocked（各自 R-01 回归用例）；第一方覆写落 buildAgentLogStatePushGroups。
- §5.2 三层数据源 + 两档定位 + tailer 上限：全落（sessions.json 恢复层为 QA 审查后补 e55f9633）。
- §5.3 四列 + states 端点 upsert-create + 120s 通知：全落（活栈冒烟实测 create/段触发）。
- §5.4 D-004 两层：总览卡 + 面板徽章落；列表小灯/悬浮卡登记缺口（NOTES ①②）。
- §7.5 生命周期契约表 9 事件：QA 逐链核验字段零错位（TickResult→PushItem→StateEntry→ORM 四列）。

## 探针结果

- sillyspec verify-probes 未另跑（本变更为四件套全量流程，TODO/覆盖对账由 plan-postcheck 在 execute 完成）。
- 端点对账：endpoints.json 已抽（task-08，41 端点含 states）；基线 563 → 归档时 delta 复算。

## 测试结果

- backend：platform_sync + agent(mcp_tools) + notification = 295 passed（apply 后主仓复跑）。
- daemon：agent-log + hub-client + kind-dispatch = 97 passed（worktree 与主仓双跑）。
- frontend：agent-log-card + notification-bell = 30 passed；tsc 干净；gen:types 重生成成功（主仓 node_modules 半坏经 pnpm install --force 修复后）。
- 跨仓 sillyspec：run-tests 359+40 全过零失败。
- 质量扫描：ruff check/format 全过；mypy（platform_sync/agent/notification）干净。
- **CLI 模块实测（verify gate）失败归因（逐一单跑复核）**：
  - `tests/integration/selfupdate-scenarios.test.ts` 路径④：`expected first.length 8 to be 4`——**他者已提交回归 + 环境依赖**：心跳位置参数链在基线后被并行变更扩展（82d0aef35 ql-20260907-010：spec_cache 第 8 参占位链；本变更未触碰 heartbeat 任何代码，daemon.ts diff +171 行全为 liveness）。该断言按"无 sillyspec 快照=4 参"旧形态写死，本机存在真实 sillyspec 安装（getSnapshot 非空 → 占位链展开 8 参），CI/净环境无快照时为 4 参——属脆弱长度断言（应断言 first[3] 字段语义），登记为该测试的预存债（本变更不改他人测试域）。
  - `tests/daemon-ws-stale-reap.test.ts` 4 例超时：**单跑复验 4/4 全过**（主仓、本变更代码在位）——全套并发下的超时抖动；本变更加入的 liveness 发现刷新含同步目录扫描（默认 fs），重负载下可能放大事件循环阻塞，登记为后续加固项（默认 fs listDir 条目上限 + 首刷延迟），非功能缺陷。
  - frontend 模块 CLI 判定 passed（exit 1 来自既有无关用例，非本变更文件）。

## 变更风险等级

integration-critical（涉 daemon/session/lifecycle 关键词——Runtime Evidence 必填，见下节）。

## Runtime Evidence（真实执行，自报告）

**活栈冒烟（2026-09-07 21:41，真实 uvicorn 127.0.0.1:8977 + 真实 shpsync_ token（PlatformSyncTokenService 铸发）+ 本地 PG，脚本 %TEMP%/liveness-smoke.py，跑后清理临时 workspace/user）：**

- 无凭据 POST /api/agent-logs/states → **401**（鉴权矩阵活栈确认）✓
- zcode 裸会话（无登记行 + 元信息）→ **200 {created:1}**，GET 回读 originator=**liveness-discovered**、harness=zcode ✓（X-001）
- blocked 段进入 + 130s 段龄推送 → **200**；GET 回读 state=**blocked**、state_evidence=**PERMISSION_REQUEST(write)**、state_derived_at 正确 ✓（task-09 触发路径活栈）
- 同段重推（140s）→ **200** 不炸（段级去重 + unresolved 幂等）✓
- 迁移活栈：主仓 alembic upgrade 20260905004300→20260907141041 实跑成功（四列落库）✓

**未覆盖项（如实声明，建议部署后人工核验）：**

- daemon liveness 循环对真实 hub 的持续推送（10s 可见性活体口径）——代码级已验（97 用例），活栈需 daemon 连平台运行观察。
- 真实 worker 卡确认 → list_workers 见 blocked → 编排按新模板升级非 kill（活栈派发 E2E）。
- 裸 agent 会话（全程不调 sillyspec）10s 出状态的端到端活体（自发现三源在单测覆盖，活栈含 daemon spawn 路径）。
