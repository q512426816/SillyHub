---
author: sillyspec-fr-index
created_at: 2026-10-08T15:19:22.662Z
---

# FR 索引 — auto-sillyhub-daemon

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 伪域（auto- 前缀）：由文件路径段投票派生，无模块卡——为该域补模块卡后，新变更将自动落回真域

## FR-auto-sillyhub-daemon-021 git-log-page.test.tsx TABS 数量钉 15→16（用例名+头注释同步），该文件全绿
变更：2026-10-08-ci-sweep-2
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given WorkspaceTabs 注册 16 键（知识图谱插知识库后）/ When 渲染取 link / Then toHaveLength(16) 且 Git 日志
全文：.sillyspec/changes/archive/2026-10-08-ci-sweep-2/requirements.md#FR-01
最近确认：97c6598b93fd8f805dda5ab1c3f94386881a116b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-08-ci-sweep-2:flow:测试绑定FR-01
  tests: frontend/src/components/git-log/__tests__/git-log-page.test.tsx「TABS 增至 16 项，「Git 日志」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-ci-sweep-2
  status: active

## FR-auto-sillyhub-daemon-022 test_cleanup_stale_runs_error_code.py error_detail 期望改新文案（reason=no daemon activity within grace window (startup cleanup / deferred recheck)/finished_by=stale_run_cleanup），全绿
变更：2026-10-08-ci-sweep-2
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 无可恢复元数据的 stale run / When _cleanup_stale_runs_impl 执行 / Then error_detail 等于新文案两
全文：.sillyspec/changes/archive/2026-10-08-ci-sweep-2/requirements.md#FR-02
最近确认：97c6598b93fd8f805dda5ab1c3f94386881a116b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-08-ci-sweep-2:flow:测试绑定FR-02
  tests: backend/app/modules/agent/tests/test_cleanup_stale_runs_error_code.py「test_stale_run_failed_branch_writes_error_code」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-ci-sweep-2
  status: active

## FR-auto-sillyhub-daemon-023 sillyspec-platform-command.test.ts 6 处与 selfupdate-scenarios.test.ts 2 处 length 断言 10→11（带 task-02 machine-id 尾参注释，同 daemon-heartbeat 先例），全绿
变更：2026-10-08-ci-sweep-2
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 心跳 11 参平铺（第 11 machineId，undefined 占位）/ When 断言 call.length / Then toBe(11) 且第 7
全文：.sillyspec/changes/archive/2026-10-08-ci-sweep-2/requirements.md#FR-03
最近确认：97c6598b93fd8f805dda5ab1c3f94386881a116b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-08-ci-sweep-2:flow:测试绑定FR-03
  tests: sillyhub-daemon/tests/integration/selfupdate-scenarios.test.ts「路径④ pending 可见性闭环」 | sillyhub-daemon/tests/sillyspec-platform-command.test.ts「task-07 心跳携带…」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-ci-sweep-2
  status: active

## FR-auto-sillyhub-daemon-024 provider-adapter-registry.test.ts readBackendAgentKindVocab 正则改 agent_kinds 复数 list Literal 形态（注释锚同步），对账恢复夹逼语义，全绿
变更：2026-10-08-ci-sweep-2
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given backend schema 字段为复数 list Literal / When readBackendAgentKindVocab 解析 / Then 词表=
全文：.sillyspec/changes/archive/2026-10-08-ci-sweep-2/requirements.md#FR-04
最近确认：97c6598b93fd8f805dda5ab1c3f94386881a116b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-08-ci-sweep-2:flow:测试绑定FR-04
  tests: sillyhub-daemon/tests/provider-adapter-registry.test.ts「backend agent_kind 词表（源读取解析）⊆ 聚合表键（backend 可下发 kind 必有声明）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-ci-sweep-2
  status: active

## FR-auto-sillyhub-daemon-025 本地仅跑相关测试文件全绿（全量留 CI），推送后 frontend-ci/backend-ci/daemon-ci/e2e-ci/scan-drift 全绿
变更：2026-10-08-ci-sweep-2
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 修复落地 / When 本地相关面跑测 / Then 全绿；When push / When 五 workflow 完成 / Then 全部 success。
全文：.sillyspec/changes/archive/2026-10-08-ci-sweep-2/requirements.md#FR-05
最近确认：97c6598b93fd8f805dda5ab1c3f94386881a116b

## FR-auto-sillyhub-daemon-026 tests/protocol-session-contract.test.ts MSG 总数钉 24→25（补 TOMBSTONE_CLEANUP 来历注释），定向 vitest 绿
变更：2026-10-11-daemon-masked-test-fix
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-11-daemon-masked-test-fix/requirements.md#FR-01
最近确认：2e2f4cc17fdda1c14c1bb12669c2e8ac1d0e927b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-11-daemon-masked-test-fix:flow:测试绑定FR-01
  tests: sillyhub-daemon/tests/protocol-session-contract.test.ts「MSG 总数 = 25」
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 004af2936041cba741bbce9afef8a46a6e412c9c
  source_change: 2026-10-11-daemon-masked-test-fix
  status: active

