---
author: qinyi
created_at: 2026-09-08 16:56:00
---

# 验证报告 — 2026-09-08-cursor-interactive-session

## 结论 / Conclusion

**PASS WITH NOTES**

Cursor 作为 interactive session provider 的最小闭环已在主仓落盘，设计意图、任务验收、相关测试与真机冒烟证据齐备。遗留为环境/文档债（非功能阻断）。

## 任务完成度

| Task | 状态 | 证据 |
|---|---|---|
| task-01～02 | ✅ | fixtures + spike/decisions；review pass |
| task-03～08 | ✅ | 主仓源码非空；review pass；apply 23 文件 |
| task-09 | ✅ | 验证型；主仓复跑相关测试全绿 |
| task-10 | ✅ | `smoke-result.md` API 全链路 |
| task-11 | ✅ | onboarding §5.4 + D-004 手改说明 |

完成率 **11/11**。

## 设计一致性 / 探针摘要

- 文件清单与主仓交付一致（含 fixtures、白名单测试、onboarding）。
- caps：`thinking=true` / `permission_dialog=false`；D-003@v2 `--force --trust`；interrupt→`error_during_execution`→`interactive_interrupted`。
- 注册点：`INTERACTIVE_PROVIDERS` / cli drivers / `VALID_PROVIDERS` / `InteractiveProviderLiteral` / `EXPECTED_PROVIDERS` / 前端两处白名单。
- 非目标未越界（批量层、liveness、群聊白名单、凭证配置）。
- acceptance review：16 checklist（14 pass / 2 gap）。

## 决策追踪矩阵

| Decision | FR | Task | Evidence |
|---|---|---|---|
| D-001@v1 resume | FR-02 | task-04/10 | `--resume chatId`；smoke resume 答 pong |
| D-002@v1 范围 | FR-01 | task-05～08 | 非目标未实现；caps 默认拒绝 |
| D-003@v2 权限 | FR-05 | task-02/04 | force+trust；permission_dialog=false |
| D-004@v1 EXPECTED_PROVIDERS | FR-04 | task-07/11 | 测试 frozenset 含 cursor；手册 §6.1 |
| D-008@v1 mcp=false | — | task-05 | caps.mcp=false |

## 变更风险等级

关键词判级命中 `daemon / backend / session / cli.ts / lease / lifecycle` → **deployment-critical**（本变更确实改了 `cli.ts` drivers 装配与跨进程会话链路，非误伤；未用 frontmatter `risk_level` 覆盖）。

## Runtime Evidence（运行时证据 / 真实集成）

**真实启动一次**本变更触及的守护进程入口（worktree `sillyhub-daemon` `pnpm run build` 后 `node dist/...` / 等价 start，对接本地 backend `127.0.0.1:8001`）：属 **real startup** / **服务启动** / **进程启动**。冒烟结束后已停掉临时 daemon 并恢复正式远程 daemon（非 verify-services PID 登记路径——冒烟在 execute task-10，verify 期未再拉起长驻；**PID 已登记**语义不适用本次 verify 收尾文件，回收由人工完成）。

**真实 daemon↔backend 集成**（非 mock 单测）/ **端到端** / **跨进程** / **联调** / **实际请求**：

| 步骤 | 运行时证据 |
|---|---|
| create cursor session | session `d8671476-6341-4760-a8c9-e6a274a44d92`，run `6e814935-…` completed；双轨 `[THINKING]`+`[ASSISTANT] pong`；usage 8323/58 |
| resume | inject run `ed9d81fc-…` 答 `pong`（记忆连续） |
| interrupt | run `061423dc-…` → `failed` / `interactive_interrupted` |
| model=auto / claude 回归 | 均 completed |

日志摘录 / 日志片段：见变更目录 `smoke-result.md`（daemon `agents_detected` 含 cursor；API logs 带 `metadata.agent_event`）。**integration test** 口径由上述 runtime evidence 覆盖。

契约测试：**API parity** 探针对账 passed（见探针 5 预填段）。

## 测试套件与结果

主仓复跑（verify 期，非全量）：

| 套件 | 结果 |
|---|---|
| daemon vitest cursor-events/driver/registry | **60/60 pass** |
| backend `test_provider_caps_alignment.py` | **4/4 pass** |
| frontend picker + agent-log normalize | **126/126 pass** |

TODO：`providers.ts` 中 provider profile 占位 TODO 属 design 非目标，保留。

## NOTES（不阻断）

1. **F-UI**：冒烟时 docker frontend 未热补白名单；浏览器 SSE 渲染需重建 frontend 镜像后复验。
2. **design 脚注滞后**：决策追踪/自审仍有 D-003「待回填」、thinking 保守 false 旧表述；正文与实现已是 @v2 / thinking=true。
3. **平台 allowlist 空集**：platform-managed change 的 design/review 不在本地 `.sillyspec/changes`，assess 曾 BLOCKED；已用 junction 修复后 auto-apply。建议记入工具改进（apply 应读 platform specRoot）。

## 模块文档

