---
change: 2026-08-05-skill-content-viewer
title: 技能内容查看器
author: WhaleFall
created_at: 2026-08-05T22:52:51+08:00
---

# Proposal: 技能内容查看器

> r2：与 design 同步（复用现有 `@uiw/react-markdown-preview`，不引新依赖；扩展现有 markdown-text 加 size 变体，不新建渲染组件）。

## 背景

`/settings/skills` 页面管理技能（给 AI 看的操作说明书）。当前平台技能和自定义技能都无法只读查看完整内容：
- 平台技能完全看不了内容（表格只有名字/文件数/说明）。
- 自定义技能要看完整内容只能进编辑框（编辑模式，不是单纯查看）。

用户希望点开技能就能看完整 SKILL.md 内容。

## 目标

为两块技能增加「右侧抽屉 + markdown 富文本渲染」的只读查看能力，统一交互。

## 方案概述

- **后端**：新增 `GET /api/daemon/skills/{skill_name}/content`，skill_name 限 manifest 已知的 sillyspec-* 白名单，返回该目录 SKILL.md（白名单 + 固定文件名，防路径穿越），权限 `get_current_principal`。
- **前端**：复用现有 `@uiw/react-markdown-preview`，扩展现有 `components/ui/markdown-text.tsx` 加 `size: "compact" | "reading"` 变体，新增 `SkillContentDrawer`（antd 右侧抽屉），settings/skills 页面表格加查看入口。
- **自定义技能**：复用现有 `GET /custom-skills/{id}`（后端零改），前端加只读查看入口。

## 非目标（Non-Goals）

- 不做技能编辑（仅查看；编辑沿用现有 CustomSkillEditDialog）。
- 不做文件树（平台技能实际每目录单 SKILL.md）。
- 不改 manifest 端点语义（daemon 同步不受影响）。
- 不展示非 sillyspec-* 技能（deploy-to-server / sillyhub-docker-deploy 是项目工具技能，非平台分发技能）。
- 不做技能版本对比/diff。
- 不改 daemon 同步/bundle 打包逻辑。
- 不新建 markdown 渲染组件（复用现有 markdown-text + @uiw）。

## 影响范围

- **后端**：daemon 模块（新端点）+ agent 模块（skills_bundle_service 辅助）。
- **前端**：settings/skills 页面 + 新组件 `SkillContentDrawer` + 扩展现有 `components/ui/markdown-text.tsx`（加 size 变体）+ lib/custom-skills.ts。
- **数据库**：无改动（无 schema 变更，不需 alembic migration）。
- **daemon 同步**：不受影响（manifest 不改）。
- **依赖**：无新增（复用现有 `@uiw/react-markdown-preview`）。
