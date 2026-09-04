---
author: qinyi
created_at: 2026-09-04 03:45:00
---
# 验证报告

## 结论
PASS

## 任务完成度
14/14 任务完成（tasks.md 全勾），逐任务 review.json 双 pass（execute-runs/exec-2026-09-04-000217/tasks/task-01..14）。execute 阶段 15/15 步完成，Task Review Gate + Stage Review Gate（acceptance，独立 QA）双通过。apply 回主仓已提交（13205757f 代码 87 文件 + 8265c182a 规范文档）。

## 设计一致性
独立 QA 验收审查（execute-review-2026-09-04-033023，16 项 checklist）确认：design §5.1/§5.2 全部关键设计点在代码可指认（行号级证据见该 review 的 reviewerNotes）；D-001~D-006 六决策全部落地；跨 task 交界（契约↔消费↔包装链路、codex 别名不包装判据、usage 短名链）零歧义。执行期新增决策 D-005（契约补遗）/D-006（改进差异豁免）已回填 design §11。

## 探针结果
- 主仓 apply 后基线漂移复核：apply 警告的 5 个基线后主仓有新提交的文件（daemon.ts/hub-client.ts/run_sync service.py/session service.py/session-panel.tsx）——apply 内容含基线 overlay 的并行在途改动+本变更改动，测试全绿证明无覆盖冲突；无生成产物（api-types 等）涉及，无需重跑 gen:types（本变更零 OpenAPI schema 变化，LeaseMessagesRequest 本就 list[dict]）。
- 零 DB 迁移主张复核：本变更全部提交不含 alembic migration 文件（git log --stat 核对），agent_run_logs 复用既有列。

## 测试结果（主仓 apply 后实跑，2026-09-04 03:40-03:45）
- sillyhub-daemon：vitest tests/interactive/ + agent-event-schema + daemon-agent-event-report + types → **55 文件 737 用例全过**；tsc --noEmit 零错
- backend：pytest test_run_sync_agent_events + test_run_sync_golden_parity + test_session_provider_caps + test_provider_caps_alignment → **46 passed**（6 告警为 skills_view_service HTTP_413 既有弃用提示，与本变更无关）
- frontend：vitest agent-log/__tests__/ + session-panel-provider-caps + use-agent-run-stream → **6 文件 181 用例全过**；tsc --noEmit 零错
- 既有缺陷披露（非本变更回归，task-11 实证 HEAD 即败）：test_session_switch_config.py::TestSwitchFailureConvergence::test_send_failure_run_failed_session_active（UnboundLocalError _row，_inject_into_session）——待另行修复

## 变更风险等级
integration-critical（daemon/session/lifecycle 关键词命中）

## Runtime Evidence（integration-critical，实跑证据）

### 〔unit_tests〕单元测试
三端套件主仓集成态实跑（见"测试结果"节）：daemon 737 / backend 46 / frontend 181 全过 + tsc×2 零错。

### 〔contract_tests〕契约测试
golden parity 双载荷对账（test_run_sync_golden_parity.py 5 用例）+ 双路径渲染等价（normalize-dual-path 12 用例）+ caps 三端源文件读取守护（4 用例）+ agent-event-schema 类型↔zod 一致性（21 用例）——全部通过。

### 〔real_daemon_backend_integration〕daemon↔backend 真实集成（联调级契约对账）
38 帧真实会话 fixture（内容采自本机 ~/.claude/projects 真实 jsonl 脱敏）驱动跨进程契约端到端对账：ClaudeEventNormalizer 事件流快照 → daemon kind:agent_event 载荷 → backend _persist_agent_event 落库，与旧轨（flat payload → _extract_sdk_messages）产物逐字段对照等价（channel/文本行前缀逐字/结构化列/usage 聚合/session pin/override 撤回终态）。该验证真实执行于主仓集成态，覆盖 daemon↔backend 双向契约（上报形态判据 + 落库六职责）。
**如实披露**：两进程 live 冒烟（真实起 daemon 进程 + 真实 Claude/codex CLI 会话打完整链路）未在本 session 执行——需 live 环境与 CLI 凭证；手测清单已随 docs/agent-provider-onboarding.md §8 交付，建议部署后按清单执行首轮联调冒烟（含升级顺序 backend 先于 daemon 与 legacy 开关演练）。

