---
author: qinyi
created_at: 2026-06-20T14:43:06+0800
change: 2026-06-20-ppm-module-migration
---

# ppm 模块迁移设计

## 1. 背景
源项目 `dept_project_back/ppdmq-module-ppm`(项目与问题管理,Java Spring Boot/芋道)+ `dept_project_front`(Vue3)全量复刻到 SillyHub(FastAPI + Next.js),作为平台级业务域。源:22 Controller ~120 接口、22 表、2 套自研审批流 + 1 套 silly 引擎。

## 2. 设计目标
- 6 子域核心功能可用:pm 项目管理 / ps 计划策划 / plan 计划节点模板 / problem 问题清单 / task 任务执行 / kanban 看板
- 平台级(不绑 workspace),复用现有 auth/admin/audit/settings/workflow
- 纯 Python + Next.js,不引入新语言/中间件
- 重写时抽公共复用、适当优化源逻辑(非 1:1 照搬)

## 3. 非目标
- 不做 silly 动态表单/变量表(简化为状态机)
- 不做独立站内信模块(通知走 audit_logs + 前端轮询)
- 不做文件上传服务(附件沿用 fileUrl 字段约定)
- 不做历史数据迁移(本项目未上线,数据可清空 — CLAUDE.md 规则7)
- 不做多租户(work_hour.tenant_id 丢弃)
- 不复刻 silly 按 nodeKey 的动态表单(handle/v1/T0010.vue)

## 4. 拆分判断
- 半批量:14+ 标准 6 件套 CRUD → 公共 helper,plan 任务可控
- 特殊簇:审批流/看板/统计 → 标准开发 + 扩展点
- 单变更内 Wave 管理(W0–W6),不生成 MASTER.md

## 5. 总体方案(方案 B:显式四件套)
单 `ppm` 模块分子包,各子域显式 `router/service/model/schema/tests` + `common` 公共 helper;状态机参照现有 `change.TRANSITIONS`。Wave:
- **W0** 基础设施:模块骨架 + common(crud/export/fsm/perms)+ PPM_* 权限 + 迁移建 19 表
- **W1** pm 项目管理(项目/客户/成员/干系人 CRUD + 导出)
- **W2** plan 模板 + ps 计划策划(项目计划/里程碑 + 状态机)
- **W3** problem 问题清单 + 4 节点审批流状态机 + 变更
- **W4** task 任务计划/执行 + work-hour 工时统计
- **W5** kanban 看板(人员列 + 拖拽 + 分配)
- **W6** 前端全量 AntD 页面 + 菜单权限集成

