---
author: sillyspec-fr-index
created_at: 2026-10-02T02:55:12.745Z
---

# FR 索引 — change

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 模块卡：modules/change.md（域=模块 id 同构；行为条目↔模块契约互跳）

## FR-auto-sillyspec-040 「任务注册表（Tasks）— <变更名>」「设计记录（Design Record）— <变更名>」「
变更：2026-10-02-title-norm-thin-h1-family
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 「任务注册表（Tasks）— <变更名>」「设计记录（Design Record）— <变更名>」「决策记录（Decisions）— <变更名>」「验证回执（f；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-10-02-title-norm-thin-h1-family/requirements.md#FR-01
最近确认：c854d89601d8529ac2d1e883f41972b287a89a27

## FR-auto-sillyspec-041 is_fallback_display_title 对上述 raw 模板标题判 True（存量污染行
变更：2026-10-02-title-norm-thin-h1-family
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When is_fallback_display_title 对上述 raw 模板标题判 True（存量污染行可被后续推送/reparse 自愈刷新）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-10-02-title-norm-thin-h1-family/requirements.md#FR-02
最近确认：c854d89601d8529ac2d1e883f41972b287a89a27

## FR-auto-sillyspec-042 收养语义标题在 thin 模板四件套 documents 推送后不回翻
变更：2026-10-02-title-norm-thin-h1-family
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 收养语义标题在 thin 模板四件套 documents 推送后不回翻；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-10-02-title-norm-thin-h1-family/requirements.md#FR-03
最近确认：c854d89601d8529ac2d1e883f41972b287a89a27

## FR-auto-sillyspec-043 既有词表条目与冒号自定义标题行为不变
变更：2026-10-02-title-norm-thin-h1-family
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 既有词表条目与冒号自定义标题行为不变；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-10-02-title-norm-thin-h1-family/requirements.md#FR-04
最近确认：c854d89601d8529ac2d1e883f41972b287a89a27

## FR-auto-sillyspec-044 backend test_title_normalization.py 新增用例全绿且既有用例无回归
变更：2026-10-02-title-norm-thin-h1-family
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When backend test_title_normalization.py 新增用例全绿且既有用例无回归；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-10-02-title-norm-thin-h1-family/requirements.md#FR-05
最近确认：c854d89601d8529ac2d1e883f41972b287a89a27

## FR-change-001 后端 _FILES_REFRESH_SYNC_RPC_TIMEOUT_S 从 3s 放宽到 15s（覆盖实测 6~13.5s 同步耗时）
变更：2026-10-16-change-files-sync-result
状态：active
摘要：真实同步在预算内完成；超预算仍降级不阻断
全文：.sillyspec/changes/archive/2026-10-16-change-files-sync-result/requirements.md#FR-01
最近确认：7ca3e7ba66d5d065715a08ea885d064b2617e3e9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-change-files-sync-result:flow:测试绑定FR-01
  tests: backend/app/modules/change/tests/test_files_refresh_sync.py「test_sync_budget_covers_measured_cli_runtime」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-change-files-sync-result
  status: active

## FR-change-002 后端消费 sillyspec_sync_change 回执：ok:false/超时/远程错误/连接丢失记 warning 日志（含 reason 与 stderr_tail），成功与防抖跳过记 info
变更：2026-10-16-change-files-sync-result
状态：active
摘要：CLI 失败回执透传；防抖跳过不算失败；四路异常降级留痕
全文：.sillyspec/changes/archive/2026-10-16-change-files-sync-result/requirements.md#FR-02
最近确认：7ca3e7ba66d5d065715a08ea885d064b2617e3e9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-change-files-sync-result:flow:测试绑定FR-02
  tests: backend/app/modules/change/tests/test_files_refresh_sync.py「test_daemon_cli_failure_result_propagates / test_daemon_no_workspace_root_result_propagates / test_daemon_debounce_skip_maps_to_info / test_rpc_timeout_degrades / test_rpc_remote_error_degrades_old_daemon / test_runtime_offline_degrades」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-change-files-sync-result
  status: active

## FR-change-003 GET files?sync=1 响应新增可选 sync_result 字段（triggered/ok/reason/stderr_tail）；默认纯读不带（null）
变更：2026-10-16-change-files-sync-result
状态：active
摘要：纯读不带回执；未触发可区分
全文：.sillyspec/changes/archive/2026-10-16-change-files-sync-result/requirements.md#FR-03
最近确认：7ca3e7ba66d5d065715a08ea885d064b2617e3e9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-change-files-sync-result:flow:测试绑定FR-03
  tests: backend/app/modules/change/tests/test_files_refresh_sync.py「test_online_triggers_sync_before_list / test_default_read_only_skips_sync / test_no_binding_skips_sync / test_daemon_offline_skips_sync / test_binding_without_daemon_id_skips_sync」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-change-files-sync-result
  status: active

## FR-change-004 前端「刷新」按钮：sync_result 失败或未触发时展示同步未完成提示（含原因中文标注），文件树照常展示；成功与防抖跳过不提示
变更：2026-10-16-change-files-sync-result
状态：active
摘要：失败可见且不挡文件树；先失败后成功自动清除
全文：.sillyspec/changes/archive/2026-10-16-change-files-sync-result/requirements.md#FR-04
最近确认：7ca3e7ba66d5d065715a08ea885d064b2617e3e9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-change-files-sync-result:flow:测试绑定FR-04
  tests: frontend/src/components/__tests__/change-file-tree-sync-feedback.test.tsx「刷新回执提示 6 例」 | frontend/src/lib/__tests__/change-file-sync.test.ts「changeFileSyncWarningText 全分支（10 例）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-change-files-sync-result
  status: active

