---
author: flow-machine-draft
created_at: 2026-10-08T01:54:07.676Z
---
# 设计记录（Design Record）— 2026-10-08-sessions-menu-permissions

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

问题：/sessions 会话页实际依赖 4 个后端权限，但菜单注册表 sessions 只挂 agent_session:read，导致角色管理勾选器「智能体会话」卡片只能配 1 项，其余权限（尤其 task:run_agent——此前不挂在任何菜单卡上，UI 完全配不了）与会话菜单对不上。

方案：纯数据面补齐——frontend/src/lib/menu-permissions.ts 中 sessions 菜单 permissions 数组补入 task:run_agent / daemon:borrow / runtime:admin 三项（agent_session:read 保持首位）。选择该方案因为勾选器（admin-role-permission-picker.tsx）、菜单显隐（permission.ts canSeeMenu）、菜单管理页（/admin/menus）全部直接消费 MENU_PERMISSION_GROUPS 单一数据源，改一处三处生效，无需新增组件代码。菜单可见性语义为任一命中即可见，与 runtime（runtime:read+task:read）、approvals（task:approve+change:approve）等既有菜单同口径；权限跨菜单重复挂载有 change:approve（变更中心+审批中心）先例。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- 无后端改动、无 API/DTO 变化（api-types.ts 无需再生成）。
- 前端数据契约：MenuPermissionGroup.permissions（sessions 项）由 1 项扩为 4 项；PermissionItem.key 仍是 api-types 生成的 Permission 联合类型，三项新 key 均已在联合类型中，编译期可过。
- 行为变化（可见性任一命中放宽）：持 task:run_agent / daemon:borrow / runtime:admin 任一项但无 agent_session:read 的用户，侧边栏将看到「智能体会话」菜单——这些用户正是会话页的目标使用者（页面核心接口本就需要这些权限），且 2026-09-18 种子迁移已给全部存量角色授过 agent_session:read，存量可见性不缩。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   不适用——静态常量数组，无事件/流输入；SSE 变更信号不消费 permissions。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   不适用——前端构建期常量，运行时只读；角色权限保存仍走既有 roles 端点，本变更不动写路径。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   不适用——菜单注册表在模块加载时固化，无会话/请求中途切换状态。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   不会——菜单注册表为全局单例，权限 key 是平台级字符串；canSeeMenu 只看用户权限集合交集，无 per-workspace 分叉。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：可见性放宽面超预期（如某些仅持 runtime:admin 的运维角色会新增看到会话菜单）——评估为可接受，因为页面本就是这些权限的主消费面，且菜单可见≠数据可见（会话列表后端仍按 user_id 隔离、写操作仍按权限矩阵）。次要风险：runtime:admin 同时挂在 runtimes 菜单（config 组「守护进程运行时管理」）与 sessions 菜单（名不同：守护进程机器查看），勾选器两卡控制同一 key、计数联动——change:approve 双卡先例同形态，非新问题。

试过但放弃的方案：① 后端新增 agent_session:* 细分权限族（create/update/delete…）替代 task:run_agent——放弃：动鉴权矩阵影响全部 daemon 端点与既有角色，远超「菜单补齐」诉求；② 勾选器增加「未挂菜单权限」兜底桶——放弃：改组件语义面大，且把权限挂到正确的菜单卡片本身就是本来的建模意图。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | frontend/src/lib/menu-permissions.ts | sessions 菜单 permissions 1→4 项 + 注释更新 |
| 修改 | frontend/src/lib/__tests__/menu-permissions.test.ts | sessions 用例期望 4 项；镜像常量补 3 项 69→72；「4 个原常显菜单」用例 sessions 放宽 toContain |
| 修改 | frontend/src/components/__tests__/admin-role-permission-picker-tree.test.tsx | 0/4 唯一性断言放宽 getAllBy（sessions 现同 4 权限） |
