---
author: flow-machine-draft
created_at: 2026-10-08T02:19:07.003Z
---
# 决策记录（Decisions）— 2026-10-08-menu-permissions-page-audit

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：可见性放宽面（workspace:read 持有者见组件菜单等）——评估可接受，这些用户对页面真实可用，且菜单可见≠数据可见（端点仍按鉴权矩阵）。次要：audit 卡保留零消费的 platform:audit:read 可能继续误导——保留理由是不删存量 key（存量角色已勾配置依赖它维持可见），其死目录属性在代码注释中言明。 试过但放弃的方案：① 移除各卡上零消费的既有 key（component:read / platform:audit:read / task:approve）——放弃：会让这些 key 在勾选器不可配（彻底死掉），且存量角色可见性可能缩；本变更聚焦补齐而非清理，死目录清理应走独立变更评审。② 后端把 component:read 接进列表端点鉴权——放弃：动后端鉴权影响存量角色（developer 只有 workspace:read+task:run_agent，会 403），远超本变更诉求。
