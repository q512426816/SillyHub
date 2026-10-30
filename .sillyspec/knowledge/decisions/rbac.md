# 决策知识 — rbac

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-rbac-001@v1 业务成员角色全局补 change:read（选 B，不改个别用户角色）
状态：implemented
变更：2026-10-30-business-member-change-read
原编号：D-001@v1
锚点：未记录
最近确认：18b93f19fdb14a2d921faa22ca33d0730de8975f
理由：用户明确选 B：给 business_member 全局加 change:read，保留 daemon:borrow；通过迁移发放（系统角色后台不可编辑）。
