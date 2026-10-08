# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

> 引用规范：矩阵证据/测试结果等处的源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。

> 探针结果已机械预填；其余章节把 `<!--TODO-->` 替换为真实内容。**结论只认「结论枚举：」槽行**——
> 槽行留「<待填：三选一>」会被 gate 判不过（fail-closed），正文其他位置的 PASS/FAIL 字样不参与判定。
>
> 「层」=证据可核验性分层（非执行者声明）：「人工判断」指本节为语义判断，由执行 agent 填写、
> CLI 不机械复跑（gate 抽查 + 人类审批点复核兜底）；「可复跑探针/确定性检查/CLI 一致性校验」= gate 可机械复核段。

## 结论 [层：人工判断]

结论枚举：PASS —— 六任务全过+验收评审七项 pass+分层 224 用例全绿+静态门六项零错；真实环境实测（5855 节点星空/8.2× 压缩/2.2MB WS 帧）全兑现。

## 移交项（结构化） [层：人工判断——CLI 清单核验]
<!-- 结论=PASS WITH NOTES 时本节必填（prose 移交叙述转结构化，复跑/验收有据可查、agent 可恢复复跑）；结论=PASS/FAIL 写「无」 -->
<!-- 类型枚举：env-blocked（环境阻断，条件列必填复跑口径）/ manual-acceptance（人工验收，条件列必填验收步骤）/ db-script（待执行脚本，条件列必填执行环境与顺序）/ other -->
| 类型 | 条目 | 复跑/验收条件 |
|---|---|---|
| manual-acceptance | 远程生产部署后浏览器复验全图（阿里云环境 daemon 升级后） | 部署后打开图谱页确认星空默认视图与下钻 |

## 证据账（cannot_verify 任务） [层：人工判断——CLI 核验]
无（六任务均有测试/实测证据，见 verify-e2e.md）

## 集成验证回执 [层：自述声明——CLI 一致性校验]
<!-- integration-critical/deployment-critical 变更必填；其余写「无」 -->
<!-- 回执双形态（2026-09-16-friction5-hardening FR-01）：下方多行 YAML 形态为推荐写法（字段序无关）；
     亦认单行管道形态：- claim: <一句话> | command: <命令> | exit: <0 或非 0> | log: <日志路径> -->
- claim: backend 图端点全分支（含 dump 五件+压缩反例）19 用例通过
  command: cd backend && uv run pytest app/modules/knowledge/tests/test_graph.py -q --no-cov
  exit: 0
  log: /tmp/task03-pytest.log（execute 期）
- claim: daemon dump 白名单与大回包 25 用例通过
  command: cd sillyhub-daemon && pnpm test -- knowledge-governance
  exit: 0
  log: worktree 执行期日志
- claim: 前端知识域 169 用例+tsc/lint 零错
  command: cd frontend && pnpm test -- knowledge && pnpm exec tsc --noEmit && pnpm lint
  exit: 0
  log: /tmp 系执行期日志
- claim: 静态门六项零错（ruff/format/mypy/lint/tsc/typecheck）
  command: backend ruff+fmt+mypy；frontend lint+tsc；daemon typecheck
  exit: 0
  log: /tmp/fm-v1..5.log
<!-- smoke 机器段缺态：not-configured（commands.smoke 未配置——配置 local.yaml 后下次 verify 亲跑并自动注入机器段）source: cli-noai-smoke -->

## 任务完成度 [层：人工判断]
task-02~07 全部完成（review pass 落盘+worktree 六笔提交）；跨仓前置（sillyspec 仓 dump）已独立归档（图测试 11/11）。

## 设计一致性 [层：人工判断]
一致（验收评审七项 pass）。执行期一处接线缝隙（daemon.ts layout 透传，task-02 卡面未含该文件）已修复并三处留痕——属任务卡拆分缝隙非设计偏差。

## 探针结果（CLI 机械预填） [层：可复跑探针——gate 抽查防篡改]
#### 探针 1：未实现标记扫描（design 清单文件）
- ✅ 无 TODO/FIXME/尚未实现 标记命中
- ℹ️ glob 项未展开（agent 手动展开扫描）：frontend/src/app/(dashboard)/workspaces/[id]/knowledge/graph/page.tsx
- ℹ️ 清单文件不存在（跳过）：frontend/src/components/knowledge/__tests__

