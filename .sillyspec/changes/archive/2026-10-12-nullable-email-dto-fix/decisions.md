---
author: flow-machine-draft
created_at: 2026-10-12T06:07:29.476Z
---
# 决策记录（Decisions）— 2026-10-12-nullable-email-dto-fix

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：前端既有代码把 `email` 当非空用的隐藏点位漏改，tsc 抓不全的 （如模板里直接插值）运行时渲染出空白。缓解：渲染点逐一回退处理 + workspace-member-row 补 null 用例 + tsc --noEmit 全量类型检查； `localeCompare` 调用点仅角色页聚合排序一处（已全局搜索确认）。 实际执行中 tsc 全量扫出 3 处（members/page 两处 + shared-daemon-manager 一处）， 另在 task-05 人工排查出 lib/admin.ts 手写 DTO 漏同步（tsc 因本地类型未改而放行）。 试过/考虑过但放弃的方案： - service 层兜底 `email=user.email or ""`：契约撒谎（空串≠无邮箱），且 前端无法区分"无邮箱"与"空邮箱"，弃。 - 只改 RoleUserRead 不动 workspace 两处：同类 500 隐患原地保留 （成员列表/搜索遇纯用户名账号必炸），修一半等于没修，弃。 - 邀请搜索补 `username ILIKE` 匹配：属于搜索行为增强，与本 500 无关， 留作后续独立小变更，避免本次 diff 膨胀。