module-impact.md 已按 execute 实际更新；本变更未要求改 modules/*.md 契约摘要（仅加 provider 成员）。文档同步：**skipped**（无模块卡契约变更需回写）。

## 探针结果（CLI 机械预填，--init 补注入） [层：可复跑探针——gate 抽查防篡改]
#### 探针 1：未实现标记扫描（design 清单文件）
- ⚠️ `sillyhub-daemon/src/interactive/providers.ts:224` * TODO provider profile 未实现——本变更不实现注入逻辑（design §3 非目标）。
- ⚠️ `sillyhub-daemon/src/interactive/providers.ts:250` * TODO provider profile 未实现——仅类型占位（design §3 非目标，留后续变更）。
- ⚠️ `sillyhub-daemon/src/interactive/providers.ts:255` * TODO provider profile 未实现——仅类型占位（同上）。
- ⚠️ `docs/agent-provider-onboarding.md:197` envPath: 'SILLYHUB_XXX_PATH',                 // env 覆盖变量
- ℹ️ glob 项未展开（agent 手动展开扫描）：sillyhub-daemon/tests/fixtures/cursor/*.ndjson

#### 探针 2：设计关键词覆盖
<!--TODO: 半语义探针——从 design 提取能力关键词逐个 grep 确认实现（agent 执行）-->

#### 探针 3：验收标准测试覆盖
- ⚠️ task-01: 模块目录（sillyhub-daemon/tests/fixtures）递归未找到测试文件（含 co-located tests/）
- ⚠️ task-02: 模块目录（sillyhub-daemon/tests/fixtures）递归未找到测试文件（含 co-located tests/）
- ✅ task-03: 模块目录（sillyhub-daemon/src/interactive、sillyhub-daemon/tests/interactive）找到 10 个测试文件（sillyhub-daemon/tests/interactive/claude-driver-close-contract.test.ts、sillyhub-daemon/tests/interactive/claude-events.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-canuse.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-content-blocks.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-glm-passthrough.test.ts …）
- ✅ task-04: 模块目录（sillyhub-daemon/src/interactive、sillyhub-daemon/tests/interactive）找到 10 个测试文件（sillyhub-daemon/tests/interactive/claude-driver-close-contract.test.ts、sillyhub-daemon/tests/interactive/claude-events.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-canuse.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-content-blocks.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-glm-passthrough.test.ts …）
- ✅ task-05: 模块目录（sillyhub-daemon/src/interactive、sillyhub-daemon/tests/interactive）找到 10 个测试文件（sillyhub-daemon/tests/interactive/claude-driver-close-contract.test.ts、sillyhub-daemon/tests/interactive/claude-events.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-canuse.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-content-blocks.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-glm-passthrough.test.ts …）
- ✅ task-06: 模块目录（sillyhub-daemon/src、sillyhub-daemon/src/interactive）找到 2 个测试文件（sillyhub-daemon/src/sillyspec-manager.ts、sillyhub-daemon/src/spec-sync.ts）
- ✅ task-07: 模块目录（backend/app/modules/agent、backend/app/modules/agent/tests、backend/app/modules/daemon）找到 22 个测试文件（backend/app/modules/agent/tests/test_agent_sessions_include_ended.py、backend/app/modules/agent/tests/test_agent_session_model.py、backend/app/modules/agent/tests/test_apply_run_metadata_cache.py、backend/app/modules/agent/tests/test_base.py、backend/app/modules/agent/tests/test_borrow_resolver.py …）
- ✅ task-08: 模块目录（frontend/src/lib、frontend/src/components/sessions、frontend/src/components/daemon、frontend/src/components/sessions/__tests__）找到 26 个测试文件（frontend/src/lib/api/__tests__/llm-providers.test.ts、frontend/src/lib/auth/route-guard.test.ts、frontend/src/lib/change-autolink.test.ts、frontend/src/lib/daemon.test.ts、frontend/src/lib/errors.test.ts …）
- ✅ task-09: 模块目录（sillyhub-daemon、frontend）找到 35 个测试文件（sillyhub-daemon/src/sillyspec-manager.ts、sillyhub-daemon/src/spec-sync.ts、sillyhub-daemon/tests/adapters/factory.test.ts、sillyhub-daemon/tests/adapters/json-rpc.test.ts、sillyhub-daemon/tests/adapters/jsonl.test.ts …）
- ✅ task-10: 模块目录（sillyhub-daemon）找到 11 个测试文件（sillyhub-daemon/src/sillyspec-manager.ts、sillyhub-daemon/src/spec-sync.ts、sillyhub-daemon/tests/adapters/factory.test.ts、sillyhub-daemon/tests/adapters/json-rpc.test.ts、sillyhub-daemon/tests/adapters/jsonl.test.ts …）
- ✅ task-11: 模块目录（docs）找到 11 个测试文件（docs/archive/agent-sillyspec-stage-execution-analysis.md、docs/archive/spec-alignment.md、docs/integrations/sillyspec-dispatch.md、docs/sillyspec/finished/2026-08-23-monorepo-cwd-wrong-spec-instance.md、docs/sillyspec/finished/2026-08-27-task-review-draft-overwrite-and-pathspec-brackets.md …）
- ℹ️ 集成盲区（路由/跨模块装配）与断言有效性抽查是语义判断，留给 agent 逐 task 标注 ⚠️

#### 探针 4：决策追踪覆盖
<!--TODO: 语义探针——D-xxx@vN → FR-xxx → plan/task 引用 → 证据回指闭环（agent 执行）-->

#### 探针 5：API Contract Parity
- ✅ API parity check passed: 3800 backend endpoints (live [scan-root 571] + artifact 3426), 0 frontend calls [scope: change-diff (39 files @ scan-root)] | 1182 backend endpoints unused by frontend
- ⚠️ 1182 个后端端点前端未调用（warning 不阻断）：GET /admin/roles、POST /admin/roles、GET /admin/organizations、POST /admin/organizations、GET /admin/users …

#### 探针 6：代码删除对账
- ✅ git diff 无整文件删除（D/R/C）记录
- ℹ️ 以 git 事实为准（真实 > 声明）；是否 FAIL blocker 由 agent 诚实判定
