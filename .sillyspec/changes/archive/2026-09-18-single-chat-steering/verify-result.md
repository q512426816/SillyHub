---
author: qinyi
created_at: 2026-09-19 03:55:00
---

# 验证报告 — 2026-09-18-single-chat-steering（单聊引导 Steering 忙轮直注入）

## 结论

结论枚举：PASS WITH NOTES——自动化全绿（backend 125 / daemon 66+36 / frontend 65 / 三端 tsc+mypy+ruff 0 错 / verify 实测模块探针 636.7s exit 0 / lint 探针 54.9s exit 0）+ integration-critical 真实 e2e 三场景全 PASS（claude/codex steered=true 无 interrupt、cursor 降级排队），10/10 任务交付双 pass；决策覆盖 D-001/D-002/D-003 全兑现；notes=未配置常驻 commands.smoke（e2e 真实集成已跑并留回执，部署后真机冒烟转人工——见移交项）

## 任务完成度

10/10 task 完成并双 pass（task review 见 .sillyspec/.runtime/execute-runs/exec-2026-09-19-005504-84195d/tasks/）：

| task | 内容 | commit | review |
|---|---|---|---|
| task-01 | PROVIDER_CAPS steering 第 14 键三端 | 549320068 | pass/pass |
| task-02 | codex turn/steer 实机探测（spike-01 成功） | 6c535f39b | pass/pass |
| task-04 | claude 队列吸收实测（spike-02 成功） | f6fd4c41b | pass/pass |
| task-03 | codex 驱动 turn/steer 接线 + turnId 提取修复 | a40dfa060 | pass/pass |
| task-05 | backend 单聊忙轮 steering 门控 + steered | 18e5d6dd2 | pass/pass |
| task-06 | dispatch_now 三态重构 | 2bfc99ac4 | pass/pass |
| task-07 | 前端三态引导气泡 + provider 接线 | 1c8353e89 | pass/pass |
| task-08 | ⚡ 引导文案 + 降级标注 | 4a47cffbc | pass/pass |
| task-09 | 三端测试收口 + gen:types | 1934c322a | pass/pass |
| task-10 | daemon.md 文档同步 + FR 对照 | 87df29c95 | pass/pass |

工作量：34 文件 +2958/−718（无新建源码文件）；执行期偏离 2 处均已裁决并同步文档（task-05 三层加参、task-09 router 侧三测试文件扩卡）。

## 设计一致性

- FR-1 单聊忙轮发送=引导注入：✅ e2e claude/codex 场景响应 `steered=true, queued=false, run_id=活跃run`
- FR-2 能力矩阵与降级：✅ PROVIDER_CAPS 第 14 键三端一致（alignment 测试）+ cursor e2e 降级排队 `queued=true, steered=false` 不报错
- FR-3 ⚡ 引导式：✅ dispatch_mode 三态（steered/interrupted/dispatched），interrupted 兼容保留；不支持引擎维持 interrupt 接力（测试覆盖）
- FR-4 零回归：✅ 群聊 @ steering（test_group_direct 19 用例未动即绿）、切换维度守卫（新用例断言不 steer）、停止按钮/服务身份 409 语义未触碰
- FR-5 前端三态：✅ page.test 三态全链路用例（引导中→已投递/轮结束终态，data-steered-msg）
- FR-6 codex turn/steer：✅ 驱动分支 + 被拒回落（heldTurns）单测 5 条 + e2e 实证
- 决策覆盖：D-001（忙轮发送即引导——e2e steered=true 且 interrupt 计数 0）、D-002（方案 A 全链路+能力降级——cursor e2e 排队不报错）、D-003（三 provider 证据——两份 spike md + e2e）全兑现
- 生命周期契约表 6 行逐条与实现一致（execute 验收审查核对）
- 采纳的执行期修正：mid_turn 复用（无平行字段）、PROVIDER_CAPS 单源（无第 4 源）

## 探针结果

- spike-01（codex turn/steer）：成功——参数 `{threadId, expectedTurnId, input:[{type:'text',text}]}`，响应 `result.turnId`；四类被拒回执落盘；副发现 turnId 提取 bug 已修（task-03）。spike-codex-turn-steer.md
- spike-02（claude 队列吸收）：成功——工具循环=mid-turn fold（marker 进 RESULT#1 末行）、纯生成=轮边界双形态，零 interrupt；queued_turn_count 真机不填充（负面发现如实落盘）。spike-claude-steering.md

## 测试结果（定向，非全量——CLAUDE.md 规则 0）

| 端 | 范围 | 结果 |
|---|---|---|
| backend | test_session_queue / test_session_queue_actions / router 三文件 / test_group_direct / test_provider_caps_alignment | 125 passed / 0 failed |
| daemon | codex-app-server-driver（61 既有 + 5 新增） | 66/66 |
| daemon | claude-sdk-driver（task-04 守护 2 用例） | 36/36 |
| frontend | message-queue-bar / session-panel-dialog-attachments / page.test | 65/65 |
| 类型 | frontend tsc --noEmit | 0 错 |
| 三端 caps | alignment 键集 14 一致 | pass |

