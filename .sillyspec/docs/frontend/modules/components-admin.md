---
schema_version: 1
doc_type: module-card
module_id: components-admin
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 后台管理对话框组件（components-admin）

## 定位
后台管理与成员/权限/凭据/技能类对话框组件集合（`frontend/src/components/` 根下 12 个组件文件 + 2 个测试）。覆盖组织树（两代实现并存）、角色权限选择、用户抽屉、API Key / MCP Token 签发、工作区成员管理、工具权限审批、AskUser 问答卡、自定义技能编辑与内容抽屉。被 app-admin-pages（用户/角色/组织）、app-pages（settings 域签发）、app-workspace-pages（成员/令牌/技能/会话权限弹窗）复用。

## 契约摘要
- `AdminOrganizationTree({ nodes, selectedId, onSelect, searchKeyword, defaultExpandedIds })`：组织树，搜索高亮 + 自动展开祖先 + 手动展开态合并。
- `AdminOrgTree`：新一代精简组织树实现（与上一条并存，新页面优先用本组件）。
- `AdminRolePermissionPicker({ permissions, onChange, disabled, className })`：菜单权限多选，按 menu 分组，支持单切 / 全选 / 取消全选。
- `AdminUserDrawer({ open, mode, user?, onClose, onSubmit, organizations, roles, canWrite, canLoginManage, currentUserId })`：新建/编辑用户抽屉，邮箱校验、自我编辑限制（isSelf）。
- `ApiKeyCreateDialog({ onCreated, onClose })`：两阶段（form → plaintext）API Key 签发，明文仅展示一次 + 复制。
- `McpTokenCreateDialog({ workspaceId, onCreated, onClose })`：同型 MCP Token 签发，绑定 workspace 作用域。
- `WorkspaceMemberAddDialog({ workspaceId, onAdded, onClose })`：搜索用户（debounce 300ms、>=2 字符、竞态 token）+ 选角色 + 添加，蒙层点击关闭。
- `WorkspaceMemberRow({ member, actionLoading, onRoleChange, onSetOwner, onRemove })`：成员行；当前用户行 role/transfer/remove 全禁用。
- `PermissionApprovalCard({ request, onResolved? })`：canUseTool 远程人审内联卡（整页模态 Dialog 形态已移除，统一走 Card）；消费 permission_request SSE 通道 + respondSessionPermission 端点。
- `AskUserDialogCard({ request, onResolved? })`：AskUserQuestion 多问题选择（单选/多选/自定义输入），`parseQuestions` 防御解析（缺字段/非数组/空选项条目跳过）。
- `CustomSkillEditDialog({ mode, skill, onClose })` / `SkillContentDrawer`：自定义技能编辑与内容查看（lib-mcp-skills）。

## 关键逻辑
```
AdminOrganizationTree: 展开集 = 搜索匹配+祖先(auto) ∪ 手动展开(manual)
RolePermissionPicker:  取消全选仅移除当前 menu 的 key
                       （保留其他 menu / 历史脏数据 key，防误删权限）
UserDrawer:            create → UserCreateRequest(email+password 必填)
                       edit   → UserUpdateRequest(不含 password)
签发类 Dialog:          submit → create → phase=plaintext 一次性明文 → onCreated
MemberAddDialog:        debounce 300ms 搜索 → 候选 → addMember → onAdded+onClose
PermissionApprovalCard: 本地 1s tick 倒计时 + respond(allow|deny) → onResolved
```

## 注意事项
- 自我保护：`AdminUserDrawer` 编辑自己时部分操作受限（isSelf 提示）；`WorkspaceMemberRow` 当前用户行全禁用防自我降级（后端也会 400，前端先禁防无效请求）。
- 权限审批只保留 Card 一条通道（旧 Card/Dialog 双形态已收敛为 Card）；不新增第二套 permission 通道或端点。
- `PermissionApprovalCard` 倒计时仅 UI 提示，真相源是后端超时；input 摘要做截断与隐私处理，不展开完整 prompt/token。
- `AskUserDialogCard.parseQuestions` 防御性解析是刻意设计：后端格式偏差只跳过坏条目，不整卡崩溃；手动输入由常驻输入框承载（无需识别 custom 选项）。
- `WorkspaceMemberAddDialog` 角色仅暴露 developer/viewer/workspace_owner（与后端 Literal 对齐），不暴露 platform_admin/reviewer/qa 等。
- 一次性明文（API Key / MCP Token）只在创建瞬间返回、列表不回显，任何改动不得让明文进入列表态或日志。
- `DaemonDirBrowser` 已删除（daemon 目录浏览不再由本模块承载），引用旧卡/旧导入时注意清理。

## 人工备注
<!-- MANUAL_NOTES_START -->

## 变更索引
- ql-20260624-004-c8a2 | ApiKeyCreateDialog 改用统一 Dialog 外壳，优化创建表单与一次性明文展示布局。

<!-- MANUAL_NOTES_END -->
