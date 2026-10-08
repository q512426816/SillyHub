---
author: flow-machine-draft
created_at: 2026-10-08T02:56:35.238Z
---
# 决策记录（Decisions）— 2026-10-08-rbac-dead-permissions-cleanup

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：线上（crrcdt）存量角色持有死键的行被删——零功能影响（无端点消费），角色列表显示权限数变少属预期收敛；PPM 角色不涉任何删除键（PPM 18 键全保留）。次要风险：种子迁移编辑只影响新环境（已应用环境不重跑），存量靠清理迁移收敛，两路径已在 ppm-permission-simplify 先例验证。 试过但放弃的方案：① 给 code:* / tool:* 接消费端点（代码评审流 / 工具 RBAC 门控）——放弃：属新功能立项不是清理，且会话 canUseTool 审批已是现行机制；② 只隐藏不删（卡片摘掉、枚举保留）——放弃：枚举残留仍进 OpenAPI 契约与角色校验域，"配了没用"的混乱只是换个形态；③ 顺带删 PermissionGroup（后端零消费）——放弃：与权限键删除耦合扩散测试面，留待独立清理。