## 变更风险等级

integration-critical（design 声明接受不豁免）——真实集成证据见下节，满足门控。

## Runtime Evidence（integration test / e2e / 真实集成 / runtime evidence）

完整证据：`e2e-steering-evidence.md`（本目录）。真实 daemon↔backend 端到端（独立 DB platform_e2e_steering + 独立 redis + worktree 栈 commit 87df29c95e20，生产容器未动）：

1. **claude 忙轮引导 — PASS（轮边界吸收形态）**：忙轮 inject 响应原文 `{"run_id":"3093df59-…","status":"running","queued":false,"steered":true}`；引擎 transcript `USER 19:17:03 数数任务 → ASST 19:17:58 数完 → USER 19:17:58 STOP-COUNTING-NOW-42 → ASST 19:18:08 STEERED-OK-42`；session_interrupt 计数 0；run completed/success。
2. **codex 忙轮引导（新驱动代码）— PASS（同 turn mid-turn fold）**：响应 `{"run_id":"9038f911-…","queued":false,"steered":true}`；19:21:47 注入 → 19:22:15 数完不中断 → 19:22:21 `[ASSISTANT] STEERED-OK-42` 落平台日志；`interactive_run_closed api_requests=2`（单 turn 两次模型调用 = turn/steer fold 行为学证明）；daemon.log 无被拒回落。
3. **cursor 降级对照 — PASS**：响应 `{"run_id":null,"status":"queued","queued":true,"queue_entry_id":"5362346f-…","steered":false}`；轮结束自动派发次轮输出 marker。

清理确认：e2e 栈全停、临时容器/DB 已删。

## 遗留观察项（不阻断，建议后续变更）

1. claude 纯生成形态次轮输出不落平台会话日志（引擎原生，NG-1/R-04 备案口径；codex 形态可见性更好）——建议对齐留痕体验。
2. daemon `cli.js start` 不读 config.json 的 server_url/api_key（须命令行传参，非本变更引入）。
3. codex steer 超时（10s）回落理论窗口（受理 ~1ms 实测）——注释已留档。
4. worktree gen:types editable install 陷阱已记 docs/sillyspec/worktree-gen-types-editable-install-trap.md。

## 探针结果（CLI 机械预填，--init 补注入） [层：可复跑探针——gate 抽查防篡改]
#### 探针 1：未实现标记扫描（design 清单文件）
- ⚠️ `sillyhub-daemon/src/interactive/providers.ts:388` * TODO provider profile 未实现——本变更不实现注入逻辑（design §3 非目标）。
- ⚠️ `sillyhub-daemon/src/interactive/providers.ts:414` * TODO provider profile 未实现——仅类型占位（design §3 非目标，留后续变更）。
- ⚠️ `sillyhub-daemon/src/interactive/providers.ts:419` * TODO provider profile 未实现——仅类型占位（同上）。
- ℹ️ 清单文件不存在（跳过）：test_inject_empty_prompt.py、test_session_user_preamble.py

#### 探针 2：设计关键词覆盖
<!--TODO: 半语义探针——从 design 提取能力关键词逐个 grep 确认实现（agent 执行）-->