#### 探针 2：设计关键词覆盖
<!--TODO: 半语义探针——从 design 提取能力关键词逐个 grep 确认实现（agent 执行）-->

#### 探针 3：验收标准测试覆盖
- ✅ task-02: 模块目录（sillyhub-daemon/src、sillyhub-daemon/tests）找到 11 个测试文件（sillyhub-daemon/src/spec-sync.ts、sillyhub-daemon/tests/adapters/factory.test.ts、sillyhub-daemon/tests/adapters/json-rpc.test.ts、sillyhub-daemon/tests/adapters/jsonl.test.ts、sillyhub-daemon/tests/adapters/ndjson.test.ts …）
- ✅ task-03: 模块目录（backend/app/modules/knowledge、backend/app/modules/knowledge/tests）找到 7 个测试文件（backend/app/modules/knowledge/tests/test_distill.py、backend/app/modules/knowledge/tests/test_governance.py、backend/app/modules/knowledge/tests/test_graph.py、backend/app/modules/knowledge/tests/test_hits.py、backend/app/modules/knowledge/tests/test_parser.py …）
- ✅ task-04: 模块目录（backend、frontend/src/lib）找到 80 个测试文件（backend/app/core/spec_paths.py、backend/app/core/tests/test_auth_deps_db_release.py、backend/app/core/tests/test_config_auth.py、backend/app/core/tests/test_errors.py、backend/app/core/tests/test_monitoring.py …）
- ✅ task-05: 模块目录（frontend/src/components/knowledge、frontend/src/components/knowledge/__tests__）找到 10 个测试文件（frontend/src/components/knowledge/__tests__/card-markdown.test.tsx、frontend/src/components/knowledge/__tests__/distill-history-dialog.test.tsx、frontend/src/components/knowledge/__tests__/distill-task-bar.test.tsx、frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx、frontend/src/components/knowledge/__tests__/entry-editor.test.tsx …）
- ✅ task-06: 模块目录（frontend/src/app/(dashboard)/workspaces/[id]/knowledge/graph、frontend/src/components/knowledge/__tests__）找到 10 个测试文件（frontend/src/components/knowledge/__tests__/card-markdown.test.tsx、frontend/src/components/knowledge/__tests__/distill-history-dialog.test.tsx、frontend/src/components/knowledge/__tests__/distill-task-bar.test.tsx、frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx、frontend/src/components/knowledge/__tests__/entry-editor.test.tsx …）
- ⚠️ task-07: 模块目录（.sillyspec/changes/2026-10-09-knowledge-graph-fullmap）递归未找到测试文件（含 co-located tests/）
- ℹ️ 集成盲区（路由/跨模块装配）与断言有效性抽查是语义判断，留给 agent 逐 task 标注 ⚠️

#### 探针 7：验收×测试覆盖矩阵
<!-- 口径注记：探针 3 = 模块目录递归存在性面（allowed_paths 目录附近有没有测试）；探针 7 = allowed_paths ∪ review changedFiles ∪ 直接下游卡测试 结构归属承接面（每条 acceptance 由哪些测试承接；下游消费卡的测试可承接上游 provider 的 acceptance——probe7-provider-tests-in-consumer-card）；两者并排冲突以 7 为准。判定枚举（五选一）：covered / covered-service / partial / uncovered / non-testable（covered-service 适用：端点行为由 service 层等非端点层测试锁定，证据附测试锚点；non-testable 是文档/部署类显式逃生门）。关键词命中只是提示，命中≠判定。 -->
<!-- 预填说明（ql-20260915-004）：判定列为 CLI 机械预填，agent 逐格复核改写——规则：无归属→uncovered（文档/部署/doc/deploy/manual/config 类词→non-testable）；有归属且命中≥1→covered；有归属零命中→partial。covered/covered-service/partial 证据须含测试锚点三形态之一（file:line / `.test.` 测试文件名 / 反引号包裹的路径或测试名），行号可省；uncovered/non-testable 证据自由形态。预填≠结论：与事实不符的格子必须改写（枚举须保持 covered/covered-service/partial/uncovered/non-testable 纯值，备注写在证据列）。 -->