## FR-change-005 新增/更新后端与前端测试全绿，既有 test_files_refresh_sync.py 各路用例语义不回归
变更：2026-10-16-change-files-sync-result
状态：active
摘要：回归面被守护
全文：.sillyspec/changes/archive/2026-10-16-change-files-sync-result/requirements.md#FR-05
最近确认：7ca3e7ba66d5d065715a08ea885d064b2617e3e9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-change-files-sync-result:flow:测试绑定FR-05
  tests: frontend/src/lib/__tests__/change-file-sync.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-change-files-sync-result
  status: active

## FR-change-006 后端 openapi.json 与前端/daemon api-types.ts 依据 pnpm gen:types 重新生成并提交
变更：2026-10-16-change-files-sync-result
状态：active
摘要：类型与 schema 同步
全文：.sillyspec/changes/archive/2026-10-16-change-files-sync-result/requirements.md#FR-06
最近确认：7ca3e7ba66d5d065715a08ea885d064b2617e3e9

## FR-change-007 列表页 tab/页码/搜索/阶段/分类/聚焦/排序/pageSize 同步写进 URL
变更：2026-10-16-change-center-back-keeps-list-state
状态：active
摘要：切已归档 tab 后 URL 同步；翻页后 URL 同步；从 URL 初始化（深链/返回恢复）
全文：.sillyspec/changes/archive/2026-10-16-change-center-back-keeps-list-state/requirements.md#FR-01
最近确认：3963621a86777b6dc2696f5118a8f1fa1125edc2

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-change-center-back-keeps-list-state:flow:测试绑定FR-01
  tests: frontend/src/app/page.test.tsx「?tab=archive&page=3 深链：主 load 按已归档第3页请求」 | frontend/src/app/page.test.tsx「切已归档 tab 后 URL 写回 tab=archive」 | frontend/src/app/page.test.tsx「翻页后 URL 写回 page=N」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-change-center-back-keeps-list-state
  status: active

## FR-change-008 详情页返回入口可后退时走 router.back()
变更：2026-10-16-change-center-back-keeps-list-state
状态：active
摘要：从列表进详情后点返回
全文：.sillyspec/changes/archive/2026-10-16-change-center-back-keeps-list-state/requirements.md#FR-02
最近确认：3963621a86777b6dc2696f5118a8f1fa1125edc2

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-change-center-back-keeps-list-state:flow:测试绑定FR-02
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-back-to-list.test.tsx「历史可后退时点返回入口调 router.back()」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-change-center-back-keeps-list-state
  status: active

## FR-change-009 无历史可退时返回入口保持 Link 兜底
变更：2026-10-16-change-center-back-keeps-list-state
状态：active
摘要：新标签深链详情后点返回
全文：.sillyspec/changes/archive/2026-10-16-change-center-back-keeps-list-state/requirements.md#FR-03
最近确认：3963621a86777b6dc2696f5118a8f1fa1125edc2

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-change-center-back-keeps-list-state:flow:测试绑定FR-03
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-back-to-list.test.tsx「无历史可退时不调 router.back() 走 Link href」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-change-center-back-keeps-list-state
  status: active

## FR-change-010 测试零回归 + 新增行为断言
变更：2026-10-16-change-center-back-keeps-list-state
状态：active
摘要：回归与新增断言
全文：.sillyspec/changes/archive/2026-10-16-change-center-back-keeps-list-state/requirements.md#FR-04
最近确认：3963621a86777b6dc2696f5118a8f1fa1125edc2

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-change-center-back-keeps-list-state:flow:测试绑定FR-04
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-change-center-back-keeps-list-state
  status: active

## FR-change-011 title_norm 新增 condense_title 纯函数并在强/弱标点截断、上限30、硬截加省略号各形态有单测（用实证坏样本做用例）
变更：2026-10-16-change-title-condense-backfill
状态：active
摘要：强边界截断不加省略号；句号强边界截断；无边界硬截加省略号；短文本原样返回；空输入
全文：.sillyspec/changes/archive/2026-10-16-change-title-condense-backfill/requirements.md#FR-01
最近确认：26271e914c9bd670faf2da32ab0851025c5e6598

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-change-title-condense-backfill:flow:测试绑定FR-01
  tests: backend/app/modules/change/tests/test_title_normalization.py「TestCondenseTitle」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-change-title-condense-backfill
  status: active

## FR-change-012 _ensure_change_row 收养口对超30字上行标题提炼后入库、不超30字原样收养，有单测
变更：2026-10-16-change-title-condense-backfill
状态：active
摘要：超长标题收养被提炼；常规标题原样收养；提炼结果为空放弃收养
全文：.sillyspec/changes/archive/2026-10-16-change-title-condense-backfill/requirements.md#FR-02
最近确认：26271e914c9bd670faf2da32ab0851025c5e6598

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-change-title-condense-backfill:flow:测试绑定FR-02
  tests: backend/app/modules/change/tests/test_title_normalization.py「TestAdoptTitleCondenseGuard」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-change-title-condense-backfill
  status: active

