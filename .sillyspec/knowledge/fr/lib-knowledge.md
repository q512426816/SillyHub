---
author: sillyspec-fr-index
created_at: 2026-09-27T10:13:08.181Z
---

# FR 索引 — lib-knowledge

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 模块卡：modules/lib-knowledge.md（域=模块 id 同构；行为条目↔模块契约互跳）

## FR-lib-knowledge-001 backend knowledge 模块新增 GET /workspaces/{ws}/knowle
变更：2026-09-27-knowledge-governance-cards
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When backend knowledge 模块新增 GET /workspaces/{ws}/knowledge/governance（KNOWLEDGE_READ）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-knowledge-governance-cards/requirements.md#FR-01
最近确认：99c508227642192dc929cd0702441f3303a6ceff

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-27-knowledge-governance-cards:flow:FR-01
  tests: backend/app/modules/knowledge/tests/test_governance.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 2cb3e7633c0df0ff5b263c3eb3fc845f2dcb5e3e
  source_change: 2026-09-27-knowledge-governance-cards
  status: active

## FR-lib-knowledge-002 frontend 知识 tab 顶部新增治理信号卡区：healthy 一行安语、超阈逐卡（kind/
变更：2026-09-27-knowledge-governance-cards
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When frontend 知识 tab 顶部新增治理信号卡区：healthy 一行安语、超阈逐卡（kind/计数/明细/处置指引——CLI 命令文案）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-knowledge-governance-cards/requirements.md#FR-02
最近确认：99c508227642192dc929cd0702441f3303a6ceff

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulbwez0:frontend/src/components/knowledge/__tests__/governance-cards.test.tsx
  tests: frontend/src/components/knowledge/__tests__/governance-cards.test.tsx
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 2cb3e7633c0df0ff5b263c3eb3fc845f2dcb5e3e
  source_change: 2026-09-27-knowledge-governance-cards
  status: active

## FR-lib-knowledge-003 取数走既有 api 模式（react-query）
变更：2026-09-27-knowledge-governance-cards
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given api 相关模块就绪；When 取数走既有 api 模式（react-query）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-knowledge-governance-cards/requirements.md#FR-03
最近确认：99c508227642192dc929cd0702441f3303a6ceff

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulbwfld:frontend/src/components/knowledge/__tests__/governance-cards.test.tsx
  tests: frontend/src/components/knowledge/__tests__/governance-cards.test.tsx
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 2cb3e7633c0df0ff5b263c3eb3fc845f2dcb5e3e
  source_change: 2026-09-27-knowledge-governance-cards
  status: active

## FR-lib-knowledge-004 pytest 覆盖端点（三类信号 fixture + 阈内 healthy + 权限）+ vites
变更：2026-09-27-knowledge-governance-cards
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 端点 / 组件 / 测试 相关模块就绪；When pytest 覆盖端点（三类信号 fixture + 阈内 healthy + 权限）+ vitest 组件测试（渲染/healthy/计数）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-knowledge-governance-cards/requirements.md#FR-04
最近确认：99c508227642192dc929cd0702441f3303a6ceff

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-27-knowledge-governance-cards:flow:FR-04
  tests: backend/app/modules/knowledge/tests/test_governance.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 2cb3e7633c0df0ff5b263c3eb3fc845f2dcb5e3e
  source_change: 2026-09-27-knowledge-governance-cards
  status: active

## FR-lib-knowledge-005 显式 pathspec 提交，不夹带并行会话 staged 面
变更：2026-09-27-knowledge-governance-cards
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 显式 pathspec 提交，不夹带并行会话 staged 面；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-knowledge-governance-cards/requirements.md#FR-05
最近确认：99c508227642192dc929cd0702441f3303a6ceff

## FR-lib-knowledge-006 daemon 新增 knowledge.digest RPC（RuntimeHandler 同款 s
变更：2026-09-27-governance-rpc-actions
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When daemon 新增 knowledge.digest RPC（RuntimeHandler 同款 spawn 模式：root_path 三道校验；Then cwd=仓库根跑 sillyspec knowledge digest --json，stdout JSON 透传
全文：.sillyspec/changes/archive/2026-09-27-governance-rpc-actions/requirements.md#FR-01
最近确认：3306460582a64242091b32ebee63a85f1b071444

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-27-governance-rpc-actions:flow:FR-01
  tests: sillyhub-daemon/tests/knowledge-governance-handler.test.ts「digest 成功」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-27-governance-rpc-actions
  status: active

