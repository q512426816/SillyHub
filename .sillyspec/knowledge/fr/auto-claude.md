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