## FR-change-013 新增一次性回填脚本 backend/scripts/backfill_change_titles.py：默认 dry-run、--apply 落库、--workspace 可定向，title 为兜底形态或超30字的行从 description 回填，服务层有单测且幂等
变更：2026-10-16-change-title-condense-backfill
状态：active
摘要：兜底 title 从 description 回填；超长语义 title 同样回填；语义短 title 不动；无 description 跳过；幂等重跑
全文：.sillyspec/changes/archive/2026-10-16-change-title-condense-backfill/requirements.md#FR-03
最近确认：26271e914c9bd670faf2da32ab0851025c5e6598

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-change-title-condense-backfill:flow:测试绑定FR-03
  tests: backend/app/modules/change/tests/test_title_backfill.py「TestTitleBackfillService」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-change-title-condense-backfill
  status: active

## FR-change-014 本地开发库 dry-run 核对计数后 --apply，抽查回填结果为约20字短句
变更：2026-10-16-change-title-condense-backfill
状态：active
摘要：本地开发库回填执行
全文：.sillyspec/changes/archive/2026-10-16-change-title-condense-backfill/requirements.md#FR-04
最近确认：26271e914c9bd670faf2da32ab0851025c5e6598

## FR-change-015 后端提供变更标题改名端点——管理员/平台责任人/变更责任人三元组可改，10-30 字校验，rename 事件留痕
变更：2026-10-16-change-title-condense-backfill
状态：active
摘要：变更责任人本人改名成功；无权限用户 403；越带标题 422；已删行 409
全文：.sillyspec/changes/archive/2026-10-16-change-title-condense-backfill/requirements.md#FR-05
最近确认：26271e914c9bd670faf2da32ab0851025c5e6598

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-change-title-condense-backfill:flow:测试绑定FR-05
  tests: backend/app/modules/change/tests/test_rename_title.py「TestRenameTitle」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-change-title-condense-backfill
  status: active

## FR-change-016 前端详情页提供改名入口（权限三元组可见，10-30 字校验提示，保存走新端点并刷新）
变更：2026-10-16-change-title-condense-backfill
状态：active
摘要：权限可见与保存链路；无权限不可见
全文：.sillyspec/changes/archive/2026-10-16-change-title-condense-backfill/requirements.md#FR-06
最近确认：26271e914c9bd670faf2da32ab0851025c5e6598

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-change-title-condense-backfill:flow:测试绑定FR-06
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-rename-title.test.tsx「改名入口权限与保存链路」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-change-title-condense-backfill
  status: active

## FR-change-017 后端 reparse：变更目录 flow-state.yaml 含 commit_type 字段时作为权威类型写入 change_type（允许覆盖库中已有旧值）；无该字段的变更保持现有目录推断与只为空回填行为不变
变更：2026-10-18-change-type-git-conventional
状态：active
摘要：主路径；无字段回落
场景正文：
- 场景：主路径 — Given 归档变更目录含 flow-state.yaml（tier: thin + commit_type: fix）且库行
- 场景：无字段回落 — Given flow-state.yaml 无 commit_type 字段，When reparse，Then change_type 保持
全文：.sillyspec/changes/archive/2026-10-18-change-type-git-conventional/requirements.md#FR-01
最近确认：261a333678e8722856b7120606385f52e31e8579

## FR-change-018 回填脚本：遍历归档变更，git 提交信息反查变更 key，排除 chore(archive)，按优先级（feat/fix > perf/refactor/test > docs/style > build/chore）取主类型，幂等写入该变更 flow-state.yaml（已存在则替换该行，最小 diff）
变更：2026-10-18-change-type-git-conventional
状态：active
摘要：主路径；伪前缀拒识
场景正文：
- 场景：主路径 — Given 变更 key 在 git 历史中有 fix(frontend) 主提交与 docs(spec) 工件提交，When
- 场景：伪前缀拒识 — Given 提交 `sillyspec: baseline checkpoint for <key>`，When 归属，Then 该提交不
全文：.sillyspec/changes/archive/2026-10-18-change-type-git-conventional/requirements.md#FR-02
最近确认：261a333678e8722856b7120606385f52e31e8579

## FR-change-019 前端详情页「类型」行改为彩色标签：已知类型（feat/fix/docs/chore/perf/refactor/test/build/style）固定配色，未知类型中性样式显示原值，空值显示 —
变更：2026-10-18-change-type-git-conventional
状态：active
摘要：主路径；未知与空值
场景正文：
- 场景：主路径 — Given change_type='fix'，Then 标签文本 fix 且红色阶（border-red）；'docs' 为蓝色阶。
- 场景：未知与空值 — Given change_type='hotfix'（未知），Then 中性配色原样显示；change_type=null，；Then 该行显示 — 且无标签节点。
全文：.sillyspec/changes/archive/2026-10-18-change-type-git-conventional/requirements.md#FR-03
最近确认：261a333678e8722856b7120606385f52e31e8579

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-18-change-type-git-conventional:flow:测试绑定FR-03
  tests: frontend/src/components/changes/detail/__tests__/change-overview-side.test.tsx「类型行：已知前缀渲染彩色标签（fix 红色阶 / docs 蓝色阶）/ 旧枚举 feature 显示层等价映射 feat / 未知前缀中性配色显示原值 / change_type 为空 → 显示 —」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-18-change-type-git-conventional
  status: active

