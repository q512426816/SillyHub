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
  tests: changes/__tests__/page.test.tsx「?tab=archive&page=3 深链：主 load 按已归档第3页请求」 | changes/__tests__/page.test.tsx「切已归档 tab 后 URL 写回 tab=archive」 | changes/__tests__/page.test.tsx「翻页后 URL 写回 page=N」
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
  tests: changes/__tests__/page.test.tsx「类型下拉选择「fix」
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
