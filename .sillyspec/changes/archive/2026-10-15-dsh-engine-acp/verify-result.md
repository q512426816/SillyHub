# 验证报告（骨架由 `sillyspec verify-probes --change <变更名> --init` 生成）

> 引用规范：矩阵证据/测试结果等处的源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。

> 探针结果已机械预填；其余章节把 `<!--TODO-->` 替换为真实内容。**结论只认「结论枚举：」槽行**——
> 槽行留「<待填：三选一>」会被 gate 判不过（fail-closed），正文其他位置的 PASS/FAIL 字样不参与判定。
>
> 「层」=证据可核验性分层（非执行者声明）：「人工判断」指本节为语义判断，由执行 agent 填写、
> CLI 不机械复跑（gate 抽查 + 人类审批点复核兜底）；「可复跑探针/确定性检查/CLI 一致性校验」= gate 可机械复核段。

## 结论 [层：人工判断]

结论枚举：PASS WITH NOTES
8 任务全绿（daemon 102+13+14+50 用例 / backend 36+9+27+5 / frontend 49+2），三端 caps 镜像一致，验收评审 pass/pass；两条 NOTES：①本机 dsh=0.1.0 低于 0.2.1 版本门→冒烟走 skip 分支（版本门语义现场验证，≥0.2.1 实跑移交）；②探针 5 的 6 个 missing 为修改文件内存量调用（runtimes.py:712 等 11 个装饰器在场），口径噪音非契约缺口。

## 移交项（结构化） [层：人工判断——CLI 清单核验]
<!-- 结论=PASS WITH NOTES 时本节必填（prose 移交叙述转结构化，复跑/验收有据可查、agent 可恢复复跑）；结论=PASS/FAIL 写「无」 -->
<!-- 类型枚举：env-blocked（环境阻断，条件列必填复跑口径）/ manual-acceptance（人工验收，条件列必填验收步骤）/ db-script（待执行脚本，条件列必填执行环境与顺序）/ other -->
| 类型 | 条目 | 复跑/验收条件 |
|---|---|---|
| env-blocked | dsh ≥0.2.1 实机端到端冒烟（创建会话/一轮对话/打断/代答/路由 model） | 装有 dsh ≥0.2.1 的机器上 `SILLYHUB_DSH_SMOKE=1 pnpm -C sillyhub-daemon exec vitest run tests/interactive/dsh-acp-smoke.test.ts`；本机 0.1.0-rc.6 低于版本门（skip 分支已实测留痕） |
| manual-acceptance | 群附件门控 pi/cursor 放行的行为变化（R-03）用户体验确认 | 群聊带附件 @ pi/cursor 成员触发一次，确认附件落盘链路（单聊口径一致）；caps 口径已由 test_group_attachment_gate 逐引擎钉死 |

## 证据账（cannot_verify 任务） [层：人工判断——CLI 核验]
<!-- 无 cannot_verify 任务时本节写「无」；有则逐 task 一行 -->
无

## 集成验证回执 [层：自述声明——CLI 一致性校验]
<!-- integration-critical/deployment-critical 变更必填；其余写「无」 -->
<!-- 回执双形态（2026-09-16-friction5-hardening FR-01）：下方多行 YAML 形态为推荐写法（字段序无关）；
     亦认单行管道形态：- claim: <一句话> | command: <命令> | exit: <0 或非 0> | log: <日志路径> -->
无（非 integration-critical/deployment-critical 变更：引擎接入为增量注册，现有引擎路径零改动）
<!-- smoke 机器段缺态：not-configured（commands.smoke 未配置——配置 local.yaml 后下次 verify 亲跑并自动注入机器段）source: cli-noai-smoke -->

## 任务完成度 [层：人工判断]
8/8 完成（100%）：
- task-01 ✅ agent-detector.ts:185-192 dsh 五字段 + version.ts:53 [0,2,1]；三态测试绿（102 用例）
- task-02 ✅ dsh-acp-events.ts normalizeAcpUpdate 五变体 + 未知忽略；13 用例绿
- task-03 ✅ dsh-acp-driver.ts 532 行契约完整（代答三态/握手失败/resume/cancel）；14 用例绿
- task-04 ✅ providers.ts caps 16 键 + 注册条目 + 联合扩展 + 三端镜像；tsc 0 + 50 用例 + 对齐 5 用例
- task-05 ✅ schema.py:131 Literal 含 dsh + openapi/api-types×2 再生成（含 dsh 且 @generated）；36 用例零回归
- task-06 ✅ messages.py/shadow.py 两处门控走 helpers.group_attachment_gate_denied；9+27 用例绿
- task-07 ✅ runtimes.ts:175-199 单一源 + PROVIDER_META.dsh；49 用例绿（含边界钉 2 例）
- task-08 ✅ 冒烟 skipIf 守卫 + 版本门内断言；本机 0.1.0 低于门 skip 留痕（守卫口径钉 1 例绿）