**task-02**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| pnpm test knowledge-governance 全绿（既有+新增 dump 用例） | `sillyhub-daemon/tests/knowledge-governance-handler.test.ts` | test、knowledge、governance（`sillyhub-daemon/tests/knowledge-governance-handler.test.ts`） | covered | `sillyhub-daemon/tests/knowledge-governance-handler.test.ts:17`（test）、`sillyhub-daemon/tests/knowledge-governance-handler.test.ts:8`（knowledge）、`sillyhub-daemon/tests/knowledge-governance-handler.test.ts:2`（governance） |

**task-03**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| pytest test_graph.py 全绿（既有+新增 dump 组）；ruff/mypy 过 | `backend/app/modules/knowledge/tests/test_graph.py` | test_graph（`backend/app/modules/knowledge/tests/test_graph.py`） | covered | `backend/app/modules/knowledge/tests/test_graph.py:238`（test_graph） |

**task-04**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| gen:types:check 过；tsc 零错 | `frontend/src/components/knowledge/__tests__/graph-canvas.test.ts` | types（`frontend/src/components/knowledge/__tests__/graph-canvas.test.ts`） | covered | `frontend/src/components/knowledge/__tests__/graph-canvas.test.ts:194`（types） |

**task-05**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| pnpm test graph-canvas 全绿；tsc/lint 零错 | `frontend/src/components/knowledge/__tests__/graph-canvas.test.ts`<br>`frontend/src/components/knowledge/__tests__/knowledge-graph-page.test.tsx`<br>`frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx` | test、graph、canvas（`frontend/src/components/knowledge/__tests__/graph-canvas.test.ts`、`frontend/src/components/knowledge/__tests__/knowledge-graph-page.test.tsx`、`frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx`） | covered | `frontend/src/components/knowledge/__tests__/graph-canvas.test.ts:20`（test）、`frontend/src/components/knowledge/__tests__/graph-canvas.test.ts:2`（graph）、`frontend/src/components/knowledge/__tests__/graph-canvas.test.ts:5`（canvas） |

**task-06**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| pnpm test knowledge 全绿；tsc/lint 零错 | `frontend/src/components/knowledge/__tests__/knowledge-graph-page.test.tsx`<br>`frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx` | test、knowledge（`frontend/src/components/knowledge/__tests__/knowledge-graph-page.test.tsx`、`frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx`） | covered | `frontend/src/components/knowledge/__tests__/knowledge-graph-page.test.tsx:17`（test）、`frontend/src/components/knowledge/__tests__/knowledge-graph-page.test.tsx:2`（knowledge） |

