---
change: 2026-08-05-skill-content-viewer
title: /settings/skills 技能内容查看器
author: WhaleFall
created_at: 2026-08-05T22:52:51+08:00
scale: large
tier: self
status: drafting
risk_level: unit-sufficient
---


# /settings/skills 技能内容查看器

> 修订记录：
> - r1（Design Grill 初审）：修正 4 项结构性矛盾（P0-1 前端已有 markdown 库、P0-2 权限依赖名、P1-1 路由顺序、P1-2/3 大小上限与 SKILL.md 缺失）。
> - r2（Design Grill 复审）：修正四件套一致性——同步 requirements；markdown 组件方案固定为「扩展现有 markdown-text.tsx 加 size 变体」（不再「择优」、不新建 markdown-viewer）。

## 背景与目标

`/settings/skills` 页面管理「给 AI 看的操作说明书」（技能）。当前两块都无法只读查看完整内容：
- **平台技能（系统自带 sillyspec-\*）**：表格只列 name/file_count/description，manifest 端点只返回 path+sha256+摘要，**看不到 SKILL.md 内容**。
- **自定义技能**：列表只有 content_preview（前 120 字），看完整 content 要进编辑框（编辑模式，非只读查看）。

**目标**：为两块都增加「只读查看完整内容」能力，统一右侧抽屉 + markdown 富文本渲染。

## 现状与问题

- 平台 skills 文件源 `config.skills_bundle_dir=/app/sillyspec-skills`，每个 sillyspec-* 目录下**单 SKILL.md**（22 文件全 .md，无子目录/二进制）。`_collect_skill_files` 已读到 bytes，但 `build_skills_manifest` 只返回 path+sha256+摘要，不返回 content。`SKILLS_GLOB="sillyspec-*"`。
- manifest 端点 `GET /api/daemon/skills/latest/manifest`（daemon/router.py:2444，权限 `get_current_principal`），不含内容。
- custom-skills `GET /custom-skills/{id}` 已返回完整 content（`CustomSkillDetail`），前端未用于只读查看。
- **前端已有 markdown 渲染能力**：`@uiw/react-markdown-preview ^5.2.1`（package.json:24，底层即 react-markdown + remark-gfm 的封装），已有可复用组件 `components/ui/markdown-text.tsx`（已被 scan-docs/page.tsx、agent-log-viewer、change-file-tree、custom-skill-edit-dialog 等 6+ 处复用）。**无需新引依赖、无需新建渲染组件**。

## 方案设计（方案 A：白名单 + 固定 SKILL.md，已选定）

### 后端：新增只读内容端点

`GET /api/daemon/skills/{skill_name}/content`（daemon/router.py，与 manifest 同模块同前缀）

- **白名单校验**：`skill_name` 必须在 `skills_bundle_dir` 下 `sillyspec-*` 目录名集合内（`Path.glob("sillyspec-*")`，与 `SKILLS_GLOB` 同源）。不在白名单 → 404。
- **固定文件**：只读 `<skills_bundle_dir>/<skill_name>/SKILL.md`，**不拼接用户传入 path** → 天然防路径穿越。
- **边缘：白名单内目录但 SKILL.md 缺失** → 404（message 注明「skill 无 SKILL.md」，与「非白名单」区分）。
- **响应**：`{ "skill_name": str, "content": str }`（content = SKILL.md 全文）。
- **大小上限**：SKILL.md 读取后若 > 1 MiB → 返 413（拒绝，不截断，保持只读语义干净；当前最大约几 KB，正常不会触发）。
- **权限**：`get_current_principal`（**与 manifest/bundle 端点同模块一致**，daemon/router.py 全模块用此依赖，接受浏览器 JWT + daemon X-API-Key；反正 bundle 端点已可拿全文，权限对齐 manifest 即可）。
- 实现：`skills_bundle_service` 新增 `read_skill_md(skill_name)` 辅助（白名单校验 + 读 SKILL.md + 大小校验，缺失/超限/非白名单分别抛对应异常），router 调用。

### 路由声明顺序（防御性）

现有同前缀端点：`/skills/latest/manifest`、`/skills/latest/bundle`（第三段为静态 `latest`）。新端点 `/skills/{skill_name}/content` 第三段为静态 `content`，**与 latest/manifest/bundle 互异，不会真冲突**。但为防御（避免 `{skill_name}` 在第二段未来扩展时误捕获静态段），新端点**声明在 manifest/bundle 端点之后**。

### 前端：抽屉 + 复用现有 markdown 渲染

