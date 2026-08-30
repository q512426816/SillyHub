# 决策知识 — backend_workspace

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-001@v1 编辑范围：完整文件编辑
状态：implemented
变更：2026-08-26-workspace-skill-edit
锚点：backend/app/modules/workspace/router.py（新端点段）
最近确认：45e05dbb
理由：skill 级新建/删除 + skill 目录内任意文本文件的新建/编辑/删除（含 SKILL.md）。

## D-004@v1 数据通道：SkillsViewService 直读直写 specDir
状态：implemented
变更：2026-08-26-workspace-skill-edit
锚点：backend/app/modules/workspace/skills_view_service.py
最近确认：45e05dbb
理由：SkillsViewService 经 SpecPathResolver 定位 specDir 本地直读直写（同 GET/MCP 变更先例）；不走 explorer 的 daemon RPC（其面向 workspace 项目根，非 specDir）。

## D-005@v1 daemon 零改动
状态：implemented
变更：2026-08-26-workspace-skill-edit
锚点：sillyhub-daemon/src/skill-manager.ts（只读依据）
最近确认：45e05dbb
理由：不动。daemon skill-manager 经既有 spec sync（manifest 增量）从 specDir/skills/ 拉到 worktree .claude/skills/workspace/——写文件即生效（下次同步）。
