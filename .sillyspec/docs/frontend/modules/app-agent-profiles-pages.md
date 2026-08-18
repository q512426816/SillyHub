---
schema_version: 1
doc_type: module-card
module_id: app-agent-profiles-pages
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 智能体档案全局卡片墙（app-agent-profiles-pages）

## 定位
智能体档案全局卡片墙页（单一页面 `src/app/(dashboard)/agent-profiles/page.tsx`），一级菜单入口 `/agent-profiles`，跨工作区聚合视图（2026-08-04-agent-profile-ui-redesign task-05 落地）。与工作区内页（`workspaces/[id]/agent-profiles`，属 app-workspace-pages）复用同一套卡片墙 + 表单组件（components-agent-profile），差异只在数据 sourcing 与 CRUD 细节。

## 契约摘要
- `AgentProfilesGlobalPage`：
  - 列表 `<AgentProfileCardGrid />`（不传 workspaceId → `useMineAgentProfiles`，数据 = 当前 actor 可见全集：个人 private + 各 ws 的 workspace 级 + platform + 系统预置）。
  - 新建 `<AgentProfileForm mode="create" />`（不传 workspaceId → 表单首字段"工作区上下文"选择器决定 sourcing/归属）。
  - 编辑 `<AgentProfileForm mode="edit" profile={p} />`（表单内按 `profile.workspace_id` 或"参考工作区"selector 决定 effectiveWsId，覆盖 private/platform 无归属场景）。
- 删除（本页核心特例逻辑）：
  - workspace 级档案走 `deleteWorkspaceAgentProfile`（需 wid）。
  - private/platform 级（workspace_id=null）走 platform 级 `deleteAgentProfile`；platform admin 可删任意档，非 admin 前端拦截并提示"请联系管理员"（普通用户删自己 private 档需后端另开 owner-gated 端点）。
  - 删除前 `confirmDelete` state 走 Modal 确认。
- 复制：仅 workspace 级支持（`copyWorkspaceAgentProfile`；platform 级无 copy 客户端）。
- 权限感知：`useSession(s => s.user?.is_platform_admin === true)` 控制删除入口。

## 关键逻辑
```
CRUD 后刷新: useCopy/useDelete hook 只 invalidate workspaceList 桶
            且需 mount 时固定 wid——全局页档案来自多 ws，无法固定，
            故改用裸 fetch 函数 + 手动 invalidate
            agentProfileQueryKeys.mineList 桶，确保卡片墙刷新
```

## 注意事项
- 路由已加入 `(dashboard)/layout.tsx` WORKSPACE_WHITELIST（平台级、不依赖工作区上下文；execute 时曾遗漏，部署实测发现被守卫弹回 /workspaces）。
- mineList / workspaceList 是两个独立 query 桶：只刷 workspaceList 会造成本页卡片墙不更新，任何 CRUD 收尾须 invalidate mineList。
- 页面是薄编排层：卡片/表单/选择器逻辑改动落在 components-agent-profile，勿在本页重复实现。
- private 档删除的后端能力缺口（owner-gated 端点）是已知限制，前端拦截文案如实提示，勿绕过。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