- **依赖**：**不新增**。复用现有 `@uiw/react-markdown-preview`。
- **渲染组件**：**扩展现有 `components/ui/markdown-text.tsx`** 加 `size: "compact" | "reading"` 变体——
  - `reading`（新增）：用于抽屉长文阅读，更大字号/行距。
  - `compact`（默认）：保持现有紧凑型，6+ 处复用点不动（向后兼容）。
  - **不新建 markdown-viewer 组件**（减少组件数 + 复用同栈）。
- **SkillContentDrawer**（`components/skill-content-drawer.tsx`）：antd 右侧 Drawer（项目已广泛用 antd Drawer），按 `kind: "platform" | "custom"` 加载内容：
  - platform：调 `getPlatformSkillContent(skill_name)`
  - custom：调 `getCustomSkill(id)` 取 content
  - 用 `<MarkdownText size="reading">` 渲染。
- **page.tsx**（skill_name 来源：`manifest.skills[].name` 或 `deriveSkillGroups(files)` 聚合的顶层目录名，均为 sillyspec-* 目录名，与新端点口径一致）：
  - 平台技能表格：技能名可点击 → 开抽屉（kind=platform）。
  - 自定义技能表格：操作列加「查看」按钮 → 开抽屉（kind=custom）。
- **lib/custom-skills.ts**：加 `getPlatformSkillContent(name)` fetch + `PlatformSkillContent` 类型 + `usePlatformSkillContent` hook。

### 数据流

- 平台：page 点击 → SkillContentDrawer(kind=platform) → `getPlatformSkillContent` → `GET /api/daemon/skills/{name}/content` → 后端白名单校验 + 读 SKILL.md → content → MarkdownText(reading) 渲染。
- 自定义：page 点击查看 → SkillContentDrawer(kind=custom) → `getCustomSkill(id)` → `GET /api/custom-skills/{id}` → content → 渲染。

## 决策记录（Decisions）

> 关键技术决策（方案选择 + 理由 + trade-off），供 plan 拆任务与 execute 实现遵循。

### D-001: 后端读平台 skill 文件方案 = 方案 A（白名单 + 固定 SKILL.md）
- **选择**：`GET /api/daemon/skills/{skill_name}/content`，skill_name 限 sillyspec-* 白名单，固定读 `<skill>/SKILL.md`，不拼 path。
- **理由**：天然防路径穿越（不接受任意 path）；匹配平台技能实际单 SKILL.md 现状（22 文件全 md 无子目录）。
- **trade-off**：仅能读 SKILL.md，未来技能若多文件需扩展 path 参数（届时加严格穿越校验）。
- **superseded**：方案 B（接受 path + 穿越校验，当前用不上 + 安全面）、方案 C（manifest 带 content，语义污染 + 响应膨胀）。

### D-002: markdown 渲染 = 复用 @uiw/react-markdown-preview + 扩展 markdown-text size 变体
- **选择**：不引新依赖，扩展现有 `components/ui/markdown-text.tsx` 加 `size: "compact" | "reading"` 变体。
- **理由**：项目已有 `@uiw/react-markdown-preview`（package.json:24）+ `markdown-text.tsx`（6+ 处复用）；避免 ~150KB 冗余依赖 + 技术栈碎片化。
- **trade-off**：需保证 compact 默认值向后兼容（现有 6 处复用不动）。
- **superseded**：新建 markdown-viewer 组件、引入 react-markdown + remark-gfm（Design Grill r1 P0-1 否决）。

### D-003: 平台技能展示范围 = sillyspec-*（与 manifest/AI 加载一致）
- **选择**：只展示 sillyspec-* 技能。
- **理由**：与 `SKILLS_GLOB` + manifest + AI 加载范围一致；deploy-to-server / sillyhub-docker-deploy 是项目工具技能，非平台分发。

### D-004: 内容端点权限 = get_current_principal
- **选择**：`get_current_principal`（与 manifest/bundle 同模块一致）。
- **理由**：daemon/router.py 全模块用此依赖，接受浏览器 JWT + daemon X-API-Key；bundle 端点已可拿全文，权限对齐 manifest。
- **superseded**：`get_current_user`（skills 模块 `CurrentUser` 别名，跨模块混用，Design Grill r1 P0-2 否决）。

### D-005: 大小上限 = >1 MiB 返 413 不截断
- **选择**：SKILL.md >1 MiB → 413 拒绝，不截断。
- **理由**：保持只读语义干净；当前最大约几 KB，正常不触发。
- **trade-off**：超大 SKILL.md 无法查看（极端情况，可后续调阈值）。

