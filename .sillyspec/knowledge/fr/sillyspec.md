---
author: sillyspec-fr-index
created_at: 2026-09-28T13:29:24.005Z
---

# FR 索引 — sillyspec

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 模块卡：modules/sillyspec.md（域=模块 id 同构；行为条目↔模块契约互跳）

## FR-auto-sillyspec-001 known-issues 观察项登记
变更：2026-09-16-background-task-grace-timeout
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given hasBackgroundTaskGrace 无界宽限风险已被 R-01 接受但暴露差未文档化；When 本变更收尾（quick --linked-changes 落盘）；Then .sillyspec/knowledge/known-issues.md 新增观察项，含四要素：暴露差（stale-flip 60min 有界 vs bg-ta
全文：.sillyspec/changes/archive/2026-09-16-background-task-grace-timeout/requirements.md#FR-01
最近确认：83b402f6b

## FR-auto-sillyspec-002 archived 载荷复活 deleted 冤案行
变更：2026-09-25-tombstone-heal-archive
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 平台 Change 行 location='deleted'（旧 CLI 墓碑 bug 误标）且 upsert_progress 收到新 CLI 重推的 'ar；When 已删探测命中走拒收分支；Then 行翻回 location='archive' 并走正常接受分支（面板「已归档」tab 恢复可见）；行缺失/仅 manifest 兜底判据命中/真删除链（本地 s
全文：.sillyspec/changes/archive/2026-09-25-tombstone-heal-archive/requirements.md#FR-01
最近确认：fed6e9e9a27b6363273addd25ac98f316e90db36

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-tombstone-heal-archive:flow:FR-01
  tests: backend/app/modules/platform_sync/tests/test_change_deleted_guard.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-25-tombstone-heal-archive
  status: active

## FR-auto-sillyspec-003 archived 墓碑不触发镜像软删
变更：2026-09-25-tombstone-heal-archive
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given _apply_cli_tombstone 收到 status=='archived' 的墓碑载荷；When 处理 tombstone；Then no-op 早退：不动 location（P1 ingest 不变量，收敛归文件移动 + reparse）、不软删 spec 镜像（归档可回溯，区别于 dele
全文：.sillyspec/changes/archive/2026-09-25-tombstone-heal-archive/requirements.md#FR-02
最近确认：fed6e9e9a27b6363273addd25ac98f316e90db36

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-tombstone-heal-archive:flow:FR-02
  tests: backend/app/modules/platform_sync/tests/test_change_deleted_guard.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-25-tombstone-heal-archive
  status: active

## FR-auto-sillyspec-004 聚焦测试全绿
变更：2026-09-25-tombstone-heal-archive
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 本变更交付；When 跑 test_change_deleted_guard.py；Then 三新用例（恢复/不软删/幂等）+ 既有 13 用例全绿（16 passed 实测）
全文：.sillyspec/changes/archive/2026-09-25-tombstone-heal-archive/requirements.md#FR-03
最近确认：fed6e9e9a27b6363273addd25ac98f316e90db36

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-tombstone-heal-archive:flow:FR-03
  tests: backend/app/modules/platform_sync/tests/test_change_deleted_guard.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-25-tombstone-heal-archive
  status: active

## FR-auto-sillyspec-005 不变量守恒
变更：2026-09-25-tombstone-heal-archive
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given D-002@v1（reparse 是 location owner）与 P1 ingest 不变量；When 本变更落库；Then 复活通道是唯一新增 location 写点且仅 deleted→archive 单向；镜像不软删不恢复
全文：.sillyspec/changes/archive/2026-09-25-tombstone-heal-archive/requirements.md#FR-04
最近确认：fed6e9e9a27b6363273addd25ac98f316e90db36

## FR-auto-sillyspec-006 .sillyspec/ROADMAP.md 自平台仓删除并显式 pathspec 提交
变更：roadmap-retire
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When .sillyspec/ROADMAP.md 自平台仓删除并显式 pathspec 提交；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/roadmap-retire/requirements.md#FR-01
最近确认：34fc294d4fdbac3dc4a088097220cf748f47744f