## FR-lib-knowledge-007 缓存回退读点时降级跑——绑定信号随 cwd 缺工作树自然缺席）与 knowledge.action
变更：2026-09-27-governance-rpc-actions
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 缓存回退读点时降级跑——绑定信号随 cwd 缺工作树自然缺席）与 knowledge.action RPC（kind 白名单 repair-paths；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-governance-rpc-actions/requirements.md#FR-02
最近确认：3306460582a64242091b32ebee63a85f1b071444

## FR-lib-knowledge-008 redomain
变更：2026-09-27-governance-rpc-actions
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When redomain；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-governance-rpc-actions/requirements.md#FR-03
最近确认：3306460582a64242091b32ebee63a85f1b071444

## FR-lib-knowledge-009 域名参数过 [a-z0-9-]+ 元字符防线）
变更：2026-09-27-governance-rpc-actions
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 域名参数过 [a-z0-9-]+ 元字符防线）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-governance-rpc-actions/requirements.md#FR-04
最近确认：3306460582a64242091b32ebee63a85f1b071444

## FR-lib-knowledge-010 backend governance 端点 RPC 优先（workspace 绑定 daemon 在
变更：2026-09-27-governance-rpc-actions
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 端点 相关模块就绪；When backend governance 端点 RPC 优先（workspace 绑定 daemon 在线时直采 digest JSON 透传，含绑定信号），dae；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-governance-rpc-actions/requirements.md#FR-05
最近确认：3306460582a64242091b32ebee63a85f1b071444

## FR-lib-knowledge-011 POST /knowledge/governance/actions（KNOWLEDGE_WRITE
变更：2026-09-27-governance-rpc-actions
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When POST /knowledge/governance/actions（KNOWLEDGE_WRITE）：kind+params；Then RPC 执行
全文：.sillyspec/changes/archive/2026-09-27-governance-rpc-actions/requirements.md#FR-06
最近确认：3306460582a64242091b32ebee63a85f1b071444

## FR-lib-knowledge-012 伪域信号增 domains:[{name,count}] 数组供逐域迁移按钮
变更：2026-09-27-governance-rpc-actions
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 迁移 相关模块就绪；When 伪域信号增 domains:[{name,count}] 数组供逐域迁移按钮；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-governance-rpc-actions/requirements.md#FR-07
最近确认：3306460582a64242091b32ebee63a85f1b071444

## FR-lib-knowledge-013 frontend：坏绑定卡[执行 repair]按钮、伪域卡逐域[迁移到…输入目标域]按钮，muta
变更：2026-09-27-governance-rpc-actions
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 迁移 相关模块就绪；When frontend：坏绑定卡[执行 repair]按钮、伪域卡逐域[迁移到…输入目标域]按钮，mutation 后 refetch；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-governance-rpc-actions/requirements.md#FR-08
最近确认：3306460582a64242091b32ebee63a85f1b071444

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-27-governance-rpc-actions:flow:FR-08
  tests: frontend/src/components/knowledge/__tests__/governance-cards.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-27-governance-rpc-actions
  status: active

## FR-lib-knowledge-014 daemon 离线时按钮降隐藏（本地计算模式无动作能力）
变更：2026-09-27-governance-rpc-actions
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When daemon 离线时按钮降隐藏（本地计算模式无动作能力）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-governance-rpc-actions/requirements.md#FR-09
最近确认：3306460582a64242091b32ebee63a85f1b071444

## FR-lib-knowledge-015 daemon vitest（digest 透传/动作白名单/元字符拒）+ backend pytes
变更：2026-09-27-governance-rpc-actions
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 端点 / 组件 / 测试 相关模块就绪；When daemon vitest（digest 透传/动作白名单/元字符拒）+ backend pytest（RPC 优先/回退/动作端点）+ frontend 组件；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-governance-rpc-actions/requirements.md#FR-10
最近确认：3306460582a64242091b32ebee63a85f1b071444

## FR-lib-knowledge-016 显式 pathspec 提交
变更：2026-09-27-governance-rpc-actions
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 显式 pathspec 提交；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-27-governance-rpc-actions/requirements.md#FR-11
最近确认：3306460582a64242091b32ebee63a85f1b071444
