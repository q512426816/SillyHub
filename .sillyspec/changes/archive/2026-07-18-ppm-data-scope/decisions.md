---
author: qinyi
created_at: 2026-07-18 17:16:00
change: 2026-07-18-ppm-data-scope
---

# 决策台账 — 2026-07-18-ppm-data-scope

> ⚠️ 本台账为人工重写,纠正 sillyspec CLI 自动生成的错误版本。CLI 自动版存在三处严重幻觉:① 对象误写为「项目计划(PsProjectPlan)/项目维护」(实为「任务计划 PlanTask / 问题清单 PpmProblemList」);② 误用「部门经理=部门子树」方案(用户明确选「按项目角色算」);③ source 字段编造用户发言(如"用户选'所属部门+下级'"——用户从未说过)。以本版本为准,真实依据见 source 字段。

## D-001@v1 · 变更对象 = 任务计划 + 问题清单

- **type**: requirement
- **status**: decided
- **source**: 用户原始需求("任务计划 和 问题清单 查询数据范围要限制下")
- **question**: 数据范围控制覆盖哪些查询入口?
- **answer**: 仅「任务计划」(`GET /api/ppm/task-plan/page`) 与「问题清单」(`GET /api/ppm/problem-list`) 两个列表查询(及其导出)。
- **normalized_requirement**: 范围 = task-plan/page + task-plan/export-excel + problem-list + problem-list/export-excel。不含项目计划/项目维护/看板。
- **impacts**: 改动集中在 `task/` 与 `problem/` 两个子域 service + router。
- **evidence**: 用户原话"任务计划 和 问题清单"。
- **priority**: P0
- **note**: 纠正 CLI 自动版把对象写成 PsProjectPlan/PpmProjectMaintenance 的错误。

## D-002@v1 · 经理判定来源 = 项目成员 role_name(非用户系统角色 key)

- **type**: requirement
- **status**: decided
- **source**: 用户 Step6 Q1 选「按每个项目里的角色(推荐)」
- **question**: 怎么判断一个登录用户是不是「项目经理/开发经理/业务经理/部门经理」?
- **answer**: 按**项目成员** `PpmProjectMember.role_name` 判定,而非用户的系统角色(`user_roles.role.key`)。在某项目成员 `role_name` 含对应经理角色 → 该项目算其管辖。
- **normalized_requirement**: 经理项目集 = `SELECT pm_project_id FROM ppm_project_member WHERE user_id=我 AND role_name 拆分含经理角色`。
- **impacts**: `_manager_project_ids` 查 `ppm_project_member` 表;不查 `user_roles`。
- **evidence**: 用户 Q1 明确选"按每个项目里的角色"(逐项目判定),非全局系统角色。
- **priority**: P0
- **note**: 纠正 CLI 自动版用 `user_roles.role.key` 判定的错误。用户 Step7"按角色 key"指用明确角色标识(中文↔key 一一对应)而非模糊匹配,判定来源仍是项目成员 role_name。

## D-003@v1 · 经理角色集 = {部门经理, 项目经理, 开发经理, 业务经理}

- **type**: requirement
- **status**: decided
- **source**: 用户原始需求 + DB 实测 role_name 取值
- **question**: 哪些角色算「经理」(看相关项目全部)?
- **answer**: `role_name` 逗号拆分后精确匹配 {部门经理, 项目经理, 开发经理, 业务经理} 之一。对应系统角色 key:DEPTBOSS/XMJL/KFJL/YWJL。**不含维保经理(WBJL)**(用户需求未列入)。
- **normalized_requirement**: `MANAGER_ROLE_NAMES = {"部门经理","项目经理","开发经理","业务经理"}`;应用层拆分 role_name 后 `& MANAGER_ROLE_NAMES` 非空即经理。
- **impacts**: `data_scope.py` 常量;4 经理权限完全相同,仅 role_name 值不同。
- **evidence**: DB `ppm_project_member.role_name` 实测:部门经理17/项目经理10/开发经理8/业务经理7 条;系统角色 key DEPTBOSS/XMJL/KFJL/YWJL 存在。
- **priority**: P0

## D-004@v1 · 部门经理 = 同项目经理逻辑(不碰组织表)

- **type**: requirement
- **status**: decided
- **source**: 用户 Step6 Q2 选「也按项目角色算(同项目经理)」
- **question**: 「部门经理看本部门全部任务」怎么认定、看哪些?
- **answer**: 部门经理不特殊:在项目成员 `role_name` 含"部门经理" → 看相关项目(同项目经理)。**不引入组织/部门维度,不碰 `Organization`/`UserOrganization`,不展开部门子树。**
- **normalized_requirement**: 部门经理 = D-003 经理集的一个值;无独立分支。
- **impacts**: 不新增 `organization_id` 字段,不写 migration,不刷数据。
- **evidence**: 用户 Q2 明确选"也按项目角色算(同项目经理)"。
- **priority**: P0
- **note**: 纠正 CLI 自动版的"部门子树 + organization_id 字段 + 刷数据"错误方案(那套 source 编造了"用户选所属部门+下级",用户从未说过)。

## D-005@v1 · "自己要干的" = 只看自己负责的

