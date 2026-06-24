---
schema_version: 1
doc_type: module-card
module_id: components-admin
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:01:57+08:00
---
# components-admin

## 定位
后台管理与工作区成员/权限审批类组件集合（`frontend/src/components/admin-*.tsx` 等 10 个组件文件）。覆盖组织树、角色权限选择、用户抽屉、API Key 签发、工作区成员增删改、工具调用权限审批（卡片+模态）、智能体提问卡片、daemon 目录浏览器。被 admin 页面、工作区页面与 agent 运行面板复用。

## 契约摘要
- `AdminOrganizationTree({ nodes, selectedId, onSelect, searchKeyword, defaultExpandedIds })` — 组织树，支持搜索高亮+自动展开祖先、手动展开态合并。
- `AdminRolePermissionPicker({ permissions, onChange, disabled, className })` — 菜单权限多选（按 menu 分组，支持单切/全选/取消全选）。
- `AdminUserDrawer({ open, mode, user?, onClose, onSubmit, organizations, roles, canWrite, canLoginManage, currentUserId })` — 用户新建/编辑抽屉，含邮箱校验、自我编辑限制。
- `ApiKeyCreateDialog({ onCreated, onClose })` — 两阶段（form→plaintext）API Key 签发，明文仅展示一次+复制。
- `WorkspaceMemberAddDialog({ workspaceId, onAdded, onClose })` — 搜索用户+选角色+添加，含 debounce、竞态 token、蒙层点击关闭。
- `WorkspaceMemberRow({ member, actionLoading, onRoleChange, onSetOwner, onRemove })` — 成员行，当前用户行全禁用防自我降级。
- `PermissionApprovalCard({ request, onResolved? })` / `PermissionApprovalDialog({ request, submitting, error, onRespond, onDefer })` — canUseTool 远程人审，卡片内联 vs 整页模态两形态，共用 respondSessionPermission 端点。
- `AskUserDialogCard({ request, onResolved? })` — AskUserQuestion 多问题选择（单选/多选/自定义输入）。
- `DaemonDirBrowser({ runtimeId, initialPath?, onSelect, selectedPath? })` — daemon 客户端目录浏览，经 listDir RPC，受 allowed_roots 白名单限制。

## 关键逻辑
```
AdminOrganizationTree: buildTree → 展开 = autoExpanded(搜索匹配+祖先) ∪ manualExpanded
AdminRolePermissionPicker: toggleMenuAll 全选时仅移除该 menu 的 key（保留其他/脏数据 key）
AdminUserDrawer: create 装配 UserCreateRequest(email+password 必填)，edit 装配 UserUpdateRequest(不含 password)
ApiKeyCreateDialog: handleSubmit → createApiKey → phase=plaintext 展示明文 → onCreated
WorkspaceMemberAddDialog: debounce 300ms 搜索(>=2 字符) → 候选 → addMember → onAdded+onClose
PermissionApprovalCard: 倒计时(本地 1s tick) + respondSessionPermission(allow/deny) + onResolved
AskUserDialogCard: parseQuestions 防御解析 → 每问题独立 selected[] + customText → 提交答案
DaemonDirBrowser: load(listDir) → enter(join) / goUp(parent) / selectCurrent
```

## 注意事项
- 自我保护：`AdminUserDrawer` 编辑自己时部分操作受限（isSelf 提示）；`WorkspaceMemberRow` 当前用户行 role/transfer/remove 全 disabled，防失去管理权（后端也会 400，前端先禁用避免无效请求）。
- `AdminRolePermissionPicker` 取消全选严格只移除当前 menu 的 key，不清除其他 menu 或历史脏数据 key，避免误删权限。
- 权限审批两组件（Card/Dialog）消费同一 permission_request SSE 通道、同一 respondSessionPermission 端点，不新增第二套通道；Dialog 是整页遮罩模态（role=dialog + aria-modal），Card 是内联。
- `PermissionApprovalCard` 倒计时仅 UI 提示，真相源是后端 5min 超时；input 摘要做截断与隐私处理，不展开完整 prompt/token。
- `AskUserDialogCard.parseQuestions` 防御性解析：缺字段/非数组/空选项的条目被跳过，避免后端格式偏差整卡崩溃；手动输入由常驻输入框承载（无需识别 custom 选项）。
- `WorkspaceMemberAddDialog` 角色仅暴露 developer/viewer/workspace_owner 三项（与后端 Literal 对齐），不暴露 platform_admin/reviewer/qa/component_lead。
- `DaemonDirBrowser` 越界 daemon allowed_roots 会 403；路径操作走 `lib-client-path` 的 normalize/join/parent。

## 人工备注
<!-- MANUAL_NOTES_START -->

## 变更索引
- ql-20260624-004-c8a2 | ApiKeyCreateDialog 改用统一 Dialog 外壳，优化创建表单与一次性明文展示布局。

<!-- MANUAL_NOTES_END -->
