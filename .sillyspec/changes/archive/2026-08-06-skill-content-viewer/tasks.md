---
change: 2026-08-05-skill-content-viewer
author: WhaleFall
created_at: 2026-08-05T22:52:51+08:00
---

# Tasks: 技能内容查看器

> 修订（Design Grill 后）：前端不引新依赖（复用 `@uiw/react-markdown-preview`）；权限用 `get_current_principal`；补 SKILL.md 缺失/大小上限/路由顺序。

## Wave 1：后端内容端点

- [ ] T1 `skills_bundle_service.py` 新增 `read_skill_md(skill_name)`：白名单校验（`skills_bundle_dir.glob("sillyspec-*")`，与 `SKILLS_GLOB` 同源）+ 读 `<skill_name>/SKILL.md`；分支：非白名单→404、白名单内但 SKILL.md 缺失→404（message 区分）、>1 MiB→413（拒绝不截断）
- [ ] T2 `daemon/router.py` 新增 `GET /skills/{skill_name}/content` 端点：权限 `get_current_principal`（与 manifest/bundle 一致），**声明在 manifest/bundle 端点之后**作防御；返回 `{skill_name, content}`
- [ ] T3 后端测试 `test_skill_content_endpoint.py`：白名单内返回内容 / 非白名单 404 / 非 sillyspec- 前缀 404 / SKILL.md 缺失 404 / >1MiB 413 / 不接受任意 path（穿越免疫）

## Wave 2：前端 markdown 渲染（复用现有，不引依赖）

- [ ] T4 扩展 `components/ui/markdown-text.tsx` 加 `size: "compact" | "reading"` 变体（reading 用于抽屉长文：更大字号/行距；compact 默认保持现有 6+ 处复用不动）。**不新引依赖、不新建 markdown-viewer 组件**

## Wave 3：前端抽屉与接入

- [ ] T5 `lib/custom-skills.ts`：加 `getPlatformSkillContent(name)` fetch + `PlatformSkillContent` 类型 + `usePlatformSkillContent` hook
- [ ] T6 `components/skill-content-drawer.tsx`：antd 右侧 Drawer，按 `kind: "platform" | "custom"` 加载内容（platform 调新端点 / custom 调 `getCustomSkill`），用 `<MarkdownText size="reading">` 渲染
- [ ] T7 `settings/skills/page.tsx`：平台技能名可点击/加查看入口 → 开抽屉（kind=platform）；自定义技能操作列加「查看」按钮 → 开抽屉（kind=custom）

## Wave 4：验证

- [ ] T8 前端组件测试（MarkdownViewer 渲染 + SkillContentDrawer 加载/展示两种 kind）
- [ ] T9 `pnpm gen:types` 确认 + 手写类型字段对齐；lint / typecheck / test 全过
- [ ] T10 对照 design + requirements 验收，实现效果与已确认原型一致
