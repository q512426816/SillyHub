---
author: WhaleFall
created_at: 2026-07-22T09:00:48
---

<!-- 本文件从空开始。ql-ID 续号规则：扫描同目录所有 QUICKLOG*.md 文件，
     取当天(YYYYMMDD)最大序号 +1。归档历史见 QUICKLOG-WhaleFall-<DATE>.md。 -->

## ql-20260722-001-b4c1 | 2026-07-22 09:00:48 | 看板任务详情「任务描述」显示暂无描述修复——回填 ppm_plan_task.task_description 历史空值（从关联明细同步）
状态：已完成
关联变更：（无）
文件：backend/migrations/versions/20260722_backfill_plan_task_task_description.py（新增 data migration，revision=20260722_backfill_task_desc，down_revision=20260721_ps_plan_add_created_by）
需求：用户反馈看板（/ppm/kanban）任务详情抽屉里「任务描述」显示「暂无描述」，但任务实际应有描述。
根因：建任务（PlanTask）时把明细 task_description 带到 ppm_plan_task.task_description 是 2026-07-20（ql-20260720-007，commit a7fc4be1）才加的逻辑。在此之前建的 600+ 老任务 task_description 全为 NULL——但其关联明细 ppm_ps_plan_node_detail.task_description 有值（描述滞留在明细里）。前端 KanbanTaskDetailDrawer 的 `task.task_description ?? desc` fallback 拿不到（content 也无 \n\n 描述分隔符，desc 恒空）→ 显示「暂无描述」。DB 实测：627 个任务仅 1 个有 task_description、626 个 NULL；604 个关联明细且明细全部有描述；0 个 content 含 \n\n。
方案：data migration 纯 UPDATE 回填——`UPDATE ppm_plan_task SET task_description = d.task_description FROM ppm_ps_plan_node_detail d WHERE ps_plan_node_detail_id=d.id AND d.task_description 非空 AND t.task_description IS NULL`。① 仅回填 NULL 行，重复 apply 幂等安全；② 不动 updated_at（纯数据修复，保留任务原始更新时间）；③ downgrade 留空（清空会丢用户已编辑值，不可逆）。迁移链核实：本地 + 容器 alembic heads 均唯一 `20260721_ps_plan_add_created_by`（无多 head/孤儿，20260722/23/24 那条链已被接上）。
结果：本地容器 docker cp migration 文件后 alembic upgrade head，NULL 626→23（剩 23 个无明细任务本就无描述来源，保持空正确），604 个关联明细任务现全有 task_description；alembic_version=20260722_backfill_task_desc；抽查「质量生产异常开发设计」等任务 task_description 已从明细回填内容正确。前端零改动（逻辑本就对，DB 有值即显示，刷新看板生效）。待 commit + 生产（阿里云）部署 migration apply + 用户浏览器验证（任务详情显示描述）。