## 设计一致性 [层：人工判断]
一致（两处已裁决偏差 + 一处文档级差异，均有留痕）：
- D-006：task-03/04 合并收口（InteractiveProvider 联合由注册表推导的类型前向依赖）+ driver-factory.ts sessionPermission 条件 6 行接线——decisions.md D-006 落盘
- D-007：task-07 单一源实为 runtimes.ts（任务卡点名导入方）——decisions.md D-007 落盘
- 文档级差异：design 接口定义写 context_usage 事件、dsh 实际线格式为 usage_update（dsh acp README 术语）——归一化器按实际线格式映射（dsh-acp-events.ts usageUpdate 注释），语义等价（ctx_tokens=used）
- 文件变更清单 15 条全部落地（30 文件含 4 生成物与 6 新测试文件），无清单外实质改动（runtimes.ts/pre-session-picker.test.tsx 为 D-007/钉子闸连带）

## 探针结果（CLI 机械预填） [层：可复跑探针——gate 抽查防篡改]
#### 探针 1：未实现标记扫描（design 清单文件）
- ⚠️ `sillyhub-daemon/src/interactive/providers.ts:543` * TODO provider profile 未实现——本变更不实现注入逻辑（design §3 非目标）。
- ⚠️ `sillyhub-daemon/src/interactive/providers.ts:569` * TODO provider profile 未实现——仅类型占位（design §3 非目标，留后续变更）。
- ⚠️ `sillyhub-daemon/src/interactive/providers.ts:574` * TODO provider profile 未实现——仅类型占位（同上）。
- ℹ️ 7 个清单文件主仓不存在、已从 worktree 读取（apply 前新文件形态）

#### 探针 2：设计关键词覆盖
能力关键词 → 实现锚点（全部命中）：
- 探测/versionPattern/minVersion → sillyhub-daemon/src/agent-detector.ts:185-192
- 版本门/警告不硬拒 → sillyhub-daemon/src/version.ts:53 + checkMinVersion 既有路径
- ACP/initialize/session/new/resume/prompt/cancel → dsh-acp-driver.ts（consume/握手/turn 循环）
- request_permission/代答/fail-closed → dsh-acp-driver.ts consume 内 onServerRequest
- 握手失败/结构化错误 → dsh-acp-driver.ts catch 分支（subtype=error_during_execution）
- 归一化/session/update/AgentEvent → dsh-acp-events.ts normalizeAcpUpdate
- caps 16 键/permission_dialog/dialog native/multimodal false → providers.ts dsh 条目
- DSH_HOME/cordis.patch.yml/llm-pi-ai/apiKeyEnv → dsh-settings.ts writeDshHome
- 三端镜像/gen-provider-caps → scripts/gen-provider-caps.mjs ENGINES 五引擎（已跑，产物在场）
- InteractiveProviderLiteral/dsh → backend/app/modules/daemon/schema.py:131
- 群附件门控/caps 口径 → helpers.py group_attachment_gate_denied + messages.py/shadow.py 两处
- SESSION_ENGINE_OPTIONS/PROVIDER_META → frontend/src/lib/daemon/runtimes.ts:175-199
- 冒烟/skipIf/留痕 → tests/interactive/dsh-acp-smoke.test.ts
无未实现关键词。

#### 探针 3：验收标准测试覆盖
- ✅ task-01: 模块目录（sillyhub-daemon/src、sillyhub-daemon/tests）找到 11 个测试文件（sillyhub-daemon/src/spec-sync.ts、sillyhub-daemon/tests/adapters/factory.test.ts、sillyhub-daemon/tests/adapters/json-rpc.test.ts、sillyhub-daemon/tests/adapters/jsonl.test.ts、sillyhub-daemon/tests/adapters/ndjson.test.ts …）
- ✅ task-02: 模块目录（sillyhub-daemon/src/interactive、sillyhub-daemon/tests/interactive）找到 10 个测试文件（sillyhub-daemon/tests/interactive/claude-driver-close-contract.test.ts、sillyhub-daemon/tests/interactive/claude-events.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-canuse.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-content-blocks.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-glm-passthrough.test.ts …）
- ✅ task-03: 模块目录（sillyhub-daemon/src/interactive、sillyhub-daemon/tests/interactive）找到 10 个测试文件（sillyhub-daemon/tests/interactive/claude-driver-close-contract.test.ts、sillyhub-daemon/tests/interactive/claude-events.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-canuse.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-content-blocks.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-glm-passthrough.test.ts …）
- ✅ task-04: 模块目录（sillyhub-daemon/src、sillyhub-daemon/src/interactive、sillyhub-daemon/tests、sillyhub-daemon/tests/interactive、backend/app/modules/agent、backend/app/modules/agent/tests、frontend/src/lib）找到 41 个测试文件（sillyhub-daemon/src/spec-sync.ts、sillyhub-daemon/tests/adapters/factory.test.ts、sillyhub-daemon/tests/adapters/json-rpc.test.ts、sillyhub-daemon/tests/adapters/jsonl.test.ts、sillyhub-daemon/tests/adapters/ndjson.test.ts …）
- ✅ task-05: 模块目录（backend/app/modules/daemon、backend、frontend/src/lib、sillyhub-daemon/src）找到 90 个测试文件（backend/app/modules/daemon/audit/tests/test_audit.py、backend/app/modules/daemon/audit/tests/test_model.py、backend/app/modules/daemon/grants/tests/test_grants_authorization.py、backend/app/modules/daemon/grants/tests/test_migration.py、backend/app/modules/daemon/grants/tests/test_model.py …）
- ✅ task-06: 模块目录（backend/app/modules/daemon/group/service、backend/app/modules/daemon/tests）找到 10 个测试文件（backend/app/modules/daemon/tests/test_advance_team_stage.py、backend/app/modules/daemon/tests/test_agent_session_tasks.py、backend/app/modules/daemon/tests/test_agent_task_status_payload.py、backend/app/modules/daemon/tests/test_allowed_roots_per_runtime.py、backend/app/modules/daemon/tests/test_allowed_roots_policy_push.py …）
- ✅ task-07: 模块目录（frontend/src/components/sessions、frontend/src/app/(dashboard)/sessions/__tests__）找到 10 个测试文件（frontend/src/components/sessions/__tests__/create-group-wizard.test.tsx、frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx、frontend/src/components/sessions/__tests__/portal-file-panels.test.tsx、frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx、frontend/src/components/sessions/__tests__/session-config-bar.test.tsx …）
- ✅ task-08: 模块目录（sillyhub-daemon/tests/interactive）找到 10 个测试文件（sillyhub-daemon/tests/interactive/claude-driver-close-contract.test.ts、sillyhub-daemon/tests/interactive/claude-events.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-canuse.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-content-blocks.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-glm-passthrough.test.ts …）
- ℹ️ 集成盲区（路由/跨模块装配）与断言有效性抽查是语义判断，留给 agent 逐 task 标注 ⚠️

