---
author: sillyspec-fr-index
created_at: 2026-10-08T02:08:13.622Z
---

# FR 索引 — auto-zcode

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 伪域（auto- 前缀）：由文件路径段投票派生，无模块卡——为该域补模块卡后，新变更将自动落回真域

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

## FR-auto-zcode-005 服务器有固定目录承载 multi-agent-platform 的 docs/releases 镜像（容器可读，经 /tmp 挂载）
变更：2026-10-14-release-notes-server-sync
状态：active
摘要：主路径；目录被清（/tmp 重启清空）
全文：.sillyspec/changes/archive/2026-10-14-release-notes-server-sync/requirements.md#FR-01
最近确认：c0d30b157200e183168da8c8872fdab1772b8097

## FR-auto-zcode-006 workspace 行指向该目录且页面能列出记录（seq/状态/提交数/正文渲染数据齐）
变更：2026-10-14-release-notes-server-sync
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-14-release-notes-server-sync/requirements.md#FR-02
最近确认：c0d30b157200e183168da8c8872fdab1772b8097

## FR-auto-zcode-007 deploy-to-server skill 增「发布记录（每次部署必做）」节：写记录（引用 sillyhub-docker-deploy 契约）+ 部署后同步命令
变更：2026-10-14-release-notes-server-sync
状态：active
摘要：主路径；跳过同步
全文：.sillyspec/changes/archive/2026-10-14-release-notes-server-sync/requirements.md#FR-03
最近确认：c0d30b157200e183168da8c8872fdab1772b8097

## FR-auto-zcode-008 本次热修部署（a176393cb）补写记录 #002 并同步到服务器验证全链
变更：2026-10-14-release-notes-server-sync
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-14-release-notes-server-sync/requirements.md#FR-04
最近确认：c0d30b157200e183168da8c8872fdab1772b8097