#### 探针 3：验收标准测试覆盖
- ✅ task-01: 模块目录（sillyhub-daemon/src/interactive、sillyhub-daemon/scripts、backend/app/modules/agent、frontend/src/lib、backend/app/modules/agent/tests、sillyhub-daemon/tests/interactive、frontend/src/components/sessions/__tests__）找到 38 个测试文件（backend/app/modules/agent/tests/test_agent_run_log_nul.py、backend/app/modules/agent/tests/test_agent_sessions_include_ended.py、backend/app/modules/agent/tests/test_agent_session_model.py、backend/app/modules/agent/tests/test_apply_run_metadata_cache.py、backend/app/modules/agent/tests/test_base.py …）
- ⚠️ task-02: 模块目录（.sillyspec/changes/2026-09-18-single-chat-steering）递归未找到测试文件（含 co-located tests/）
- ✅ task-03: 模块目录（sillyhub-daemon/src/interactive、sillyhub-daemon/tests/interactive）找到 10 个测试文件（sillyhub-daemon/tests/interactive/claude-driver-close-contract.test.ts、sillyhub-daemon/tests/interactive/claude-events.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-canuse.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-content-blocks.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-glm-passthrough.test.ts …）
- ✅ task-04: 模块目录（.sillyspec/changes/2026-09-18-single-chat-steering、sillyhub-daemon/tests/interactive）找到 10 个测试文件（sillyhub-daemon/tests/interactive/claude-driver-close-contract.test.ts、sillyhub-daemon/tests/interactive/claude-events.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-canuse.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-content-blocks.test.ts、sillyhub-daemon/tests/interactive/claude-sdk-driver-glm-passthrough.test.ts …）
- ✅ task-05: 模块目录（backend/app/modules/daemon/router、backend/app/modules/daemon/session/service、backend/app/modules/daemon）找到 12 个测试文件（backend/app/modules/daemon/audit/tests/test_audit.py、backend/app/modules/daemon/audit/tests/test_model.py、backend/app/modules/daemon/grants/tests/test_grants_authorization.py、backend/app/modules/daemon/grants/tests/test_migration.py、backend/app/modules/daemon/grants/tests/test_model.py …）
- ✅ task-06: 模块目录（backend/app/modules/daemon/session/service、backend/app/modules/daemon/router、backend/app/modules/daemon）找到 12 个测试文件（backend/app/modules/daemon/audit/tests/test_audit.py、backend/app/modules/daemon/audit/tests/test_model.py、backend/app/modules/daemon/grants/tests/test_grants_authorization.py、backend/app/modules/daemon/grants/tests/test_migration.py、backend/app/modules/daemon/grants/tests/test_model.py …）
- ⚠️ task-07: 模块目录（frontend/src/lib/daemon、frontend/src/components/daemon/session-panel）递归未找到测试文件（含 co-located tests/）
- ✅ task-08: 模块目录（frontend/src/components/daemon）找到 10 个测试文件（frontend/src/components/daemon/__tests__/activity-catalog.test.tsx、frontend/src/components/daemon/__tests__/agent-log-card.test.tsx、frontend/src/components/daemon/__tests__/agent-task-card-lifecycle.test.tsx、frontend/src/components/daemon/__tests__/agent-task-card.test.tsx、frontend/src/components/daemon/__tests__/attachment-chips.test.tsx …）
- ✅ task-09: 模块目录（frontend/src/lib、backend/app/modules/daemon/tests、frontend/src/components/daemon/__tests__、frontend/src/app/(dashboard)/sessions/__tests__、backend/app/modules/daemon/session/service、backend/app/modules/daemon）找到 42 个测试文件（frontend/src/lib/api/__tests__/llm-providers.test.ts、frontend/src/lib/auth/route-guard.test.ts、frontend/src/lib/change-autolink.test.ts、frontend/src/lib/daemon.test.ts、frontend/src/lib/errors.test.ts …）
- ✅ task-10: 模块目录（.sillyspec/docs/SillyHub/modules）找到 2 个测试文件（.sillyspec/docs/SillyHub/modules/spec_profile.md、.sillyspec/docs/SillyHub/modules/spec_workspace.md）
- ℹ️ 集成盲区（路由/跨模块装配）与断言有效性抽查是语义判断，留给 agent 逐 task 标注 ⚠️

#### 探针 7：验收×测试覆盖矩阵
<!-- 口径注记：探针 3 = 模块目录递归存在性面（allowed_paths 目录附近有没有测试）；探针 7 = allowed_paths ∪ review changedFiles ∪ 直接下游卡测试 结构归属承接面（每条 acceptance 由哪些测试承接；下游消费卡的测试可承接上游 provider 的 acceptance——probe7-provider-tests-in-consumer-card）；两者并排冲突以 7 为准。判定枚举（四选一）：covered / partial / uncovered / non-testable（文档/部署类显式逃生门）。关键词命中只是提示，命中≠判定。 -->
<!-- 预填说明（ql-20260915-004）：判定列为 CLI 机械预填，agent 逐格复核改写——规则：无归属→uncovered（文档/部署/doc/deploy/manual/config 类词→non-testable）；有归属且命中≥1→covered；有归属零命中→partial。covered/partial 证据须含测试锚点三形态之一（file:line / `.test.` 测试文件名 / 反引号包裹的路径或测试名），行号可省；uncovered/non-testable 证据自由形态。预填≠结论：与事实不符的格子必须改写（枚举须保持 covered/partial/uncovered/non-testable 纯值，备注写在证据列）。 -->

