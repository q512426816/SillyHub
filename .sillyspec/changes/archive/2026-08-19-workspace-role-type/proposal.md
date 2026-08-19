---
author: qinyi
created_at: 2026-08-18 23:10:00
change: 2026-08-18-workspace-role-type
---

# 提案书（Proposal）— 工作区角色类型

## 动机

工作区与 PPM 项目的关联骨架（2026-07-28-ppm-project-link-workspace）只回答了"项目和哪些工作区有关"，没有回答"这个工作区是项目里的**什么**"——前端代码、后端代码、业务文档还是某个模块。用户的核心诉求：后续会话能按项目直接定位到对应角色的工作区，agent 执行有据可查。跨设备团队协作（前端工作区挂机器 A、后端工作区挂机器 B、一个会话指挥两边）是下一个变更的消费方，本变更把"每个工作区是什么角色"这块地基打好。

## 关键问题

1. **Workspace.type/role 字段存在但从未暴露**：字段从 ProjectComponent 吸收（ADR-07）落了表、API 也接受，但添加工作区弹窗没有任何类型输入项，实际数据基本全 NULL——字段空转。
2. **自由字符串没法支撑定位**：没有受控词表，即便填了值也无法可靠过滤/聚合；列表页类型筛选下拉还挂着已废弃旧值（daemon-client），形同虚设。
3. **yaml 拓扑与用户语义各自为政**：projects/*.yaml 组件 type 原样透传（frontend/backend/docs…），与用户认知的"前端代码/后端代码/业务文档"不对齐，同一概念两套词。
4. **没有用途描述字段**：工作区"是干什么的"无处可写，项目侧关联列表只有名字。

## 变更范围

- `Workspace.type` 收成 8 值受控词表（frontend-code/backend-code/fullstack/business-doc/submodule/deploy-ops/design-asset/other），后端常量 + Pydantic Literal 校验进 OpenAPI；新建必填。
- `role` 保留自由文本补充（如"订单模块"）；新增 `description` 字段（Text 可空）。
- 前端：添加工作区弹窗加类型必选下拉+描述框；列表页类型徽标+筛选换新词表（含 ?unclassified=true 未分类）；详情页可编辑三项；PPM 项目关联列表按词表渲染徽标。
- yaml 拓扑 type 在组件目录展示层按映射规则归一（不落 Workspace 表）；ComponentRead 补 description。
- Migration：加 description 列 + 存量 type CASE 收编；破坏面调用点（移动端筛选/创建、后端存量测试）同 change 最小修齐。

## 不在范围内（显式清单）

- 不做"项目会话按工作区角色选择工作区"入口（下一变更）。
- 不在 ppm_project_workspace 关联表加任何元数据（维持 2026-07-28 决策：类型放本体）。
- 不做移动端新功能（既有调用点只做最小收口防回归）。
- 不改 daemon / 会员绑定 / spec 同步链路。
- 不做旧值保真兼容（未上线允许重置；映射不上的显示原值不崩）。

## 成功标准（可验证）

- 新建工作区必须选类型；存量 NULL 显示"未分类"，`?unclassified=true` 可筛出。
- 列表/项目关联列表按词表徽标渲染；类型筛选用新词表命中正确。
- OpenAPI enum 出现在 WorkspaceCreate.type；api-types.ts 由 gen:types 生成含联合类型。
- yaml 组件目录展示归一后类型；WorkspaceBrief 含 role/description。
- pytest / vitest / tsc 全绿（含 §5.6 破坏面清单的既有测试改写）。
