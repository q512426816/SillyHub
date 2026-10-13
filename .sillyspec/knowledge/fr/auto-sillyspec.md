---
author: sillyspec-fr-index
created_at: 2026-10-08T01:03:54.861Z
---

# FR 索引 — auto-sillyspec

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 伪域（auto- 前缀）：由文件路径段投票派生，无模块卡——为该域补模块卡后，新变更将自动落回真域

## FR-auto-sillyspec-053 service.update() 对 models 做显式 None-pop，与 agent_kinds 既有防护同款对齐
变更：2026-10-08-provider-update-models-none-guard
状态：active
摘要：显式 null 更新
全文：.sillyspec/changes/archive/2026-10-08-provider-update-models-none-guard/requirements.md#FR-01
最近确认：87e292759e4934ec73c9c92152c38de97610509e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-08-provider-update-models-none-guard:flow:测试绑定FR-01
  tests: backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py「TestMultiKindUpdateSemantics::test_explicit_null_models_is_noop」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-provider-update-models-none-guard
  status: active

## FR-auto-sillyspec-054 PATCH body models=null 不再 500，原模型列表保持不变（补回归测试覆盖）
变更：2026-10-08-provider-update-models-none-guard
状态：active
摘要：回归用例双断言
全文：.sillyspec/changes/archive/2026-10-08-provider-update-models-none-guard/requirements.md#FR-02
最近确认：87e292759e4934ec73c9c92152c38de97610509e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-08-provider-update-models-none-guard:flow:测试绑定FR-02
  tests: backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py「TestMultiKindUpdateSemantics::test_explicit_null_models_is_noop」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-provider-update-models-none-guard
  status: active

## FR-auto-sillyspec-055 本模块相关测试文件全绿
变更：2026-10-08-provider-update-models-none-guard
状态：active
摘要：相关面验证
全文：.sillyspec/changes/archive/2026-10-08-provider-update-models-none-guard/requirements.md#FR-03
最近确认：87e292759e4934ec73c9c92152c38de97610509e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-08-provider-update-models-none-guard:flow:测试绑定FR-03
  tests: backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py「全文件」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-provider-update-models-none-guard
  status: active

## FR-auto-sillyspec-056 前端 change-patch.json 文件预览渲染结构化清单面，scopeAudit 子对象在场时叠加对账快照视图，缺席时降级说明
变更：2026-10-09-close-trace-single-set-platform
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-09-close-trace-single-set-platform/requirements.md#FR-01
最近确认：2f6d525155a2b7cd8ec208e77f0f83e5f9a43967

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-close-trace-single-set-platform:flow:测试绑定FR-01
  tests: frontend/src/components/files/__tests__/structured-views.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-close-trace-single-set-platform
  status: active

## FR-auto-sillyspec-057 旧形态归档（四件套/heavy 双件）预览不回归
变更：2026-10-09-close-trace-single-set-platform
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-09-close-trace-single-set-platform/requirements.md#FR-02
最近确认：2f6d525155a2b7cd8ec208e77f0f83e5f9a43967

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-close-trace-single-set-platform:flow:测试绑定FR-02
  tests: frontend/src/components/files/__tests__/structured-views.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-close-trace-single-set-platform
  status: active

## FR-auto-sillyspec-058 tsc --noEmit 通过；change 模块相关测试无新增失败（预存环境错误除外）
变更：2026-10-09-close-trace-single-set-platform
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-09-close-trace-single-set-platform/requirements.md#FR-03
最近确认：2f6d525155a2b7cd8ec208e77f0f83e5f9a43967

## FR-auto-sillyspec-059 清扫只收「最近无心跳」的任务（心跳宽限 + is_async 豁免）
变更：2026-10-11-task-sweep-liveness-guard
状态：active
摘要：后台任务跨轮存活不被误收
全文：.sillyspec/changes/archive/2026-10-11-task-sweep-liveness-guard/requirements.md#FR-01
最近确认：460c2474d9377ddeef2971b481f8a56cd0700b5a

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-11-task-sweep-liveness-guard:flow:测试绑定FR-01
  tests: backend/app/modules/daemon/tests/test_agent_session_tasks.py「test_finalize_sweeps_only_stale_sync」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-11-task-sweep-liveness-guard
  status: active