### D-006: SKILL.md 缺失 = 404（message 区分非白名单）
- **选择**：白名单内目录但 SKILL.md 缺失 → 404，message 注明「skill 无 SKILL.md」，与非白名单 404 区分。

### D-007: 路由声明顺序 = 新端点声明在 manifest/bundle 之后
- **选择**：`/skills/{skill_name}/content` 声明在 `/skills/latest/manifest`、`/skills/latest/bundle` 之后。
- **理由**：防御性（第三段 content 与 latest 静态段互异不冲突，但声明在后避免未来 `{skill_name}` 误捕获静态段）。

## 文件变更清单

**新增：**
- `frontend/src/components/skill-content-drawer.tsx`（右侧抽屉，用 MarkdownText size=reading 渲染）
- `backend/app/modules/daemon/tests/test_skill_content_endpoint.py`（新端点测试）
- `frontend/src/components/__tests__/skill-content-drawer.test.tsx`（抽屉组件测试）

**修改：**
- `backend/app/modules/daemon/router.py`（新增 `GET /skills/{skill_name}/content` 端点，声明在 manifest/bundle 之后，权限 `get_current_principal`）
- `backend/app/modules/agent/skills_bundle_service.py`（新增 `read_skill_md(skill_name)` 辅助：白名单 + 读 SKILL.md + 缺失/超限/非白名单分别处理）
- `frontend/src/components/ui/markdown-text.tsx`（加 `size: "compact" | "reading"` 变体；compact 默认保持现有行为不动）
- `frontend/src/app/(dashboard)/settings/skills/page.tsx`（表格加查看入口）
- `frontend/src/lib/custom-skills.ts`（getPlatformSkillContent + 类型 + hook）
- `frontend/src/lib/query-keys.ts`（`customSkills.content(name)` 参数化工厂，防不同 skill 缓存串）
- `frontend/src/app/(dashboard)/settings/skills/__tests__/page.test.tsx`（mock 补 `usePlatformSkillContent` export，适配新增子组件）

**不改：** `frontend/package.json`（复用现有 `@uiw/react-markdown-preview`，不引新依赖）；**不新建** markdown-viewer 组件。

**原型（已确认）：** `prototype-skill-content-viewer.html`

## 风险登记

| 风险 | 等级 | 缓解 |
|---|---|---|
| 路径穿越（读任意文件） | 高 | 方案 A：skill_name 白名单 + 固定 SKILL.md，不拼 path，天然免疫 |
| markdown XSS | 低 | 复用现有 `@uiw/react-markdown-preview`（默认转义，不引入 rehype-raw），与项目其他 markdown 展示处同栈 |
| 大文件（SKILL.md 过大） | 低 | >1 MiB 返 413 拒绝（不截断）；当前全为几 KB |
| markdown-text size 变体兼容 | 低 | compact 默认值保持现有行为，6+ 处复用点显式 compact 或依赖默认，向后兼容；reading 仅抽屉用 |
| 路由声明顺序 | 低 | 第三段 content 与 latest 静态段不冲突；新端点声明在 manifest/bundle 之后作防御 |
| manifest 端点语义污染 | 低 | 不改 manifest，独立新端点 |
| gen:types 类型债 | 低 | custom-skills/新端点走前端手写类型（对齐现有模式），注意字段同步 |

## 生命周期契约

**不涉及生命周期契约。** 本变更是只读内容查看（新增 GET 端点 + 前端展示），不涉及 session/lease/agent_run/daemon 状态机或生命周期事件，不适用 lifecycle contract。

## 自审（Self-Review）

- ✅ 方案 A 白名单 + 固定文件，安全（无路径穿越面），匹配「平台技能实际单 SKILL.md」现状
- ✅ 自定义技能复用现有 detail 端点，后端零改
- ✅ 复用现有 `@uiw/react-markdown-preview` + 扩展 `markdown-text.tsx` 加 size 变体（reading/compact），不引新依赖、不新建渲染组件（避免 ~150KB 冗余 + 技术栈碎片化）
- ✅ 权限用 `get_current_principal`（与 manifest/bundle 同模块一致），不混用 skills 模块的 `CurrentUser`
- ✅ 路由声明顺序已注明（不冲突 + 防御性声明在后）
- ✅ 边缘定义清晰：SKILL.md 缺失→404（区分非白名单）、>1MiB→413
- ✅ 四件套一致性：proposal / design / requirements / tasks 四件套 markdown 组件、大小上限、权限表述已对齐（r2 修正）
- ✅ 不改 manifest 语义、不影响 daemon 同步
- ⚠️ gen:types 不覆盖 custom-skills/新端点，前端手写类型需注意字段同步（对齐现有模式）
