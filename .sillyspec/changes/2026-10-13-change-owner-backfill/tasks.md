---
author: flow-machine-draft
created_at: 2026-10-13T15:09:03.043Z
---
# 任务注册表（Tasks）— 2026-10-13-change-owner-backfill

- [x] task-01: reparse 新建无主变更行时，负责人兜底取工作区所有者（只填新行，不覆盖已有 owner_id 的行）
- [x] task-02: 变更列表负责人列直接显示 owner_name 文本（不再只显示首字小圆）
- [x] task-03: 无 owner 的行负责人列兜底显示工作区所有者名字而非「—」
- [x] task-04: 后端 reparse owner 兜底有单测覆盖（新建行兜底填充 / 已有 owner 不覆盖）
- [x] task-05: 前端负责人渲染相关测试通过