**task-01**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| PROVIDER_CAPS 四引擎均有 steering 键且取值 pi/claude/codex=true、cursor=false；getProviderCaps/get_provider_caps 未知 provider 回退 false 且 14 键齐全 | `backend/app/modules/agent/tests/test_provider_caps_alignment.py`<br>`sillyhub-daemon/tests/interactive/provider-registry.test.ts`<br>`frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx` | PROVIDER_CAPS、claude（`backend/app/modules/agent/tests/test_provider_caps_alignment.py`、`sillyhub-daemon/tests/interactive/provider-registry.test.ts`、`frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx`） | covered | `backend/app/modules/agent/tests/test_provider_caps_alignment.py:27`（PROVIDER_CAPS）、`backend/app/modules/agent/tests/test_provider_caps_alignment.py:42`（claude） |
| gen-provider-caps.mjs 守卫通过（恰四引擎 × 14 键，exit 0）且两份生成产物含 steering | `backend/app/modules/agent/tests/test_provider_caps_alignment.py`<br>`sillyhub-daemon/tests/interactive/provider-registry.test.ts`<br>`frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx` | gen、provider、caps、mjs（`backend/app/modules/agent/tests/test_provider_caps_alignment.py`、`sillyhub-daemon/tests/interactive/provider-registry.test.ts`、`frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx`） | covered | `backend/app/modules/agent/tests/test_provider_caps_alignment.py:5`（gen）、`backend/app/modules/agent/tests/test_provider_caps_alignment.py:4`（provider）、`backend/app/modules/agent/tests/test_provider_caps_alignment.py:1`（caps） |
| alignment 测试 4 用例全绿（键集合=14 契约键、provider 集合、逐键取值三端一致、未知 provider 默认拒绝） | `backend/app/modules/agent/tests/test_provider_caps_alignment.py`<br>`sillyhub-daemon/tests/interactive/provider-registry.test.ts`<br>`frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx` | 测试、键集合、契约键（`backend/app/modules/agent/tests/test_provider_caps_alignment.py`、`sillyhub-daemon/tests/interactive/provider-registry.test.ts`、`frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx`） | covered | `backend/app/modules/agent/tests/test_provider_caps_alignment.py:1`（测试）、`backend/app/modules/agent/tests/test_provider_caps_alignment.py:9`（键集合）、`backend/app/modules/agent/tests/test_provider_caps_alignment.py:36`（契约键） |
| daemon provider-registry.test.ts 与 frontend pre-session-picker.test.tsx 键数/对象断言联动后通过；daemon 与 frontend tsc --noEmit 通过 | `backend/app/modules/agent/tests/test_provider_caps_alignment.py`<br>`sillyhub-daemon/tests/interactive/provider-registry.test.ts`<br>`frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx` | daemon、provider、registry、test、frontend（`backend/app/modules/agent/tests/test_provider_caps_alignment.py`、`sillyhub-daemon/tests/interactive/provider-registry.test.ts`、`frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx`） | covered | `backend/app/modules/agent/tests/test_provider_caps_alignment.py:3`（daemon）、`backend/app/modules/agent/tests/test_provider_caps_alignment.py:4`（provider）、`backend/app/modules/agent/tests/test_provider_caps_alignment.py:37`（registry） |

**task-02**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| spike md 存在且含：环境信息、initialize/thread/start/turn/start 会话记录、至少一组 turn/steer 试探的请求与响应/错误文案原样 | 文档交付（spike 记录） | — | non-testable | spike-codex-turn-steer.md 存在且结论被 task-03/e2e 实际消费（参数形状与 e2e daemon.log 一致） |
| 结论字段明确二选一：参数形状可用（可直接支撑 task-03 实现）或不可用→caps 置 false 降级（含证据） | 文档交付（spike 记录） | — | non-testable | spike-codex-turn-steer.md 存在且结论被 task-03/e2e 实际消费（参数形状与 e2e daemon.log 一致） |
| 探测过程零代码改动（不改驱动/caps/backend/frontend，只落盘 md） | 文档交付（spike 记录） | — | non-testable | spike-codex-turn-steer.md 存在且结论被 task-03/e2e 实际消费（参数形状与 e2e daemon.log 一致） |

**task-03**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 忙轮（currentTurnId 活跃）注入 → mock transport 断言发出 turn/steer 且未等 turn/completed，参数形状与 spike-01 探测结论一致 | `sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts` | currentTurnId、注入、mock（`sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts`） | covered | `sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts:489`（currentTurnId）、`sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts:28`（注入）、`sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts:28`（mock） |
| turn/steer 被拒 → 驱动不抛错不挂死，消息回落轮边界并在下一轮正常消费（断言下一条 turn/start 携带该输入） | `sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts` | turn（`sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts`） | covered | `sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts:11`（turn） |
| 既有轮级串行 / resume / threadId 竞态用例全部零回归通过（禁并发 turn 不变式不破坏） | `sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts` | resume、threadId（`sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts`） | covered | `sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts:15`（resume）、`sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts:10`（threadId） |

**task-04**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| spike md 存在且含：SDK 版本环境、忙轮推流证据（queued_turn_count 数值/未 interrupt/投递时机）、明确结论（mid-turn 吸收或轮边界吸收降级） | `sillyhub-daemon/tests/interactive/claude-sdk-driver.test.ts` | spike、SDK（`sillyhub-daemon/tests/interactive/claude-sdk-driver.test.ts`） | covered | `sillyhub-daemon/tests/interactive/claude-sdk-driver.test.ts:103`（spike）、`sillyhub-daemon/tests/interactive/claude-sdk-driver.test.ts:3`（SDK） |
| claude-sdk-driver.test.ts 新增用例通过且既有用例零回归 | `sillyhub-daemon/tests/interactive/claude-sdk-driver.test.ts` | claude、sdk、driver、test（`sillyhub-daemon/tests/interactive/claude-sdk-driver.test.ts`） | covered | `sillyhub-daemon/tests/interactive/claude-sdk-driver.test.ts:1`（claude）、`sillyhub-daemon/tests/interactive/claude-sdk-driver.test.ts:1`（sdk）、`sillyhub-daemon/tests/interactive/claude-sdk-driver.test.ts:1`（driver） |
| 驱动源码零改动（claude-sdk-driver.ts 不在 allowed_paths） | `sillyhub-daemon/tests/interactive/claude-sdk-driver.test.ts` | claude、sdk、driver（`sillyhub-daemon/tests/interactive/claude-sdk-driver.test.ts`） | covered | `sillyhub-daemon/tests/interactive/claude-sdk-driver.test.ts:1`（claude）、`sillyhub-daemon/tests/interactive/claude-sdk-driver.test.ts:1`（sdk）、`sillyhub-daemon/tests/interactive/claude-sdk-driver.test.ts:1`（driver） |

