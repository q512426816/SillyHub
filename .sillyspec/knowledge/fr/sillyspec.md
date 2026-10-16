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
  tests: sillyhub-daemon/tests/borrow-sandbox-context.test.ts「tech_stack join 超 500 截断并标注（防线对齐 description）」
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
  tests: sillyhub-daemon/tests/borrow-sandbox-context.test.ts「repo_url 超 500 截断并标注」
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
  tests: sillyhub-daemon/tests/borrow-sandbox-context.test.ts「短字段逐字原样与 500 边界不截断」
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
  tests: sillyhub-daemon/tests/borrow-sandbox-context.test.ts「渲染幂等：同一 ctx 两次渲染输出一致（同 slug 沙箱重入安全）」
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
  tests: sillyhub-daemon/tests/borrow-sandbox-context.test.ts「全字段渲染：元信息 + 真实路径只读声明 + 沙箱产出指引 + 文尾数据声明」
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
  tests: sillyhub-daemon/tests/linked-repos-snapshot.test.ts「相对形态 root_path 抛错不 spawn CLI」
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
  tests: sillyhub-daemon/tests/linked-repos-sync.test.ts「root_path 三种绝对形态放行 + 相对形态抛错」
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
  tests: sillyhub-daemon/tests/linked-repos-sync.test.ts「rel_path 绝对形态该层 failed 不 spawn」
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
  tests: sillyhub-daemon/tests/linked-repos-sync.test.ts「abs_path 相对形态该层 failed 不 spawn」
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
  tests: sillyhub-daemon/tests/linked-repos-sync.test.ts「合法约定零回归：兄弟相对路径与绝对本机路径照常 spawn」
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
  tests: sillyhub-daemon/tests/linked-repos-snapshot.test.ts「UNC 与 POSIX 绝对形态放行」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-11-linked-repos-path-guard
  status: active

## FR-auto-zcode-001 .claude/.codex/.opencode/.zcode 四镜像目录均有 21 个 sillyspec-* 技能（含 sillyspec-flow），内容与 npm sillyspec@3.32.0 包一致
变更：2026-10-08-sync-sillyspec-skills-3320
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-08-sync-sillyspec-skills-3320/requirements.md#FR-01
最近确认：e3a4222dcee84c1281d5e7414b11b1908724cf69

## FR-auto-zcode-002 .zcode/skills/sillyspec-quick/SKILL.md 去掉本地手补的退役横幅段，还原为上游原版
变更：2026-10-08-sync-sillyspec-skills-3320
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-08-sync-sillyspec-skills-3320/requirements.md#FR-02
最近确认：e3a4222dcee84c1281d5e7414b11b1908724cf69

## FR-auto-zcode-003 AGENTS.md 注入段版本号刷新为 v3.32.0
变更：2026-10-08-sync-sillyspec-skills-3320
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-08-sync-sillyspec-skills-3320/requirements.md#FR-03
最近确认：e3a4222dcee84c1281d5e7414b11b1908724cf69

## FR-auto-zcode-004 docs/sillyspec/ 新增活跃坑：init 技能同步映射不含 zcode
变更：2026-10-08-sync-sillyspec-skills-3320
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-08-sync-sillyspec-skills-3320/requirements.md#FR-04
最近确认：e3a4222dcee84c1281d5e7414b11b1908724cf69

## FR-auto-sillyspec-083 .sillyspec/knowledge/uncategorized.md 新增补记小节，覆盖本地 12/360 无重复行直接 REINDEX、amcheck 须 JOIN pg_am 过滤 btree、last_used_at 停滞即同步静默断档信号、墓碑冲突遗留待拍板，四点齐全
变更：2026-10-16-pg-index-local-followup
状态：active
摘要：补记四点齐全
全文：.sillyspec/changes/archive/2026-10-16-pg-index-local-followup/requirements.md#FR-01
最近确认：08aa9fa699db804e74b848e3aa801de390550c08

## FR-auto-sillyspec-084 补记紧邻既有 2026-10-16 生产事故条目且不改动原条目内容
变更：2026-10-16-pg-index-local-followup
状态：active
摘要：原条目零改动
全文：.sillyspec/changes/archive/2026-10-16-pg-index-local-followup/requirements.md#FR-02
最近确认：08aa9fa699db804e74b848e3aa801de390550c08

## FR-auto-sillyspec-085 数字与本次实证一致：360 checked/12 bad/修复后 0 bad、清单 10152 到 10680 行、变更行 614
变更：2026-10-16-pg-index-local-followup
状态：active
摘要：数字一致
全文：.sillyspec/changes/archive/2026-10-16-pg-index-local-followup/requirements.md#FR-03
最近确认：08aa9fa699db804e74b848e3aa801de390550c08