## FR-auto-sillyspec-007 读侧零改动：sillyspec CLI next.js 绿地探测/status cat/lite 豁
变更：roadmap-retire
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 读侧零改动：sillyspec CLI next.js 绿地探测/status cat/lite 豁免措辞均不动（条件化自失活）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/roadmap-retire/requirements.md#FR-02
最近确认：34fc294d4fdbac3dc4a088097220cf748f47744f

## FR-auto-sillyspec-008 daemon sillyspec-manager.ts:2184 仅为注释示例非消费点
变更：roadmap-retire
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When daemon sillyspec-manager.ts:2184 仅为注释示例非消费点；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/roadmap-retire/requirements.md#FR-03
最近确认：34fc294d4fdbac3dc4a088097220cf748f47744f

## FR-auto-sillyspec-009 纯 doc 删除，收口实测自动跳过代码面
变更：roadmap-retire
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 纯 doc 删除，收口实测自动跳过代码面；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/roadmap-retire/requirements.md#FR-04
最近确认：34fc294d4fdbac3dc4a088097220cf748f47744f

## FR-auto-sillyspec-010 方法：按条目自带「变更：<name>」分组 → 读归档 change.patch 的交付路径判定目标
变更：2026-09-28-unmapped-batch-redomain
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 方法：按条目自带「变更：<name>」分组；Then 读归档 change.patch 的交付路径判定目标域（backend/frontend/daemon/sillyspec 四粗域，与页面一键归位口径一致）
全文：.sillyspec/changes/archive/2026-09-28-unmapped-batch-redomain/requirements.md#FR-01
最近确认：4dfba3a2ab2d4a78936d98ebb6fc734ce5af6236

## FR-auto-sillyspec-011 映射表先出后审：patch 缺失/多域混合的变更用条目文本关键词兜底判定，映射表人工复核后才落盘
变更：2026-09-28-unmapped-batch-redomain
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 映射表先出后审：patch 缺失/多域混合的变更用条目文本关键词兜底判定，映射表人工复核后才落盘；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-unmapped-batch-redomain/requirements.md#FR-02
最近确认：4dfba3a2ab2d4a78936d98ebb6fc734ce5af6236

## FR-auto-sillyspec-012 699 条全部迁入真域，计数守恒（迁移前后条目总数一致，无丢失无重复）
变更：2026-09-28-unmapped-batch-redomain
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 迁移 相关模块就绪；When 699 条全部迁入真域，计数守恒（迁移前后条目总数一致，无丢失无重复）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-unmapped-batch-redomain/requirements.md#FR-03
最近确认：4dfba3a2ab2d4a78936d98ebb6fc734ce5af6236

## FR-auto-sillyspec-013 fr/unmapped.md 清空删除，INDEX 路由行同步
变更：2026-09-28-unmapped-batch-redomain
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When fr/unmapped.md 清空删除，INDEX 路由行同步；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-unmapped-batch-redomain/requirements.md#FR-04
最近确认：4dfba3a2ab2d4a78936d98ebb6fc734ce5af6236

## FR-auto-sillyspec-014 sillyspec knowledge validate 通过
变更：2026-09-28-unmapped-batch-redomain
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When sillyspec knowledge validate 通过；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-unmapped-batch-redomain/requirements.md#FR-05
最近确认：4dfba3a2ab2d4a78936d98ebb6fc734ce5af6236

## FR-auto-sillyspec-015 digest 伪域归零（unmapped 池 0）
变更：2026-09-28-unmapped-batch-redomain
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When digest 伪域归零（unmapped 池 0）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-unmapped-batch-redomain/requirements.md#FR-06
最近确认：4dfba3a2ab2d4a78936d98ebb6fc734ce5af6236

## FR-auto-sillyspec-016 映射依据可追溯（每个变更→域的判定来源留档在变更目录）
变更：2026-09-28-unmapped-batch-redomain
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 映射依据可追溯（每个变更；Then 域的判定来源留档在变更目录）
全文：.sillyspec/changes/archive/2026-09-28-unmapped-batch-redomain/requirements.md#FR-07
最近确认：4dfba3a2ab2d4a78936d98ebb6fc734ce5af6236

