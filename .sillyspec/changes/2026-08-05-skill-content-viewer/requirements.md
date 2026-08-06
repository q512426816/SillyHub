---
change: 2026-08-05-skill-content-viewer
author: WhaleFall
created_at: 2026-08-05T22:52:51+08:00
---

# Requirements: 技能内容查看器

> r2：与 design.md 同步（权限 get_current_principal、markdown 复用 @uiw + 扩 markdown-text、大小上限 413 不截断、SKILL.md 缺失 404）。

## 功能需求

### FR-01 平台技能内容查看
用户在 `/settings/skills` 平台技能列表点击技能名（或查看入口），右侧抽屉展示该技能 SKILL.md 完整内容，用 `@uiw/react-markdown-preview`（经 `markdown-text` reading 尺寸）渲染为富文本（标题/列表/代码块/表格/引用/内联 code）。

### FR-02 自定义技能只读查看
用户在自定义技能列表点「查看」按钮，右侧抽屉展示该技能完整 content，用 `markdown-text`（reading）渲染，与「编辑」分离（不进入编辑模式，纯只读）。

### FR-03 平台技能内容端点
后端提供 `GET /api/daemon/skills/{skill_name}/content`，返回指定 sillyspec-* 技能的 SKILL.md 内容（`{skill_name, content}`），权限 `get_current_principal`（与 manifest 端点一致）。

### FR-04 路径安全与边缘定义（白名单 + 固定文件）
端点不接受任意 path 参数；`skill_name` 必须在 `skills_bundle_dir` 下 `sillyspec-*` 目录名白名单内，只读固定 `SKILL.md`，杜绝路径穿越。边缘：
- 非白名单 skill_name → 404。
- 白名单内目录但 `SKILL.md` 缺失 → 404（message 注明「skill 无 SKILL.md」，与非白名单区分）。
- SKILL.md > 1 MiB → 413 拒绝（不截断，保持只读语义干净）。

### FR-05 markdown 渲染
SKILL.md 用 `@uiw/react-markdown-preview` 渲染为富文本，默认转义 HTML（不引入 rehype-raw），不执行内联脚本。复用现有 `markdown-text.tsx` 加 reading 尺寸变体，不新建渲染组件。

### FR-06 权限
- 平台技能内容：`get_current_principal`（登录用户，接受浏览器 JWT + daemon X-API-Key，同 manifest）。
- 自定义技能内容：仅技能创建者（per-user，沿用现有 `created_by` 归属校验）。

### FR-07 抽屉交互
点技能 → 右侧抽屉滑出展示内容；点遮罩/关闭按钮收起；不离开当前列表页。

## 非功能需求

### NFR-01 安全
无路径穿越、无 XSS（`@uiw/react-markdown-preview` 默认转义，不引 rehype-raw）。

### NFR-02 兼容
Windows/Linux/macOS 浏览器表现一致；不破坏现有 `/settings/skills` 页面布局与 CRUD（编辑/删除/新增）；`markdown-text` 加 size 变体向后兼容（compact 默认值保持现有 6+ 处复用行为）。

### NFR-03 性能
SKILL.md 按需加载（点开才请求），不阻塞列表渲染；SKILL.md > 1 MiB 返 413 拒绝（不截断）。

### NFR-04 可维护
复用现有 `markdown-text.tsx`，扩展 `size: "compact" | "reading"` 双尺寸（compact 紧凑型沿用、reading 阅读型供抽屉），减少组件数；前端类型手写对齐后端字段（custom-skills/新端点走独立 schema，不纳入 OpenAPI 生成，沿用现有模式）。
