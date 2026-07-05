---
author: qinyi
created_at: 2026-05-31T10:00:00
---

# Tasks

- [ ] DB migration: changes 表添加 current_stage/stages/approval_status/approved_by/approved_at/rejection_reason 字段
- [ ] Model: Change model 添加对应字段
- [ ] Schema: 新增 sync 相关 Pydantic DTO
- [ ] Service: 新增 sync service 方法（progress sync、documents sync、approval CRUD）
- [ ] Router: 新增 CLI 对接 API router
- [ ] 注册: main.py 注册新 router
- [ ] 前端: Change 详情页加阶段进度条 + 审批区域
- [ ] 验证: pytest + next build