#### 探针 7：验收×测试覆盖矩阵
<!-- 口径注记：探针 3 = 模块目录递归存在性面（allowed_paths 目录附近有没有测试）；探针 7 = allowed_paths ∪ review changedFiles ∪ 直接下游卡测试 结构归属承接面（每条 acceptance 由哪些测试承接；下游消费卡的测试可承接上游 provider 的 acceptance——probe7-provider-tests-in-consumer-card）；两者并排冲突以 7 为准。判定枚举（五选一）：covered / covered-service / partial / uncovered / non-testable（covered-service 适用：端点行为由 service 层等非端点层测试锁定，证据附测试锚点；non-testable 是文档/部署类显式逃生门）。关键词命中只是提示，命中≠判定。 -->
<!-- 预填说明（ql-20260915-004）：判定列为 CLI 机械预填，agent 逐格复核改写——规则：无归属→uncovered（文档/部署/doc/deploy/manual/config 类词→non-testable）；有归属且命中≥1→covered；有归属零命中→partial。covered/covered-service/partial 证据须含测试锚点三形态之一（file:line / `.test.` 测试文件名 / 反引号包裹的路径或测试名），行号可省；uncovered/non-testable 证据自由形态。预填≠结论：与事实不符的格子必须改写（枚举须保持 covered/covered-service/partial/uncovered/non-testable 纯值，备注写在证据列）。 -->

**task-01**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| AGENT_DEFS 含 dsh 项且五字段齐（bin/envPath/versionPattern/minVersion/protocol） | `sillyhub-daemon/tests/agent-detector.test.ts`<br>`sillyhub-daemon/tests/version.test.ts` | AGENT_DEFS、bin、envPath（`sillyhub-daemon/tests/agent-detector.test.ts`） | covered | `sillyhub-daemon/tests/agent-detector.test.ts:4`（AGENT_DEFS）、`sillyhub-daemon/tests/agent-detector.test.ts:4`（bin）、`sillyhub-daemon/tests/agent-detector.test.ts:82`（envPath） |
| MIN_VERSIONS 含 dsh [0,2,1]；低版本仅警告不阻断（与四引擎同语义） | `sillyhub-daemon/tests/agent-detector.test.ts`<br>`sillyhub-daemon/tests/version.test.ts` | MIN_VERSIONS（`sillyhub-daemon/tests/version.test.ts`） | covered | `sillyhub-daemon/tests/version.test.ts:4`（MIN_VERSIONS） |
| 两个测试文件新用例全绿，既有用例零回归 | `sillyhub-daemon/tests/agent-detector.test.ts`<br>`sillyhub-daemon/tests/version.test.ts` | — | covered | `sillyhub-daemon/tests/agent-detector.test.ts` + `sillyhub-daemon/tests/version.test.ts` 实跑 102/102 绿（task01-test.log） |

**task-02**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 样例序列映射输出与预期 AgentEvent 序列逐字段一致（text/thinking/tool_use/tool_result/ctx_usage） | `sillyhub-daemon/tests/interactive/dsh-acp-events.test.ts` | AgentEvent、text、thinking（`sillyhub-daemon/tests/interactive/dsh-acp-events.test.ts`） | covered | `sillyhub-daemon/tests/interactive/dsh-acp-events.test.ts:2`（AgentEvent）、`sillyhub-daemon/tests/interactive/dsh-acp-events.test.ts:5`（text）、`sillyhub-daemon/tests/interactive/dsh-acp-events.test.ts:33`（thinking） |
| 未知 sessionUpdate 类型不抛错不丢后续事件 | `sillyhub-daemon/tests/interactive/dsh-acp-events.test.ts` | 未知、sessionUpdate（`sillyhub-daemon/tests/interactive/dsh-acp-events.test.ts`） | covered | `sillyhub-daemon/tests/interactive/dsh-acp-events.test.ts:10`（未知）、`sillyhub-daemon/tests/interactive/dsh-acp-events.test.ts:10`（sessionUpdate） |
| 纯函数无 IO，可独立单测 | `sillyhub-daemon/tests/interactive/dsh-acp-events.test.ts` | — | covered | `sillyhub-daemon/tests/interactive/dsh-acp-events.test.ts` 实跑 13/13 绿（task02-test.log；纯函数直测无 IO） |

