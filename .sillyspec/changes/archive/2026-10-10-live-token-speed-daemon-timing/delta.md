---
generated_at: 2026-10-10T13:42:51.446Z
sources_reconcile: 命中（ran_at=2026-10-10T12:48:15.535Z，verify-runs 按 change 过滤取最新）
sources_verify_facts: 命中
sources_module_map: 命中
sources_decisions: 缺失
---

# 变更 Delta — 2026-10-10-live-token-speed-daemon-timing

## Before（变更前状态）

### 受影响模块（module-map 注册摘要）

（受影响模块集为空——交付/差集文件均未命中任何模块 paths）

未匹配文件（不归属任何模块 paths，人工裁量）：backend/app/modules/daemon/run_sync/service/publish.py、backend/app/modules/daemon/run_sync/service/submit_commit.py、backend/app/modules/daemon/run_sync/service/submit_steps.py、backend/app/modules/daemon/tests/test_run_sync_ctx_tokens.py、frontend/src/components/daemon/__tests__/turn-speed.test.ts、frontend/src/components/daemon/__tests__/turn-timeline-token-speed.test.tsx、frontend/src/components/daemon/session-panel/session-panel-dialog.tsx、frontend/src/components/daemon/session-panel/session-panel-page.tsx、frontend/src/components/daemon/turn-speed.ts、frontend/src/lib/daemon/session-sse.ts、sillyhub-daemon/src/agent-event-schema.ts、sillyhub-daemon/src/interactive/claude-events.ts、sillyhub-daemon/src/interactive/codex-app-server-driver.ts、sillyhub-daemon/src/interactive/pi-rpc-driver.ts、sillyhub-daemon/src/types.ts、sillyhub-daemon/tests/interactive/claude-events.test.ts、sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts、sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts

### 声明域并集（decisions.md 模块域）

（无 decisions.md：C:\Users\qinyi\IdeaProjects\multi-agent-platform\.sillyspec\changes\2026-10-10-live-token-speed-daemon-timing\decisions.md 不存在——声明域缺位）

## Delta（做了什么）

### 交付文件 × 模块归属

| 交付文件 | 模块归属 |
|---|---|
| backend/app/modules/daemon/run_sync/service/publish.py | —（未匹配） |
| backend/app/modules/daemon/run_sync/service/submit_commit.py | —（未匹配） |
| backend/app/modules/daemon/run_sync/service/submit_steps.py | —（未匹配） |
| backend/app/modules/daemon/tests/test_run_sync_ctx_tokens.py | —（未匹配） |
| frontend/src/components/daemon/__tests__/turn-speed.test.ts | —（未匹配） |
| frontend/src/components/daemon/__tests__/turn-timeline-token-speed.test.tsx | —（未匹配） |
| frontend/src/components/daemon/session-panel/session-panel-dialog.tsx | —（未匹配） |
| frontend/src/components/daemon/session-panel/session-panel-page.tsx | —（未匹配） |
| frontend/src/components/daemon/turn-speed.ts | —（未匹配） |
| frontend/src/lib/daemon/session-sse.ts | —（未匹配） |
| sillyhub-daemon/src/agent-event-schema.ts | —（未匹配） |
| sillyhub-daemon/src/interactive/claude-events.ts | —（未匹配） |
| sillyhub-daemon/src/interactive/codex-app-server-driver.ts | —（未匹配） |
| sillyhub-daemon/src/interactive/pi-rpc-driver.ts | —（未匹配） |
| sillyhub-daemon/src/types.ts | —（未匹配） |
| sillyhub-daemon/tests/interactive/claude-events.test.ts | —（未匹配） |
| sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts | —（未匹配） |
| sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts | —（未匹配） |

- 对账基线：status=ok / form=worktree / sources=worktree:diff-base..HEAD、worktree:status-porcelain(uncommitted)
- missing（声明未落盘）：无
- undeclared（落盘未声明）：无

### 决策清单（id × 模块域）

（无 decisions.md：C:\Users\qinyi\IdeaProjects\multi-agent-platform\.sillyspec\changes\2026-10-10-live-token-speed-daemon-timing\decisions.md 不存在——决策清单缺位）

### 探针 metrics 摘要（验证结论表的机器半边）

快照时刻：2026-10-10T12:44:45.910Z
- probe1：matches=0 / skippedFiles=1 / worktreeHits=0 / globEntries=0
- probe3：tasks=6 / hasTest=6
- probe5：backendEndpoints=1697 / frontendCalls=0
- probe6：deletions=0 / unavailable=false
- probe8：mispairs=0 / feOnly=0 / missingNotNull=0 / contractCount=0 / contractOrphans=0 / missingRequired=0 / feKeys=0 / backendFields=0
- probe9：javaFileCount=0 / groupCount=0 / inconsistentGroups=0
- probe10：checkedFiles=7 / unclearedFiles=0

## After（建议动作）

### 模块卡同步状态（module-impact.md「更新结果」）

（引自变更目录 module-impact.md，人工维护为准）

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/interactive.md` | interactive 无独立卡文件——同步落 docs/SillyHub/modules/daemon.md 文末增量节（三引擎逐调用计时 + usage 契约 api_duration_ms） | done |
| `modules/types.md` | types 无独立卡文件——AgentEventUsage 可选字段追加随 interactive 增量节记录（docs/SillyHub/modules/daemon.md） | done（并入上卡） |
| `modules/daemon.md`（backend） | run_sync 摄取链补维段（api_duration_ms→duration_api_ms 仅增不减 + SSE 增键） | done |
| `modules/components-daemon.md`（frontend） | tokens 事件新键 + turn-speed 门控语义段 | done |
| `_module-map.yaml` | 无需 rebuild：16 个未匹配文件逐个判定均属既有模块卡范围（daemon interactive / backend run_sync / frontend daemon 域），未命中系前缀粒度非索引缺失 | done（判定完成，索引零改动） |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。

### scan 刷新建议

- （受影响模块集为空——无重点刷新面）
- 未匹配文件补录提示：以下文件未命中任何模块 paths——建议补录 _module-map.yaml（新文件）或核对归属（人工裁量）：backend/app/modules/daemon/run_sync/service/publish.py、backend/app/modules/daemon/run_sync/service/submit_commit.py、backend/app/modules/daemon/run_sync/service/submit_steps.py、backend/app/modules/daemon/tests/test_run_sync_ctx_tokens.py、frontend/src/components/daemon/__tests__/turn-speed.test.ts、frontend/src/components/daemon/__tests__/turn-timeline-token-speed.test.tsx、frontend/src/components/daemon/session-panel/session-panel-dialog.tsx、frontend/src/components/daemon/session-panel/session-panel-page.tsx、frontend/src/components/daemon/turn-speed.ts、frontend/src/lib/daemon/session-sse.ts、sillyhub-daemon/src/agent-event-schema.ts、sillyhub-daemon/src/interactive/claude-events.ts、sillyhub-daemon/src/interactive/codex-app-server-driver.ts、sillyhub-daemon/src/interactive/pi-rpc-driver.ts、sillyhub-daemon/src/types.ts、sillyhub-daemon/tests/interactive/claude-events.test.ts、sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts、sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts

### 端点基线提示

- 无基线（变更未拍 baseline）：C:\Users\qinyi\IdeaProjects\multi-agent-platform\.sillyspec\.runtime\endpoint-baselines\2026-10-10-live-token-speed-daemon-timing.json 不存在或不可解析——端点增删不可比（backendEndpoints=1697（>0））