## FR-change-020 聚焦测试：parser commit_type 读取用例、_apply_parsed 权威覆盖用例、change-overview-side 类型标签用例全绿；前端 tsc 通过
变更：2026-10-18-change-type-git-conventional
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 改动落地，When 跑 test_parser.py + test_reparse_guard.py + 侧栏组件测试，；Then 全绿（60 + 11 passed），tsc exit 0。
全文：.sillyspec/changes/archive/2026-10-18-change-type-git-conventional/requirements.md#FR-04
最近确认：261a333678e8722856b7120606385f52e31e8579

## FR-change-021 本仓回填 dogfood：脚本跑完后抽验 2026-10-17-session-envelope-rev-stale-guard 的 flow-state.yaml 含 commit_type: fix
变更：2026-10-18-change-type-git-conventional
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 本仓 641 个归档变更与 5020 条提交，When 实跑脚本，Then 抽验变更末行含
全文：.sillyspec/changes/archive/2026-10-18-change-type-git-conventional/requirements.md#FR-05
最近确认：261a333678e8722856b7120606385f52e31e8579

## FR-change-022 后端 list_ 与 GET /changes 新增 change_type 筛选参数：白名单（conventional 前缀 + feature/prototype/quick 旧值），feat 筛选等价命中旧值 feature（与显示层映射口径一致），未知/缺省值不过滤
变更：2026-10-18-change-list-type-filter
状态：active
摘要：主路径；白名单外
场景正文：
- 场景：主路径 — Given 库内行 feat/feature/fix 各一，When list_(change_type="feat")，Then 返回
- 场景：白名单外 — Given 同上三行，When change_type="garbage"，Then 全部返回不过滤（与缺省同）。
全文：.sillyspec/changes/archive/2026-10-18-change-list-type-filter/requirements.md#FR-01
最近确认：857d8af461ea4aa3705016087c3d9124105a3180

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-18-change-list-type-filter:flow:测试绑定FR-01
  tests: backend/app/modules/change/tests/test_change_lineage_filter.py「test_change_type_filter_feat_aliases_legacy_feature / test_change_type_filter_exact_match_and_fallback」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-18-change-list-type-filter
  status: active

## FR-change-023 CommitTypeChip 从详情页抽为公共组件，列表行 meta 行 change_key 后复用渲染类型彩色标签（含 feature→feat 显示映射、空值零占位）
变更：2026-10-18-change-list-type-filter
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 列表行 change_type=fix/feature/null 各一，Then 渲染恰两枚标签（文本
全文：.sillyspec/changes/archive/2026-10-18-change-list-type-filter/requirements.md#FR-02
最近确认：857d8af461ea4aa3705016087c3d9124105a3180

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-18-change-list-type-filter:flow:测试绑定FR-02
  tests: frontend/src/components/changes/detail/__tests__/change-overview-side.test.tsx「类型行：已知前缀渲染彩色标签（fix 红色阶 / docs 蓝色阶）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-18-change-list-type-filter
  status: active

## FR-change-024 前端筛选栏新增「类型」下拉（全部类型/feat/fix/docs/chore/test/refactor/perf/build/style/原型），URL 参数 type 持久化、tab 切换随既有筛选一并回默认、与 tab/搜索/分类/聚焦组合生效
变更：2026-10-18-change-list-type-filter
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 列表页，When 下拉选「fix（修复）」，Then listChanges 收到
全文：.sillyspec/changes/archive/2026-10-18-change-list-type-filter/requirements.md#FR-03
最近确认：857d8af461ea4aa3705016087c3d9124105a3180

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-18-change-list-type-filter:flow:测试绑定FR-03
  tests: frontend/src/app/page.test.tsx「类型下拉选择「fix」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-18-change-list-type-filter
  status: active

## FR-change-025 聚焦测试：后端 change_type 筛选用例（feat 等价命中 feature、未知值不过滤）+ 前端列表页筛选与行标签用例全绿；tsc 通过
变更：2026-10-18-change-list-type-filter
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 改动落地，When 跑 test_change_lineage_filter.py + 列表页/侧栏组件测试，；Then 全绿（8 + 52 + 11 passed），tsc exit 0，ruff/mypy 干净。
全文：.sillyspec/changes/archive/2026-10-18-change-list-type-filter/requirements.md#FR-04
最近确认：857d8af461ea4aa3705016087c3d9124105a3180

## FR-change-026 C 件 parser：reparse 对含 timeline.md 的变更，从「任务面」锚定哈希 × 🔀 行标题提取白名单内主类型（优先级 feat/fix > perf/refactor/test > docs/style > build/chore/revert），作权威类型（允许覆盖；flow-state.yaml 显式 commit_type 字段仍最优先，目录推断兜底不变）；无 timeline/无锚定哈希/无命中类型 → 回落不写
变更：2026-10-19-platform-auto-commit-type
状态：active
摘要：主路径；并行噪音；权威序
场景正文：
- 场景：主路径 — Given timeline.md（🔀 含 fix 主提交 + docs/chore 工件提交，任务面锚定 fix 哈希），；When 提取，Then 返 fix（优先级 feat/fix 高于 docs/chorie 工件）。
- 场景：并行噪音 — Given 🔀 行含他变更提交哈希（不在任务面锚集），When 提取，Then 该提交不参与判定；
- 场景：权威序 — Given flow-state commit_type=docs 与 timeline 提取 fix 同场，When reparse，；Then change_type=docs（flow-state 最优先）。
全文：.sillyspec/changes/archive/2026-10-19-platform-auto-commit-type/requirements.md#FR-01
最近确认：44f12324e768fad638b278a57a46073d566cdbd6

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-19-platform-auto-commit-type:flow:测试绑定FR-01
  tests: backend/app/modules/change/tests/test_parser.py「TestTimelineCommitType::test_anchored_hash_extracts_main_type / test_unanchored_parallel_commits_ignored / test_missing_timeline_or_no_anchor_returns_none / test_unknown_pseudo_prefix_rejected / test_flow_state_field_beats_timeline / test_timeline_source_authoritative_when_no_flow_state」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-19-platform-auto-commit-type
  status: active