## FR-auto-sillyspec-060 清扫收口行可被 running 心跳复活（误收自愈）；真实终态行维持吸收
变更：2026-10-11-task-sweep-liveness-guard
状态：active
摘要：误收自愈；真实终态不复活
全文：.sillyspec/changes/archive/2026-10-11-task-sweep-liveness-guard/requirements.md#FR-02
最近确认：460c2474d9377ddeef2971b481f8a56cd0700b5a

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-11-task-sweep-liveness-guard:flow:测试绑定FR-02
  tests: backend/app/modules/daemon/tests/test_agent_session_tasks.py「test_sweep_stopped_row_revives_on_running_heartbeat」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-11-task-sweep-liveness-guard
  status: active

## FR-auto-sillyspec-061 run 收口安排延迟复扫（孤儿不靠重启兜底）
变更：2026-10-11-task-sweep-liveness-guard
状态：active
摘要：新鲜后沉默的孤儿
全文：.sillyspec/changes/archive/2026-10-11-task-sweep-liveness-guard/requirements.md#FR-03
最近确认：460c2474d9377ddeef2971b481f8a56cd0700b5a

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-11-task-sweep-liveness-guard:flow:测试绑定FR-03
  tests: backend/app/modules/daemon/tests/test_agent_session_tasks.py「test_delayed_resweep_catches_now_silent」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-11-task-sweep-liveness-guard
  status: active

## FR-auto-sillyspec-062 既有行为回归
变更：2026-10-11-task-sweep-liveness-guard
状态：active
摘要：回归
全文：.sillyspec/changes/archive/2026-10-11-task-sweep-liveness-guard/requirements.md#FR-04
最近确认：460c2474d9377ddeef2971b481f8a56cd0700b5a

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-11-task-sweep-liveness-guard:flow:测试绑定FR-04
  tests: backend/app/modules/daemon/tests/test_agent_session_tasks.py「test_genuine_stopped_absorbs_running_heartbeat」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-11-task-sweep-liveness-guard
  status: active

## FR-auto-sillyspec-063 tech_stack join 结果超 500 字符时截断加「…（已截断）」标注，与 description 同款
变更：2026-10-11-borrow-ctx-metadata-truncate
状态：active
摘要：超长技术栈数组
全文：.sillyspec/changes/archive/2026-10-11-borrow-ctx-metadata-truncate/requirements.md#FR-01
最近确认：d2dd769513f5d21559927dcda958740a1b4981e8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-11-borrow-ctx-metadata-truncate:flow:测试绑定FR-01
  tests: test/sillyhub-daemon/tests/borrow-sandbox-context.test.ts「tech_stack join 超 500 截断并标注（防线对齐 description）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-11-borrow-ctx-metadata-truncate
  status: active

## FR-auto-sillyspec-064 repo_url 超 500 字符同款截断
变更：2026-10-11-borrow-ctx-metadata-truncate
状态：active
摘要：超长仓库地址
全文：.sillyspec/changes/archive/2026-10-11-borrow-ctx-metadata-truncate/requirements.md#FR-02
最近确认：d2dd769513f5d21559927dcda958740a1b4981e8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-11-borrow-ctx-metadata-truncate:flow:测试绑定FR-02
  tests: test/sillyhub-daemon/tests/borrow-sandbox-context.test.ts「repo_url 超 500 截断并标注」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-11-borrow-ctx-metadata-truncate
  status: active

## FR-auto-sillyspec-065 短字段（≤500）逐字原样（零回归）
变更：2026-10-11-borrow-ctx-metadata-truncate
状态：active
摘要：边界 500
全文：.sillyspec/changes/archive/2026-10-11-borrow-ctx-metadata-truncate/requirements.md#FR-03
最近确认：d2dd769513f5d21559927dcda958740a1b4981e8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-11-borrow-ctx-metadata-truncate:flow:测试绑定FR-03
  tests: test/sillyhub-daemon/tests/borrow-sandbox-context.test.ts「短字段逐字原样与 500 边界不截断」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-11-borrow-ctx-metadata-truncate
  status: active