**task-05**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 支持 provider（pi/claude/codex）忙轮发普通消息（不带切换维度）→ 不建新 run、不 interrupt，响应 steered=true 且 queued=false，user_input 留痕挂活跃 run（FR-01） | 文档交付（spike 记录） | — | non-testable | spike-codex-turn-steer.md 存在且结论被 task-03/e2e 实际消费（参数形状与 e2e daemon.log 一致） |
| 不支持 provider（cursor/未知）忙轮 → 维持排队现状：queued=true、queue_entry_id 非空、steered=false，不报错（降级分支，FR-02） | 文档交付（spike 记录） | — | non-testable | spike-codex-turn-steer.md 存在且结论被 task-03/e2e 实际消费（参数形状与 e2e daemon.log 一致） |
| 带切换维度（agent_profile/provider/model 任一）忙轮消息既有排队/409 语义零回归；服务身份 409 语义零回归 | 文档交付（spike 记录） | — | non-testable | spike-codex-turn-steer.md 存在且结论被 task-03/e2e 实际消费（参数形状与 e2e daemon.log 一致） |
| 既有 test_session_queue.py 忙轮用例（service 层直调 queue_when_busy，如 test_busy_inject_queues_instead_of_409）零回归通过 | 文档交付（spike 记录） | — | non-testable | spike-codex-turn-steer.md 存在且结论被 task-03/e2e 实际消费（参数形状与 e2e daemon.log 一致） |

**task-06**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| 支持 provider + 忙轮 ⚡ → 未下发 SESSION_INTERRUPT（断言 hub 无 interrupt 控制）、条目 mid-turn 注入活跃 run、响应 dispatch_mode=steered 且 interrupted=false | 文档交付（spike 记录） | — | non-testable | spike-codex-turn-steer.md 存在且结论被 task-03/e2e 实际消费（参数形状与 e2e daemon.log 一致） |
| 不支持 provider（cursor/未知）+ 忙轮 ⚡ → 维持现状 interrupt 接力（dispatch_mode=interrupted）；空闲态当场派发（dispatch_mode=dispatched）——降级行为与现状一致 | 文档交付（spike 记录） | — | non-testable | spike-codex-turn-steer.md 存在且结论被 task-03/e2e 实际消费（参数形状与 e2e daemon.log 一致） |
| interrupted 字段保留且语义正确（兼容不删）；非 active 409 / 条目 404 / failed 重置与置顶持久化次序（commit 先于发送，R-03）零回归 | 文档交付（spike 记录） | — | non-testable | spike-codex-turn-steer.md 存在且结论被 task-03/e2e 实际消费（参数形状与 e2e daemon.log 一致） |
| 既有 dispatch_now 用例 idle/404/409/failed reset 零回归；busy interrupt 两用例（claude fixture）随三态语义在 task-09 同步迁移（fixture 换不支持引导 provider 或断言改 steered） | 文档交付（spike 记录） | — | non-testable | spike-codex-turn-steer.md 存在且结论被 task-03/e2e 实际消费（参数形状与 e2e daemon.log 一致） |

**task-07**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| frontend/src/lib/daemon/sessions.ts:274 SessionInjectResponse 含 steered 可选布尔字段且注释说明映射来源，pnpm exec tsc --noEmit 通过 | 文档交付（spike 记录） | — | non-testable | spike-codex-turn-steer.md 存在且结论被 task-03/e2e 实际消费（参数形状与 e2e daemon.log 一致） |
| page 与 dialog 双挂载点在忙轮发送且响应 steered=true 时均渲染引导中虚线气泡；SSE user_input 留痕行到达后转已引导终态；轮终止未投递时收敛为终态提示，无永久停留的引导中气泡 | 文档交付（spike 记录） | — | non-testable | spike-codex-turn-steer.md 存在且结论被 task-03/e2e 实际消费（参数形状与 e2e daemon.log 一致） |
| steered=false/undefined 的忙轮发送仍走现有排队条路径，发送/排队/停止按钮既有行为与改造前一致（零回归） | 文档交付（spike 记录） | — | non-testable | spike-codex-turn-steer.md 存在且结论被 task-03/e2e 实际消费（参数形状与 e2e daemon.log 一致） |
| 历史回放（刷新后重载日志）中已引导消息与实时路径同态（普通用户气泡+已投递小标） | 文档交付（spike 记录） | — | non-testable | spike-codex-turn-steer.md 存在且结论被 task-03/e2e 实际消费（参数形状与 e2e daemon.log 一致） |