## FR-change-027 B 件同步重扫：spec-sync 落盘 ops 后，路径命中 flow-state.yaml 或 timeline.md 的变更键集合非空时，以后台任务对该集合跑 scoped reparse（独立 session、失败仅告警不阻断同步响应）
变更：2026-10-19-platform-auto-commit-type
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given CLI 归档同步推 rename op（changes/<key>/ → changes/archive/<key>/），When
全文：.sillyspec/changes/archive/2026-10-19-platform-auto-commit-type/requirements.md#FR-02
最近确认：44f12324e768fad638b278a57a46073d566cdbd6

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-19-platform-auto-commit-type:flow:测试绑定FR-02
  tests: backend/app/modules/spec_workspace/tests/test_incremental_reparse_trigger.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-19-platform-auto-commit-type
  status: active

## FR-change-028 聚焦测试：timeline 提取用例（含并行噪音排除/截断标题/无锚回退）+ 既有 parser/reparse 测试零回归；ruff/mypy 干净
变更：2026-10-19-platform-auto-commit-type
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 改动落地，When 跑 test_parser.py + test_reparse_guard.py，Then 全绿
全文：.sillyspec/changes/archive/2026-10-19-platform-auto-commit-type/requirements.md#FR-03
最近确认：44f12324e768fad638b278a57a46073d566cdbd6

## FR-change-029 本机真数据端到端验证：以模块方式对真实归档批量对照 timeline 提取与 git 全历史口径，抽样核验分歧语义
变更：2026-10-19-platform-auto-commit-type
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 本仓 208 个含 timeline 归档，When 批量对照，Then 提取非空 135（98 一致 +
全文：.sillyspec/changes/archive/2026-10-19-platform-auto-commit-type/requirements.md#FR-04
最近确认：44f12324e768fad638b278a57a46073d566cdbd6

## FR-change-030 后端 _resolve_order_by 白名单新增 created_at_desc/created_at_asc；API 缺省 fallback 保持 updated_at_desc 不变
变更：2026-10-19-change-list-created-sort
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 三行创建时间相差一天，When sort=created_at_desc，Then 越新越靠前；
全文：.sillyspec/changes/archive/2026-10-19-change-list-created-sort/requirements.md#FR-01
最近确认：e935e8c671e20cda72d65ea44ebbe9adb65b0d47

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-19-change-list-created-sort:flow:测试绑定FR-01
  tests: backend/app/modules/change/tests/test_change_lineage_filter.py「test_sort_created_at_desc_newest_first」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-19-change-list-created-sort
  status: active

## FR-change-031 前端列表默认 created_at_desc；列头「创建时间」点击切换降/升序；旧深链兼容
变更：2026-10-19-change-list-created-sort
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 无 sort 参数进列表，Then listChanges 收 sort=created_at_desc；点列头 →
全文：.sillyspec/changes/archive/2026-10-19-change-list-created-sort/requirements.md#FR-02
最近确认：e935e8c671e20cda72d65ea44ebbe9adb65b0d47

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-19-change-list-created-sort:flow:测试绑定FR-02
  tests: frontend/src/app/page.test.tsx「点创建时间列头 → sortDir 切换，默认 created_at_desc 点击后 asc」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-19-change-list-created-sort
  status: active

## FR-change-032 聚焦测试：后端排序用例 + 前端默认/切换/契约用例全绿；tsc 通过
变更：2026-10-19-change-list-created-sort
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 改动落地，When 跑 test_change_lineage_filter.py + 列表页测试，Then 全绿
全文：.sillyspec/changes/archive/2026-10-19-change-list-created-sort/requirements.md#FR-03
最近确认：e935e8c671e20cda72d65ea44ebbe9adb65b0d47

## FR-change-033 assets/patch-file 端点新增可选 repo 参数（未命中已解析 repos keys 按 note 降级不抛错），切片取 change-patch.json 对应仓 repos[].patch 内联正文，复用既有切片与上限逻辑
变更：2026-10-19-cross-repo-patch-slicing
状态：active
摘要：跨仓命中切片；未知仓/无正文仓
全文：.sillyspec/changes/archive/2026-10-19-cross-repo-patch-slicing/requirements.md#FR-01
最近确认：2b87056a6bd73e6dfa932232adec16c5bde2415b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-19-cross-repo-patch-slicing:flow:测试绑定FR-01
  tests: backend/app/modules/change/tests/test_assets.py::test_patch_file_diff_repo_hit_and_unknown
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-19-cross-repo-patch-slicing
  status: active