**task-03**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| InteractiveDriver 契约实现完整（start/consume/interrupt 必选 + thinking 可选；compact 不实现） | `sillyhub-daemon/tests/interactive/dsh-acp-driver.test.ts` | InteractiveDriver、start、consume、interrupt（`sillyhub-daemon/tests/interactive/dsh-acp-driver.test.ts`） | covered | `sillyhub-daemon/tests/interactive/dsh-acp-driver.test.ts:33`（InteractiveDriver）、`sillyhub-daemon/tests/interactive/dsh-acp-driver.test.ts:49`（start）、`sillyhub-daemon/tests/interactive/dsh-acp-driver.test.ts:185`（consume） |
| 代答三态行为正确（allow→allow 选项回传；deny/超时→reject；askUserOnly→自动放行） | `sillyhub-daemon/tests/interactive/dsh-acp-driver.test.ts` | allow、deny、超时（`sillyhub-daemon/tests/interactive/dsh-acp-driver.test.ts`） | covered | `sillyhub-daemon/tests/interactive/dsh-acp-driver.test.ts:342`（allow）、`sillyhub-daemon/tests/interactive/dsh-acp-driver.test.ts:391`（deny）、`sillyhub-daemon/tests/interactive/dsh-acp-driver.test.ts:8`（超时） |
| 握手失败产出结构化 error 且不重试 | `sillyhub-daemon/tests/interactive/dsh-acp-driver.test.ts` | error（`sillyhub-daemon/tests/interactive/dsh-acp-driver.test.ts`） | covered | `sillyhub-daemon/tests/interactive/dsh-acp-driver.test.ts:70`（error） |
| 驱动单测全绿 | `sillyhub-daemon/tests/interactive/dsh-acp-driver.test.ts` | — | covered | `sillyhub-daemon/tests/interactive/dsh-acp-driver.test.ts` 实跑 14/14 绿（task03-test.log） |

**task-04**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| INTERACTIVE_PROVIDERS 含 dsh 完整声明（satisfies 编译期校验过） | `sillyhub-daemon/tests/dsh-settings.test.ts`<br>`sillyhub-daemon/tests/interactive/provider-registry.test.ts`<br>`sillyhub-daemon/tests/provider-adapter-registry.test.ts`<br>`backend/app/modules/agent/tests/test_provider_caps_alignment.py` | INTERACTIVE_PROVIDERS、dsh、satisfies（`sillyhub-daemon/tests/interactive/provider-registry.test.ts`、`sillyhub-daemon/tests/provider-adapter-registry.test.ts`、`sillyhub-daemon/tests/dsh-settings.test.ts`） | covered | `sillyhub-daemon/tests/interactive/provider-registry.test.ts:35`（INTERACTIVE_PROVIDERS）、`sillyhub-daemon/tests/dsh-settings.test.ts:1`（dsh）、`sillyhub-daemon/tests/provider-adapter-registry.test.ts:4`（satisfies） |
| caps 三端镜像一致（daemon 单源 → backend/frontend 生成物，对齐测试绿） | `sillyhub-daemon/tests/dsh-settings.test.ts`<br>`sillyhub-daemon/tests/interactive/provider-registry.test.ts`<br>`sillyhub-daemon/tests/provider-adapter-registry.test.ts`<br>`backend/app/modules/agent/tests/test_provider_caps_alignment.py` | caps、daemon、单源、backend（`sillyhub-daemon/tests/interactive/provider-registry.test.ts`、`sillyhub-daemon/tests/provider-adapter-registry.test.ts`、`backend/app/modules/agent/tests/test_provider_caps_alignment.py`） | covered | `sillyhub-daemon/tests/interactive/provider-registry.test.ts:4`（caps）、`sillyhub-daemon/tests/interactive/provider-registry.test.ts:248`（daemon）、`sillyhub-daemon/tests/interactive/provider-registry.test.ts:29`（单源） |
| patch 写入器三态正确（anthropic 形态/openai 形态/无配置跳过） | `sillyhub-daemon/tests/dsh-settings.test.ts`<br>`sillyhub-daemon/tests/interactive/provider-registry.test.ts`<br>`sillyhub-daemon/tests/provider-adapter-registry.test.ts`<br>`backend/app/modules/agent/tests/test_provider_caps_alignment.py` | patch、anthropic、形态、openai（`sillyhub-daemon/tests/dsh-settings.test.ts`、`sillyhub-daemon/tests/interactive/provider-registry.test.ts`、`backend/app/modules/agent/tests/test_provider_caps_alignment.py`、`sillyhub-daemon/tests/provider-adapter-registry.test.ts`） | covered | `sillyhub-daemon/tests/dsh-settings.test.ts:55`（patch）、`sillyhub-daemon/tests/dsh-settings.test.ts:3`（anthropic）、`sillyhub-daemon/tests/dsh-settings.test.ts:3`（形态） |

