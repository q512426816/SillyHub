---
author: qinyi
created_at: 2026-08-26 19:25:00
---

# 决策台账（Decisions）— 2026-08-26-workspace-skill-edit

## D-001@v1 编辑范围：完整文件编辑

- type: boundary
- status: confirmed
- source: brainstorm step 3 用户选择「完整文件编辑」
- question: skills 编辑能力做到哪一步？
- answer: skill 级新建/删除 + skill 目录内任意文本文件的新建/编辑/删除（含 SKILL.md）。
- normalized_requirement: 文件 CRUD 限 skill 目录内两层路径；二进制/超限拒绝；SKILL.md 可编辑不可删除。
- impacts: 后端 5 端点、前端双栏、FR-01
- evidence: 用户 2026-08-26 AskUserQuestion 亲选
- priority: P0
- 锚点: backend/app/modules/workspace/router.py（新端点段）
- 模块域: backend_workspace, frontend_workspace_skills

## D-002@v1 交互形态：页内双栏（方案 A）

- type: ux
- status: confirmed
- source: brainstorm step 4（用户未响应 AskUserQuestion，主代理按推荐执行并如实记录）
- question: 编辑页交互形态？
- answer: skills 页内双栏——左栏 skill 列表+文件树，右栏 textarea 编辑器；「新建 Skill」对话框。否决 B（独立路由多余跳转）/C（对话框撑不起文件树）。
- normalized_requirement: 单页完成浏览/编辑/增删；未保存状态可见；删除二次确认。
- impacts: 前端页面结构、原型对照
- evidence: explorer 页交互先例 + 完整文件编辑范围下 C 形态不可行；用户对设计确认（step 5）包含该形态
- priority: P1
- 锚点: frontend/src/app/(dashboard)/workspaces/[id]/skills/page.tsx
- 模块域: frontend_workspace_skills

## D-003@v1 安全约束集

- type: security
- status: confirmed
- source: brainstorm step 5 设计（R-01/R-03/R-05 对应）
- question: 任意文件编辑的安全边界？
- answer: 路径穿越 fail-closed（resolve+commonpath+段白名单）；skill 名/文件名 `^[A-Za-z0-9._-]+$` 且拒 `..`；仅文本（UTF-8 解码探测，失败 415）；读写 512KB 上限（413）；SKILL.md 禁删（409）。
- normalized_requirement: 全部约束有中文错误码与专项测试；越界路径绝不触盘。
- impacts: service 校验、测试矩阵
- evidence: mcp-server file 模式 fail-closed 先例（MCP_ALLOWED_ROOT 校验）+ MCP 变更路径安全评审经验
- priority: P0
- 锚点: backend/app/modules/workspace/skills_view_service.py（安全 helper 段）
- 模块域: backend_workspace

## D-004@v1 数据通道：SkillsViewService 直读直写 specDir

- type: architecture
- status: confirmed
- source: brainstorm step 3 调研
- question: 文件读写走哪条通道？
- answer: SkillsViewService 经 SpecPathResolver 定位 specDir 本地直读直写（同 GET/MCP 变更先例）；不走 explorer 的 daemon RPC（其面向 workspace 项目根，非 specDir）。
- normalized_requirement: 不引入 RPC 依赖；容器路径直读（记忆 runtime-read-broken-daemon-client 勿改）。
- impacts: service 实现
- evidence: skills_view_service.py 既有直读 + workspace.md 模块卡「SkillsViewService 直读容器路径是刻意的」
- priority: P1
- 锚点: backend/app/modules/workspace/skills_view_service.py
- 模块域: backend_workspace

## D-005@v1 daemon 零改动

- type: architecture
- status: confirmed
- source: brainstorm step 3 调研（skill-manager.ts task-04）
- question: 生效链路要动 daemon 吗？
- answer: 不动。daemon skill-manager 经既有 spec sync（manifest 增量）从 specDir/skills/ 拉到 worktree .claude/skills/workspace/——写文件即生效（下次同步）。
- normalized_requirement: 前端提示「下次同步对新会话生效」；不承诺即时生效。
- impacts: 提示文案、非目标（不动 skills 分发链路）
- evidence: sillyhub-daemon/src/skill-manager.ts 头注释 task-04 段
- priority: P1
- 锚点: sillyhub-daemon/src/skill-manager.ts（只读依据）
- 模块域: backend_workspace

## D-006@v1 审计：手工 AuditLog（MCP 先例沿用）

- type: security
- status: confirmed
- source: 2026-08-26-workspace-mcp-edit task-01/02 修复经验
- question: 纯文件写操作怎么落审计？
- answer: 每个写端点手工插 AuditLog+commit（action=workspace_skill.*，details 记 skill 名/文件路径、不含文件内容）——纯文件写无 ORM 变更，audit_hooks 钩子不触发。
- normalized_requirement: 四类写操作各落一行审计；文件内容绝不进审计。
- impacts: service 写路径
- evidence: skills_view_service.py update_mcp_config 手工审计先例（本仓 worktree）
- priority: P0
- 锚点: backend/app/modules/workspace/skills_view_service.py（审计段）
- 模块域: backend_workspace