## FR-change-034 资产卡仓段下列出该仓文件清单（后端从 patch 头解析投影，超上限截断标注），点开单文件弹窗看跨仓 diff
变更：2026-10-19-cross-repo-patch-slicing
状态：active
摘要：仓段文件清单
全文：.sillyspec/changes/archive/2026-10-19-cross-repo-patch-slicing/requirements.md#FR-02
最近确认：2b87056a6bd73e6dfa932232adec16c5bde2415b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-19-cross-repo-patch-slicing:flow:测试绑定FR-02
  tests: backend/app/modules/change/tests/test_assets.py::test_patch_meta_repo_file_list | frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx::跨仓冻结面
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-19-cross-repo-patch-slicing
  status: active

## FR-change-035 后端单测覆盖命中/未知仓/无 repos 三态，前端组件测试覆盖列表与点开弹窗，类型重生成同步
变更：2026-10-19-cross-repo-patch-slicing
状态：active
摘要：验证面
全文：.sillyspec/changes/archive/2026-10-19-cross-repo-patch-slicing/requirements.md#FR-03
最近确认：2b87056a6bd73e6dfa932232adec16c5bde2415b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-19-cross-repo-patch-slicing:flow:测试绑定FR-03
  tests: backend/app/modules/change/tests/test_assets.py::test_patch_file_diff_repo_hit_and_unknown | backend/app/modules/change/tests/test_assets.py::test_patch_meta_repo_file_list | frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx::跨仓冻结面
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-19-cross-repo-patch-slicing
  status: active

## FR-change-036 全量变更下拉项内嵌 5 阶段进度圈行
变更：2026-10-26-session-change-progress-hover
状态：active
摘要：主路径；降级
依据决策：D-002@v1
全文：.sillyspec/changes/archive/2026-10-26-session-change-progress-hover/requirements.md#FR-01
最近确认：33f4154a3

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-26-session-change-progress-hover:task-01:acc-0-6ecd5d6a
  tests: backend/app/modules/change/tests/test_progress_projection_ext.py | backend/app/modules/daemon/tests/test_heartbeat_thin_flows.py | frontend/src/components/daemon/__tests__/change-progress-row.test.tsx | frontend/src/components/daemon/__tests__/change-total-progress-ring.test.tsx | sillyhub-daemon/tests/sillyspec-flow-status-collector.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 33f4154a35f79bd897d99fd134e3c588242f56bd
  source_change: 2026-10-26-session-change-progress-hover
  status: active
- row: 2026-10-26-session-change-progress-hover:task-01:acc-1-1a18e89f
  tests: backend/app/modules/change/tests/test_progress_projection_ext.py | backend/app/modules/daemon/tests/test_heartbeat_thin_flows.py | frontend/src/components/daemon/__tests__/change-progress-row.test.tsx | frontend/src/components/daemon/__tests__/change-total-progress-ring.test.tsx | sillyhub-daemon/tests/sillyspec-flow-status-collector.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 33f4154a35f79bd897d99fd134e3c588242f56bd
  source_change: 2026-10-26-session-change-progress-hover
  status: active
- row: 2026-10-26-session-change-progress-hover:task-02:acc-0-cf266b7a
  tests: backend/app/modules/change/tests/test_progress_projection_ext.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 33f4154a35f79bd897d99fd134e3c588242f56bd
  source_change: 2026-10-26-session-change-progress-hover
  status: active
- row: 2026-10-26-session-change-progress-hover:task-02:acc-1-84fdd23a
  tests: backend/app/modules/change/tests/test_progress_projection_ext.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 33f4154a35f79bd897d99fd134e3c588242f56bd
  source_change: 2026-10-26-session-change-progress-hover
  status: active
- row: 2026-10-26-session-change-progress-hover:task-08:acc-0-08118443
  tests: frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 33f4154a35f79bd897d99fd134e3c588242f56bd
  source_change: 2026-10-26-session-change-progress-hover
  status: active
- row: 2026-10-26-session-change-progress-hover:task-12:acc-0-41fa578c
  tests: backend/app/modules/agent/tests/test_agent_session_model.py | backend/app/modules/agent/tests/test_cleanup_stale_runs_error_code.py | backend/app/modules/agent/tests/test_coordinator_approval_signal.py | backend/app/modules/agent/tests/test_finalizer.py | backend/app/modules/agent/tests/test_group_chat_models.py | backend/app/modules/agent/tests/test_mcp_tools.py | backend/app/modules/agent/tests/test_orchestrator.py | backend/app/modules/agent/tests/test_placement_borrow_integration.py | backend/app/modules/agent/tests/test_profile_router.py | backend/app/modules/agent/tests/test_provider_caps_alignment.py | backend/app/modules/agent/tests/test_worktree_integration.py | backend/app/modules/change/tests/test_assets.py | backend/app/modules/change/tests/test_change_lineage_filter.py | backend/app/modules/change/tests/test_change_session_binding.py | backend/app/modules/change/tests/test_dispatch.py | backend/app/modules/change/tests/test_dispatch_execute_team_mode.py | backend/app/modules/change/tests/test_files_refresh_sync.py | backend/app/modules/change/tests/test_files_router.py | backend/app/modules/change/tests/test_parser.py | backend/app/modules/change/tests/test_rename_title.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 33f4154a35f79bd897d99fd134e3c588242f56bd
  source_change: 2026-10-26-session-change-progress-hover
  status: active