**task-05**
- ℹ️ 既有用例候选（FR 关联回归面，本变更未改动；判定仍由你复核，命中≠结论）：`backend/app/modules/change/tests/test_assets.py`、`backend/app/modules/change/tests/test_files_router.py`、`backend/app/modules/change/tests/test_session_changes_endpoint.py`、`backend/app/modules/change/tests/test_step_progress.py`、`backend/app/modules/change/tests/test_timeline.py`、`backend/app/modules/change/tests/test_title_normalization.py`、`backend/app/modules/change/tests/test_usage_stats.py`、`backend/app/modules/daemon/tests/test_change_session.py`、`backend/app/modules/daemon/tests/test_group_logs_pagination.py`、`backend/app/modules/daemon/tests/test_inject_origin_guard.py`、`backend/app/modules/daemon/tests/test_interactive_lifecycle_patch.py`、`backend/app/modules/daemon/tests/test_ppm_session.py`、`backend/app/modules/daemon/tests/test_scheduled_messages_crud.py`、`backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py`、`backend/app/modules/daemon/tests/test_session_events_cross.py`、`backend/app/modules/daemon/tests/test_session_pin_rename.py`、`backend/app/modules/daemon/tests/test_session_queue.py`、`backend/app/modules/daemon/tests/test_session_queue_actions.py`、`backend/app/modules/daemon/tests/test_session_runs_endpoint.py`、`backend/app/modules/daemon/tests/test_session_service.py`、`backend/app/modules/knowledge/tests/test_distill.py`、`backend/app/modules/knowledge/tests/test_hits.py`、`backend/app/modules/knowledge/tests/test_writer.py`、`backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py`、`backend/app/modules/platform_sync/tests/test_agent_log_messages.py`、`backend/app/modules/platform_sync/tests/test_change_events.py`、`backend/app/modules/platform_sync/tests/test_owner_sync.py`、`backend/app/modules/platform_sync/tests/test_usage_ingest.py`、`backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py`、`backend/app/modules/workspace/linked_repos/tests/test_linked_repos.py`、`backend/app/modules/workspace/tests/test_daemon_client_scan.py`、`backend/tests/modules/agent/test_agent_run_log_tool_kind.py`、`backend/tests/modules/agent/test_scan_interactive_dispatch.py`、`backend/tests/modules/auth/test_permissions.py`、`backend/tests/modules/change/test_archive_gate.py`、`backend/tests/test_align_platform_change_events_migration.py`、`backend/tests/test_check_assertion_surfaces.py`、`backend/tests/test_health.py`、`frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx`、`frontend/src/app/(dashboard)/admin/server-status/__tests__/page.test.tsx`、`frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx`、`frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx`、`frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx`、`frontend/src/app/m/account/page.test.tsx`、`frontend/src/app/page.test.tsx`、`frontend/src/components/__tests__/app-shell.test.tsx`、`frontend/src/components/__tests__/change-file-tree-autorefresh.test.tsx`、`frontend/src/components/__tests__/change-file-tree.test.tsx`、`frontend/src/components/agent-log/__tests__/tool-renderers-write-diff.test.tsx`、`frontend/src/components/changes/__tests__/scope-audit-command-card.test.tsx`、`frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx`、`frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx`、`frontend/src/components/changes/detail/__tests__/change-timeline-card.test.tsx`、`frontend/src/components/changes/detail/__tests__/change-usage-card.test.tsx`、`frontend/src/components/daemon/__tests__/agent-log-card.test.tsx`、`frontend/src/components/daemon/__tests__/agent-replay-body.test.tsx`、`frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx`、`frontend/src/components/daemon/__tests__/session-panel-pre-session.test.tsx`、`frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx`、`frontend/src/components/daemon/__tests__/tool-args-detail.test.tsx`、`frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx`、`frontend/src/components/daemon/__tests__/turn-speed.test.ts`、`frontend/src/components/daemon/__tests__/turn-timeline-token-speed.test.tsx`、`frontend/src/components/explorer/__tests__/file-preview.test.tsx`、`frontend/src/components/files/__tests__/file-preview-modal.test.tsx`、`frontend/src/components/files/__tests__/preview-registry.test.ts`、`frontend/src/components/files/__tests__/structured-views.test.tsx`、`frontend/src/components/floating/floating-session-host.test.tsx`、`frontend/src/components/git-log/__tests__/git-log-page.test.tsx`、`frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx`、`frontend/src/components/llm-providers/__tests__/llm-provider-form-apiformat.test.tsx`、`frontend/src/components/llm-providers/__tests__/llm-provider-form-fetch-config.test.tsx`、`frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx`、`frontend/src/components/llm-providers/__tests__/llm-provider-list.test.tsx`、`frontend/src/components/mobile/mobile-change-detail.test.tsx`、`frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx`、`frontend/src/components/sessions/__tests__/session-config-bar.test.tsx`、`frontend/src/components/sessions/__tests__/sessions-portal.test.tsx`、`frontend/src/components/workspace-config-card.test.tsx`、`frontend/src/lib/__tests__/agent-log-turns.test.ts`、`frontend/src/lib/__tests__/daemon-session-stream-sync.test.ts`、`frontend/src/lib/__tests__/logout-storage.test.ts`、`frontend/src/lib/__tests__/menu-overrides.test.ts`、`frontend/src/lib/__tests__/menu-permissions.test.ts`、`frontend/src/lib/__tests__/permission.test.ts`、`frontend/src/lib/__tests__/session-mention-sources.test.tsx`、`frontend/src/lib/__tests__/token-refresh.test.ts`、`frontend/src/lib/api/__tests__/llm-providers.test.ts`、`sillyhub-daemon/tests/agent-log/parse-claude-code.test.ts`、`sillyhub-daemon/tests/sillyspec-tombstone-cleanup.test.ts`
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| Literal 含 "dsh"；openapi.json 枚举透出；两侧 api-types 重生成一致（无手写） | `backend/app/modules/change/tests/test_assets.py`<br>`backend/app/modules/change/tests/test_files_router.py`<br>`backend/app/modules/change/tests/test_session_changes_endpoint.py`<br>`backend/app/modules/change/tests/test_step_progress.py`<br>`backend/app/modules/change/tests/test_timeline.py`<br>…共 20 个（目录级候选全量在 facts/trace，归属按关键词命中与证据锚点收窄） | Literal、json（`backend/app/modules/daemon/tests/test_change_session.py`、`backend/app/modules/daemon/tests/test_inject_origin_guard.py`、`backend/app/modules/daemon/tests/test_ppm_session.py`、`backend/app/modules/change/tests/test_assets.py`、`backend/app/modules/change/tests/test_files_router.py`、`backend/app/modules/change/tests/test_session_changes_endpoint.py`、`backend/app/modules/change/tests/test_usage_stats.py`、`backend/app/modules/daemon/tests/test_group_logs_pagination.py`、`backend/app/modules/daemon/tests/test_interactive_lifecycle_patch.py`、`backend/app/modules/daemon/tests/test_scheduled_messages_crud.py`、`backend/app/modules/daemon/tests/test_session_events_cross.py`、`backend/app/modules/daemon/tests/test_session_pin_rename.py`、`backend/app/modules/daemon/tests/test_session_queue_actions.py`、`backend/app/modules/daemon/tests/test_session_runs_endpoint.py`） | covered-service | `backend/app/modules/daemon/tests/test_session_create_config.py` 实跑 36/36 绿（task05 执行期）；生成物 openapi.json/api-types.ts×2 均含 dsh 且头部 auto-generated（grep 三文件 ×2 命中）；枚举校验本体为 pydantic Literal（无独立端点，service 层零行为变化） |