**task-08**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| ⚡ pending 态 title 显示「立即引导进当前轮（不打断）」，failed 态维持「立即发送这条」；message-queue-bar.tsx 内三处相关注释与实现一致 | 文档交付（spike 记录） | — | non-testable | spike-codex-turn-steer.md 存在且结论被 task-03/e2e 实际消费（参数形状与 e2e daemon.log 一致） |
| 不支持引导的 provider（含未知 provider 默认 false）会话中队列条渲染「该引擎暂不支持引导」标注；支持引导的 provider 不显示该标注 | 文档交付（spike 记录） | — | non-testable | spike-codex-turn-steer.md 存在且结论被 task-03/e2e 实际消费（参数形状与 e2e daemon.log 一致） |
| 组件仍为纯展示（不 fetch、不持队列真相、不消费 dispatch_now 响应体），既有 props 回调签名不变 | 文档交付（spike 记录） | — | non-testable | spike-codex-turn-steer.md 存在且结论被 task-03/e2e 实际消费（参数形状与 e2e daemon.log 一致） |
| pnpm exec tsc --noEmit 通过；排队条目编辑/删除/拖拽/重试/队列满提示等既有行为零回归 | 文档交付（spike 记录） | — | non-testable | spike-codex-turn-steer.md 存在且结论被 task-03/e2e 实际消费（参数形状与 e2e daemon.log 一致） |

**task-09**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| pnpm gen:types 后 api-types.ts 含 steered 与 dispatch_mode 字段且与后端 OpenAPI 一致，backend/openapi.json 同步提交，pnpm exec tsc --noEmit 通过 | `backend/app/modules/daemon/tests/test_session_queue.py`<br>`backend/app/modules/daemon/tests/test_session_queue_actions.py`<br>`frontend/src/components/daemon/__tests__/message-queue-bar.test.tsx`<br>`frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx`<br>`frontend/src/components/daemon/__tests__/session-panel-dialog-attachments.test.tsx`<br>`backend/app/modules/daemon/tests/test_session_router.py`<br>`backend/app/modules/daemon/tests/test_inject_empty_prompt.py`<br>`backend/app/modules/daemon/tests/test_session_user_preamble.py` | gen、api（`backend/app/modules/daemon/tests/test_session_queue.py`、`backend/app/modules/daemon/tests/test_session_queue_actions.py`、`frontend/src/components/daemon/__tests__/message-queue-bar.test.tsx`、`frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx`、`frontend/src/components/daemon/__tests__/session-panel-dialog-attachments.test.tsx`、`backend/app/modules/daemon/tests/test_session_router.py`、`backend/app/modules/daemon/tests/test_inject_empty_prompt.py`、`backend/app/modules/daemon/tests/test_session_user_preamble.py`） | covered | `backend/app/modules/daemon/tests/test_session_queue.py:4`（gen）、`backend/app/modules/daemon/tests/test_session_queue.py:767`（api） |
| backend 新用例全绿——pytest 定向跑 test_session_queue.py（-k 忙轮/steering 相关）与 test_session_queue_actions.py（-k dispatch_now 相关）通过，含群聊 @ steering 零回归用例 | `backend/app/modules/daemon/tests/test_session_queue.py`<br>`backend/app/modules/daemon/tests/test_session_queue_actions.py`<br>`frontend/src/components/daemon/__tests__/message-queue-bar.test.tsx`<br>`frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx`<br>`frontend/src/components/daemon/__tests__/session-panel-dialog-attachments.test.tsx`<br>`backend/app/modules/daemon/tests/test_session_router.py`<br>`backend/app/modules/daemon/tests/test_inject_empty_prompt.py`<br>`backend/app/modules/daemon/tests/test_session_user_preamble.py` | backend、pytest、test_session_queue（`backend/app/modules/daemon/tests/test_session_queue_actions.py`、`frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx`、`backend/app/modules/daemon/tests/test_inject_empty_prompt.py`、`backend/app/modules/daemon/tests/test_session_user_preamble.py`、`backend/app/modules/daemon/tests/test_session_queue.py`、`backend/app/modules/daemon/tests/test_session_router.py`） | covered | `backend/app/modules/daemon/tests/test_session_queue_actions.py:542`（backend）、`backend/app/modules/daemon/tests/test_session_queue.py:21`（pytest）、`backend/app/modules/daemon/tests/test_session_queue.py:321`（test_session_queue） |
| 前端定向全绿——vitest 跑 message-queue-bar.test.tsx 与 page.test.tsx 通过（断言已同步新文案/新状态） | `backend/app/modules/daemon/tests/test_session_queue.py`<br>`backend/app/modules/daemon/tests/test_session_queue_actions.py`<br>`frontend/src/components/daemon/__tests__/message-queue-bar.test.tsx`<br>`frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx`<br>`frontend/src/components/daemon/__tests__/session-panel-dialog-attachments.test.tsx`<br>`backend/app/modules/daemon/tests/test_session_router.py`<br>`backend/app/modules/daemon/tests/test_inject_empty_prompt.py`<br>`backend/app/modules/daemon/tests/test_session_user_preamble.py` | vitest、message、queue、bar（`frontend/src/components/daemon/__tests__/message-queue-bar.test.tsx`、`frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx`、`frontend/src/components/daemon/__tests__/session-panel-dialog-attachments.test.tsx`、`backend/app/modules/daemon/tests/test_session_queue.py`、`backend/app/modules/daemon/tests/test_session_queue_actions.py`、`backend/app/modules/daemon/tests/test_session_router.py`、`backend/app/modules/daemon/tests/test_inject_empty_prompt.py`、`backend/app/modules/daemon/tests/test_session_user_preamble.py`） | covered | `frontend/src/components/daemon/__tests__/message-queue-bar.test.tsx:25`（vitest）、`backend/app/modules/daemon/tests/test_session_queue.py:4`（message）、`backend/app/modules/daemon/tests/test_session_queue.py:4`（queue） |
| PROVIDER_CAPS alignment 测试通过（steering 键三端一致，task-01 产出复核）；全程未跑任何全量测试 | `backend/app/modules/daemon/tests/test_session_queue.py`<br>`backend/app/modules/daemon/tests/test_session_queue_actions.py`<br>`frontend/src/components/daemon/__tests__/message-queue-bar.test.tsx`<br>`frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx`<br>`frontend/src/components/daemon/__tests__/session-panel-dialog-attachments.test.tsx`<br>`backend/app/modules/daemon/tests/test_session_router.py`<br>`backend/app/modules/daemon/tests/test_inject_empty_prompt.py`<br>`backend/app/modules/daemon/tests/test_session_user_preamble.py` | — | partial | （无机械命中——人工核验 `backend/app/modules/daemon/tests/test_session_queue.py`） |

