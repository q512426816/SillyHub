---
author: sillyspec-fr-index
created_at: 2026-09-29T01:15:18.223Z
---

# FR 索引 — auto-sillyspec

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 伪域（auto- 前缀）：由文件路径段投票派生，无模块卡——为该域补模块卡后，新变更将自动落回真域

## FR-auto-sillyspec-020 IssueRow 无 leading 时渲染空占位 div，四个子元素落进设计轨道（图标/主体 1f
变更：2026-09-29-issue-row-grid-misalign
状态：active
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
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 修复后 unclear-req-to-brainstorm 行 desc span 与 step-sub-row 包围盒交集为 false，desc 省略号截断；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-29-issue-row-grid-misalign/requirements.md#FR-02
最近确认：790c594bf0570259215b5c18178c481f6f856a22

## FR-auto-sillyspec-022 右列内容不再向左溢出自身容器（全行扫描：右列每个可见文本元素左界 >= 右列容器左界）
变更：2026-09-29-issue-row-grid-misalign
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 右列内容不再向左溢出自身容器（全行扫描：右列每个可见文本元素左界 >= 右列容器左界）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-29-issue-row-grid-misalign/requirements.md#FR-03
最近确认：790c594bf0570259215b5c18178c481f6f856a22

## FR-auto-sillyspec-023 primer issue-row 既有测试全绿 + 新增占位回归用例 + tsc 0 错
变更：2026-09-29-issue-row-grid-misalign
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When primer issue-row 既有测试全绿 + 新增占位回归用例 + tsc 0 错；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-29-issue-row-grid-misalign/requirements.md#FR-04
最近确认：790c594bf0570259215b5c18178c481f6f856a22

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-29-issue-row-grid-misalign:flow:FR-04
  tests: changes/__tests__/page.test.tsx | frontend/src/components/primer/__tests__/primer-structures.test.tsx
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