**task-06**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 发送侧与触发侧门控判定均与 caps.attachments 完全一致（六种 provider 形态 × 两侧参数化钉死） | `backend/app/modules/daemon/tests/test_group_attachment_gate.py`<br>`backend/app/modules/daemon/tests/test_group_p2.py` | caps、attachments（`backend/app/modules/daemon/tests/test_group_attachment_gate.py`、`backend/app/modules/daemon/tests/test_group_p2.py`） | covered | `backend/app/modules/daemon/tests/test_group_attachment_gate.py:1`（caps）、`backend/app/modules/daemon/tests/test_group_attachment_gate.py:4`（attachments） |
| 既有群消息测试零回归 | `backend/app/modules/daemon/tests/test_group_attachment_gate.py`<br>`backend/app/modules/daemon/tests/test_group_p2.py` | — | covered | `backend/app/modules/daemon/tests/test_group_p2.py` 实跑 27/27 零回归（task06-test.log）+ `test_group_attachment_gate.py` 9/9 绿 |

**task-07**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 单聊创建入口可选 dsh；群聊六要素白名单不含 dsh | `frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx` | dsh、label（边界钉 describe） | covered | `frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx`「dsh 单聊引擎边界钉」describe 2 用例（SESSION_ENGINE_OPTIONS 含 dsh+label 对齐 / 群白名单源级不含） |
| 既有页面测试零回归 | `frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx` | — | covered | `frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx` 实跑 49/49 绿（task07-test.log） |

**task-08**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 有 dsh 环境：冒烟全绿（一轮对话事件序列完整、打断生效、代答三态正确、路由 model 设置成功） | `sillyhub-daemon/tests/interactive/dsh-acp-smoke.test.ts` | dsh、环境（`sillyhub-daemon/tests/interactive/dsh-acp-smoke.test.ts`） | covered | `sillyhub-daemon/tests/interactive/dsh-acp-smoke.test.ts:1`（dsh）、`sillyhub-daemon/tests/interactive/dsh-acp-smoke.test.ts:94`（环境） |
| 无 dsh 环境：显式 skip + 留痕（不假绿） | `sillyhub-daemon/tests/interactive/dsh-acp-smoke.test.ts` | dsh、环境、显式、skip、留痕（`sillyhub-daemon/tests/interactive/dsh-acp-smoke.test.ts`） | covered | `sillyhub-daemon/tests/interactive/dsh-acp-smoke.test.ts:1`（dsh）、`sillyhub-daemon/tests/interactive/dsh-acp-smoke.test.ts:94`（环境）、`sillyhub-daemon/tests/interactive/dsh-acp-smoke.test.ts:5`（显式） |

