---
schema_version: 1
doc_type: module-card
module_id: components-workspace
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 工作区关联与共享组件（components-workspace）

## 定位
`components/workspace/` 目录（4 源文件 + 2 测试），两个子域：①PPM↔workspace 关联（2026-07-28-ppm-project-link-workspace 派生）——`LinkWorkspaceDialog`（项目侧绑定/解绑工作区弹窗）与 `LinkedProjectsSection`（工作区侧关联项目区块），双边操作同一张 `ppm_project_workspace` 表；②共享 daemon（2026-07-25-daemon-borrow-for-business 派生）——`SharedDaemonToggle`（lender 出借开关）与 `SharedDaemonManager`（owner 撤销管理区）。

## 契约摘要
- `LinkWorkspaceDialog`：props `{ open, projectId, projectName, onClose }`。项目维护页行内打开；调 lib-workspace 的 `listProjectWorkspaces` / `linkWorkspace` / `unlinkWorkspace`，辅以 `listWorkspaces` 补候选。antd 体系（与 ppm 页一致）；工作区状态 Tag 语义色（active 绿/pending 蓝/archived 灰/deleted 红）。
- `LinkedProjectsSection`：props `{ workspaceId }`。嵌入工作区详情页；调 `listLinkedProjects` / `linkProject` / `unlinkProject`（候选来自 `listProjects`）。shadcn/ui 体系（与 workspaces/[id] 页一致）。项目状态 code→中文（1 进行中/2 已完成/3 已暂停，已是中文原样返回）。
- `SharedDaemonToggle`：props `{ workspaceId, shared, daemonLabel?, onChanged }`。lender「共享我的 daemon」开关——勾选/取消调 `setMyBindingShared(workspaceId, next)`，成功 `onChanged()` 刷新，失败行内报错并回滚开关值。仅当 lender 已绑定 daemon 时由父级渲染。
- `SharedDaemonManager`：props `{ workspaceId, members?, onRevoked? }`。owner 区段：`fetchSharedDaemons` 列全部共享 daemon（出借人/daemon 主机/在线状态，失败降级空数组不阻塞页面），`revokeSharedDaemon`（DELETE）confirm 后撤销；lender 显示名从传入 members 反查 user_id→display_name，找不到回退短 id。

## 关键逻辑
```
双边对称: LinkWorkspaceDialog(项目侧) ⇄ LinkedProjectsSection(工作区侧)
  → 同一张 ppm_project_workspace 表，任一边增删另一边自动可见
共享 daemon 生命周期:
  lender: SharedDaemonToggle → setMyBindingShared(wsId, true/false)
  owner:  SharedDaemonManager → revokeSharedDaemon(wsId, userId)
  lender 名回退: members.find(user_id)?.display_name ?? email ?? 短id(8位)
```

## 注意事项
- 两子域 UI 体系刻意不同（ppm 侧 antd / workspace 侧 shadcn），是对应宿主页的既定规则，勿"统一"。
- SharedDaemonToggle 失败回滚开关是显式约定；onChanged 后父级须重 fetch myBinding 回填。
- SharedDaemonManager 数据装配是 useEffect+fetch（非 react-query），失败静默降级空数组；members 未传时出借人显示短 id 属预期。
- 授予 business_member 角色不在本域（复用成员管理页角色下拉），本域只管共享开关与撤销。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