## FR-auto-sillyspec-020 IssueRow 无 leading 时渲染空占位 div，四个子元素落进设计轨道（图标/主体 1f
变更：2026-09-29-issue-row-grid-misalign
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When IssueRow 无 leading 时渲染空占位 div，四个子元素落进设计轨道（图标/主体 1fr/右列 auto），与 IssueRowHeader 占位；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-29-issue-row-grid-misalign/requirements.md#FR-01
最近确认：790c594bf0570259215b5c18178c481f6f856a22

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-29-issue-row-grid-misalign:flow:FR-01
  tests: frontend/src/components/primer/__tests__/primer-structures.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-29-issue-row-grid-misalign
  status: active

## FR-auto-sillyspec-021 修复后 unclear-req-to-brainstorm 行 desc span 与 step-s
变更：2026-09-29-issue-row-grid-misalign
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 修复后 unclear-req-to-brainstorm 行 desc span 与 step-sub-row 包围盒交集为 false，desc 省略号截断；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-29-issue-row-grid-misalign/requirements.md#FR-02
最近确认：790c594bf0570259215b5c18178c481f6f856a22

## FR-auto-sillyspec-022 右列内容不再向左溢出自身容器（全行扫描：右列每个可见文本元素左界 >= 右列容器左界）
变更：2026-09-29-issue-row-grid-misalign
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 右列内容不再向左溢出自身容器（全行扫描：右列每个可见文本元素左界 >= 右列容器左界）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-29-issue-row-grid-misalign/requirements.md#FR-03
最近确认：790c594bf0570259215b5c18178c481f6f856a22

## FR-auto-sillyspec-023 primer issue-row 既有测试全绿 + 新增占位回归用例 + tsc 0 错
变更：2026-09-29-issue-row-grid-misalign
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When primer issue-row 既有测试全绿 + 新增占位回归用例 + tsc 0 错；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-29-issue-row-grid-misalign/requirements.md#FR-04
最近确认：790c594bf0570259215b5c18178c481f6f856a22

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-29-issue-row-grid-misalign:flow:FR-04
  tests: frontend/src/app/page.test.tsx | frontend/src/components/primer/__tests__/primer-structures.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-29-issue-row-grid-misalign
  status: active

## FR-auto-sillyspec-024 部署生产后同行复测交集 false + 列表全行扫描零叠压
变更：2026-09-29-issue-row-grid-misalign
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 部署生产后同行复测交集 false + 列表全行扫描零叠压；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-29-issue-row-grid-misalign/requirements.md#FR-05
最近确认：790c594bf0570259215b5c18178c481f6f856a22

## FR-auto-sillyspec-025 `::` 用例锚剥离——pytest 节点 ID 记录串可定位真实文件
变更：2026-09-30-assets-testfile-nodeid-anchor
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 变更详情「沉淀资产」卡渲染归档 test-trace 的测试绑定行，tests[] 条目为 `file::Class::method` 形整串（pytest 节；When 用户点开该测试文件；Then 归一层剥掉 `::` 起的用例锚得到纯路径，按干净 basename 发起 explorer search 并等值/后缀命中，弹窗预览仓库内真实文件——不再恒显
全文：.sillyspec/changes/archive/2026-09-30-assets-testfile-nodeid-anchor/requirements.md#FR-01
最近确认：bac7255cc57ba16fe9efcb44032e435a0d4d508e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-30-assets-testfile-nodeid-anchor:flow:FR-01
  tests: frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx「:: 用例锚（pytest 节点 ID）剥离：按纯路径等值命中预览，无重定向注记」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-30-assets-testfile-nodeid-anchor
  status: active

## FR-auto-sillyspec-026 锚后粘联的全角括号注解残段一并剥除
变更：2026-09-30-assets-testfile-nodeid-anchor
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given tests[] 条目的用例锚后粘联全角括号注解残段——flow done 摘录按空白切 token 产生的未闭合截断形（如 `test_x（documents`；When 归一层剥锚；Then 残段随锚一并剥除得到纯路径，不影响 basename 搜索入参与路径等值/后缀比较
全文：.sillyspec/changes/archive/2026-09-30-assets-testfile-nodeid-anchor/requirements.md#FR-02
最近确认：bac7255cc57ba16fe9efcb44032e435a0d4d508e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-30-assets-testfile-nodeid-anchor:flow:FR-02
  tests: frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx「:: 锚后粘联全角括号残段（截断未闭合形）一并剥离（生产实证串）」 | frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx「闭合形全角括号注解粘联（无锚界符）同样剥除」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-30-assets-testfile-nodeid-anchor
  status: active