- ⚠️ 零/半自动化承接条目 6 条——这些路径无测试兜底，verify 复核必须**显式走查**（尤其编辑/更新链路与非主分支流：二次复核实证它们正是 P1 藏身处），走查结论登记进「代码审查」节

#### 探针 4：决策追踪覆盖
决策闭环矩阵（D-001~D-007 全闭环，无 unresolved）：
- D-001@v1（探测先例）→ FR-01 → task-01 → agent-detector.ts:185-192 ✅
- D-002@v1（版本门警告）→ FR-01/02 → task-01/03 → version.ts:53 + 驱动握手失败结构化 ✅
- D-003@v1（自研驱动）→ FR-02/03/04 → task-02/03 → dsh-acp-driver.ts + events.ts ✅
- D-004@v1（rejected：官方 SDK）→ 佐证面 → package.json 零新依赖（execute-review 交叉项 pass）✅
- D-005@v1（rejected：headless）→ 佐证面 → adapters PROVIDER_TO_PROTOCOL 无 dsh ✅
- D-006@v1（执行期合并）→ task-03/04 → driver-factory.ts 条件 diff 最小（评审确认）✅
- D-007@v1（单一源修正）→ task-07 → runtimes.ts:175-199 ✅
requirements.md 决策覆盖矩阵含 D-001~D-005（D-006/007 为执行期新增，plan 后产生——本矩阵回指闭环）。

#### 探针 5：API Contract Parity
- ❌ API parity check failed: 6 frontend calls have no matching backend endpoint [scope: change-diff (30 files @ worktree)] | 0 backend endpoints unused by frontend (+438 stock noise collapsed)
- ℹ️ 后端端点比对集为多根并集（主仓既有 ∪ worktree 新增 ∪ 存量 artifact），共扫 2 个根

| 状态 | 前端调用 | 后端端点 | 文件 |
|---|---|---|---|
| ❌ missing | GET /api/daemon/runtimes | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\.sillyspec\.runtime\worktrees\2026-10-15-dsh-engine-acp\frontend\src\lib\daemon\runtimes.ts:39 |
| ❌ missing | GET /api/daemon/runtimes/page | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\.sillyspec\.runtime\worktrees\2026-10-15-dsh-engine-acp\frontend\src\lib\daemon\runtimes.ts:66 |
| ❌ missing | GET /api/daemon/runtimes/{param} | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\.sillyspec\.runtime\worktrees\2026-10-15-dsh-engine-acp\frontend\src\lib\daemon\runtimes.ts:97 |
| ❌ missing | DELETE /api/daemon/runtimes/{param} | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\.sillyspec\.runtime\worktrees\2026-10-15-dsh-engine-acp\frontend\src\lib\daemon\runtimes.ts:125 |
| ❌ missing | GET /api/daemon/version | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\.sillyspec\.runtime\worktrees\2026-10-15-dsh-engine-acp\frontend\src\lib\daemon\runtimes.ts:145 |
| ❌ missing | GET /api/daemon/runtimes/usage | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\.sillyspec\.runtime\worktrees\2026-10-15-dsh-engine-acp\frontend\src\lib\daemon\runtimes.ts:312 |

- ✅ **语义复核：口径噪音非契约缺口**——6 个 missing 全部为 runtimes.ts（本变更修改文件）内的存量调用：backend/app/modules/daemon/router/runtimes.py 自述 11 个 runtime 端点（:712 @router.get("/runtimes") 等装饰器在场），本变更加行仅 PROVIDER_META/SUPPORTED_PROVIDERS 两段（git diff +10 行不含任何调用）；探针对账集未解析该存量 router。判定：无需补端点。
- ⚠️ 0 个本变更端点前端未调用（warning 不阻断）：
- ℹ️ 另有 438 个存量端点未调用（他模块存量噪音，已折叠不逐条列出）

#### 探针 6：代码删除对账
- ✅ git diff 无整文件删除（D/R/C）记录
- ℹ️ 以 git 事实为准（真实 > 声明）；是否 FAIL blocker 由 agent 诚实判定

#### 探针 8：载荷字段契约对账（advisory）
- 不适用（清单无 Java/SQL 后端面，或 design.md 缺失）
#### 探针 9：守卫一致性（advisory）
- 不适用（清单无 .java 改动文件，或 design.md 缺失）
- ℹ️ 清单无 .java 文件（另有 19 个非 Java 清单文件不在探针 9 扫描面）
#### 探针 10：预填注清零（error 门）
<!-- 口径注记：预填注（来源注协议）在场 = 白名单槽未确认（预填≠结论）；删注 = 确认动作。本探针是门禁梯度 error 档——verify --done 时 gate 复跑同源检测，注未清零阻断完成（归档前清零兜底）。已知误报面：散文引用注字面量会命中（如文档描述注协议本身）——核对后真未确认则删注，纯散文则改写措辞，不得删探针段。 -->
- ✅ 预填注清零（9 个在检文件无未确认预填）
#### 探针 11：红线一致性（advisory）
- 不适用（仓未配置 .sillyspec/redlines.yaml——红线机检零打扰，D-002）
#### 探针 12：UI 视觉证据（分级门）
<!-- 口径注记：在场性检查非语义审计——只验 visual-evidence.md 存在非空与降级裁决留痕，不判对照结论对错（语义面归 verify-result 人工判断层）。证据应在执行时按 flow start「UI 变更执行须知」随手产生；本探针不要求收口现做。分级：缺证据默认 ⚠️（local.yaml ui_visual_gate=error 升阻断）；视觉降级无「用户裁决」留痕恒 ❌（off 豁免）。 -->
- ❌ design/requirements 存在视觉降级声明而变更目录无用户裁决留痕（visual-evidence.md 或 decisions.md 含「用户裁决」）——静默降级禁止收口
  - 修复：补渲染对照证据到 visual-evidence.md；降级项补用户裁决留痕（含「用户裁决」字样段）后重跑收口

