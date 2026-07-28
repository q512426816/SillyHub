---
author: qinyi
created_at: 2026-07-28 13:51:03
change: 2026-07-28-ppm-project-link-workspace
---

# 提案书(Proposal)— PPM项目关联平台工作区

> 总体规划分两阶段:本提案是 **A 阶段(关联骨架)**;B 阶段(项目维度会话式 AI 开发入口 + 重做会话界面 + PC/手机)是下一个独立变更,依赖本关联。

## 动机

PPM 项目维护(业务项目档案:编号/客户/状态/计划/任务)与平台工作区(Git 仓库 + AI 开发空间:代码/Agent/变更)目前**完全割裂**——两边无任何关联字段,项目成员看不到关联的代码工作区,工作区也看不出属于哪个业务项目。用户的终极诉求是「在 PPM 项目里像 Claude Code 那样和 AI 对话改代码」,这需要先打通「项目和谁关联」,本提案把这块地基做好,为 B 阶段铺路。

## 关键问题(现有方案为何不够)

1. **业务与开发割裂**:PPM 管「做什么」,工作区管「在哪做、怎么做」,二者无关联,无法从项目维度进入对应代码工作区。
2. **PPM 平台级无工作区维度**:D-001@v1 明确 PPM 实体平台级、无 `workspace_id`;需要一个**不污染 PPM 数据模型**的方式建立关联。
3. **会话入口的前置依赖**:B 阶段「项目→关联工作区→会话」硬依赖关联记录,关联骨架必须先行且独立可交付/可验证。

## 变更范围(本次 A 阶段做什么)

- 新建 PPM 项目 ↔ 工作区 **多对多关联表** `ppm_project_workspace`(仿 `TaskWorkspace` / `AgentRunWorkspace`)。
- **双边对称 API**:项目侧(`/ppm/projects/{id}/workspaces`)+ 工作区侧(`/workspaces/{id}/ppm-projects`)各自 GET/POST/DELETE,操作同一张表,各自权限校验。
- **双边前端(PC)**:项目维护页「关联工作区」弹窗 + 工作区详情页「关联项目」区块,关联后互相可见(名/状态)。
- 权限:工作区侧 = 工作区成员;项目侧 = PPM 项目 manager(复用 `data_scope`/`manager_project_ids`)。
- 一个 Alembic migration(零破坏,新表)。

## 方案概述

沿用工作区现有 M:N 关联模式,新增 `PpmProjectWorkspace`,工作区作为关联中枢,双边操作同一张表(详见 design.md)。PPM 后端零数据模型改动,仅加关联端点。

## 不在范围内(Non-Goals)

- ❌ **会话式开发入口 / 重做会话界面**(B 阶段):不在项目页加「进会话」、不接 agent_run 交互。
- ❌ **关联元数据**:不记类型/主次/备注/角色,纯关联。
- ❌ **手机端**:本阶段仅 PC,手机端随 B 阶段。
- ❌ **权限传递**:不做「项目成员自动获得关联工作区会话权限」(B 阶段议题)。
- ❌ **任务↔变更/agent_run 数据联动**(B 阶段或更后)。

## 影响

- **后端**:workspace 模块(model/link_service/link_router/main.py 注册/schema)、ppm/project(router 加关联端点)、migration。
- **前端**:ppm/projects 页、workspaces/[id] 页、2 个新组件。
- **PPM 已上线模块**:零数据模型改动,仅 `ppm/project/router.py` 加关联端点(只读写新关联表)。
- **下游**:B 阶段(项目会话入口)依赖本关联。