## FR-auto-sillyhub-daemon-027 tests/fixtures/claude-sdk-messages/golden-session.events.json 帧 7/15/29 补 usage.api_duration_ms（500/1100/400）+ 头注再生成记录 + §2 锚点两处同步，定向 vitest 绿
变更：2026-10-11-daemon-masked-test-fix
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-11-daemon-masked-test-fix/requirements.md#FR-02
最近确认：2e2f4cc17fdda1c14c1bb12669c2e8ac1d0e927b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-11-daemon-masked-test-fix:flow:测试绑定FR-02
  tests: sillyhub-daemon/tests/interactive/golden/claude-events-golden.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 004af2936041cba741bbce9afef8a46a6e412c9c
  source_change: 2026-10-11-daemon-masked-test-fix
  status: active

## FR-auto-sillyhub-daemon-028 tests/daemon-mission-worker-artifact.test.ts 兜底代报载体 pi→codex（caps.mcp 仍 false，机制断言原样保留）+ 新增 pi 零代报钉子（自报路径防双写），定向 vitest 绿
变更：2026-10-11-daemon-masked-test-fix
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-11-daemon-masked-test-fix/requirements.md#FR-03
最近确认：2e2f4cc17fdda1c14c1bb12669c2e8ac1d0e927b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-11-daemon-masked-test-fix:flow:测试绑定FR-03
  tests: sillyhub-daemon/tests/daemon-mission-worker-artifact.test.ts「mission_worker + codex(mcp=false) + success + 全文非空 → 恰一次代报」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-11-daemon-masked-test-fix
  status: active

## FR-auto-sillyhub-daemon-029 daemon typecheck 过；不跑全量（规则 0），全量留给 CI
变更：2026-10-11-daemon-masked-test-fix
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-11-daemon-masked-test-fix/requirements.md#FR-04
最近确认：2e2f4cc17fdda1c14c1bb12669c2e8ac1d0e927b

## FR-auto-sillyhub-daemon-030 工作区行的 name/slug/display_alias 与真实代码目录行的 root_path 均套既有 truncateText（500 阈值+省略标注），行为与既有三字段逐字一致；type/default_branch 等 backend 受约束短字段不在本变更面
变更：2026-10-12-borrow-ctx-truncate-rest
状态：active
摘要：超长字段截断；边界不截
全文：.sillyspec/changes/archive/2026-10-12-borrow-ctx-truncate-rest/requirements.md#FR-01
最近确认：1cb57618a2cc9c6535c086946005b29ca8938cf0

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-borrow-ctx-truncate-rest:flow:测试绑定FR-01
  tests: sillyhub-daemon/tests/borrow-sandbox-context.test.ts「name/slug/display_alias/root_path 超 500 截断（2026-10-12-borrow-ctx-truncate-rest，防线覆盖剩余自由文本字段）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-borrow-ctx-truncate-rest
  status: active

## FR-auto-sillyhub-daemon-031 新增用例先红后绿：name>500/root_path>500/三者并存超 500/边界 500 恰好不截（对齐既有用例形态）；既有用例全绿
变更：2026-10-12-borrow-ctx-truncate-rest
状态：active
摘要：先红后绿
全文：.sillyspec/changes/archive/2026-10-12-borrow-ctx-truncate-rest/requirements.md#FR-02
最近确认：1cb57618a2cc9c6535c086946005b29ca8938cf0

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-borrow-ctx-truncate-rest:flow:测试绑定FR-02
  tests: sillyhub-daemon/tests/borrow-sandbox-context.test.ts「name/slug/display_alias/root_path 超 500 截断（2026-10-12-borrow-ctx-truncate-rest，防线覆盖剩余自由文本字段）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-borrow-ctx-truncate-rest
  status: active

## FR-auto-sillyhub-daemon-032 生产代码零新增防御原语（复用 truncateText），模块头注安全语义段同步
变更：2026-10-12-borrow-ctx-truncate-rest
状态：active
摘要：单一实现核验
全文：.sillyspec/changes/archive/2026-10-12-borrow-ctx-truncate-rest/requirements.md#FR-03
最近确认：1cb57618a2cc9c6535c086946005b29ca8938cf0

## FR-auto-sillyhub-daemon-033 仅跑本改动相关测试（规则 0）：sillyhub-daemon/tests/borrow-sandbox-context.test.ts 全文件
变更：2026-10-12-borrow-ctx-truncate-rest
状态：active
摘要：相关面回归
全文：.sillyspec/changes/archive/2026-10-12-borrow-ctx-truncate-rest/requirements.md#FR-04
最近确认：1cb57618a2cc9c6535c086946005b29ca8938cf0

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-borrow-ctx-truncate-rest:flow:测试绑定FR-04
  tests: sillyhub-daemon/tests/borrow-sandbox-context.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-borrow-ctx-truncate-rest
  status: active