## FR-change-037 execute 圈按 Task 表 n/m 展示任务进度
变更：2026-10-26-session-change-progress-hover
状态：active
摘要：主路径；批量无 N+1
依据决策：D-005@v1
全文：.sillyspec/changes/archive/2026-10-26-session-change-progress-hover/requirements.md#FR-02
最近确认：33f4154a3

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-26-session-change-progress-hover:task-03:acc-0-dfcc92f2
  tests: backend/app/modules/change/tests/test_progress_projection_ext.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 33f4154a35f79bd897d99fd134e3c588242f56bd
  source_change: 2026-10-26-session-change-progress-hover
  status: active

## FR-change-038 轻量变更下拉项内嵌 ①→②→③ 相位行
变更：2026-10-26-session-change-progress-hover
状态：active
摘要：主路径；收口阶段；降级
依据决策：D-001@v1
全文：.sillyspec/changes/archive/2026-10-26-session-change-progress-hover/requirements.md#FR-03
最近确认：33f4154a3

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-26-session-change-progress-hover:task-04:acc-0-740078d6
  tests: backend/app/modules/change/tests/test_progress_projection_ext.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 33f4154a35f79bd897d99fd134e3c588242f56bd
  source_change: 2026-10-26-session-change-progress-hover
  status: active
- row: 2026-10-26-session-change-progress-hover:task-05:acc-0-0bc12beb
  tests: backend/app/modules/daemon/tests/test_heartbeat_thin_flows.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 33f4154a35f79bd897d99fd134e3c588242f56bd
  source_change: 2026-10-26-session-change-progress-hover
  status: active
- row: 2026-10-26-session-change-progress-hover:task-06:acc-0-d22f1e66
  tests: sillyhub-daemon/tests/sillyspec-flow-status-collector.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 33f4154a35f79bd897d99fd134e3c588242f56bd
  source_change: 2026-10-26-session-change-progress-hover
  status: active
- row: 2026-10-26-session-change-progress-hover:task-07:acc-0-3cf6023c
  tests: sillyhub-daemon/tests/sillyspec-flow-status-collector.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 33f4154a35f79bd897d99fd134e3c588242f56bd
  source_change: 2026-10-26-session-change-progress-hover
  status: active

## FR-change-039 升厚与 brainstorm→thin 分流的渲染归属
变更：2026-10-26-session-change-progress-hover
状态：active
摘要：升厚切换；分流标注
依据决策：D-006@v1、D-007@v1
全文：.sillyspec/changes/archive/2026-10-26-session-change-progress-hover/requirements.md#FR-04
最近确认：33f4154a3

## FR-change-040 入口旁单个总进度圈（最新进行中一个）
变更：2026-10-26-session-change-progress-hover
状态：active
摘要：多变更只显一个；数据缺失
依据决策：D-003@v1、D-013@v1
全文：.sillyspec/changes/archive/2026-10-26-session-change-progress-hover/requirements.md#FR-05
最近确认：33f4154a3

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-26-session-change-progress-hover:task-09:acc-0-0cf2a32a
  tests: frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 33f4154a35f79bd897d99fd134e3c588242f56bd
  source_change: 2026-10-26-session-change-progress-hover
  status: active
- row: 2026-10-26-session-change-progress-hover:task-10:acc-0-011ce0f2
  tests: frontend/src/components/daemon/__tests__/session-change-files-hover.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 33f4154a35f79bd897d99fd134e3c588242f56bd
  source_change: 2026-10-26-session-change-progress-hover
  status: active

## FR-change-041 数据链路三线落地（方案 A）
变更：2026-10-26-session-change-progress-hover
状态：active
摘要：heartbeat 坏条目；采集失败
依据决策：D-004@v1
全文：.sillyspec/changes/archive/2026-10-26-session-change-progress-hover/requirements.md#FR-06
最近确认：33f4154a3

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-26-session-change-progress-hover:task-11:acc-0-bf562f7e
  tests: backend/app/modules/agent/tests/test_agent_session_model.py | backend/app/modules/agent/tests/test_cleanup_stale_runs_error_code.py | backend/app/modules/agent/tests/test_coordinator_approval_signal.py | backend/app/modules/agent/tests/test_finalizer.py | backend/app/modules/agent/tests/test_group_chat_models.py | backend/app/modules/agent/tests/test_mcp_tools.py | backend/app/modules/agent/tests/test_orchestrator.py | backend/app/modules/agent/tests/test_placement_borrow_integration.py | backend/app/modules/agent/tests/test_profile_router.py | backend/app/modules/agent/tests/test_provider_caps_alignment.py | backend/app/modules/agent/tests/test_worktree_integration.py | backend/app/modules/change/tests/test_assets.py | backend/app/modules/change/tests/test_change_lineage_filter.py | backend/app/modules/change/tests/test_change_session_binding.py | backend/app/modules/change/tests/test_dispatch.py | backend/app/modules/change/tests/test_dispatch_execute_team_mode.py | backend/app/modules/change/tests/test_files_refresh_sync.py | backend/app/modules/change/tests/test_files_router.py | backend/app/modules/change/tests/test_parser.py | backend/app/modules/change/tests/test_rename_title.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 33f4154a35f79bd897d99fd134e3c588242f56bd
  source_change: 2026-10-26-session-change-progress-hover
  status: active

