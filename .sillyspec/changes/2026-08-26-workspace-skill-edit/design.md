---
author: WhaleFall
created_at: 2026-08-26 19:25:00
updated_at: 2026-08-26 19:25:00
scale: large
modules: [backend_workspace, frontend_workspace_skills]
---

# 设计文档（Design）— 工作区自定义 Skills 完整文件编辑

## 1. 背景

工作区「自定义 Skills」页（`/workspaces/[id]/skills`）当前只读列出 `specDir/skills/` 下的 skill 名与文件清单（变更 2026-07-07-skills-mcp-management-ui D-006）。用户要求与刚完成的 MCP 配置页同等待遇——可编辑，且明确选择**完整文件编辑**范围（skill 目录内任意文件的 CRUD + skill 级新建/删除）。

与 MCP 变更的关键差异：skills 是**多文件树**（每 skill 目录 = SKILL.md 主文件 + 可选辅助文件）；消费链路无需新建——daemon 的 skill-manager 经既有 spec sync 从 specDir/skills/ 拉到 worktree `.claude/skills/workspace/`（skill-manager.ts task-04 注释），**写文件即经 manifest 增量同步生效**。

## 2. 设计目标

- Skills 页支持：新建 skill（名+描述→生成 SKILL.md）、删除 skill、skill 目录内任意文本文件的新建/编辑/删除
- 安全边界：路径穿越 fail-closed、文件名/skill 名白名单、仅文本文件、大小上限、SKILL.md 入口保护
- 写操作可审计、原子落盘、错误中文
- daemon 零改动

## 3. 非目标（Non-Goals）

- 不做文件重命名/移动、不做目录嵌套管理（文件路径限 skill 目录内两层，对齐 `_list_files_local` 平铺清单）
- 不做二进制文件上传/下载（仅文本编辑）
- 不做在线语法校验/预览渲染（textarea 纯文本编辑）
- 不动平台级 skills 分发（`GET /api/daemon/skills/latest/manifest` 链路）
- 不改 explorer 模块（其数据通道是 daemon RPC 读项目根，与 specDir 不同源）
- 不做编辑器多标签页/未保存切换拦截（v1 单文件编辑，切换即提示保存）

## 4. 拆分判断

前后端两模块强耦合（端点与页面交互一一对应），单变更分 Wave 实现；非批量模式。

## 5. 总体方案

### Wave 1 后端（workspace 模块）

1. `SkillsViewService` 扩展写路径（读路径 `list_skills` 不动）+ router 新增 5 端点（全部 `require_permission(Permission.WORKSPACE_WRITE)`，与 MCP PUT 同模式）：
   - `POST /workspaces/{id}/skills`：body `{name, description?}`（pydantic）→ 建 `skills/<name>/SKILL.md`（frontmatter name+description+空正文）；skill 名白名单 `^[A-Za-z0-9._-]+$` 且不得含 `..`；已存在 → 409 中文
   - `DELETE /workspaces/{id}/skills/{skill_name}`：删除整个 skill 目录（shutil.rmtree 经 to_thread）；不存在 → 404 中文
   - `GET /workspaces/{id}/skills/{skill_name}/files/{file_path:path}`：读文本内容 → `{path, content, size}`；UTF-8 解码失败 → 415「该文件不是文本文件」；>512KB → 413
   - `PUT` 同路径：body `{content}` → 原子写（tmp+os.replace，父目录自动创建，限两层内）；content 非字符串/空 body → 422；>512KB → 413
   - `DELETE` 同路径：删文件；`SKILL.md` → 409「SKILL.md 是 skill 入口文件，不可删除」
2. 路径安全（所有含 file_path 端点）：`resolve` 后必须仍在该 skill 目录内（`os.path.commonpath`/前缀比较，含 `..`/绝对注入一律 422 中文）；文件路径段白名单同 skill 名
3. 审计：每个写端点手工插 `AuditLog`（action=`workspace_skill.create/delete/update_file/delete_file`，details 记 skill 名/文件路径，不含文件内容）+ commit（2026-08-26-workspace-mcp-edit 先例）
4. 错误族：AppError 子类就近 service 文件（中文 message、UPPER_SNAKE code）

### Wave 2 前端（双栏交互，对照原型）

5. `skills/page.tsx` 双栏改造：左栏 skill 卡片（名+文件数）+ 选中展开文件树 + 「新建文件/删除文件/删除 Skill」按钮；右栏文件编辑器（textarea 等宽）+ 未保存标记 + 保存/重置；「新建 Skill」对话框（名+描述）
6. `lib/workspace-skills-view.ts` 扩展：`createWorkspaceSkill` / `deleteWorkspaceSkill` / `readWorkspaceSkillFile` / `writeWorkspaceSkillFile` / `deleteWorkspaceSkillFile` + 对应 hooks（queryKeys：skills list + 单文件内容 key）
7. 提示文案：保存成功 toast「已保存（下次同步对新会话生效）」；编辑器下方常驻 hint（仅文本 ≤512KB / SKILL.md 不可删 / 文件名字符约束）
8. 删除操作二次确认（skill 删除提示目录级删除不可恢复）

### Wave 3 类型与文档