## FR-auto-sillyhub-daemon-034 daemon 侧 task_notification 到达但内存注册表无对应条目时,不再静默丢弃:尽力归属到会话并照常上报终态事件,有日志可查
变更：2026-10-13-agent-task-stuck-running
状态：active
摘要：task_started 帧丢失、注册表仅剩 tool_use 派生的别名条目；三无孤儿终态（注册表缺失且无在跑 runId）
全文：.sillyspec/changes/archive/2026-10-13-agent-task-stuck-running/requirements.md#FR-01
最近确认：4cc145d9dd4e9cebe7d743be0cb5d4c7ec5cf10e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-agent-task-stuck-running:flow:测试绑定FR-01
  tests: sillyhub-daemon/tests/interactive/claude-events.test.ts「Task/Agent tool_use 派生 agent_task_status 必带 tool_use_id」 | sillyhub-daemon/tests/interactive/task-lifecycle.test.ts「task_notification 别名条目补发终态/静默注销/三无 WARN 日志」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-agent-task-stuck-running
  status: active

## FR-auto-sillyhub-daemon-035 前端时间线装配对找不到父段的 [TASK_NOTIFICATION] 终态行,按 task_id 兜底匹配既有子代理段吸收终态,派发段不再永久转圈
变更：2026-10-13-agent-task-stuck-running
状态：active
摘要：TASK_NOTIFICATION 行 parent 缺失/错位，派发段在本轮已存在；task_id 也无法命中（任务从未在本轮出现）
全文：.sillyspec/changes/archive/2026-10-13-agent-task-stuck-running/requirements.md#FR-02
最近确认：4cc145d9dd4e9cebe7d743be0cb5d4c7ec5cf10e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-agent-task-stuck-running:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/__tests__/task-line-assembler.test.ts「[TASK_*] parent 未命中按 task_id 兜底反查（FR-02）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-agent-task-stuck-running
  status: active

## FR-auto-sillyhub-daemon-036 为上述两处修复补回归测试,daemon 与 frontend 现有相关测试不回归
变更：2026-10-13-agent-task-stuck-running
状态：active
摘要：回归防线
全文：.sillyspec/changes/archive/2026-10-13-agent-task-stuck-running/requirements.md#FR-03
最近确认：4cc145d9dd4e9cebe7d743be0cb5d4c7ec5cf10e

## FR-auto-sillyhub-daemon-037 daemon edit_patch 上限按 UTF-8 字节判定，CJK 大 patch 超限不附着（新用例覆盖）
变更：2026-10-13-editpatch-p3-cleanup
状态：active
摘要：CJK 字节超限
场景正文：
- 场景：CJK 字节超限 — Given 载体行 structuredPatch 序列化含 30 000 个 CJK 字符（90 000 UTF-8 字节、30 000 字符）；When 解析；Then tool_result 段 edit_patch 缺省 undefined；字节不超限的 CJK patch（10 000 字符=30 000 字节）照常附着
全文：.sillyspec/changes/archive/2026-10-13-editpatch-p3-cleanup/requirements.md#FR-01
最近确认：0263cbbc50af7e9d078a5a325417a09e1af4c128

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-editpatch-p3-cleanup:flow:测试绑定FR-01
  tests: sillyhub-daemon/tests/agent-log/parse-claude-code.test.ts「上限按 UTF-8 字节计（2026-10-13-editpatch-p3-cleanup）：CJK patch 字符数低于 64000 但字节超限 → 不附着；字节不超限 → 附着」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-editpatch-p3-cleanup
  status: active

## FR-auto-sillyhub-daemon-038 agent-log-card 装配测试断言 edit_patch 直连透传到 ToolCallPreview（新用例覆盖）
变更：2026-10-13-editpatch-p3-cleanup
状态：active
摘要：直连防回归
场景正文：
- 场景：直连防回归 — Given 对话化消息含 Write tool_use + 带 edit_patch 的 tool_result（配对成功）；When 展开对话视图渲染；Then Write 卡渲染红删绿增 diff 行与「变更对比（覆盖写入 +N −M）」标题
全文：.sillyspec/changes/archive/2026-10-13-editpatch-p3-cleanup/requirements.md#FR-02
最近确认：0263cbbc50af7e9d078a5a325417a09e1af4c128

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-editpatch-p3-cleanup:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/__tests__/agent-log-card.test.tsx「edit_patch 直连：tool_result 段携带 structuredPatch 时 Write/Edit 卡渲染变更对比 diff」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-editpatch-p3-cleanup
  status: active

## FR-auto-sillyhub-daemon-039 相关 daemon/frontend 测试通过，既有行为零回归
变更：2026-10-13-editpatch-p3-cleanup
状态：active
摘要：回归
场景正文：
- 场景：回归 — Given daemon agent-log 全套与 frontend agent-log-card/agent-log/tool-args-detail 套件；When 全部运行；Then 全绿 + daemon typecheck 零错误
全文：.sillyspec/changes/archive/2026-10-13-editpatch-p3-cleanup/requirements.md#FR-03
最近确认：0263cbbc50af7e9d078a5a325417a09e1af4c128

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-editpatch-p3-cleanup:flow:测试绑定FR-03
  tests: frontend/src/components/agent-log/__tests__/tool-renderers-write-diff.test.tsx | frontend/src/components/daemon/__tests__/agent-log-card.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-editpatch-p3-cleanup
  status: active