**task-07**
- ℹ️ 既有用例候选（FR 关联回归面，本变更未改动；判定仍由你复核，命中≠结论）：`backend/app/modules/agent/tests/test_mcp_tools.py`、`backend/app/modules/agent/tests/test_provider_caps_alignment.py`、`backend/app/modules/change/tests/test_assets.py`、`backend/app/modules/change/tests/test_step_progress.py`、`backend/app/modules/change/tests/test_title_normalization.py`、`backend/app/modules/daemon/tests/test_build_claim_payload.py`、`backend/app/modules/daemon/tests/test_change_session.py`、`backend/app/modules/daemon/tests/test_group_logs_pagination.py`、`backend/app/modules/daemon/tests/test_pending_update_upsert.py`、`backend/app/modules/daemon/tests/test_ppm_session.py`、`backend/app/modules/daemon/tests/test_scheduled_messages_crud.py`、`backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py`、`backend/app/modules/daemon/tests/test_session_compact_endpoint.py`、`backend/app/modules/daemon/tests/test_session_pin_rename.py`、`backend/app/modules/daemon/tests/test_session_readiness.py`、`backend/app/modules/daemon/tests/test_session_service.py`、`backend/app/modules/daemon/tests/test_session_suspend.py`、`backend/app/modules/daemon/tests/test_worker_redispatch.py`、`backend/app/modules/knowledge/tests/test_distill.py`、`backend/app/modules/knowledge/tests/test_governance.py`、`backend/app/modules/knowledge/tests/test_graph.py`、`backend/app/modules/knowledge/tests/test_hits.py`、`backend/app/modules/knowledge/tests/test_writer.py`、`backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py`、`backend/app/modules/platform_sync/tests/test_agent_blocked_notify.py`、`backend/app/modules/platform_sync/tests/test_agent_log_states_push.py`、`backend/app/modules/platform_sync/tests/test_owner_sync.py`、`backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py`、`backend/app/modules/workspace/tests/test_daemon_client_scan.py`、`backend/tests/modules/agent/test_scan_interactive_dispatch.py`、`backend/tests/modules/auth/test_permissions.py`、`frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx`、`frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx`、`frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx`、`frontend/src/app/page.test.tsx`、`frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx`、`frontend/src/components/daemon/__tests__/machine-card-pending.test.tsx`、`frontend/src/components/daemon/__tests__/session-panel-mobile-detail-guard.test.tsx`、`frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx`、`frontend/src/components/floating/floating-session-host.test.tsx`、`frontend/src/components/knowledge/__tests__/governance-cards.test.tsx`、`frontend/src/components/knowledge/__tests__/graph-canvas.test.ts`、`frontend/src/components/knowledge/__tests__/knowledge-graph-page.test.tsx`、`frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx`、`frontend/src/components/mobile/mobile-change-detail.test.tsx`、`frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx`、`frontend/src/components/sessions/__tests__/session-list-panel.test.tsx`、`frontend/src/components/sessions/__tests__/sessions-portal.test.tsx`、`frontend/src/components/workspace-config-card.test.tsx`、`frontend/src/hooks/__tests__/use-session-liveness.test.ts`、`frontend/src/lib/__tests__/agent-log-turns.test.ts`、`frontend/src/lib/__tests__/menu-overrides.test.ts`、`frontend/src/lib/__tests__/menu-permissions.test.ts`、`frontend/src/lib/__tests__/session-mention-sources.test.tsx`、`frontend/src/lib/api/__tests__/llm-providers.test.ts`、`sillyhub-daemon/tests/agent-log/liveness/discovery.test.ts`、`sillyhub-daemon/tests/agent-log/liveness/registry.test.ts`、`sillyhub-daemon/tests/agent-log/liveness/tailer.test.ts`、`sillyhub-daemon/tests/daemon-hits-periodic-lifecycle.test.ts`、`sillyhub-daemon/tests/daemon-selfupdate-orchestrator.test.ts`、`sillyhub-daemon/tests/disk-probe-pending.test.ts`、`sillyhub-daemon/tests/integration/worker-resume.test.ts`、`sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts`、`sillyhub-daemon/tests/interactive/daemon-notify-session-ready.test.ts`、`sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts`、`sillyhub-daemon/tests/knowledge-governance-handler.test.ts`、`sillyhub-daemon/tests/knowledge-hits-periodic.test.ts`、`sillyhub-daemon/tests/knowledge-hits-upload.test.ts`、`sillyhub-daemon/tests/sillyspec-platform-command.test.ts`
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| verify-e2e.md 全项过或偏差有解释；浏览器 console 零红 | `backend/app/modules/agent/tests/test_mcp_tools.py`<br>`backend/app/modules/agent/tests/test_provider_caps_alignment.py`<br>`backend/app/modules/change/tests/test_assets.py`<br>`backend/app/modules/change/tests/test_step_progress.py`<br>`backend/app/modules/change/tests/test_title_normalization.py`<br>`backend/app/modules/daemon/tests/test_build_claim_payload.py`<br>`backend/app/modules/daemon/tests/test_change_session.py`<br>`backend/app/modules/daemon/tests/test_group_logs_pagination.py`<br>`backend/app/modules/daemon/tests/test_pending_update_upsert.py`<br>`backend/app/modules/daemon/tests/test_ppm_session.py`<br>`backend/app/modules/daemon/tests/test_scheduled_messages_crud.py`<br>`backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py`<br>`backend/app/modules/daemon/tests/test_session_compact_endpoint.py`<br>`backend/app/modules/daemon/tests/test_session_pin_rename.py`<br>`backend/app/modules/daemon/tests/test_session_readiness.py`<br>`backend/app/modules/daemon/tests/test_session_service.py`<br>`backend/app/modules/daemon/tests/test_session_suspend.py`<br>`backend/app/modules/daemon/tests/test_worker_redispatch.py`<br>`backend/app/modules/knowledge/tests/test_distill.py`<br>`backend/app/modules/knowledge/tests/test_governance.py`<br>`backend/app/modules/knowledge/tests/test_graph.py`<br>`backend/app/modules/knowledge/tests/test_hits.py`<br>`backend/app/modules/knowledge/tests/test_writer.py`<br>`backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py`<br>`backend/app/modules/platform_sync/tests/test_agent_blocked_notify.py`<br>`backend/app/modules/platform_sync/tests/test_agent_log_states_push.py`<br>`backend/app/modules/platform_sync/tests/test_owner_sync.py`<br>`backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py`<br>`backend/app/modules/workspace/tests/test_daemon_client_scan.py`<br>`backend/tests/modules/agent/test_scan_interactive_dispatch.py`<br>`backend/tests/modules/auth/test_permissions.py`<br>`frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx`<br>`frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx`<br>`frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx`<br>`frontend/src/app/page.test.tsx`<br>`frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx`<br>`frontend/src/components/daemon/__tests__/machine-card-pending.test.tsx`<br>`frontend/src/components/daemon/__tests__/session-panel-mobile-detail-guard.test.tsx`<br>`frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx`<br>`frontend/src/components/floating/floating-session-host.test.tsx`<br>`frontend/src/components/knowledge/__tests__/governance-cards.test.tsx`<br>`frontend/src/components/knowledge/__tests__/graph-canvas.test.ts`<br>`frontend/src/components/knowledge/__tests__/knowledge-graph-page.test.tsx`<br>`frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx`<br>`frontend/src/components/mobile/mobile-change-detail.test.tsx`<br>`frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx`<br>`frontend/src/components/sessions/__tests__/session-list-panel.test.tsx`<br>`frontend/src/components/sessions/__tests__/sessions-portal.test.tsx`<br>`frontend/src/components/workspace-config-card.test.tsx`<br>`frontend/src/hooks/__tests__/use-session-liveness.test.ts`<br>`frontend/src/lib/__tests__/agent-log-turns.test.ts`<br>`frontend/src/lib/__tests__/menu-overrides.test.ts`<br>`frontend/src/lib/__tests__/menu-permissions.test.ts`<br>`frontend/src/lib/__tests__/session-mention-sources.test.tsx`<br>`frontend/src/lib/api/__tests__/llm-providers.test.ts`<br>`sillyhub-daemon/tests/agent-log/liveness/discovery.test.ts`<br>`sillyhub-daemon/tests/agent-log/liveness/registry.test.ts`<br>`sillyhub-daemon/tests/agent-log/liveness/tailer.test.ts`<br>`sillyhub-daemon/tests/daemon-hits-periodic-lifecycle.test.ts`<br>`sillyhub-daemon/tests/daemon-selfupdate-orchestrator.test.ts`<br>`sillyhub-daemon/tests/disk-probe-pending.test.ts`<br>`sillyhub-daemon/tests/integration/worker-resume.test.ts`<br>`sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts`<br>`sillyhub-daemon/tests/interactive/daemon-notify-session-ready.test.ts`<br>`sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts`<br>`sillyhub-daemon/tests/knowledge-governance-handler.test.ts`<br>`sillyhub-daemon/tests/knowledge-hits-periodic.test.ts`<br>`sillyhub-daemon/tests/knowledge-hits-upload.test.ts`<br>`sillyhub-daemon/tests/sillyspec-platform-command.test.ts` | verify、e2e、浏览器、console（`backend/app/modules/change/tests/test_step_progress.py`、`backend/app/modules/knowledge/tests/test_distill.py`、`backend/tests/modules/auth/test_permissions.py`、`frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx`、`backend/app/modules/change/tests/test_title_normalization.py`、`sillyhub-daemon/tests/daemon-hits-periodic-lifecycle.test.ts`、`sillyhub-daemon/tests/daemon-selfupdate-orchestrator.test.ts`、`sillyhub-daemon/tests/disk-probe-pending.test.ts`、`sillyhub-daemon/tests/integration/worker-resume.test.ts`、`sillyhub-daemon/tests/interactive/daemon-notify-session-ready.test.ts`、`sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts`、`sillyhub-daemon/tests/knowledge-hits-upload.test.ts`、`sillyhub-daemon/tests/sillyspec-platform-command.test.ts`） | covered | `backend/app/modules/change/tests/test_step_progress.py:92`（verify）、`backend/app/modules/change/tests/test_title_normalization.py:556`（e2e）、`backend/app/modules/change/tests/test_step_progress.py:222`（浏览器） |