## FR-auto-sillyspec-066 截断只作用于 tech_stack/repo_url，其余字段零影响 + 渲染幂等不变
变更：2026-10-11-borrow-ctx-metadata-truncate
状态：active
摘要：并存字段
全文：.sillyspec/changes/archive/2026-10-11-borrow-ctx-metadata-truncate/requirements.md#FR-04
最近确认：d2dd769513f5d21559927dcda958740a1b4981e8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-11-borrow-ctx-metadata-truncate:flow:测试绑定FR-04
  tests: test/sillyhub-daemon/tests/borrow-sandbox-context.test.ts「渲染幂等：同一 ctx 两次渲染输出一致（同 slug 沙箱重入安全）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-11-borrow-ctx-metadata-truncate
  status: active

## FR-auto-sillyspec-067 新增截断用例先红后绿，既有用例全绿 + tsc 零错
变更：2026-10-11-borrow-ctx-metadata-truncate
状态：active
摘要：先红后绿
全文：.sillyspec/changes/archive/2026-10-11-borrow-ctx-metadata-truncate/requirements.md#FR-05
最近确认：d2dd769513f5d21559927dcda958740a1b4981e8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-11-borrow-ctx-metadata-truncate:flow:测试绑定FR-05
  tests: test/sillyhub-daemon/tests/borrow-sandbox-context.test.ts「全字段渲染：元信息 + 真实路径只读声明 + 沙箱产出指引 + 文尾数据声明」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-11-borrow-ctx-metadata-truncate
  status: active

## FR-auto-sillyspec-068 runLinkedReposSnapshot 收到相对形态 root_path（如 ws-root、../x）时抛错，不 spawn 任何 CLI
变更：2026-10-11-linked-repos-path-guard
状态：active
摘要：相对形态拒绝
全文：.sillyspec/changes/archive/2026-10-11-linked-repos-path-guard/requirements.md#FR-01
最近确认：3e7f497db56fb37bc8737fd0ef3f02a78dcb27b0

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-11-linked-repos-path-guard:flow:测试绑定FR-01
  tests: test/sillyhub-daemon/tests/linked-repos-snapshot.test.ts「相对形态 root_path 抛错不 spawn CLI」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-11-linked-repos-path-guard
  status: active

## FR-auto-sillyspec-069 runLinkedReposSync 收到相对形态 root_path 时抛错；POSIX / 根、Windows 盘符 C:/、UNC \\srv\share 三种绝对形态均放行
变更：2026-10-11-linked-repos-path-guard
状态：active
摘要：三形态放行 + 相对拒绝
全文：.sillyspec/changes/archive/2026-10-11-linked-repos-path-guard/requirements.md#FR-02
最近确认：3e7f497db56fb37bc8737fd0ef3f02a78dcb27b0

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-11-linked-repos-path-guard:flow:测试绑定FR-02
  tests: test/sillyhub-daemon/tests/linked-repos-sync.test.ts「root_path 三种绝对形态放行 + 相对形态抛错」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-11-linked-repos-path-guard
  status: active

## FR-auto-sillyspec-070 sync 逐仓 rel_path 为绝对形态（/a、C:/a）→ projects_yaml 层 failed（路径非法）且不 spawn
变更：2026-10-11-linked-repos-path-guard
状态：active
摘要：绝对形态 rel_path
全文：.sillyspec/changes/archive/2026-10-11-linked-repos-path-guard/requirements.md#FR-03
最近确认：3e7f497db56fb37bc8737fd0ef3f02a78dcb27b0

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-11-linked-repos-path-guard:flow:测试绑定FR-03
  tests: test/sillyhub-daemon/tests/linked-repos-sync.test.ts「rel_path 绝对形态该层 failed 不 spawn」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-11-linked-repos-path-guard
  status: active

## FR-auto-sillyspec-071 sync 逐仓 abs_path 为相对形态（a/b、../x）→ repos_registry 层 failed 且不 spawn
变更：2026-10-11-linked-repos-path-guard
状态：active
摘要：相对形态 abs_path
全文：.sillyspec/changes/archive/2026-10-11-linked-repos-path-guard/requirements.md#FR-04
最近确认：3e7f497db56fb37bc8737fd0ef3f02a78dcb27b0

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-11-linked-repos-path-guard:flow:测试绑定FR-04
  tests: test/sillyhub-daemon/tests/linked-repos-sync.test.ts「abs_path 相对形态该层 failed 不 spawn」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-11-linked-repos-path-guard
  status: active

