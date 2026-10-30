# 决策记录

## D-001@v1 业务成员角色全局补 change:read（选 B，不改个别用户角色）
- 状态：confirmed
- 类型：architecture
- 模块域：rbac
- 问题：403 change:read 的修法：给个别用户换工作区角色（A），还是给系统角色 business_member 全局补 change:read（B）？
- 答案：用户明确选 B：给 business_member 全局加 change:read，保留 daemon:borrow；通过迁移发放（系统角色后台不可编辑）。
- 影响：backend/migrations/versions/20261030160000_grant_business_member_change_read.py;backend/tests/modules/auth/test_business_member_change_read_migration.py
- 否决理由：A 方案把个别用户换成 viewer/developer 会丢掉 daemon:borrow，与「全部业务成员可看变更」诉求不符。