## FR-auto-sillyspec-027 `#` 与 `>` 形态锚同样剥除（四形态契约对齐）且既有归一行为不回退
变更：2026-09-30-assets-testfile-nodeid-anchor
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — When 归一层剥锚；Then `#`/`>` 形态与 `::` 同归纯路径；既有「」注解剥离、反斜杠/`./` 归一、短路径唯一后缀救回与 worktree 副本排除行为全部保持（存量路径解
全文：.sillyspec/changes/archive/2026-09-30-assets-testfile-nodeid-anchor/requirements.md#FR-03
最近确认：bac7255cc57ba16fe9efcb44032e435a0d4d508e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-30-assets-testfile-nodeid-anchor:flow:FR-03
  tests: frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx「# 与 > 形态锚剥离：同归纯路径，短路径唯一后缀救回」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-30-assets-testfile-nodeid-anchor
  status: active

## FR-auto-sillyspec-028 单元测试覆盖四形态锚与括号残段剥离
变更：2026-09-30-assets-testfile-nodeid-anchor
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given change-assets-card 组件测试套件；When 覆盖 `::` 锚（含本轮生产实证串）、全角括号残段（截断形与闭合形）、`#`/`>` 锚；Then 断言 explorer search 入参为剥锚后干净 basename、弹窗预览真实路径；存量用例不回退
全文：.sillyspec/changes/archive/2026-09-30-assets-testfile-nodeid-anchor/requirements.md#FR-04
最近确认：bac7255cc57ba16fe9efcb44032e435a0d4d508e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-30-assets-testfile-nodeid-anchor:flow:FR-04
  tests: frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx「2026-09-30-assets-testfile-nodeid-anchor 新增四用例（:: 锚/截断残段/闭合残段/#> 锚）整体」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-30-assets-testfile-nodeid-anchor
  status: active

## FR-auto-sillyspec-029 takeover ③级歧义时 409 文案包含全部命中机器名（而非「（未知机器）」）
变更：2026-09-30-takeover-tier3-ambiguous-msg
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When takeover ③级歧义时 409 文案包含全部命中机器名（而非「（未知机器）」）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-30-takeover-tier3-ambiguous-msg/requirements.md#FR-01
最近确认：a9c4c690dd8402bdb7387669a6d182a4c1af88ab

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-30-takeover-tier3-ambiguous-msg:flow:FR-01
  tests: backend/app/modules/daemon/tests/test_takeover.py::TestFourTierMatching::test_tier3_ambiguous_lists_machine_names
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-30-takeover-tier3-ambiguous-msg
  status: active

## FR-auto-sillyspec-030 无命中且无机器身份时文案说明「未识别上报机器」并指引 allowed_roots 配置
变更：2026-09-30-takeover-tier3-ambiguous-msg
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 无命中且无机器身份时文案说明「未识别上报机器」并指引 allowed_roots 配置；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-30-takeover-tier3-ambiguous-msg/requirements.md#FR-02
最近确认：a9c4c690dd8402bdb7387669a6d182a4c1af88ab

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-30-takeover-tier3-ambiguous-msg:flow:FR-02
  tests: backend/app/modules/daemon/tests/test_takeover.py::TestFourTierMatching（既有四级矩阵用例零回归）
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-30-takeover-tier3-ambiguous-msg
  status: active

## FR-auto-sillyspec-031 既有 test_takeover.py 用例不回归（ambiguous 用例文案断言更新）
变更：2026-09-30-takeover-tier3-ambiguous-msg
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 既有 test_takeover.py 用例不回归（ambiguous 用例文案断言更新）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-30-takeover-tier3-ambiguous-msg/requirements.md#FR-03
最近确认：a9c4c690dd8402bdb7387669a6d182a4c1af88ab

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-30-takeover-tier3-ambiguous-msg:flow:FR-03
  tests: backend/app/modules/daemon/tests/test_takeover.py::TestFourTierMatching::test_tier4_no_match_409_with_machine_name（无命中文案态回归）
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-30-takeover-tier3-ambiguous-msg
  status: active

