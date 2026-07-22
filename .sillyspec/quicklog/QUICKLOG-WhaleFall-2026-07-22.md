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

## ql-20260722-003-f7d9 | 2026-07-22 11:20:00 | /ppm/problem-list 列表页改造：归属默认全部、问题类型入展开、列重排补齐、按计划开始时间正序
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/problem-list/page.tsx + frontend/src/app/(dashboard)/ppm/problem-list/_forms.tsx + frontend/src/components/ppm-user-select.tsx + backend/app/modules/ppm/problem/service.py + backend/app/modules/ppm/problem/router.py + backend/app/modules/ppm/problem/tests/test_problem_flow.py
需求：用户 4 项——①查询条件「归属」默认查全部（原默认只看我的）；②「问题类型」查询条件移到「展开」区（默认收起）；③列表列重排并补齐为 序号|项目|模块|问题类型(bug标红)|功能名称|问题描述|责任人&处置人|紧急|预估/已消耗(人天)|计划起止|状态|发现人|发现时间|问题答复/解答|验证人|备注|操作(冻列)；④列表默认按计划开始时间正序。
修法：前端 page.tsx——view 默认 mine→all；查询条件「问题类型」Field 从默认区移入 expanded 展开区；columns 全量重排为 17 列+操作，问题类型 Tag 加 color=red(bug) 标红；新增合并列「责任人&处置人」renderDutyHandle(处置人空 或 处置人==责任人(id/name 双判) 只显示一个，不一致才显示「责任人 & 处置人」)；「预估/已消耗(人天)」合并单列(work_load / spent_time，超预估标红、有消耗标绿)；load 默认排序 order_by=created_at desc → plan_start_time asc。_forms.tsx——编辑保存 now_handle_user_name 随 id 一并回传(下拉 handleOptions 反查 label,否则后端不单独反查处置人 name 恒 null 列表只能显示 UUID)；PpmUserSelect 新增 extraOptions prop(编辑回填：当前处置人不在当前项目成员下拉里时,调用方补一条保证 label 显示姓名而非 UUID,baseOptions 先并入 extraOptions 再按 value 去重)。后端——service.py 排序白名单 allowed_sort 加 plan_start_time(配合前端 order_by);router.py list 回填 now_handle_user_name(历史仅存 id 的处置人按单 id 反查 User.display_name 批量补全,name 已有不重复查,_safe_uuid 容错)。
测试：新增 2 个后端排序单测(plan_start_time asc 排序生效 + 白名单外字段静默降级);backend ppm 全模块 357 passed(原 355+新增2);frontend ppm 单测 52 passed;tsc --noEmit 0 error;eslint 改动文件 0 error(仅历史 warning)。
遗留：①需端到端部署验证(docker compose --build frontend 重新构建后人工确认列表列/排序/合并列显示);②多列总宽超视口,横向滚动+操作冻列依赖 tableLayout=fixed 与 fixed:right,真实数据下若某列过宽需再调列宽。
