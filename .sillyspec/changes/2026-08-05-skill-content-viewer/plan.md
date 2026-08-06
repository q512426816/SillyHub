---
change: 2026-08-05-skill-content-viewer
author: WhaleFall
created_at: 2026-08-05T22:58:00+08:00
plan_level: independent
---

# 实现计划：/settings/skills 技能内容查看器

## 概述

为 `/settings/skills` 两块技能（系统自带 sillyspec-* + 自定义）增加右侧抽屉只读查看完整内容能力。后端新增白名单端点（方案 A），前端复用现有 `@uiw/react-markdown-preview` + 扩展 `markdown-text` 加 size 变体，不引新依赖。

依据：design.md（D-001..D-007 决策）+ requirements.md（FR-01..07）+ tasks.md。

## 入口接线路径检查

本变更**不改入口文件**（cli.ts / main.ts / server.ts）：`daemon/router.py` 是后端业务路由（非入口），前端 `page.tsx` 是页面组件（非 main.ts 入口）。无入口接线路径问题。

## Wave 1：后端内容端点（无外部依赖，可独立先做）

- [x] task-01: read_skill_md 辅助（backend/app/modules/agent/skills_bundle_service.py）— 满足 FR-04
  - 步骤：新增 `read_skill_md(skill_name) -> str`；白名单 `skills_dir.glob(SKILLS_GLOB)` 同源校验（不在→HTTPException 404）；固定读 `<skill>/SKILL.md`（缺失→HTTPException 404 message 区分）；>1 MiB→HTTPException 413；不拼 path
  - 完成标准：白名单同源 SKILLS_GLOB；三分支异常独立可测；穿越免疫
  - 依赖：无

- [x] task-02: 内容端点（backend/app/modules/daemon/router.py）— 满足 FR-03、FR-04、FR-06
  - 步骤：新增 `@router.get("/skills/{skill_name}/content")`，**声明在 `/skills/latest/manifest`(L2443)、`/skills/latest/bundle`(L2463) 之后**；权限 `Depends(get_current_principal)`；调 read_skill_md，异常映射 404/413；返回 `{skill_name, content}`（无 response_model，前端手写类型）
  - 完成标准：200 返内容；非白名单/缺失→404；超限→413；权限 get_current_principal；声明在 manifest/bundle 后
  - 依赖：task-01

- [x] task-03: 后端测试（backend/app/modules/daemon/tests/test_skill_content_endpoint.py，新增）— 满足 FR-04
  - 步骤：5 场景——白名单内返 200+content；非 sillyspec- 前缀 404；SKILL.md 缺失 404（message 区分）；>1MiB 413；穿越免疫
  - 完成标准：5 场景全过
  - 依赖：task-01, task-02

## Wave 2：前端 markdown 渲染基建（无依赖，可与 Wave 1 并行）

- [x] task-04: 扩展 markdown-text size 变体（frontend/src/components/ui/markdown-text.tsx）— 满足 FR-05、NFR-02
  - 步骤：加 `size?: "compact" | "reading"` prop 默认 "compact"（现有 6 处复用不传 size，零行为变化）；reading 更大字号/行距
  - 完成标准：compact 默认不变（回归通过）；reading 长文易读
  - 依赖：无

## Wave 3：前端抽屉与接入（依赖 Wave 1 端点 + Wave 2 markdown-text）

- [x] task-05: 平台 skill content fetch（frontend/src/lib/custom-skills.ts + frontend/src/lib/query-keys.ts）— 满足 FR-01
  - 步骤：加 `PlatformSkillContent` 类型；`getPlatformSkillContent(name)` 调 `GET /api/daemon/skills/{name}/content`；`usePlatformSkillContent(name?)` hook；**query key 参数化工厂** `queryKeys.customSkills.content(name) => [...customSkills, "content", name]`（防不同 skill 缓存串）；改 query-keys.ts 加 content 工厂
  - 完成标准：fetch/hook/类型齐；query key 参数化；错误处理对齐 apiFetch
  - 依赖：task-02

- [x] task-06: SkillContentDrawer 组件（frontend/src/components/skill-content-drawer.tsx，新增）— 满足 FR-01、FR-02、FR-05、FR-07
  - 步骤：antd Drawer（右侧 width 560 destroyOnClose）；props `{open,onClose,kind:"platform"|"custom",skillName?,skillId?}`；platform 用 `usePlatformSkillContent(skillName)`、custom 用 hook（与 platform 缓存对称，非裸调）；渲染 `<MarkdownText size="reading">`；loading/error/empty 状态
  - 完成标准：两种 kind 加载+渲染；loading/error 处理；缓存策略对称
  - 依赖：task-04, task-05, 现有 getCustomSkill

- [x] task-07: page.tsx 接入查看入口（frontend/src/app/(dashboard)/settings/skills/page.tsx）— 满足 FR-01、FR-02、FR-07
  - 步骤：加 drawer 状态 `{kind,skillName?,skillId?}|null`；平台技能名可点击→setDrawer({kind:"platform",skillName:g.name})；自定义操作列加「查看」按钮→setDrawer({kind:"custom",skillId:s.id})；渲染 `<SkillContentDrawer open onClose {...drawer}/>`
  - 完成标准：两块都能点开抽屉；不破坏现有 CRUD
  - 依赖：task-06

## Wave 4：验证（依赖 Wave 1-3）

- [x] task-08: 前端组件测试（frontend/src/components/__tests__/）— 满足 FR-01、FR-02、FR-05
  - 步骤：测 MarkdownText reading/compact 渲染；SkillContentDrawer platform/custom 加载+展示（mock fetch）
  - 完成标准：组件测试过
  - 依赖：task-04, task-06

- [x] task-09: gen:types + lint/typecheck/test — 满足 NFR-01、NFR-04
  - 步骤：`pnpm gen:types`（确认无 regression）；frontend lint + typecheck + test 全过；backend ruff（router.py + skills_bundle_service.py）
  - 完成标准：全绿
  - 依赖：task-01..task-08

- [x] task-10: 验收 — 满足 FR-01..FR-07
  - 步骤：对照 design + requirements 验收（FR-01..07 逐项）；实现效果与原型一致；人工点开平台+自定义技能看渲染
  - 完成标准：验收通过，可 archive
  - 依赖：task-01..task-09

## Wave 依赖图

```
Wave1: task-01 → task-02 → task-03   （后端，无外部依赖）
Wave2: task-04                        （前端渲染基建，独立）
Wave3: task-05(←02) → task-06(←04,05) → task-07(←06)
Wave4: task-08(←04,06), task-09(←all), task-10(←all)
```

Wave 1 与 Wave 2 可并行（后端/前端独立）。Wave 3 依赖 Wave 1 端点 + Wave 2 markdown-text。Wave 4 全量验证。

## 非目标（对齐 proposal）

不做编辑、不做文件树、不改 manifest 语义、不展示非 sillyspec-* 技能、不新建 markdown-viewer 组件、不引新依赖。

## FR 覆盖矩阵

| FR | 覆盖 task |
|---|---|
| FR-01 平台技能查看 | task-05, task-06, task-07, task-08 |
| FR-02 自定义只读查看 | task-06, task-07, task-08 |
| FR-03 内容端点 | task-02 |
| FR-04 路径安全+边缘 | task-01, task-02, task-03 |
| FR-05 markdown 渲染 | task-04, task-06, task-08 |
| FR-06 权限 | task-02 |
| FR-07 抽屉交互 | task-06, task-07 |
