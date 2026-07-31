---
author: qinyi
created_at: 2026-07-31 12:45:00
---

# 模块影响分析（Module Impact）— skills-settings-p0-fixup 自定义技能 frontmatter 修复 + 技能管理 UI 优化

## 变更概述

修复自定义技能打包缺 YAML frontmatter 致 AI 无法识别触发的真凶 bug（后端打包层 `_build_skill_md` 拼 frontmatter），并优化技能管理页/编辑弹窗体验（步骤模板、头部预览、生效提示、新手引导、只读 banner）。不改 daemon、不改 DB schema、不改 CustomSkill 字段定义。

## 真实变更文件（git diff cd0381e4，以 git diff 为准）

源码文件：
- backend/app/modules/agent/skills_bundle_service.py
- backend/app/modules/skills/model.py
- backend/app/modules/skills/schema.py
- backend/app/modules/daemon/tests/test_skills_bundle.py
- frontend/src/components/custom-skill-edit-dialog.tsx
- frontend/src/app/(dashboard)/settings/skills/page.tsx
- frontend/src/components/__tests__/custom-skill-edit-dialog.test.tsx
- frontend/src/app/(dashboard)/settings/skills/__tests__/page.test.tsx

契约文件（gen:types 产物）：
- backend/openapi.json
- frontend/src/lib/api-types.ts

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|------|----------|----------|-------------|-------------|
| backend/skills | 逻辑变更 + 接口契约（注释/描述文本） | model.py, schema.py | content 列注释对齐「frontmatter 由打包层组装，DB 只存 body」；schema content Field description 文本更新（进 openapi.json，类型不变） | false |
| backend/agent | 逻辑变更 | skills_bundle_service.py | 新增 `_build_skill_md`：打包层用 name+description 拼 YAML frontmatter + body；防双拼（content 已含 `---` 原样返回）；`_collect_custom_skills` 调用它 | false |
| backend/daemon | 测试变更 | tests/test_skills_bundle.py | `test_manifest_includes_custom_skills` + `test_bundle_includes_custom_skills` 断言由「原样 content」改为「frontmatter + body」，sha256 匹配拼装结果 | false |
| frontend/设置·技能 | 逻辑变更 + UI | custom-skill-edit-dialog.tsx, settings/skills/page.tsx | 编辑弹窗：步骤模板骨架 + 插入按钮 + 描述触发提示 + 头部预览 + 统一校验禁用 + 脏检测撤销 + 生效 useNotify；页面：可折叠新手引导卡 + 上区灰字效果说明 + 副标题白话化 + 非管理员 amber 只读 banner | false |
| frontend/测试 | 测试新增/更新 | __tests__/custom-skill-edit-dialog.test.tsx, settings/skills/__tests__/page.test.tsx | 弹窗专项 6 测试（头部预览/校验/模板/notify/撤销）+ 页面 6 测试更新（useNotify mock / placeholder 适配 / amber banner 断言） | false |
| 契约（跨模块） | 接口契约同步 | openapi.json, api-types.ts | `pnpm gen:types` 同步 schema description 文本变更（DTO 字段类型未变） | false |

## 未匹配文件

无。所有源码文件均映射到已配置模块（backend/skills、backend/agent、backend/daemon、frontend）。

## 三重交叉验证

- 声明范围（design.md 文件变更清单）：backend skills_bundle_service + model + schema + daemon test + frontend 弹窗/页面/测试 → 与 git diff 一致
- 任务范围（tasks/task-01~04 allowed_paths）：task-01 后端 4 文件、task-02 弹窗、task-03 页面、task-04 测试 → 与 git diff 一致
- 真实变更（git diff）：上述 8 源码 + 2 契约产物 → 声明/任务/真实三者一致，无遗漏、无多余

## 结论

变更范围集中、可控，影响 backend/skills、backend/agent、backend/daemon（测试）、frontend 四个模块，均为本变更直接相关，无意外扩散。契约层经 gen:types 同步，无类型债。
