---
id: task-03
title: project 子域四件套(项目/客户/成员/干系人)+ 迁移 + 测试
priority: P0
estimated_hours: 12
depends_on: [task-01, task-02]
blocks: [task-05, task-07, task-08]
requirement_ids: [FR-01]
decision_ids: [D-001@v1, D-007@v1]
author: qinyi
created_at: 2026-06-20T14:52:22+0800
---

## 目标
实现 pm 项目管理子域 4 张表:项目维护 / 客户维护 / 项目成员(userId FK users) / 项目干系人,标准 CRUD 6 件套 + simple-list(项目下拉)+ export-excel。

## 文件
- 新增 backend/app/modules/ppm/project/{__init__,model,router,service,schema}.py
- 新增 backend/migrations/versions/2026mmdd_create_ppm_project_tables.py
- 新增 backend/app/modules/ppm/project/tests/test_*.py

## 实现要点(参照源)
- model.py:4 个 SQLModel 继承 BaseModel(UUID 主键 + 自动 audit),表名 ppm_project_maintenance / ppm_customer_maintenance / ppm_project_member / ppm_project_stakeholder;字段逐项对照源 DO 目录:
  - /dept_project_back/ppdmq-module-ppm/.../dal/dataobject/(project/customer/member/stakeholder)
- 关键约定:
  - 附件:源 fileUrl*/attachGroupId → 统一 `file_urls`(JSON array)+ `attach_group_id`(str 约定)— D-007@v1
  - ppm_project_member.user_id FK → users.id;含 role 字段(开发/项目/部门经理 + 成员)— D-004@v1
  - 平台级:无 workspace_id — D-001@v1
- schema.py:XxxCreate/XxxUpdate/XxxResp/XxxPageReq(from_attributes=True),复用 common.crud.PageReq。
- service.py:CRUD 6 件套(create/update/delete/get/page)+ simple_list(仅 id+name 给下拉)+ export_excel(复用 common.export)。
- router.py:4 个子前缀(/project-maintenance, /customer-maintenance, /project-member, /project-stakeholder);每个端点 `require_permission_any(PPM_PROJECT_*)`(参照 auth 已有用法)。
- 迁移参照现有 create_* 风格(env.py 已在 task-01 补 import 占位,这里补 4 model)。

## 验收
- [ ] 4 表 alembic upgrade 成功,字段与源 DO 对齐(verify 对照)
- [ ] CRUD 6 件套端点鉴权生效(无 PPM_PROJECT_* → 403)
- [ ] simple_list 返回 {id, name} 下拉数据
- [ ] /export-excel 下载 .xlsx 合法
- [ ] file_urls JSON 字段读写正常
- [ ] project_member.user_id FK 约束有效
- [ ] pytest 全绿