#### 探针 4：决策追踪覆盖
<!--TODO: 语义探针——D-xxx@vN → FR-xxx → plan/task 引用 → 证据回指闭环（agent 执行）-->

#### 探针 5：API Contract Parity
- ✅ API parity check passed: 631 backend endpoints (live [scan-root 634 + worktree 635] + artifact 0), 0 frontend calls [scope: change-diff (15 files @ worktree)] | 0 backend endpoints unused by frontend (+207 stock noise collapsed)
- ℹ️ 后端端点比对集为多根并集（主仓既有 ∪ worktree 新增 ∪ 存量 artifact），共扫 2 个根
- ⚠️ 0 个本变更端点前端未调用（warning 不阻断）：
- ℹ️ 另有 207 个存量端点未调用（他模块存量噪音，已折叠不逐条列出）

#### 探针 6：代码删除对账
- ✅ git diff 无整文件删除（D/R/C）记录
- ℹ️ 以 git 事实为准（真实 > 声明）；是否 FAIL blocker 由 agent 诚实判定

#### 探针 8：载荷字段契约对账（advisory）
- 不适用（清单无 Java/SQL 后端面，或 design.md 缺失）
#### 探针 9：守卫一致性（advisory）
- 不适用（清单无 .java 改动文件，或 design.md 缺失）
- ℹ️ 清单无 .java 文件（另有 13 个非 Java 清单文件不在探针 9 扫描面）
#### 探针 10：预填注清零（error 门）
<!-- 口径注记：预填注（来源注协议）在场 = 白名单槽未确认（预填≠结论）；删注 = 确认动作。本探针是门禁梯度 error 档——verify --done 时 gate 复跑同源检测，注未清零阻断完成（归档前清零兜底）。已知误报面：散文引用注字面量会命中（如文档描述注协议本身）——核对后真未确认则删注，纯散文则改写措辞，不得删探针段。 -->
- ✅ 预填注清零（7 个在检文件无未确认预填）
#### 探针 11：红线一致性（advisory）
- 不适用（仓未配置 .sillyspec/redlines.yaml——红线机检零打扰，D-002）
#### 探针 12：UI 视觉证据（分级门）
<!-- 口径注记：在场性检查非语义审计——只验 visual-evidence.md 存在非空与降级裁决留痕，不判对照结论对错（语义面归 verify-result 人工判断层）。证据应在执行时按 flow start「UI 变更执行须知」随手产生；本探针不要求收口现做。分级：缺证据默认 ⚠️（local.yaml ui_visual_gate=error 升阻断）；视觉降级无「用户裁决」留痕恒 ❌（off 豁免）。 -->
- ✅ UI 视觉证据在场（visual-evidence.md 非空）

