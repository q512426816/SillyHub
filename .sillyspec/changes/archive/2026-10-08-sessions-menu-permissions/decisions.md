---
author: flow-machine-draft
created_at: 2026-10-08T02:02:44.127Z
---
# 决策记录（Decisions）— 2026-10-08-sessions-menu-permissions

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：可见性放宽面超预期（如某些仅持 runtime:admin 的运维角色会新增看到会话菜单）——评估为可接受，因为页面本就是这些权限的主消费面，且菜单可见≠数据可见（会话列表后端仍按 user_id 隔离、写操作仍按权限矩阵）。次要风险：runtime:admin 同时挂在 runtimes 菜单（config 组「守护进程运行时管理」）与 sessions 菜单（名不同：守护进程机器查看），勾选器两卡控制同一 key、计数联动——change:approve 双卡先例同形态，非新问题。 试过但放弃的方案：① 后端新增 agent_session:* 细分权限族（create/update/delete…）替代 task:run_agent——放弃：动鉴权矩阵影响全部 daemon 端点与既有角色，远超「菜单补齐」诉求；② 勾选器增加「未挂菜单权限」兜底桶——放弃：改组件语义面大，且把权限挂到正确的菜单卡片本身就是本来的建模意图。