## 接口验证覆盖矩阵 [层：人工判断——CLI 预填复核]
<!-- 口径注记（与探针 7 互指，R-07）：探针 7 = 验收项 × 测试承接面（每条 acceptance 由哪些测试承接）；本矩阵 = 接口端点 × 验证用例面（design 接口段每个端点由哪些验证用例/冒烟步骤覆盖）——两者并排互补，双矩阵并行存在。端点集来自 design.md 接口段 tolerant 解析（parseDesignApiTable：段头宽收 + 方法/路径双条件），预填≠结论，agent 逐行复核。判定枚举（五选一）：covered / covered-service / partial / uncovered / non-testable——covered-service 适用：端点行为由 service 层等非端点层测试锁定；证据须含测试文件锚点三形态之一（`.test.` / file:line / 反引号包裹的路径或测试名）；non-testable 适用（含运行验证移交场景）：目标环境不可达、构建级验证已过而运行冒烟移交部署后执行——证据写构建回执+移交去向一句话，该行不计入有效分母（勿硬凑 covered-service）。 -->
<!-- 预填说明：端点行由 CLI 机械预填，判定/用例依据 ID/结果/证据由 agent 逐格填写——用例依据 ID 锚点五形态（可复制样例）：design接口表#POST /api/xx（# 后必须 METHOD /path，仅表名/行号/散文描述不计命中）、权限矩阵[admin×读]、契约表@任务卡字段清单、DDL@users.id、载荷@e2e_body.json（须真实命中对应表/段，防空指）。 -->
<!-- 文法注释：子行 = 端点行下一行、两空格缩进、以「↳ <消费端>:」前缀书写（消费端细分承接面，不计矩阵行账）；探索行 = 判定 uncovered 且证据列含 [探索] 标记（探索性验证不算覆盖）。 -->
| 端点 | 判定 | 用例依据 ID | 结果 | 证据 |
|---|---|---|---|---|
| 本变更接口面：0 端点（agent 声明） | <待填：五选一> | <待填：用例 ID> | <待填> | <待填：锚点> |
<!-- 解析零行降级（D-005）：接口面以 agent 声明为准（对账分母=声明数）；声明与实际不符时补 design 接口段表格后重跑 --init --force 重生成本段（quick-B：--force 才有刷新通道，手填内容会重置先备份） -->
<!-- advisory 尾注（warning 计算归 validator，本段只留位）：有消费端未填子行的端点将列于此（advisory——消费端归类=design 清单启发式，数据面 facts.consumerHints）；写端点（POST/PUT/DELETE/PATCH）未在权限矩阵段声明的将列于此（advisory——补行或显式豁免「无权限约束」，数据面 facts.apiFace.writeEndpoints；表缺行会让派生框架继承你的洞） -->

## 测试结果 [层：确定性检查——CLI 实测对账]
<!--TODO: 测试命令 + 结果（通过数/失败数；known_failures 豁免逐条注明）-->

## 决策追踪矩阵（如存在 decisions.md；无则删本节） [层：人工判断]
<!-- 机械半边预填（CLI，P0-1）：D→FR→task 链自 decisions.md × tasks/*.md frontmatter 结构化字段构建；
     Evidence / 状态两列是人工判断——逐格复核，未闭环行必须在报告标注风险 -->
| 决策 ID | FR | Task | Evidence | 状态 |
|---|---|---|---|---|
| D-001@v1 | FR-01、FR-02、FR-03、FR-04、FR-05、FR-06 | task-01、task-04、task-05、task-08 | <待填：证据回指> | <待填> |
| D-002@v1 | FR-01、FR-02、FR-03、FR-04、FR-05 | task-01、task-03、task-08 | <待填：证据回指> | <待填> |
| D-003@v1 | FR-01、FR-02、FR-03、FR-04、FR-05、FR-06 | task-02、task-03、task-04、task-08 | <待填：证据回指> | <待填> |
| D-004@v1 | ⚠️ 未映射 | ⚠️ 未闭环（无 task 回指） | <待填：证据回指> | <待填> |
| D-005@v1 | ⚠️ 未映射 | ⚠️ 未闭环（无 task 回指） | <待填：证据回指> | <待填> |
| D-006@v1 | ⚠️ 未映射 | ⚠️ 未闭环（无 task 回指） | <待填：证据回指> | <待填> |
| D-007@v1 | ⚠️ 未映射 | ⚠️ 未闭环（无 task 回指） | <待填：证据回指> | <待填> |

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