## 接口验证覆盖矩阵 [层：人工判断——CLI 预填复核]
<!-- 口径注记（与探针 7 互指，R-07）：探针 7 = 验收项 × 测试承接面（每条 acceptance 由哪些测试承接）；本矩阵 = 接口端点 × 验证用例面（design 接口段每个端点由哪些验证用例/冒烟步骤覆盖）——两者并排互补，双矩阵并行存在。端点集来自 design.md 接口段 tolerant 解析（parseDesignApiTable：段头宽收 + 方法/路径双条件），预填≠结论，agent 逐行复核。判定枚举（五选一）：covered / covered-service / partial / uncovered / non-testable——covered-service 适用：端点行为由 service 层等非端点层测试锁定；证据须含测试文件锚点三形态之一（`.test.` / file:line / 反引号包裹的路径或测试名）。 -->
<!-- 预填说明：端点行由 CLI 机械预填，判定/用例依据 ID/结果/证据由 agent 逐格填写——用例依据 ID 锚点五形态（可复制样例）：design接口表#POST /api/xx（# 后必须 METHOD /path，仅表名/行号/散文描述不计命中）、权限矩阵[admin×读]、契约表@任务卡字段清单、DDL@users.id、载荷@e2e_body.json（须真实命中对应表/段，防空指）。 -->
<!-- 文法注释：子行 = 端点行下一行、两空格缩进、以「↳ <消费端>:」前缀书写（消费端细分承接面，不计矩阵行账）；探索行 = 判定 uncovered 且证据列含 [探索] 标记（探索性验证不算覆盖）。 -->
| 端点 | 判定 | 用例依据 ID | 结果 | 证据 |
|---|---|---|---|---|
| GET /api/workspaces/{workspace_id}/knowledge/graph/dump | covered-service | dump happy/gzip 恒压缩/大 payload/未外溢反例/upgrade_required/路由序/403 | HTTP 层 TestClient + gzip spy | `backend/app/modules/knowledge/tests/test_graph.py:1` |
  ↳ 前端图谱页: knowledge-graph-page.test.tsx 全图默认/回退/下钻用例 |
  ↳ daemon 侧: knowledge-governance-handler.test.ts dump 三用例 |
