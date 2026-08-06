---
change: 2026-08-05-skill-content-viewer
author: WhaleFall
created_at: 2026-08-06T10:00:00+08:00
---

# 模块影响分析（Module Impact）— /settings/skills 技能内容查看器

## 变更概述

为 /settings/skills 两块技能（系统自带 sillyspec-* + 自定义）增加右侧抽屉只读查看完整内容能力。后端新增白名单只读端点（方案 A），前端复用现有 @uiw/react-markdown-preview + 扩展 markdown-text size 变体 + 新建 SkillContentDrawer。

## 真实变更文件（git diff 478e8976..HEAD，10 文件）

**backend（3）：**
- backend/app/modules/agent/skills_bundle_service.py
- backend/app/modules/daemon/router.py
- backend/app/modules/daemon/tests/test_skill_content_endpoint.py（新）

**frontend（7）：**
- frontend/src/app/(dashboard)/settings/skills/page.tsx
- frontend/src/app/(dashboard)/settings/skills/__tests__/page.test.tsx
- frontend/src/components/ui/markdown-text.tsx
- frontend/src/components/skill-content-drawer.tsx（新）
- frontend/src/components/__tests__/skill-content-drawer.test.tsx（新）
- frontend/src/lib/custom-skills.ts
- frontend/src/lib/query-keys.ts

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|------|----------|----------|-------------|-------------|
| agent | 接口变更（新增辅助函数） | backend/app/modules/agent/skills_bundle_service.py | 新增 `read_skill_md(skill_name)`：白名单（sillyspec-* glob 同源 SKILLS_GLOB）+ 固定读 SKILL.md（不拼 path，穿越免疫）+ 三分支异常（非白名单/缺失→FileNotFoundError、>1MiB→ValueError）；纯 stdlib 不引 FastAPI | false |
| daemon | 接口变更（新增只读端点） | backend/app/modules/daemon/router.py, tests/test_skill_content_endpoint.py | 新增 `GET /api/daemon/skills/{skill_name}/content`（声明在 manifest/bundle 之后，权限 get_current_principal，catch 转 HTTPException 404/413）；5 场景测试。**不改** daemon lifecycle/session/lease/WS/心跳/状态机 | false |
| frontend | 新增 + 逻辑变更 | markdown-text.tsx, skill-content-drawer.tsx, page.tsx, custom-skills.ts, query-keys.ts + 2 测试 | markdown-text 加 `size:"compact"\|"reading"` 变体（compact 默认兼容 6+ 处复用）；新建 SkillContentDrawer（antd 抽屉，platform usePlatformSkillContent / custom useQuery 缓存对称）；page 平台最后一列查看按钮 + 自定义查看按钮；custom-skills 加 getPlatformSkillContent + usePlatformSkillContent；query-keys 加 content(name) 参数化工厂 | false |

## 未匹配文件

无（10 文件全部匹配到 agent/daemon/frontend 模块）。

## 跨模块依赖

- daemon 端点 → 调 agent.skills_bundle_service.read_skill_md（agent 提供文件读取，daemon 提供路由）
- frontend → 调 daemon 端点（getPlatformSkillContent）+ 复用 skills 模块 custom-skills detail（getCustomSkill）
- skills 模块：未直接改文件，但前端复用其 custom-skills API（GET /custom-skills/{id} detail）

## 不触碰（重要不变量）

- daemon lifecycle/session/lease/WS/心跳/状态机（design「不涉及生命周期契约」）
- 启动入口 cli.ts/main.ts/server.ts（design「入口接线路径检查：不改入口文件」）
- 数据库 schema（无 migration，无 alembic）
- daemon 同步/bundle 打包逻辑（manifest 端点不改）
- 前端依赖（不引新包，复用现有 @uiw/react-markdown-preview）