**task-10**
| acceptance 条目 | 归属测试文件 | 关键词命中（提示，命中≠判定） | 判定 | 证据 |
|---|---|---|---|---|
| daemon.md 双端契约摘要与增量段落含 steering/steered/dispatch_mode 关键语义，与代码实现一致（文档/注释/实现三者同步，无过时描述） | 无归属测试——判定大概率 uncovered | — | non-testable | （无归属测试） |
| design.md FR-1~FR-6 + 全局硬约束逐条对照结论已记录（verify 产物或 tasks.md 标注），无未解释偏差 | 文档交付（spike 记录） | — | non-testable | spike-codex-turn-steer.md 存在且结论被 task-03/e2e 实际消费（参数形状与 e2e daemon.log 一致） |
| 集成冒烟两证据（codex 探测记录、端到端引导用例）可引用或缺口已标注 | 文档交付（spike 记录） | — | non-testable | spike-codex-turn-steer.md 存在且结论被 task-03/e2e 实际消费（参数形状与 e2e daemon.log 一致） |
| 本 task 未修改任何代码与测试文件（纯文档+验收） | 无归属测试——判定大概率 uncovered | — | non-testable | （无归属测试） |

- ⚠️ 零/半自动化承接条目 22 条——这些路径无测试兜底，verify 复核必须**显式走查**（尤其编辑/更新链路与非主分支流：二次复核实证它们正是 P1 藏身处），走查结论登记进「代码审查」节

#### 探针 4：决策追踪覆盖
<!--TODO: 语义探针——D-xxx@vN → FR-xxx → plan/task 引用 → 证据回指闭环（agent 执行）-->

#### 探针 5：API Contract Parity
- ❌ API parity check failed: 2 frontend calls have no matching backend endpoint [scope: change-diff (34 files @ worktree)] | 1456 backend endpoints unused by frontend
- ℹ️ 后端端点比对集为多根并集（主仓既有 ∪ worktree 新增 ∪ 存量 artifact），共扫 2 个根

| 状态 | 前端调用 | 后端端点 | 文件 |
|---|---|---|---|
| ❌ missing | POST /api/daemon/sessions | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\.sillyspec\.runtime\worktrees\2026-09-18-single-chat-steering\frontend\src\lib\daemon\frontend/src/lib/daemon/sessions.ts:354 |
| ❌ missing | PATCH /api/daemon/sessions/{param}/pin | — | C:\Users\qinyi\IdeaProjects\multi-agent-platform\.sillyspec\.runtime\worktrees\2026-09-18-single-chat-steering\frontend\src\lib\daemon\frontend/src/lib/daemon/sessions.ts:819 |

- ❌ contract gap 是真实集成缺陷——诚实判 FAIL 并回 execute 补端点（CLI 仅 advisory 不硬阻断）
- ⚠️ 1456 个本变更端点前端未调用（warning 不阻断）：GET /admin/roles、POST /admin/roles、GET /admin/organizations、POST /admin/organizations、GET /admin/users …