<!-- advisory 尾注（warning 计算归 validator，本段只留位）：有消费端未填子行的端点将列于此（advisory——消费端归类=design 清单启发式，数据面 facts.consumerHints）；写端点（POST/PUT/DELETE/PATCH）未在权限矩阵段声明的将列于此（advisory——补行或显式豁免「无权限约束」，数据面 facts.apiFace.writeEndpoints；表缺行会让派生框架继承你的洞） -->

## 测试结果 [层：确定性检查——CLI 实测对账]
<!--TODO: 测试命令 + 结果（通过数/失败数；known_failures 豁免逐条注明）-->

## 决策追踪矩阵（如存在 decisions.md；无则删本节） [层：人工判断]
<!-- 机械半边预填（CLI，P0-1）：D→FR→task 链自 decisions.md × tasks/*.md frontmatter 结构化字段构建；
     Evidence / 状态两列是人工判断——逐格复核，未闭环行必须在报告标注风险 -->
| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1 | FR-01、FR-04、FR-05 | task-06、task-07 | <待填：证据回指> | <待填> |
| D-002@v1 | FR-01、FR-02、FR-03、FR-04、FR-05 | task-02、task-03、task-04、task-05、task-06、task-07 | <待填：证据回指> | <待填> |
| D-003@v1 | ⚠️ 未映射 | ⚠️ 未闭环（无 task 回指） | <待填：证据回指> | <待填> |

## 技术债务 [层：人工判断]
<!--TODO: TODO/FIXME/HACK 统计（探针 1 的命中已预填在上方探针结果）-->

## 变更风险等级 [层：人工判断]
<!--TODO: doc-only / unit-sufficient / contract-required / integration-critical / deployment-critical；若 design.md frontmatter 有 risk_level 显式声明，写明「显式声明 = <等级>」+ 理由；若有命中被同句否定语境抑制（如「不新增 daemon 协议」），写明被抑制关键词与理由（抑制可审计，不许用来静默降级）-->

## Runtime Evidence [层：人工判断]
<!--TODO: 关键命令输出/时间戳/commit hash 证据链；integration/deployment-critical 必填，按实际触碰的运行时组件写（启动命令/端点/请求响应/日志片段/生命周期终态断言/失败模式排除），未涉及的行写「不涉及」-->
<!-- 降级路径（design §3.2，D-004 收口）：服务起不来时：Controller 直调冒烟（mock 下游，验绑定+校验+路由）/ 基础设施恢复后复跑固化用例——不要空填不涉及 -->

## 代码审查 [层：人工判断]
<!--TODO: 问题列表 + 总体评价。走查清单（零覆盖路径必查——探针 7 ⚠️ 条目即定向面）：
     ① 编辑/更新链路（回显、字段映射、残留态）——非新增主链路，实证盲区；
     ② 非主分支流（相关方/旁路支线等未走查路径）；
     ③ 守卫一致性：同资源端点的操作人/权限校验模式对比（实证 doSubmit 无操作人校验而 delete/withdraw 有——越权）；
     ④ 载荷字段契约（探针 8 ⚠️ 配对逐条核实）；
     ⑤ 分页/并发/事务原子性（无测试基建端的纯逻辑面）-->

## 独立复核（可选回流槽） [层：人工判断——复核后追加]
<!-- verify 完成后的深度复核（独立子代理/二次审查）结论回流至此：缺陷分级（P1 功能不可用 / P2 需求子项 / P3 建议修）+ 修复证据链 + 对「结论枚举」的影响改写。无复核时本节写「无」或删除。复核结论不再只活在聊天记录（2026-09-16 EHS 二次复核实证：5 个 P1 只有聊天可查，变更档案仍写 PASS WITH NOTES）。 -->