### 〔real_startup_once〕真实启动验证（本变更改动的那类入口：daemon CLI 主入口）
新构建产物（pnpm build → dist/cli.js，含本变更的 cli.ts/daemon.ts/session-manager/providers/claude-events 改动）真实启动两次：
- `node dist/cli.js status` → **exit 0**，正常输出 State/PID/Runtime ID/Server URL/Config dir——新入口及整条 import 链（cli.ts→daemon.ts→interactive/*→agent-event-schema）在生产形态下可启动、可执行。
- `node dist/cli.js start --server http://127.0.0.1:8001` → 真实执行 start 路径，PID 守卫正确拒绝重复启动（本机有运行中旧版 daemon 实例 PID 69112，未打扰）。生产实例轮换到新构建属部署动作（按文档 §2 顺序 backend 先于 daemon），不在本次 verify 范围。

### 〔runtime_log_evidence〕日志片段（真实输出摘录）
```
$ node dist/cli.js status
State:       running
PID:         69112
Runtime ID:  68c63051-fe2a-49ec-9678-85259f15700e
Server URL:  http://127.0.0.1:8001
Config dir:  C:\Users\qinyi\.sillyhub\daemon
EXIT=0

$ node dist/cli.js start --server http://127.0.0.1:8001
Error: daemon already running (pid 69112). Run 'sillyhub-daemon stop' first, then start again.
EXIT=0
```
（新 CLI 入口两路径真实运行输出；运行中的 69112 为旧构建实例，其日志不作为本变更运行时证据。）

### 其它实跑证据
- 主仓 apply 后基线漂移复核：apply 警告的 5 文件经测试全绿证明无覆盖冲突；本变更零 OpenAPI schema 变化（LeaseMessagesRequest 本就 list[dict]），无需重跑 gen:types。
- 零 DB 迁移复核：全部提交不含 alembic migration 文件。

---

# 部署后真实会话冒烟（2026-09-04 08:40-09:05，本地栈 + 升级后 daemon）

> 补齐本报告此前披露的"未执行项：真实会话冒烟"。环境：本地 Docker 栈（backend/frontend e03e30823 镜像）+ 本机 sillyhub-daemon 升级至 e03e3082 构建（一键安装位 ~/.sillyhub/daemon/bin/，新 API key，runtime 68c63051，7 provider online：claude 2.1.216/codex 0.147.0/cursor/kimi/openclaw/opencode/pi）。

## 结论：冒烟通过（含 2 个新发现的真实 bug，均与本变更实现无关，已登记待修）

## 冒烟清单执行结果（onboarding §8 + 用户指定项）

| 项 | 结果 | 证据 |
|---|---|---|
| daemon 启动+探测 | ✅ | 新 bundle 含 ClaudeEventNormalizer×10；7 provider 探测 available 并注册 online（心跳新鲜） |
| 真实会话双轨落库 | ✅ | run c43ff985（3 turns completed，356/291 tokens）：stdout 20 行中 12 行带 metadata.agent_event、tool_call 2/2 带；文本行 [ASSISTANT]/[TOOL_USE] 前缀逐字与旧协议一致 |
| 工具执行（工具卡） | ✅ | Bash echo smoke-test-e03e3082 与 date 真实执行（tool_result=smoke-test-e03e3082 / 2026-09-04 08:48:04），tool_use/tool_result 事件带 tool_name=Bash 与 call_id 配对 |
| partial 流式+override 撤回 | ✅ | thinking/text partial 落库 + 完整行后的 [THINKING_OVERRIDE]/[ASSISTANT_OVERRIDE] 标记行（backend 自撤链）；SSE 流 358 行含 71 处 agent_event |
| 子代理 | ✅ | run b90d3a94：Task 子代理（subagent_type=general-purpose, depth=1, parent_tool_use_id 三列全落），子代理 Read 工具失败重试链完整归属 |
| 审批卡（permission_dialog） | ✅ | run 10ac2c4f：AskUserQuestion → SSE permission_request 事件（完整 questions/options 结构）→ respond allow（HTTP 200 accepted）→ turn completed |
| 实时 usage | ✅ | SSE 流 110 处 usage summary 事件（轮中实时 token） |
| legacy 开关演练 | ✅ | SILLYHUB_LEGACY_TEXT_EVENTS=1 态：turn completed，stdout 191 行 0 行带 agent_event（旧格式）；恢复正常态后新 turn 5/7 行恢复双轨 |

## 新发现的真实 bug（非本变更回归，均已实证定位）

1. **quick-chat 端点结构性失效（P1）**：POST /api/daemon-chat 不传 workspace_id → `dispatch_to_daemon` Branch 0（placement.py:1200 `workspace_id is None → raise NoOnlineDaemonError`）直接失败，run 恒 failed（"No online daemon runtime found"）。三次复现。该端点在 workspace 绑定模型重构后未跟上，需传默认 workspace 或改走会话端点。**临时绕过：用 POST /api/daemon/sessions（带 workspace_id+runtime_id）。**
2. **backend spec-sync apply_ops 唯一键冲突（P1）**：`spec_workspace/service.py:2062` 对已存在 manifest 路径裸 INSERT（缺 upsert/幂等），触发源=变更归档移动后 daemon 推 add ops 撞已有行（本次实证：changes/archive/2026-09-02-changes-overview-card/design.md）。后果链：POST /api/changes/-/spec-sync 500 → daemon interactive spec pull 超时（60s）→ 会话启动延迟 → 首轮 inject 丢弃 → run failed（interactive_interrupted）。会话启动完成后后续 turn 正常。**与 sillyspec CLI 侧 spec-sync 冲突（docs/sillyspec/2026-09-03-spec-sync-conflict-no-accept-server-option.md）同族。**

## 遗留运维项
- 本机 daemon 已恢复常态运行（PID 77168，双轨模式，新 API key smoke-2026-09-04）；原 key shk_live_Wss0… 在误操作中被配置覆盖，已用新 key 替代（旧 key 若仍有效可在 API keys 管理页吊销）。
- 建议顺序：修 bug 2（spec-sync 幂等）→ 修 bug 1（quick-chat）→ 阿里云侧 daemon 各机器重装升级。