## FR-change-042 全链路 fail-open 兼容降级
变更：2026-10-26-session-change-progress-hover
状态：active
摘要：旧 daemon
全文：.sillyspec/changes/archive/2026-10-26-session-change-progress-hover/requirements.md#FR-07
最近确认：33f4154a3

## FR-change-043 计数徽标双色
变更：2026-10-26-session-change-progress-hover
状态：active
摘要：双态断言
依据决策：D-012@v2
全文：.sillyspec/changes/archive/2026-10-26-session-change-progress-hover/requirements.md#FR-08
最近确认：33f4154a3

## FR-change-044 通知行「用时」与唤醒判定同源：elapsed_ms 缺失时用注册表 startedAt 兜底时长显示 MM:SS，不再出现误导性 00:00
变更：2026-10-27-task-wakeup-precision-fix
状态：active
摘要：帧缺失时显示注册表兜底时长；双缺失保持 00:00
全文：.sillyspec/changes/archive/2026-10-27-task-wakeup-precision-fix/requirements.md#FR-01
最近确认：4dc531554f19e0cb3ed0561f06e4d4c979375f8f

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-27-task-wakeup-precision-fix:flow:测试绑定FR-01
  tests: sillyhub-daemon/tests/interactive/task-lifecycle.test.ts「唤醒用时与判定同源：elapsed_ms 缺失显示注册表兜底时长」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-27-task-wakeup-precision-fix
  status: active

## FR-change-045 前台命令免唤醒：tool_use 元数据登记 run_in_background 标记（Task/Agent/Bash 三类工具），判定为前台的任务终态不注入唤醒；终态 emit 与 [TASK_NOTIFICATION] 落行行为不变
变更：2026-10-27-task-wakeup-precision-fix
状态：active
摘要：前台 Bash 长命令不再触发唤醒；后台 Bash/Agent 完成即唤醒（不受时长阈值限制）
全文：.sillyspec/changes/archive/2026-10-27-task-wakeup-precision-fix/requirements.md#FR-02
最近确认：4dc531554f19e0cb3ed0561f06e4d4c979375f8f

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-27-task-wakeup-precision-fix:flow:测试绑定FR-02
  tests: sillyhub-daemon/tests/interactive/task-lifecycle.test.ts「前台 Bash（run_in_background 缺省）终态不注入唤醒且终态信号不变」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-27-task-wakeup-precision-fix
  status: active

## FR-change-046 后台标记缺失（task_started 丢失且无回执兜底）时保留旧时长阈值兜底唤醒并打 WARN；SILLYHUB_TASK_WAKEUP_QUIET_MS env 与缺省 60000 不变，语义改为兜底场景防噪阀
变更：2026-10-27-task-wakeup-precision-fix
状态：active
摘要：三无孤儿终态维持旧行为；阈值 0 总关闭阀不变
全文：.sillyspec/changes/archive/2026-10-27-task-wakeup-precision-fix/requirements.md#FR-03
最近确认：4dc531554f19e0cb3ed0561f06e4d4c979375f8f

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-27-task-wakeup-precision-fix:flow:测试绑定FR-03
  tests: sillyhub-daemon/tests/interactive/task-lifecycle.test.ts「三无孤儿终态兜底放行并打 WARN」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-27-task-wakeup-precision-fix
  status: active

## FR-change-047 唤醒判定补结构化日志：task_id/task_name/status/时长/时长来源（sdk-frame|registry|unknown）/后台判定结果，前台跳过与兜底放行均可观测
变更：2026-10-27-task-wakeup-precision-fix
状态：active
摘要：三出口均可观测
全文：.sillyspec/changes/archive/2026-10-27-task-wakeup-precision-fix/requirements.md#FR-04
最近确认：4dc531554f19e0cb3ed0561f06e4d4c979375f8f

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-27-task-wakeup-precision-fix:flow:测试绑定FR-04
  tests: sillyhub-daemon/tests/interactive/task-lifecycle.test.ts「唤醒判定出口结构化日志字段齐备」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-27-task-wakeup-precision-fix
  status: active

## FR-change-048 文案修正：daemon prompt「后台子代理任务」改「后台任务」、「（列表中的每一个都已终止，没有仍在运行的任务）」改「（本批次均已终止）」，backend helpers.py 合并正则与拼接模板同步改，前端识别锚 [后台任务通知] 前缀不变零改动
变更：2026-10-27-task-wakeup-precision-fix
状态：active
摘要：合并计数在新文案下正确；backend 合并兼容旧头部
全文：.sillyspec/changes/archive/2026-10-27-task-wakeup-precision-fix/requirements.md#FR-05
最近确认：4dc531554f19e0cb3ed0561f06e4d4c979375f8f

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-27-task-wakeup-precision-fix:flow:测试绑定FR-05
  tests: backend/app/modules/daemon/tests/test_session_queue.py「merge_task_wakeup_prompt 新旧头部兼容」 | sillyhub-daemon/tests/interactive/task-lifecycle.test.ts「prompt 头部新文案与合并计数」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-27-task-wakeup-precision-fix
  status: active

## FR-change-049 daemon/backend/frontend 三侧仅跑与本改动相关的测试并通过
变更：2026-10-27-task-wakeup-precision-fix
状态：active
摘要：相关测试全绿
全文：.sillyspec/changes/archive/2026-10-27-task-wakeup-precision-fix/requirements.md#FR-06
最近确认：4dc531554f19e0cb3ed0561f06e4d4c979375f8f
