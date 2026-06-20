"""ppm - pm 项目管理子域 (project maintenance)。

4 张平台级表:
- ppm_project_maintenance     项目维护
- ppm_customer_maintenance    客户维护
- ppm_project_member          项目成员 (user_id FK→users.id)
- ppm_project_stakeholder     项目干系人 (pm_project_id FK→ppm_project_maintenance.id)

平台级:无 workspace_id (D-001@v1)。项目角色独立字符串字段,不复用 auth.Role
(D-004@v1)。本 4 表源 DO 无 fileUrl 字段,不臆造 file_urls (D-007@v1 仅在确有
附件的实体生效)。

设计依据:``design.md`` §5/§7/§8,task-03.md。
"""