## FR-auto-sillyspec-032 handoff 档 TakeoverRequest 支持可选 runtime_id（用户所选机器+引
变更：2026-09-30-takeover-handoff-any-location
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When handoff 档 TakeoverRequest 支持可选 runtime_id（用户所选机器+引擎），服务端校验属主+在线后用作派发位置；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-30-takeover-handoff-any-location/requirements.md#FR-01
最近确认：d9131ca545a1a0a85c49180ecc938d532cf58ab6

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-30-takeover-handoff-any-location:flow:FR-01
  tests: backend/app/modules/daemon/tests/test_takeover_handoff.py::TestHandoffEndToEnd::test_provider_reselect_422_and_ok（含
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-30-takeover-handoff-any-location
  status: active

## FR-auto-sillyspec-033 缺省保持原四级匹配（原机）不回归
变更：2026-09-30-takeover-handoff-any-location
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 缺省保持原四级匹配（原机）不回归；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-30-takeover-handoff-any-location/requirements.md#FR-02
最近确认：d9131ca545a1a0a85c49180ecc938d532cf58ab6

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-30-takeover-handoff-any-location:flow:FR-02
  tests: frontend/src/components/daemon/__tests__/session-panel-takeover.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-30-takeover-handoff-any-location
  status: active

## FR-auto-sillyspec-034 handoff 档原机匹配失败不再阻塞（显式 runtime_id 时 handoff_doc=fa
变更：2026-09-30-takeover-handoff-any-location
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When handoff 档原机匹配失败不再阻塞（显式 runtime_id 时 handoff_doc=false 降级继续）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-30-takeover-handoff-any-location/requirements.md#FR-03
最近确认：d9131ca545a1a0a85c49180ecc938d532cf58ab6

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-30-takeover-handoff-any-location:flow:FR-03
  tests: backend/app/modules/daemon/tests/test_takeover.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-30-takeover-handoff-any-location
  status: active

## FR-auto-sillyspec-035 未传 runtime_id 且原机无匹配仍 409
变更：2026-09-30-takeover-handoff-any-location
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 未传 runtime_id 且原机无匹配仍 409；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-30-takeover-handoff-any-location/requirements.md#FR-04
最近确认：d9131ca545a1a0a85c49180ecc938d532cf58ab6

## FR-auto-sillyspec-036 前端 handoff 档选择器为两级（在线机器 → 该机白名单在线引擎），默认预选上报机器
变更：2026-09-30-takeover-handoff-any-location
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 前端 相关模块就绪；When 前端 handoff 档选择器为两级（在线机器；Then 该机白名单在线引擎），默认预选上报机器
全文：.sillyspec/changes/archive/2026-09-30-takeover-handoff-any-location/requirements.md#FR-05
最近确认：d9131ca545a1a0a85c49180ecc938d532cf58ab6

## FR-auto-sillyspec-037 native 档不渲染选择器且仍锁原机
变更：2026-09-30-takeover-handoff-any-location
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When native 档不渲染选择器且仍锁原机；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-30-takeover-handoff-any-location/requirements.md#FR-06
最近确认：d9131ca545a1a0a85c49180ecc938d532cf58ab6

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-30-takeover-handoff-any-location:flow:FR-06
  tests: backend/app/modules/daemon/tests/test_takeover.py::TestTiersAndForkCreation::test_native_tier_resume_session_id_in_lease（native | frontend/src/components/daemon/__tests__/session-panel-takeover.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-30-takeover-handoff-any-location
  status: active

## FR-auto-sillyspec-038 接手引擎候选过滤 SESSION_SUPPORTED_PROVIDERS（不可会话引擎不再出现）
变更：2026-09-30-takeover-handoff-any-location
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 接手引擎候选过滤 SESSION_SUPPORTED_PROVIDERS（不可会话引擎不再出现）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-30-takeover-handoff-any-location/requirements.md#FR-07
最近确认：d9131ca545a1a0a85c49180ecc938d532cf58ab6

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-30-takeover-handoff-any-location:flow:FR-07
  tests: frontend/src/components/daemon/__tests__/session-panel-takeover.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-30-takeover-handoff-any-location
  status: active