- **type**: requirement
- **status**: decided
- **source**: 用户 Step6 Q3 选「只看自己负责的(推荐)」
- **question**: 其余人「只能看自己要干的任务」,范围包括哪些?
- **answer**: 任务计划 = `PlanTask.user_id == 自己`;问题清单 = 自己是 `duty_user_id` / `audit_user_id` / `now_handle_user`(逗号拆分含自己)任一。**不含** `work_partner`/`TaskExecute.execute_user_id`(配合人员/执行人不纳入)。
- **normalized_requirement**: 非经理非超管 → where = `(user_id==我)`(任务) / `(duty==我 OR audit==我 OR now_handle 含我)`(问题)。
- **impacts**: service where 分支;`now_handle_user` 应用层拆分匹配。
- **evidence**: 用户 Q3 明确选"只看自己负责的"。
- **priority**: P0
- **note**: 纠正 CLI 自动版"其余看不到任何数据"的错误——用户要"看自己要干的"非空集。

## D-006@v1 · 超管 = is_platform_admin 或 super_admin 角色

- **type**: requirement
- **status**: decided
- **source**: 用户需求(super_admin 超级管理员看全部)+ 工程兜底
- **question**: 「super_admin 看全部」怎么判定?
- **answer**: `user.is_platform_admin=true` 或持 `super_admin` 角色 → 全部(不加 where)。
- **normalized_requirement**: `is_super = user.is_platform_admin or (await has_role(session, user, "super_admin"))`。
- **impacts**: `data_scope` 第一分支短路。
- **evidence**: DB `super_admin` 角色 5 人(`is_platform_admin` 全 false)+ `is_platform_admin=true` 的 admin2(1 人),两者兜底合并;现有 rbac `has_permission` 即用 `is_platform_admin` 短路。
- **priority**: P0

## D-007@v1 · 实现方案 A:公共过滤模块 + service 注入

- **type**: design
- **status**: decided
- **source**: 用户 Step8 选「方案A 公共过滤模块(推荐)」
- **question**: 数据范围过滤架构怎么选?
- **answer**: 新建 `ppm/common/data_scope.py` 提供经理项目集计算 + 范围 where 构造函数,在 `PlanTaskService.page` / `ProblemService.list_problems`(及各自导出)注入。否决 B(接口层依赖注入,改 router+service 签名多)、C(预算缓存,YAGNI)。
- **normalized_requirement**: 1 个新模块 + 2 个 service 注入 user 参数 + router 透传 user;不新增依赖项层。
- **impacts**: `data_scope.py` 新建;task/problem service 加 `user` 参数;router 调用处补传 user。
- **evidence**: 用户选方案 A;符合现有 `personal-task-plan` 硬编码 user_id 的 service 注入风格。
- **priority**: P0

## D-008@v1 · 无新表 / 无新字段 / 无 migration

- **type**: design
- **status**: decided
- **source**: 方案 A 推导 + D-002/D-004 结论
- **question**: 要不要改数据模型?
- **answer**: **不要。** 完全复用现有 `PpmProjectMember.role_name` + `PlanTask`/`PpmProblemList` 现有字段做查询过滤。零 migration、零数据刷写。
- **normalized_requirement**: 不动 model、不加 alembic。
- **impacts**: 回退零成本;无需 alembic heads 检查(规避 memory `migration-chain-fragmentation-pattern` 风险)。
- **evidence**: D-002 判定靠 role_name(已存在);D-004 不碰组织表。
- **priority**: P0
- **note**: 纠正 CLI 自动版"新增 organization_id + migration + 刷数据"的错误(那是 D-004 误方案的衍生)。

## D-009@v1 · project_id 为 NULL 的任务归属

- **type**: design
- **status**: decided
- **source**: 边界推导(PlanTask.project_id 可空)
- **question**: 没挂项目的任务(`project_id` NULL),经理看得见吗?
- **answer**: 经理项目集过滤不到 NULL → 这类任务仅当 `user_id==自己`(自己负责)或超管时可见。默认合理(没挂项目的任务不属于任何"相关项目")。
- **normalized_requirement**: NULL project_id 任务不进经理分支,只可能命中"自己负责"分支或超管全量。
- **impacts**: 无额外处理,where 自然实现。
- **evidence**: `PlanTask.project_id` 可空(`task/model.py:75`)。
- **priority**: P1

## D-010@v1 · 数据范围与功能权限正交

- **type**: design
- **status**: decided
- **source**: 工程惯例 + 用户"其余人只看自己要干的"(有功能权限但范围受限)
- **question**: 数据范围要不要替代功能权限?
- **answer**: 不替代,正交。`require_permission_any(PPM_TASK_READ/PPM_PROBLEM_READ)` 保留(管"能不能进接口"),scope 管"能看哪些数据"。两层叠加。
- **normalized_requirement**: 功能权限点不变;scope 是额外数据过滤层。
- **impacts**: router 保留 `require_permission_any` + 加 user 透传。
- **evidence**: 现有 `require_permission_any`(`core/auth_deps.py:124`)保留。
- **priority**: P1

## D-011@v1 · 本次不做前端改造

- **type**: design
- **status**: decided
- **source**: YAGNI + 用户需求聚焦后端查询范围
- **question**: 前端"我的/全部"按钮要不要改?
- **answer**: 本次不改前端。后端强制按角色过滤后,"全部"语义自然变为"权限范围内全部",需求即满足。前端文案/按钮显隐优化(如对普通人隐藏"全部")留后续 quick。
- **normalized_requirement**: 仅后端改动;前端零改。
- **impacts**: 范围缩小,降低回归风险。
- **evidence**: 用户需求只说"查询数据范围限制",未提前端。
- **priority**: P2
