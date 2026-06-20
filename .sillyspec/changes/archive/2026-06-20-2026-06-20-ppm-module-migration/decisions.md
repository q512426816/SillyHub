---
author: qinyi
created_at: 2026-06-20T14:43:06+0800
change: 2026-06-20-ppm-module-migration
---

# 决策台账

## D-001@v1: ppm 工作区隔离 = 平台级
- type: architecture
- status: accepted
- source: user
- question: ppm 数据绑 workspace 还是平台级?
- answer: 平台级,不绑 workspace
- normalized_requirement: 所有 ppm 表无 workspace_id;路由 /api/ppm/*;鉴权 require_permission_any(PPM_*) + require_platform_admin
- impacts: [design §5/§7/§8]
- evidence: AskUserQuestion 用户选择"平台级"
- priority: P0

## D-002@v1: 里程碑明细流 = 中等简化
- type: architecture
- status: accepted
- source: user
- question: silly 流程引擎(里程碑明细)简化程度?
- answer: 中等(状态机 + 变更,弃 silly 动态表单/变量表,版本用 parent_id)
- normalized_requirement: PsPlanNodeDetail 单表 + parent_id 版本链 + status 状态机(草稿→审核→审批→完成 + 驳回 + 变更);保留 _process 履历表;不做按 nodeKey 动态表单
- impacts: [design §8, R-01]
- evidence: AskUserQuestion 用户选择"中等"
- priority: P0

## D-003@v1: Excel 导出 = openpyxl
- type: boundary
- status: accepted
- source: user
- question: ~18 个 export-excel 怎么处理?
- answer: 加 openpyxl 完整实现
- normalized_requirement: backend 依赖加 openpyxl;common/export.py 通用导出 helper;各子域 /export-excel 端点
- impacts: [design §6/§7, R-04]
- evidence: AskUserQuestion 用户选择"加 openpyxl"
- priority: P1

## D-004@v1: 项目角色体系 = ppm 内独立
- type: architecture
- status: accepted
- source: code(自行决策)
- question: ppm 项目成员角色(开发/项目/部门经理)复用 auth.Role 还是独立?
- answer: ppm 内独立轻量定义(枚举/字典),不复用 auth.Role
- normalized_requirement: project_member.role 为 ppm 项目角色枚举(开发经理/项目经理/部门经理/成员);审批流按角色查 project_member;不映射 auth.Role(权限容器非职位)
- impacts: [design §10 R-02]
- evidence: auth/permissions.py 的 Role 是权限容器;源 getProjectMemberList(projectId, role)
- priority: P0

## D-005@v1: 权限模型 = PPM_* 枚举
- type: architecture
- status: accepted
- source: code(自行决策)
- question: 权限如何映射?
- answer: 新增 PPM_* Permission 枚举,归并源 29 perm
- normalized_requirement: auth/permissions.py 新增 PPM_PROJECT_*/CUSTOMER_*/PLAN_*/PROBLEM_*/TASK_*/WORKHOUR_*/KANBAN_*(read/write/delete/export);RBAC 种子迁移同步;路由 require_permission_any
- impacts: [design §6/§7]
- evidence: 源 @PreAuthorize 29 perm code;本项目 Permission StrEnum
- priority: P0

## D-006@v1: 通知 = 审计日志 + 前端轮询
- type: boundary
- status: accepted
- source: user
- question: 站内信通知怎么补?
- answer: 不建独立站内信,用 audit_logs 记录 + 前端轮询
- normalized_requirement: 流程流转写 audit_logs(自动);前端轮询任务/审计列表;不实现 NotifyMessage 模块
- impacts: [design §3]
- evidence: AskUserQuestion 用户选择"最小可用"
- priority: P1

## D-007@v1: 附件 = fileUrl 字段约定
- type: boundary
- status: accepted
- source: user
- question: 附件存储怎么补?
- answer: 不建上传服务,沿用 fileUrl 字段约定
- normalized_requirement: 附件存为 file_urls(JSON 数组)字段 + attach_group_id 字符串约定;不实现文件上传/对象存储模块
- impacts: [design §3/§8]
- evidence: AskUserQuestion 用户选择"最小可用";源 fileUrl1-9
- priority: P1

## D-008@v1: 无历史数据迁移
- type: compatibility
- status: accepted
- source: docs(CLAUDE.md 规则7)
- question: 是否迁移源系统历史数据?
- answer: 不迁移,本项目未上线可清空
- normalized_requirement: 只迁功能不迁数据;无需 ETL;迁移文件仅建空表 + 种子权限
- impacts: [design §3/§9]
- evidence: CLAUDE.md 规则7"本项目未正式上线,数据可以清空"
- priority: P1
