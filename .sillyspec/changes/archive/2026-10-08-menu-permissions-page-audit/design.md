---
author: flow-machine-draft
created_at: 2026-10-08T02:13:50.083Z
---
# 设计记录（Design Record）— 2026-10-08-menu-permissions-page-audit

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

问题：2026-10-08-sessions-menu-permissions 修完 sessions 后，全站 38 菜单逐页对账发现另外 7 个菜单卡存在同类「页面实际接口鉴权与菜单卡权限不匹配」——页面需要的权限没挂卡（勾选器配不了或菜单可见性错位）：components（列表端点要 workspace:read）、changes（任务子页要 task:read）、knowledge（写按钮要 knowledge:write）、mcp（平台库写要 settings:admin）、approvals（agent-sessions/dialogs 列表要 task:read、权限面板要 task:run_agent）、audit（审计日志端点要 change:read，platform:audit:read 零消费）、incidents（上报按钮要 deploy:staging）。

方案：与 sessions 变更同款纯数据面补齐——只改 menu-permissions.ts 7 个菜单卡的 permissions 数组（既有 key 不删、门控主 key 保持首位）+ 同步测试断言。勾选器/菜单显隐/菜单管理页均消费同一数据源，改一处全生效。可见性语义仍为任一命中即可见，跨卡重复挂载（workspace:read/task:read/settings:admin/task:run_agent/change:read/deploy:staging 均已在其它卡）有 change:approve 等先例。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- 无后端改动、无 API/DTO 变化（api-types.ts 无需再生成）。
- 前端数据契约：7 个 MenuPermissionGroup.permissions 数组各扩 1~2 项；key 均已在 Permission 联合类型中。
- 行为变化（可见性任一命中放宽）：workspace:read 持有者新增可见「项目组组件」；task:read 持有者新增可见「变更中心」「审批中心」；knowledge:write 持有者新增可见「知识库」；settings:admin 持有者新增可见「MCP 资产库」；task:run_agent 持有者新增可见「审批中心」；change:read 持有者新增可见「审计中心」（修正反向错位：此前 platform:audit:read 持有者看得到菜单但页面 403）；deploy:staging 持有者新增可见「事件」。均为页面真实可用人群。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   不适用——静态常量数组，无事件/流输入。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   不适用——前端构建期常量，运行时只读；角色保存走既有端点，不动写路径。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   不适用——注册表模块加载时固化，无中途状态。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   不会——canSeeMenu 只看用户权限集合交集，无 per-workspace 分叉；权限 key 为平台级字符串。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：可见性放宽面（workspace:read 持有者见组件菜单等）——评估可接受，这些用户对页面真实可用，且菜单可见≠数据可见（端点仍按鉴权矩阵）。次要：audit 卡保留零消费的 platform:audit:read 可能继续误导——保留理由是不删存量 key（存量角色已勾配置依赖它维持可见），其死目录属性在代码注释中言明。

试过但放弃的方案：① 移除各卡上零消费的既有 key（component:read / platform:audit:read / task:approve）——放弃：会让这些 key 在勾选器不可配（彻底死掉），且存量角色可见性可能缩；本变更聚焦补齐而非清理，死目录清理应走独立变更评审。② 后端把 component:read 接进列表端点鉴权——放弃：动后端鉴权影响存量角色（developer 只有 workspace:read+task:run_agent，会 403），远超本变更诉求。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | frontend/src/lib/menu-permissions.ts | 7 菜单卡 permissions 补齐 + 注释依据 |
| 修改 | frontend/src/lib/__tests__/menu-permissions.test.ts | changes/audit 用例更新；6 子菜单用例 components 豁免 workspace:read 断言 |