9. `pnpm gen:types`（5 端点进 OpenAPI）+ api-types.ts/openapi.json 同提交
10. 模块卡同步（backend.md / frontend.md）

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/workspace/router.py | 新增 5 端点（POST/DELETE skills + GET/PUT/DELETE files）。数据流：producer=前端编辑器 → REST → service 写 specDir/skills/ → consumer=daemon spec sync（既有链路拉取到 worktree） |
| 修改 | backend/app/modules/workspace/skills_view_service.py | 写路径方法（create/delete skill + read/write/delete file）+ 路径安全 helper + pydantic 请求模型 + AppError 子类（就近，MCP 先例） |
| 新增 | backend/app/modules/workspace/tests/test_skills_edit.py | 全分支测试（见验收） |
| 修改 | frontend/src/lib/workspace-skills-view.ts | 5 个 fetch 函数 + hooks + queryKeys 扩展 |
| 新增/修改 | frontend/src/app/(dashboard)/workspaces/[id]/skills/page.tsx | 双栏改造（对照原型） |
| 新增/修改 | frontend/src/app/(dashboard)/workspaces/[id]/skills/__tests__/page.test.tsx | 更新既有只读断言 + 新增编辑交互用例 |
| 生成 | frontend/src/lib/api-types.ts + backend/openapi.json | gen:types 重生成 |

## 7. 接口定义

### 7.1 POST /api/workspaces/{workspace_id}/skills

- 请求：`{"name": "my-skill", "description": "做什么"}`（name 必填白名单字符，description ≤500 字符可选）
- 成功 201：`SkillsViewResponse`（更新后的列表）
- 409 `HTTP_409_SKILL_ALREADY_EXISTS`「skill 已存在」；422 `HTTP_422_SKILL_NAME_INVALID`「skill 名仅允许字母/数字/点/下划线/连字符」

### 7.2 DELETE /api/workspaces/{workspace_id}/skills/{skill_name}

- 成功 200 `{deleted: true}`；404 skill 不存在

### 7.3 GET/PUT/DELETE /api/workspaces/{workspace_id}/skills/{skill_name}/files/{file_path}

- GET 200 `{path, content, size}`；415 非文本；413 超限
- PUT 请求 `{content}`（必填字符串）；200 返回 `{path, size}`；422 路径非法/校验失败；413 超限
- DELETE 200 `{deleted: true}`；409 `HTTP_409_SKILL_ENTRY_PROTECTED`「SKILL.md 是 skill 入口文件，不可删除」
- 通用：404 skill/文件不存在；路径越界 422 `HTTP_422_SKILL_PATH_INVALID`「文件路径不合法」

### 7.4 前端 queryKeys

既有 `workspaceSkillsView.detail(wsId)`（query-keys.ts:39-42，list 查询）+ 新增 `workspaceSkillFile.detail(wsId, skill, path)`（单文件内容查询；写入/删除后失效两者）。Grill 修正：design 初稿误写 `workspaceSkills`，实际既有 key 名为 `workspaceSkillsView`。

## 7.5 生命周期契约

不涉及生命周期契约（本变更不新增/修改 session、lease、agent_run 的事件与状态流转；文件写入经既有 spec sync 增量链路自然分发，无新事件）。

## 8. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 路径穿越攻击（../、绝对路径、Windows 盘符/分隔符变体） | P0 | resolve+commonpath 前缀校验 fail-closed；路径段白名单正则；专项测试覆盖变体 |
| R-02 | 误删 skill 目录不可恢复 | P1 | 前端二次确认明确「目录级删除不可恢复」；删除审计行留痕 |
| R-03 | 大文件/二进制拖垮编辑器 | P1 | 读侧 512KB+UTF-8 探测双闸；写侧同限 |
| R-04 | 写入与 daemon spec sync 竞态（同步中改文件） | P2 | spec sync 有 content-hash 冲突协议兜底；登记不额外加锁 |
| R-05 | SKILL.md 被删导致 skill 失效 | P1 | 后端 409 硬保护 + 前端按钮禁用 |
| R-06 | gen:types 无关抖动 / node_modules 半坏 | P2 | 规则 21/36 流程（tsc 探针 + --force） |

## 9. 决策追踪

- D-001@v1（完整文件编辑范围）→ §1/§2 / FR-01
- D-002@v1（页内双栏交互）→ §5 Wave2 / FR-02
- D-003@v1（安全约束集）→ §5 Wave1-2/3 / FR-03
- D-004@v1（SkillsViewService 直读直写 specDir）→ §5 Wave1 / FR-04
- D-005@v1（daemon 零改动）→ §1/§5 / FR-04
- D-006@v1（审计手工 AuditLog）→ §5 Wave1-3 / FR-05

未解决/遗留：无。

## 10. 自审（Self-Review）

- 章节齐全 ✅；生命周期关键词（session/同步）→ §7.5 紧邻豁免短语 ✅
- 文件清单含对外接口 → 数据流标注（producer→specDir→daemon sync consumer）✅
- 原型已生成（新交互流程「必须生成」级）✅
- 推翻旧决策 D-006（2026-07-07 同源只读）已在 §1 记录 ✅
- ⚠️ 自审存疑 1：`{file_path:path}` FastAPI path converter 含 `/` 的边界（两层限制在后端段数校验，不依赖路由）——**Grill 已核**：daemon/router.py:3375 有 `{path:path}` 先例，可用；两层限制由后端路径段数校验保证
- ⚠️ 自审存疑 2：删除 skill 用 rmtree 的符号链接逃逸（specDir 用户可控内容）——plan 阶段加 symlink 检查（删除前 lstat 拒绝非常规条目）或确认 rmtree 安全参数
- **并行冲突登记（Grill 发现）**：本变更与 2026-08-26-workspace-mcp-edit（已 verify 待合并）改同一批文件（skills_view_service.py / router.py / workspace-skills-view.ts / api-types.ts）——execute 前必须先合并 MCP 变更回 main 并重建本变更 worktree（base 含 MCP 改动），否则合并必冲突