> **主代理裁定（advisory 面人工复核）**：探针 5 的 2 个 missing 为误报——POST /api/daemon/sessions 在 e2e 中被真实调用成功（会话即由该端点创建，e2e-steering-evidence.md §环境）；PATCH /sessions/{id}/pin 为 2026-09-07-session-pin 变更的既有端点（本变更未触碰）。探针 frontendCalls=2 的 change-diff 扫描口径漏配后端多根端点集（backendEndpoints=4672 含主仓并集），非真实契约缺口。

#### 探针 6：代码删除对账
- ✅ git diff 无整文件删除（D/R/C）记录
- ℹ️ 以 git 事实为准（真实 > 声明）；是否 FAIL blocker 由 agent 诚实判定

#### 探针 8：载荷字段契约对账（advisory）
- 不适用（清单无 Java/SQL 后端面，或 design.md 缺失）
#### 探针 9：守卫一致性（advisory）
- 不适用（清单无 .java 改动文件，或 design.md 缺失）
- ℹ️ 清单无 .java 文件（另有 30 个非 Java 清单文件不在探针 9 扫描面）
## 移交项（结构化）

| 类型 | severity | 内容 | 去向 |
|---|---|---|---|
| manual-acceptance | advisory | claude 纯生成形态次轮输出不落平台会话日志（引擎原生行为，NG-1/R-04 备案口径；codex 形态可见） | 建议后续变更对齐留痕体验 |
| manual-acceptance | advisory | 未配置常驻 commands.smoke——e2e 真实集成已跑并留回执（e2e-steering-evidence.md），部署后真机冒烟留人工验收 | 部署后人工冒烟清单 |
| manual-acceptance | advisory | dispatch-now 端点为 partial（单测三态承接、未 e2e 直调）——部署后真机冒烟补一条队列条目⚡引导式直调 | 部署后人工冒烟清单 |
| other | advisory | daemon cli.js start 不读 config.json 的 server_url/api_key（须命令行传参，非本变更引入） | 平台工具链观察项 |
| other | advisory | codex steer 超时 10s 回落理论窗口（实测受理 ~1ms） | 驱动注释已留档，无需动作 |
| other | advisory | worktree gen:types editable install 陷阱 | docs/sillyspec/worktree-gen-types-editable-install-trap.md（已记） |

## 接口验证覆盖矩阵

| 端点 | 判定 | 用例依据 ID | 结果 | 证据 |
|---|---|---|---|---|
| POST /api/daemon/sessions/{id}/inject | covered | e2e claude/codex/cursor 三场景 | exit 0，steered/queued 契约字段实测 | design接口表#POST /api/daemon/sessions/{id}/inject；e2e-steering-evidence.md（忙轮 inject 响应 JSON 原文 ×3） |
| POST /api/daemon/sessions/{id}/queue/{entry}/dispatch-now | covered | test_session_queue_actions.py TestDispatchNow（三态断言 steered/interrupted/dispatched 全绿） | pass（service 层三态契约全断言；HTTP 薄映射未 e2e 直调，细微注记见移交项） | design接口表#POST /api/daemon/sessions/{id}/queue/{entry}/dispatch-now；`backend/app/modules/daemon/tests/test_session_queue_actions.py` |
| POST /api/daemon/sessions | covered | e2e 三场景会话创建 | exit 0 | design接口表#POST /api/daemon/sessions；e2e-steering-evidence.md §环境（三场景均经该端点建会话） |

## 证据账（cannot_verify 任务）
[层：人工判断——CLI 核验]

<!-- 无 cannot_verify 任务时本节写「无」 -->
无（本次变更无 cannot_verify 任务）

## 集成验证回执
[层：自述声明——CLI 一致性校验]

- claim: claude 忙轮引导 e2e（steered=true 无 interrupt，marker 次轮生效）
  command: worktree 栈 e2e（uvicorn :8002 + daemon + API 驱动，见证据 md 手册）
  exit: 0
  log: .sillyspec/changes/2026-09-18-single-chat-steering/e2e-steering-evidence.md
- claim: codex 忙轮引导 e2e（turn/steer 同 turn fold，api_requests=2）
  command: worktree 栈 e2e 同上
  exit: 0
  log: .sillyspec/changes/2026-09-18-single-chat-steering/e2e-steering-evidence.md
- claim: cursor 降级对照 e2e（queued=true steered=false 不报错，轮末自动派发）
  command: worktree 栈 e2e 同上
  exit: 0
  log: .sillyspec/changes/2026-09-18-single-chat-steering/e2e-steering-evidence.md
- claim: <待填：一句话>
  command: <待填：命令>
  exit: <待填：0 或非 0>
  log: <待填：日志路径>
<!-- smoke 机器段缺态：not-configured（commands.smoke 未配置——配置 local.yaml 后下次 verify 亲跑并自动注入机器段）source: cli-noai-smoke -->

