---
author: sillyspec-fr-index
created_at: 2026-09-22T17:27:13.449Z
---

# FR 索引 — spec-sync

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 模块卡：modules/spec-sync.md（域=模块 id 同构；行为条目↔模块契约互跳）

## FR-spec-sync-001 hits 多端汇聚上行
变更：2026-09-20-knowledge-effect-panel
状态：active
摘要：默认场景
依据决策：D-003@v1、D-007@v1
场景正文：
- 场景：默认场景 — Given 多用户各自机器的 daemon 对同一 workspace 产生本地 hits 文件；When daemon spec 同步流程触发；Then 豁免读取 `.runtime/knowledge-hits.jsonl` 按本地 offset 完整行断点增量上报（≤2000 行/批）；服务器按 (works
全文：.sillyspec/changes/archive/2026-09-20-knowledge-effect-panel/requirements.md#FR-01
最近确认：095869924

## FR-spec-sync-002 运营指标仪表盘
变更：2026-09-20-knowledge-effect-panel
状态：active
摘要：默认场景
依据决策：D-009@v1
场景正文：
- 场景：默认场景 — Given workspace 已有 hits 数据；When 打开知识库页；Then 顶部四指标卡：知识覆盖率（被命中条目/全部条目+按周趋势迷你图）、死条目（90 天零命中，点击展开清单抽屉）、每任务命中密度（inject 按 change 去
全文：.sillyspec/changes/archive/2026-09-20-knowledge-effect-panel/requirements.md#FR-02
最近确认：095869924

## FR-spec-sync-003 使用率榜
变更：2026-09-20-knowledge-effect-panel
状态：active
摘要：默认场景
依据决策：D-008@v3
场景正文：
- 场景：默认场景 — Given 条目命中计数与条目存在期间任务总数（任务=inject 行 change_name 去重，含变更与 quick）；When 渲染使用率榜；Then 全量条目按每任务触发率降序滚动展示（主数值 % 格式：<10% 两位小数、≥10% 一位小数，D-008@v3），绝对次数作副信息，不截断条数
全文：.sillyspec/changes/archive/2026-09-20-knowledge-effect-panel/requirements.md#FR-03
最近确认：095869924

## FR-spec-sync-004 全 zone 统一条目渲染器
变更：2026-09-20-knowledge-effect-panel
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 知识库任一文件（手册/decisions/fr/generated/INDEX）；When 用户点开；Then 默认卡片流按文件形态分发：手册=## 小节逐条正文卡（条目级 🔥 徽标）；决策/FR=结构化字段卡（ID/标题/状态徽标/字段行/理由摘要/取代链/依据决策跳
全文：.sillyspec/changes/archive/2026-09-20-knowledge-effect-panel/requirements.md#FR-04
最近确认：095869924

## FR-spec-sync-005 fr 独立 zone
变更：2026-09-20-knowledge-effect-panel
状态：active
摘要：默认场景
依据决策：D-005@v1
场景正文：
- 场景：默认场景 — Given knowledge/fr/ 目录存在条目；When 知识库列表加载；Then fr 条目归「需求规则」组独立展示（决策库组后），zone 值 "fr" 透传
全文：.sillyspec/changes/archive/2026-09-20-knowledge-effect-panel/requirements.md#FR-05
最近确认：095869924

## FR-spec-sync-006 使用徽标
变更：2026-09-20-knowledge-effect-panel
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 命中聚合计数；When 列表与卡片渲染；Then 文件行挂文件级 🔥 徽标；手册小节卡挂条目级徽标（锚点=文件#小节标题对齐）
全文：.sillyspec/changes/archive/2026-09-20-knowledge-effect-panel/requirements.md#FR-06
最近确认：095869924

## FR-spec-sync-007 初始化按机器探测到的 agent 写入多端 skill
变更：2026-10-09-workspace-init-skill-gate
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 机器上 agent-detector 探测到 N 个 agent 且与 sillyspec CLI `VALID_TOOLS` 的同名交集非空；When init lease 执行 `sillyspec init`（必须不带 `--no-skills`，`--tool` 为交集逗号列表）；Then 每个 tool 的 skill 目录（claude→`.claude/skills`、codex→`.codex/skills`、openclaw→`.open
全文：.sillyspec/changes/archive/2026-10-09-workspace-init-skill-gate/requirements.md#FR-01
最近确认：ad53f7271

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-workspace-init-skill-gate:task-01:acc-0-9465688b
  tests: sillyhub-daemon/src/spec-sync.ts | sillyhub-daemon/tests/run-sillyspec-init.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-workspace-init-skill-gate
  status: active
- row: 2026-10-09-workspace-init-skill-gate:task-01:acc-1-e32cf1a8
  tests: sillyhub-daemon/src/spec-sync.ts | sillyhub-daemon/tests/run-sillyspec-init.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-workspace-init-skill-gate
  status: active
- row: 2026-10-09-workspace-init-skill-gate:task-02:acc-0-90f57461
  tests: sillyhub-daemon/tests/sillyspec-tool-mapping.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-workspace-init-skill-gate
  status: active
- row: 2026-10-09-workspace-init-skill-gate:task-02:acc-1-84fd69f4
  tests: sillyhub-daemon/tests/sillyspec-tool-mapping.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-workspace-init-skill-gate
  status: active

## FR-spec-sync-008 白名单同步与版本门控提升
变更：2026-10-09-workspace-init-skill-gate
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given daemon 端 `SILLYSPEC_VALID_TOOLS` 为 7 值（含 zcode）且 `MIN_SILLYSPEC_VERSION_FOR_INIT；When init lease 执行前 spawn `sillyspec --version` 做门控；Then 版本 ≥3.32.2 放行；<3.32.2 时 init 必须失败并返回 `sillyspec_init_cli_too_old`（禁止写 `init_sync
全文：.sillyspec/changes/archive/2026-10-09-workspace-init-skill-gate/requirements.md#FR-02
最近确认：ad53f7271

## FR-spec-sync-009 详情页未初始化轻引导（成员/机器维度）
变更：2026-10-09-workspace-init-skill-gate
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 当前成员在本机对工作区的绑定 `init_synced_at` 为 NULL；When 打开工作区详情页配置卡片；Then 现有「未初始化」琥珀徽标下方必须出现引导 Alert（文案含"初始化后才能正常使用"与"每台机器需要单独初始化"）；`init_synced_at` 非空时 M
全文：.sillyspec/changes/archive/2026-10-09-workspace-init-skill-gate/requirements.md#FR-03
最近确认：ad53f7271

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-workspace-init-skill-gate:task-05:acc-0-381396e8
  tests: frontend/src/components/workspace-config-card.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-workspace-init-skill-gate
  status: active
- row: 2026-10-09-workspace-init-skill-gate:task-05:acc-1-02353ccf
  tests: frontend/src/components/workspace-config-card.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-workspace-init-skill-gate
  status: active
- row: 2026-10-09-workspace-init-skill-gate:task-05:acc-2-cf4a5097
  tests: frontend/src/components/workspace-config-card.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-workspace-init-skill-gate
  status: active

## FR-spec-sync-010 创建成功后自动串行初始化
变更：2026-10-09-workspace-init-skill-gate
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given 创建弹窗提交带 `daemon_id` 且 `createWorkspace` 成功；When 前端串行调用 `initDispatch(workspaceId)` 并每 2s 轮询 `fetchMyBinding` 直到 `init_synced_at`；Then 弹窗必须依次展示"创建✓→初始化中→完成"进度；完成态提供「打开工作区」出口；初始化失败/超时时弹窗必须明示"工作区已创建成功，但初始化失败，可稍后在详情页重新
全文：.sillyspec/changes/archive/2026-10-09-workspace-init-skill-gate/requirements.md#FR-04
最近确认：ad53f7271

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-workspace-init-skill-gate:task-04:acc-0-92cd0895
  tests: frontend/src/components/__tests__/workspace-scan-dialog.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-workspace-init-skill-gate
  status: active
- row: 2026-10-09-workspace-init-skill-gate:task-04:acc-1-38c20000
  tests: frontend/src/components/__tests__/workspace-scan-dialog.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-workspace-init-skill-gate
  status: active
- row: 2026-10-09-workspace-init-skill-gate:task-04:acc-2-9ace1f39
  tests: frontend/src/components/__tests__/workspace-scan-dialog.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-workspace-init-skill-gate
  status: active

## FR-spec-sync-011 init lease 失败禁止回写初始化状态
变更：2026-10-09-workspace-init-skill-gate
状态：active
摘要：默认场景
依据决策：D-006@v1
场景正文：
- 场景：默认场景 — Given 一个 mode='init' 的 lease 以 `status='failed'` 上报 complete；When 后端 `complete_lease` 处理 init 回写段；Then 成员绑定的 `init_synced_at` / `init_synced_spec_version` 必须保持 NULL（禁止回写）并记 warn 日志 `i
全文：.sillyspec/changes/archive/2026-10-09-workspace-init-skill-gate/requirements.md#FR-05
最近确认：ad53f7271

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-workspace-init-skill-gate:task-03:acc-0-2920023a
  tests: backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-workspace-init-skill-gate
  status: active
- row: 2026-10-09-workspace-init-skill-gate:task-03:acc-1-93b6fbce
  tests: backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-workspace-init-skill-gate
  status: active
- row: 2026-10-09-workspace-init-skill-gate:task-03:acc-2-0384b6d6
  tests: backend/app/modules/daemon/lease/tests/test_init_claim_tokens.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-workspace-init-skill-gate
  status: active

## FR-spec-sync-012 repo-native 且源项目无 .sillyspec 时不再降级：daemon 就地创建空 .sillyspec 后建 junction，getSpecBundle 不被调用（junction 分支早退）
变更：2026-10-10-repo-native-no-platform-markers
状态：active
摘要：全新项目首接
全文：.sillyspec/changes/archive/2026-10-10-repo-native-no-platform-markers/requirements.md#FR-01
最近确认：1c9c0e40dae6ee77ad07859f3b80e0dc2d7e269c

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-repo-native-no-platform-markers:flow:测试绑定FR-01
  tests: sillyhub-daemon/tests/test_init_lease.test.ts「repo-native：源项目无 .sillyspec → 就地创建空真理源 + junction 建立，getSpecBundle 不被调（不再降级投毒）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-repo-native-no-platform-markers
  status: active

## FR-spec-sync-013 repo-native 且缓存为普通目录残留时不再静默降级：残留 rename 备份后建 junction，原缓存数据保留在备份目录
变更：2026-10-10-repo-native-no-platform-markers
状态：active
摘要：策略切换残留
全文：.sillyspec/changes/archive/2026-10-10-repo-native-no-platform-markers/requirements.md#FR-02
最近确认：1c9c0e40dae6ee77ad07859f3b80e0dc2d7e269c

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-repo-native-no-platform-markers:flow:测试绑定FR-02
  tests: sillyhub-daemon/tests/test_init_lease.test.ts「repo-native：缓存为普通目录残留 → rename 备份后 junction 成立，原内容保留在备份目录，getSpecBundle 不被调」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-repo-native-no-platform-markers
  status: active

## FR-spec-sync-014 junction 成立后 init 时 sillyspec 自指守卫生效：源项目根不落 .sillyspec-platform.json / .sillyspec-platform-managed / .sillyspec-platform-cleaned 任一文件
变更：2026-10-10-repo-native-no-platform-markers
状态：active
摘要：init 不投毒
全文：.sillyspec/changes/archive/2026-10-10-repo-native-no-platform-markers/requirements.md#FR-03
最近确认：1c9c0e40dae6ee77ad07859f3b80e0dc2d7e269c

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-repo-native-no-platform-markers:flow:测试绑定FR-03
  tests: sillyhub-daemon/tests/test_init_lease.test.ts「repo-native：源项目无 .sillyspec → 就地创建空真理源 + junction 建立，getSpecBundle 不被调（不再降级投毒）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-repo-native-no-platform-markers
  status: active

## FR-spec-sync-015 既有 repo-native / repo-mirrored / platform-managed 策略分支测试全部保持绿（无回归）
变更：2026-10-10-repo-native-no-platform-markers
状态：active
摘要：回归
全文：.sillyspec/changes/archive/2026-10-10-repo-native-no-platform-markers/requirements.md#FR-04
最近确认：1c9c0e40dae6ee77ad07859f3b80e0dc2d7e269c

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-10-repo-native-no-platform-markers:flow:测试绑定FR-04
  tests: sillyhub-daemon/tests/test_init_lease.test.ts「策略分支 init 时序 + 状态文件保鲜 (ql-20260820-007)」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-10-repo-native-no-platform-markers
  status: active

## FR-spec-sync-016 backup rename 失败（如 Windows 句柄占用）时仍走原降级 pull 路径，不抛错不删数据
变更：2026-10-10-repo-native-no-platform-markers
状态：active
摘要：rename 失败降级
全文：.sillyspec/changes/archive/2026-10-10-repo-native-no-platform-markers/requirements.md#FR-05
最近确认：1c9c0e40dae6ee77ad07859f3b80e0dc2d7e269c

## FR-spec-sync-017 rename 成功后 symlink 抛异常（注入 EPERM）时 ensureSpecJunction 返回 false 并 warn，pullSpecBundle 走降级 pull 分支（spec_sync: repo_native_junction_blocked_fallback 日志可达）
变更：2026-10-11-junction-fallback-backup-sweep
状态：active
摘要：半交换 symlink 失败降级
全文：.sillyspec/changes/archive/2026-10-11-junction-fallback-backup-sweep/requirements.md#FR-01
最近确认：aa809dc912e6e40aada0e2e9c2dad913f3807714

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-11-junction-fallback-backup-sweep:flow:测试绑定FR-01
  tests: test/sillyhub-daemon/tests/test_init_lease.test.ts「半交换 symlink 失败降级 pull：数据留 backup + 双 warn 可达」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-11-junction-fallback-backup-sweep
  status: active

## FR-spec-sync-018 mkdir(dirname(specDir)) 抛异常同上收口，不再有裸异常飞出
变更：2026-10-11-junction-fallback-backup-sweep
状态：active
摘要：mkdir 失败同降级
全文：.sillyspec/changes/archive/2026-10-11-junction-fallback-backup-sweep/requirements.md#FR-02
最近确认：aa809dc912e6e40aada0e2e9c2dad913f3807714

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-11-junction-fallback-backup-sweep:flow:测试绑定FR-02
  tests: test/sillyhub-daemon/tests/test_init_lease.test.ts「半交换 mkdir 失败同降级」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-11-junction-fallback-backup-sweep
  status: active

## FR-spec-sync-019 rename 自身失败仍走既有 return false 降级（零回归）
变更：2026-10-11-junction-fallback-backup-sweep
状态：active
摘要：rename 失败
全文：.sillyspec/changes/archive/2026-10-11-junction-fallback-backup-sweep/requirements.md#FR-03
最近确认：aa809dc912e6e40aada0e2e9c2dad913f3807714

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-11-junction-fallback-backup-sweep:flow:测试绑定FR-03
  tests: test/sillyhub-daemon/tests/test_init_lease.test.ts「repo-native 残留备份交换（既有用例零改动回归）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-11-junction-fallback-backup-sweep
  status: active

## FR-spec-sync-020 源项目 .sillyspec mkdir 失败（:153）保持 fail-loud 不降级——降级 pull 会重新引入平台标记投毒路径（261dc22e9 修的就是这个），此边界显式留档
变更：2026-10-11-junction-fallback-backup-sweep
状态：active
摘要：源项目根只读
全文：.sillyspec/changes/archive/2026-10-11-junction-fallback-backup-sweep/requirements.md#FR-04
最近确认：aa809dc912e6e40aada0e2e9c2dad913f3807714

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-11-junction-fallback-backup-sweep:flow:测试绑定FR-04
  tests: test/sillyhub-daemon/tests/test_init_lease.test.ts「源缺失不降级（既有用例零改动回归）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-11-junction-fallback-backup-sweep
  status: active

## FR-spec-sync-021 sweepStalePullScraps 清扫 7 天前的 .pre-junction-backup-* 目录；10 分钟内的备份不被误删
变更：2026-10-11-junction-fallback-backup-sweep
状态：active
摘要：repo-native 成功路径清扫过期备份
全文：.sillyspec/changes/archive/2026-10-11-junction-fallback-backup-sweep/requirements.md#FR-05
最近确认：aa809dc912e6e40aada0e2e9c2dad913f3807714

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-11-junction-fallback-backup-sweep:flow:测试绑定FR-05
  tests: test/sillyhub-daemon/tests/test_init_lease.test.ts「repo-native 成功路径清扫过期备份/保留期内不误删」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-11-junction-fallback-backup-sweep
  status: active

## FR-spec-sync-022 .tmp-/.trash- 既有 10 分钟语义零回归；相关测试先红后绿全绿 + tsc 零错
变更：2026-10-11-junction-fallback-backup-sweep
状态：active
摘要：先红后绿
全文：.sillyspec/changes/archive/2026-10-11-junction-fallback-backup-sweep/requirements.md#FR-06
最近确认：aa809dc912e6e40aada0e2e9c2dad913f3807714

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-11-junction-fallback-backup-sweep:flow:测试绑定FR-06
  tests: test/sillyhub-daemon/tests/test_init_lease.test.ts「备份清扫：tmp/trash 10 分钟语义零回归」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-11-junction-fallback-backup-sweep
  status: active

## FR-spec-sync-023 platform-sync-section 渲染注册表「版本冲突」型开放行（非纯墓碑）并给对比/裁决入口，未决冲突计数与横幅口径一致
变更：2026-10-11-sync-conflict-tri-fix
状态：active
摘要：主路径（注册表行可见可裁决）；与机器行去重；混合行（版本冲突 + 墓碑并集）
场景正文：
- 场景：主路径（注册表行可见可裁决） — Given 注册表有 1 条开放行（conflicting_paths 含 `changes/archive/X/tasks.md`，platform_deleted 为空；When 渲染平台同步区块；Then 渲染 1 行 spec 徽章 + 变更名 X + 「查看对比」按钮，卡头「未决冲突」= 1（与横幅计数一致）。
- 场景：与机器行去重 — Given 同一变更名已存在于机器 pending_conflicts 行（CLI 侧冲突）；When 渲染；Then 只渲染机器行一次，不因注册表行重复渲染。
- 场景：混合行（版本冲突 + 墓碑并集） — Given conflicting_paths 同时含版本冲突路径与 platform_deleted 路径；When 渲染；Then 按版本冲突面归因渲染（墓碑行判定要求纯墓碑，混合行不额外渲染墓碑行）。
全文：.sillyspec/changes/archive/2026-10-11-sync-conflict-tri-fix/requirements.md#FR-01
最近确认：0c821b2ec492f134411d4ab2429e8b7f1da438b0

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-11-sync-conflict-tri-fix:flow:测试绑定FR-01
  tests: frontend/src/components/changes/__tests__/platform-sync-section.test.tsx「注册表版本冲突行与机器行同名去重——机器行优先不重复渲染」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-11-sync-conflict-tri-fix
  status: active

## FR-spec-sync-024 daemon 增量推送撞乐观锁冲突后自动重拉 re-base 一次并重试，re-base 后仍冲突才落注册表
变更：2026-10-11-sync-conflict-tri-fix
状态：active
摘要：主路径（re-base 自愈）；真分叉仍上抛；无版本面不重试
场景正文：
- 场景：主路径（re-base 自愈） — Given 缓存 base_version 过期（他端已把文件推到 v4，本地持 v2，内容相同——2026-10-11 生产实证 workflow 工作区形态）；When 增量推送撞 conflict → re-base 到 v4 → 重算 ops（同内容豁免 / base 匹配）→ 重试；Then 全绿返回，不抛 SpecPushConflict，注册表开放行随全绿自动关闭。
- 场景：真分叉仍上抛 — Given 两端对同路径内容真分叉；When 首推 conflict → re-base → 重试仍 conflict；Then 抛 SpecPushConflict，调用方语义与现状一致（warn + 人工裁决）。
- 场景：无版本面不重试 — Given conflict=true 但 server_versions 为空；When 推送；Then 直接抛 SpecPushConflict（无从 re-base，不做无意义重算）。
全文：.sillyspec/changes/archive/2026-10-11-sync-conflict-tri-fix/requirements.md#FR-02
最近确认：0c821b2ec492f134411d4ab2429e8b7f1da438b0

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-11-sync-conflict-tri-fix:flow:测试绑定FR-02
  tests: sillyhub-daemon/tests/spec-sync-incremental.test.ts「re-base 重试遇传输失败 → 转抛 SpecPushConflict 不落 tar 回退不写 pending_push（review P2 2026-10-11）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-11-sync-conflict-tri-fix
  status: active

## FR-spec-sync-025 sillyspec CLI platform sync 支持不带 --change 的全树同步；assertSafeChangeName 放行磁盘已存在的变更名
变更：2026-10-11-sync-conflict-tri-fix
状态：active
摘要：主路径（全树同步）；中文名放行（生产实证用例）；穿越仍拦；未连接明确提示
场景正文：
- 场景：主路径（全树同步） — Given 工作区已 platform connect、归档目录与活跃目录均有待同步内容；When `sillyspec platform sync`（无 --change）；Then 走 syncSpecTree 全树 diff 推送完成，退出码 0，无「需要指定变更名称」报错。
- 场景：中文名放行（生产实证用例） — Given 磁盘存在 `changes/archive/2026-10-10-取消LTC宽表校验规则/`；When `sillyspec platform sync --change 2026-10-10-取消LTC宽表校验规则`；Then 守卫放行进入同步（不再报「含非法字符」）。
- 场景：穿越仍拦 — Given `--change "a/../b"` 或 `--change "a/b"`；When 任一经守卫入口；Then 仍被拒（安全语义不回归）。
- 场景：未连接明确提示 — Given 未 platform connect；When `sillyspec platform sync`（无 --change）；Then 输出明确「未连接平台」提示，不静默成功。
全文：.sillyspec/changes/archive/2026-10-11-sync-conflict-tri-fix/requirements.md#FR-03
最近确认：0c821b2ec492f134411d4ab2429e8b7f1da438b0

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-11-sync-conflict-tri-fix:flow:测试绑定FR-03
  tests: test/assert-safe-change-name.test.mjs「日期前缀+中文描述」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-11-sync-conflict-tri-fix
  status: active

## FR-spec-sync-026 三处修复各有单测覆盖且相关测试全绿
变更：2026-10-11-sync-conflict-tri-fix
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-10-11-sync-conflict-tri-fix/requirements.md#FR-04
最近确认：0c821b2ec492f134411d4ab2429e8b7f1da438b0

## FR-spec-sync-027 首推 postSpecSyncIncremental 返回 conflict=true 后，re-base 段内（rebaseManifestVersions/computeIncrementalOps/onProgress/重试推送）抛出的任何异常必须统一转为 SpecPushConflict 上抛人工裁决，禁止落入外层 tar 全量回退
变更：2026-10-12-spec-sync-rebase-guard
状态：active
摘要：重算 IO 异常不落 tar 回退；onProgress 回调异常同样受守卫
全文：.sillyspec/changes/archive/2026-10-12-spec-sync-rebase-guard/requirements.md#FR-01
最近确认：f3203a38d920fa3ea9ca51cf3a87d8fb76fd4060

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-spec-sync-rebase-guard:flow:测试绑定FR-01
  tests: sillyhub-daemon/tests/spec-sync-incremental.test.ts「conflict 后 re-base 重算遇 IO 异常 → 转 SpecPushConflict 不落 tar 回退（2026-10-12-spec-sync-rebase-guard）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-spec-sync-rebase-guard
  status: active

## FR-spec-sync-028 重试推送仍 conflict（真分叉）与重试传输失败转抛 SpecPushConflict 的既有语义保持不变
变更：2026-10-12-spec-sync-rebase-guard
状态：active
摘要：真分叉原样上抛；重试传输失败转抛
全文：.sillyspec/changes/archive/2026-10-12-spec-sync-rebase-guard/requirements.md#FR-02
最近确认：f3203a38d920fa3ea9ca51cf3a87d8fb76fd4060

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-spec-sync-rebase-guard:flow:测试绑定FR-02
  tests: sillyhub-daemon/tests/spec-sync-incremental.test.ts「conflict → re-base 重试仍 conflict → 抛 SpecPushConflict（不静默覆盖，NFR-02 / 2026-10-11-sync-conflict-tri-fix FR-02）」 | sillyhub-daemon/tests/spec-sync-incremental.test.ts「re-base 重试遇传输失败 → 转抛 SpecPushConflict 不落 tar 回退不写 pending_push（review P2 2026-10-11）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-spec-sync-rebase-guard
  status: active

## FR-spec-sync-029 成功路径（rebase 后推送成功、无 conflict）行为零变化，既有 spec-sync-incremental 用例全绿
变更：2026-10-12-spec-sync-rebase-guard
状态：active
摘要：他端先推型自愈不变
全文：.sillyspec/changes/archive/2026-10-12-spec-sync-rebase-guard/requirements.md#FR-03
最近确认：f3203a38d920fa3ea9ca51cf3a87d8fb76fd4060

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-spec-sync-rebase-guard:flow:测试绑定FR-03
  tests: sillyhub-daemon/tests/spec-sync-incremental.test.ts「conflict → re-base 重试全绿 → 自愈成功（他端先推型，2026-10-11-sync-conflict-tri-fix FR-02）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-spec-sync-rebase-guard
  status: active

## FR-spec-sync-030 新增用例：conflict 后 computeIncrementalOps 抛 IO 异常 → 断言抛 SpecPushConflict 且 postSpecSync（tar 全量）零调用（先红后绿）
变更：2026-10-12-spec-sync-rebase-guard
状态：active
摘要：注入窗口确定性
全文：.sillyspec/changes/archive/2026-10-12-spec-sync-rebase-guard/requirements.md#FR-04
最近确认：f3203a38d920fa3ea9ca51cf3a87d8fb76fd4060

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-spec-sync-rebase-guard:flow:测试绑定FR-04
  tests: sillyhub-daemon/tests/spec-sync-incremental.test.ts「conflict 后 re-base 重算遇 IO 异常 → 转 SpecPushConflict 不落 tar 回退（2026-10-12-spec-sync-rebase-guard）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-spec-sync-rebase-guard
  status: active

## FR-spec-sync-031 仅跑本改动相关测试（规则 0）：sillyhub-daemon/tests/spec-sync-incremental.test.ts 全文件
变更：2026-10-12-spec-sync-rebase-guard
状态：active
摘要：相关面回归
全文：.sillyspec/changes/archive/2026-10-12-spec-sync-rebase-guard/requirements.md#FR-05
最近确认：f3203a38d920fa3ea9ca51cf3a87d8fb76fd4060

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-spec-sync-rebase-guard:flow:测试绑定FR-05
  tests: sillyhub-daemon/tests/spec-sync-incremental.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-spec-sync-rebase-guard
  status: active