## FR-auto-sillyspec-039 既有 takeover 用例零回归 + 新增覆盖（runtime_id 显式/原机离线降级/白名单过
变更：2026-09-30-takeover-handoff-any-location
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 既有 takeover 用例零回归 + 新增覆盖（runtime_id 显式/原机离线降级/白名单过滤）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-30-takeover-handoff-any-location/requirements.md#FR-08
最近确认：d9131ca545a1a0a85c49180ecc938d532cf58ab6

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-30-takeover-handoff-any-location:flow:FR-08
  tests: backend/app/modules/daemon/tests/test_takeover.py | frontend/src/components/daemon/__tests__/session-panel-takeover.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-30-takeover-handoff-any-location
  status: active

## FR-auto-sillyspec-045 isToolReportBody 派生上移到所有早退分支之前（session 判空安全），handleSend 依赖数组补该变量
变更：2026-10-06-opencode-session-send-incident
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-06-opencode-session-send-incident/requirements.md#FR-01
最近确认：27deb16a7b065fbf623f9f1e5e40ec8fc3d494c6

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-06-opencode-session-send-incident:flow:测试绑定FR-01
  tests: frontend/src/components/daemon/__tests__/session-panel-pre-session.test.tsx「首句发送 → createSession 含 runtime_id + prompt + manual_approval/ask_user_only（不带 provider），成功清空输入并上报 onPreSessionCreated」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-opencode-session-send-incident
  status: active

## FR-auto-sillyspec-046 session-panel-pre-session.test.tsx 原先挂掉的 15 个用例全部转绿（TDZ 回归测试即现有用例）
变更：2026-10-06-opencode-session-send-incident
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-06-opencode-session-send-incident/requirements.md#FR-02
最近确认：27deb16a7b065fbf623f9f1e5e40ec8fc3d494c6

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-06-opencode-session-send-incident:flow:测试绑定FR-02
  tests: frontend/src/components/daemon/__tests__/session-panel-pre-session.test.tsx | frontend/src/components/daemon/__tests__/session-panel-takeover.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-opencode-session-send-incident
  status: active

## FR-auto-sillyspec-047 服务器 OpenCode Go 供应商行 extra_env 注入 HTTPS_PROXY=http://127.0.0.1:7897，daemon 本机 Claude Code 经代理连 opencode.ai 实测 200
变更：2026-10-06-opencode-session-send-incident
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-06-opencode-session-send-incident/requirements.md#FR-03
最近确认：27deb16a7b065fbf623f9f1e5e40ec8fc3d494c6

## FR-auto-sillyspec-048 未跑全量测试（仅跑本修复相关测试文件）
变更：2026-10-06-opencode-session-send-incident
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-06-opencode-session-send-incident/requirements.md#FR-04
最近确认：27deb16a7b065fbf623f9f1e5e40ec8fc3d494c6

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-06-opencode-session-send-incident:flow:测试绑定FR-04
  tests: frontend/src/components/daemon/__tests__/session-panel-pre-session.test.tsx「空文本不发首句（后端 prompt 首句约束）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-opencode-session-send-incident
  status: active

## FR-auto-sillyspec-049 服务器 OpenCode Go 供应商行 settings_config 已清 NULL（psql 回显核对）
变更：2026-10-06-opencode-settings-config-poison
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-06-opencode-settings-config-poison/requirements.md#FR-01
最近确认：18205e82742eba62c020a512efc29e2df21fc718

## FR-auto-sillyspec-050 平台 UI 真实新会话（OpenCode Go + deepseek-v4.1-flash）发送首句收到模型回复（第 1 轮已完成）
变更：2026-10-06-opencode-settings-config-poison
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-06-opencode-settings-config-poison/requirements.md#FR-02
最近确认：18205e82742eba62c020a512efc29e2df21fc718

## FR-auto-sillyspec-051 坑文档补记 settings_config 覆盖链教训（规则 7 优先级高于平台注入，编辑供应商数据时必须同步检查该字段）
变更：2026-10-06-opencode-settings-config-poison
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-06-opencode-settings-config-poison/requirements.md#FR-03
最近确认：18205e82742eba62c020a512efc29e2df21fc718

## FR-auto-sillyspec-052 无代码改动，无测试面（纯运维数据 + 文档）
变更：2026-10-06-opencode-settings-config-poison
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-06-opencode-settings-config-poison/requirements.md#FR-04
最近确认：18205e82742eba62c020a512efc29e2df21fc718
