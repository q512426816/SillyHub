---
author: qinyi
created_at: 2026-08-23 16:35:00
---

# 运行时实证（Runtime Evidence）— 2026-08-23-agent-activity-sessions task-08

> 部署链：worktree（分支 sillyspec/2026-08-23-agent-activity-sessions，commit 604c81a1）→ main（20f57f6c，26 文件 +3285）→ 迁移打 compose PG（20260823100000→20260823120000）→ backend/frontend 镜像重建 up -d（两容器 healthy）。跨仓 sillyspec 仓独立 commit 4e4fc6b0。
> 敏感值（token）仅临时文件使用后即删，未入任何提交产物。

## 1. 三仓全量回归

| 仓 | 命令 | 结果 |
|---|---|---|
| backend（worktree，全量） | `uv run pytest -q --no-cov -n auto` | **5108 passed** / 6 skipped / 3 xfailed / 1 xpassed / 1 failed——唯一 failed 为 `test_dispatch_worker…`（主仓既有红，前一变更已登记，与本变更无关） |
| frontend（worktree，全量） | `pnpm vitest run` | **exit 0 全绿**（daemon 目录 359 + sessions 目录 96 含改写后 14 用例；组件级明细见 task-07） |
| sillyhub-daemon（worktree） | `pnpm test` / `pnpm typecheck` | **150 文件 2592 passed | 9 skipped** / typecheck 0 错 |
| sillyspec（跨仓） | `node --test test/agent-session-log.test.mjs` | **79/79**（基线 67 零回归 + 新 12，task-01 内完成） |
| 合并后 main 复验 | platform_sync + activation + tsc | 140 passed / 0 错 |

插曲：首次前端镜像构建失败（next build：session-log-assembler 的 "file" 类型错）——根因是 worktree 基线稍旧，我在其中重生成的 api-types 覆盖了 main 上并行变更（agent-file-upload-mcp）新增的 file 枚举；随后并行变更随 merge fab7149a 合流、main 全量基线重生成后 build 绿（生成物与 HEAD 无差异，无需修正提交）。教训已记：跨并行变更时 gen:types 必须在合并后基线重跑。

## 2. 端到端六项实证（部署环境 8001，真实 CLI = sillyspec 本地仓新代码）

| # | 项 | 结果 |
|---|---|---|
| ① | 带 `--change` 直跑 | ✅ `node src/index.js status --change 2026-08-23-agent-activity-sessions` → 平台出现 tool_report 会话「**zcode · 2026-08-23-agent-activity-sessions**」（status=pending、provider=claude（D-007 映射）、turn_count=0、aggregation_key=`zcode\|2026-08-23-agent-activity-sessions`） |
| ② | 无 ctx 直跑（存量回落） | ✅ 无 ctx 存量 entry 归「**zcode · 本地活动**」单桶会话（NFR-02 防刷屏） |
| ③ | hub_session_id 关联 | ✅ API 模拟：POST 带 `hub_session_id=<既有 chat 会话>` → entry 的 agent_session_id 精确挂接该会话、该会话 status 不变；daemon 侧 env 注入（三路径）由 task-02 的 7 断言单测覆盖（真实 daemon 会话全链路留日常使用验证，如实登记） |
| ④ | 变更不串台（entry 级 ctx） | ✅ 同一次上报中：本 run 触及的 3 条 entry 挂变更会话（08:15），未触及的无 ctx 存量挂单桶（07:18-07:46）——D-009 分流语义在真实数据上成立 |
| ⑤ | 旧 workspace 级条目移除 | ✅ agent-log-card.tsx 中 workspaceId 零残留；session-panel 挂载为 `<AgentLogCard sessionId={session.id}/>`（关联条目）；prop 删除由 tsc 类型层保证 |
| ⑥ | 内容查看 | ✅ 真实 `~/.zcode` 日志路径 → **200 + 真实内容尾部**（本机 daemon allowed_roots 覆盖家目录，R-01 在本机不构成限制）；不存在的 entry → **404**；二进制黑名单 409/离线 504/forbidden 409 由 task-05 的 17 用例锁定 |

## 3. 遗留

- 真实 daemon 平台会话内跑 sillyspec 的 hub 关联全链路（env 注入→CLI 上报→关联）未在本轮起真会话验证（需真实派发），由 t02 单测 + ③ API 模拟组合覆盖——建议首个真实使用时顺手确认。
- 主仓既有红 `test_dispatch_worker…` 不变（前变更已登记）。
- `pnpm build` 曾因跨并行变更的生成物基线问题失败——已在合并基线重生成解决；流程教训记入本文件 §1。