## FR-auto-sillyspec-072 合法约定零回归：rel_path '../platform-specs' 兄弟相对路径、abs_path 绝对路径照常 spawn；既有两测试文件全绿
变更：2026-10-11-linked-repos-path-guard
状态：active
摘要：合法 fixture 零回归
全文：.sillyspec/changes/archive/2026-10-11-linked-repos-path-guard/requirements.md#FR-05
最近确认：3e7f497db56fb37bc8737fd0ef3f02a78dcb27b0

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-11-linked-repos-path-guard:flow:测试绑定FR-05
  tests: test/sillyhub-daemon/tests/linked-repos-sync.test.ts「合法约定零回归：兄弟相对路径与绝对本机路径照常 spawn」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-11-linked-repos-path-guard
  status: active

## FR-auto-sillyspec-073 新增校验用例先红后绿 + daemon tsc 零错（Linux CI 兼容：助手不依赖运行平台）
变更：2026-10-11-linked-repos-path-guard
状态：active
摘要：先红后绿
全文：.sillyspec/changes/archive/2026-10-11-linked-repos-path-guard/requirements.md#FR-06
最近确认：3e7f497db56fb37bc8737fd0ef3f02a78dcb27b0

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-11-linked-repos-path-guard:flow:测试绑定FR-06
  tests: test/sillyhub-daemon/tests/linked-repos-snapshot.test.ts「UNC 与 POSIX 绝对形态放行」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-11-linked-repos-path-guard
  status: active

## FR-auto-sillyspec-074 sillyhub-daemon 项目模块图（.sillyspec/docs/sillyhub-daemon/modules/_module-map.yaml）task-runner 模块 paths 补齐目录前缀登记：src/task-runner 包目录 + tests/task-runner 测试目录（前缀匹配制，非 glob）
变更：2026-10-13-daemon-module-map
状态：active
摘要：目录前缀登记
全文：.sillyspec/changes/archive/2026-10-13-daemon-module-map/requirements.md#FR-01
最近确认：44ce2cf6bc6bfec9d2a2ade49c3f92272b6f7451

## FR-auto-sillyspec-075 用 sillyspec 源码 matchedModuleIds 实测：sillyhub-daemon/tests/task-runner/spawn-flush-e2e.test.ts 与 sillyhub-daemon/src/task-runner/spawn-stream.ts 均命中 task-runner 模块（未来变更自动落真域）
变更：2026-10-13-daemon-module-map
状态：active
摘要：路由实测
全文：.sillyspec/changes/archive/2026-10-13-daemon-module-map/requirements.md#FR-02
最近确认：44ce2cf6bc6bfec9d2a2ade49c3f92272b6f7451

## FR-auto-sillyspec-076 fr/auto-sillyhub-daemon.md 的 FR-auto-sillyhub-daemon-034~038 五条目整体迁出，fr/task-runner.md 以 FR-task-runner-016~020 接续编号原样承接（变更/状态/摘要/全文/最近确认/测试绑定逐字段保持）
变更：2026-10-13-daemon-module-map
状态：active
摘要：原样承接
全文：.sillyspec/changes/archive/2026-10-13-daemon-module-map/requirements.md#FR-03
最近确认：44ce2cf6bc6bfec9d2a2ade49c3f92272b6f7451

## FR-auto-sillyspec-077 sillyspec knowledge validate 通过、knowledge digest 伪域信号卡中 auto-sillyhub-daemon 待迁计数相应下降
变更：2026-10-13-daemon-module-map
状态：active
摘要：工具自检
全文：.sillyspec/changes/archive/2026-10-13-daemon-module-map/requirements.md#FR-04
最近确认：44ce2cf6bc6bfec9d2a2ade49c3f92272b6f7451

## FR-auto-sillyspec-078 不改任何 src 代码与归档件；sillyhub-daemon/backend 不需要跑测试（纯知识面变更）
变更：2026-10-13-daemon-module-map
状态：active
摘要：变更面约束
全文：.sillyspec/changes/archive/2026-10-13-daemon-module-map/requirements.md#FR-05
最近确认：44ce2cf6bc6bfec9d2a2ade49c3f92272b6f7451