## 6. 文件变更清单
| 操作 | 路径 | 说明 |
|---|---|---|
| 新增 | backend/app/modules/ppm/__init__.py | 模块入口 |
| 新增 | backend/app/modules/ppm/common/{crud,export,fsm,perms}.py | 公共 helper |
| 新增 | backend/app/modules/ppm/{project,plan,problem,task,kanban}/{model,router,service,schema}.py + tests/ | 5 子域四件套 |
| 修改 | backend/app/main.py | include_router(prefix="/api/ppm") |
| 修改 | backend/app/modules/auth/permissions.py | 新增 PPM_* Permission 枚举 |
| 新增 | backend/migrations/versions/2026mmdd_create_ppm_tables.py | 19 表迁移 |
| 修改 | backend/migrations/env.py | import ppm 各 model |
| 修改 | backend/pyproject.toml | +openpyxl |
| 新增 | frontend/src/app/(dashboard)/ppm/**/page.tsx | 各子域页面 |
| 新增 | frontend/src/lib/ppm/*.ts | API client |
| 修改 | frontend/src/lib/menu-permissions.ts | PPM 菜单 + 权限 |

## 7. 接口定义
统一前缀 `/api/ppm`,平台级 `require_permission_any(PPM_*)`。路径/方法对齐源 Controller:

| 子域 | 路径前缀 | 核心端点 |
|---|---|---|
| project | /project-maintenance, /customer-maintenance, /project-member, /project-stakeholder | CRUD 6 件套 + simple-list |
| plan | /plan-node, /plan-node-module, /project-plan, /plan-node(ps), /plan-node-detail(ps) | CRUD + 子表明细 + 流程(save/reject/change) |
| problem | /problem-list, /problem-change, /process-task, /process-log, /change-process-* | CRUD + nextProcess/rejectProcess/doneTask/closeTask |
| task | /task-plan, /personal-task-plan, /task-execute, /work-hour | CRUD + execute + stat-by-user/project + list-by-date-range |
| kanban | /kanban/* | users(人员=可见 project_member,可按 Organization 分组)/ tasks / assign / reorder / search |
| 导出 | 各子域 /export-excel | openpyxl |

DTO:Pydantic v2(`XxxCreate/Update/Resp/PageReq`,`model_config={"from_attributes": True}`),字段对齐源 VO(见源 `vo` 包)。

**7.5 生命周期契约表**:不涉及 session/lease/agent_run/daemon/lifecycle/claim/heartbeat 关键词,按规则省略。

## 8. 数据模型
平台级,表名 `ppm_<实体>`(蛇形),继承 `BaseModel`(UUID 主键 + created_at/updated_at + 自动 audit)。共 19 张新表:

| 子域 | 表 |
|---|---|
| project | ppm_project_maintenance, ppm_customer_maintenance, ppm_project_member, ppm_project_stakeholder |
| plan | ppm_plan_node, ppm_plan_node_detail, ppm_plan_node_module, ppm_ps_project_plan, ppm_ps_plan_node, ppm_ps_plan_node_detail, ppm_ps_plan_node_detail_process |
| problem | ppm_problem_list, ppm_problem_change, ppm_problem_list_process_task, ppm_problem_list_process_log, ppm_problem_change_process_task, ppm_problem_change_process_log |
| task | ppm_plan_task, ppm_task_execute, ppm_work_hour |

字段对齐源 DO(见源 `dal/dataobject/`,不在此重复)。关键简化:
- **里程碑明细**:弃 silly `_node`/`_variable` 两表 → `PsPlanNodeDetail` 单表 + `parent_id` 版本链 + `status` 驱动状态机;保留 `_process` 履历表
- **附件**:源 9 个 fileUrl + attachGroupId → 统一 `file_urls`(JSON 数组)+ `attach_group_id` 字符串约定
- **多租户**:work_hour.tenant_id 丢弃

## 9. 兼容策略
- 本项目未上线,数据可清空,无需兼容旧数据/旧 API(CLAUDE.md 规则7)
- 新 ppm 模块完全独立,不影响现有 workspace/agent/change 业务
- 现有 auth/admin/settings/workflow 的 API 与表结构不变,仅 `auth/permissions.py` 新增枚举 + RBAC 种子迁移追加

## 10. 风险登记
| 编号 | 风险 | 等级 | 应对 |
|---|---|---|---|
| R-01 | silly 动态表单能力丢失,里程碑节点自定义表单无法复刻 | P1 | 状态机覆盖主流程;自定义表单列后续增强 |
| R-02 | 审批流"找下一处理人"依赖项目角色,本项目无职位概念 | P1 | ppm 内独立定义项目角色(开发/项目/部门经理+成员),按角色查 project_member |
| R-03 | 19 表无建表 SQL,字段反向建模可能遗漏 | P1 | 逐 DO 核对 + alembic autogenerate + verify 对照源 |
| R-04 | openpyxl 导出 ~18 接口工作量大 | P2 | common/export.py 通用 helper 配置驱动 |
| R-05 | 看板拖拽持久化 + 人员聚合跨表查询性能 | P2 | kanban_order 字段 + 聚合查询加索引 |

## 11. 决策追踪
见 `decisions.md`。D-001@v1~D-008@v1 全部被本设计覆盖:
- D-001@v1 平台级 → §5/§8(无 workspace_id)/§7(require_permission_any)
- D-002@v1 里程碑中等简化 → §8(弃三表 + parent_id)/状态机
- D-003@v1 openpyxl 导出 → §6/§7
- D-004@v1 项目角色独立 → §10 R-02
- D-005@v1 PPM_* 权限 → §6/§7
- D-006@v1 通知走审计日志 → §3
- D-007@v1 附件 fileUrl → §3/§8
- D-008@v1 无历史迁移 → §3/§9

## 12. 自审
- ✅ 需求覆盖:6 子域 + 2 流 + 导出 + 看板全覆盖
- ✅ Grill 覆盖:D-001@v1~D-008@v1 全引用
- ✅ 约定一致:模块四件套/平台级/表名蛇形/中文注释/apiFetch/menu-permissions 均符合 scan CONVENTIONS
- ✅ 真实性:表名/子域来自源 DO/Controller 调研
- ✅ YAGNI:非目标明确剔除 silly 动态表单/站内信/上传/多租户
- ✅ 验收标准:W0–W6 各 Wave 可独立 verify(接口 + 表 + 页面)
- ✅ 非目标清晰:§3
- ✅ 兼容策略:§9(本项目未上线)
- ✅ 风险识别:R-01~R-05
- ✅ 7.5 生命周期契约:不涉及相关关键词,省略合规
- ⚠️ 自审存疑:审批流精确节点跳转(bug 跳过部门经理等)需 W3 实现时对照源 `ProblemNode10-40` 逐条核对

## 13. Design Grill 交叉审查(2026-06-20)
status: **passed**(无 P0/P1 blocker)。P2 实现细节:
- **X-001** kanban 人员数据源(源按 dept 聚合,本项目平台级无 dept):修正为「人员 = 当前用户可见的 project_member,可按 Organization(复用 admin org)分组」— §7 已更新
- **X-002** openpyxl 同步阻塞 async 事件循环:导出端点用 `def`(非 async)或 `anyio.to_thread.run_sync` — W1/W4 遵循
- **X-003** 审批流"下一处理人"缺失(项目无该角色成员):fallback 流程挂起 + 返回待指派提示 — W3 遵循

Cross-Check:19表=22源−3silly(一致);D-001@v1平台级↔/api/ppm前缀(一致);项目角色/状态机/fileUrl 定义可测试(清晰)。
