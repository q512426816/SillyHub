---
author: sillyspec-fr-index
created_at: 2026-10-08T17:53:22.647Z
---

# FR 索引 — auto-claude

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 伪域（auto- 前缀）：由文件路径段投票派生，无模块卡——为该域补模块卡后，新变更将自动落回真域

## FR-auto-claude-001 onlyoffice-restore-fonts.sh 两处 tar 解包 docker exec 与同文件既有调用一致带 MSYS_NO_PATHCONV=1，Git Bash 下路径参数不再被 MSYS 改写
变更：2026-10-09-msys-fonts-guard
状态：active
摘要：Git Bash 下字体恢复不再中断
全文：.sillyspec/changes/archive/2026-10-09-msys-fonts-guard/requirements.md#FR-01
最近确认：f8f068a1fa86fad636f25df52ea68838e7b1c73b

## FR-auto-claude-002 .claude/skills/sillyhub-docker-deploy/SKILL.md 与 .codex 副本同步为 .zcode 现行版内容（claude-data 卷/claude --version 等退役面描述消除）
变更：2026-10-09-msys-fonts-guard
状态：active
摘要：三副本一致
全文：.sillyspec/changes/archive/2026-10-09-msys-fonts-guard/requirements.md#FR-02
最近确认：f8f068a1fa86fad636f25df52ea68838e7b1c73b

## FR-auto-claude-003 shell 语法门通过（bash -n），无其它回归面（脚本其余行零改动）
变更：2026-10-09-msys-fonts-guard
状态：active
摘要：最小改动面
全文：.sillyspec/changes/archive/2026-10-09-msys-fonts-guard/requirements.md#FR-03
最近确认：f8f068a1fa86fad636f25df52ea68838e7b1c73b

## FR-auto-claude-004 鼠标悬停底部区域标签时，浮层翻到鼠标上方显示，永远在视口内
变更：2026-10-12-ws-ref-hover-tip-flip
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 输入框贴页面底缘、鼠标悬停标签（y≈720，视口高 768）/ When 浮层渲染 / Then top=662（鼠标上方）且在视口内。
全文：.sillyspec/changes/archive/2026-10-12-ws-ref-hover-tip-flip/requirements.md#FR-01
最近确认：1ec1af9dd914b8145359bc47258a258ae36335f4

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-ws-ref-hover-tip-flip:flow:测试绑定FR-01
  tests: test/frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx「hoverTip 底部空间不足翻到鼠标上方（输入框贴页面底缘场景，2026-10-12 修复）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-ws-ref-hover-tip-flip
  status: active

## FR-auto-claude-005 常规位置（下方有空间）仍显示在鼠标下方 16px
变更：2026-10-12-ws-ref-hover-tip-flip
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given y=200 / When 渲染 / Then top=216。
全文：.sillyspec/changes/archive/2026-10-12-ws-ref-hover-tip-flip/requirements.md#FR-02
最近确认：1ec1af9dd914b8145359bc47258a258ae36335f4

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-ws-ref-hover-tip-flip:flow:测试绑定FR-02
  tests: test/frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-ws-ref-hover-tip-flip
  status: active

## FR-auto-claude-006 相关测试全绿
变更：2026-10-12-ws-ref-hover-tip-flip
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given vitest run input-ref-overlay.test.tsx / Then 14/14 通过。
全文：.sillyspec/changes/archive/2026-10-12-ws-ref-hover-tip-flip/requirements.md#FR-03
最近确认：1ec1af9dd914b8145359bc47258a258ae36335f4

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-ws-ref-hover-tip-flip:flow:测试绑定FR-03
  tests: test/frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-ws-ref-hover-tip-flip
  status: active
