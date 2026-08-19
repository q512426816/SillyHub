---
author: qinyi
created_at: 2026-08-18 22:58:30
change: 2026-08-18-workspace-role-type
---

# 决策台账 — 工作区角色类型

## D-001@v1 类型语义放工作区本体，不放关联表

- type: design
- status: accepted
- source: 用户 2026-08-18 对话（"这个信息是不是工作区本身可以添加和类型区分，同一个工作区对应到不同项目下应该都是同一个类型的东西"）
- question: 工作区角色类型（前端代码/后端代码/业务文档等）存在工作区本体还是 ppm_project_workspace 关联表？
- answer: 工作区本体（Workspace.type）。同一工作区关联多个项目时类型唯一，关联表保持纯净。
- normalized_requirement: Workspace.type 收受控词表；ppm_project_workspace 不加任何元数据列。
- impacts: FR-01/FR-06；延续 2026-07-28-ppm-project-link-workspace Non-Goal 决策。
- evidence: design.md §2/§3/§11。
- priority: P0

## D-002@v1 type 用受控词表（方案 A），单层结构

- type: design
- status: accepted
- source: 用户 2026-08-18 方案选择（AskUserQuestion 答复"方案 A（推荐）"）
- question: type 采用受控词表、自由文本、还是父子两层（component_key 大类 + type 子模块）？
- answer: 方案 A：8 值受控词表 + role 自由文本补充 + description 长文本。后端常量+Literal 校验进 OpenAPI。
- normalized_requirement: WORKSPACE_TYPE_VALUES 8 值；WorkspaceCreate.type 必填；role ≤100 自由文本；description ≤2000 可空。
- impacts: FR-01/FR-02/FR-03；R-01。
- evidence: design.md §5.1/§7。
- priority: P0

## D-003@v1 yaml 拓扑 type 仅收编明确映射

- type: design
- status: accepted
- source: 设计阶段自定（用户授权"按推荐落地"，方案确认时包含第⑤段）
- question: projects/*.yaml 组件 type 与新词表不一致时怎么处理？
- answer: YAML_TYPE_NORMALIZE_MAP 仅收编明确映射（frontend→frontend-code 等）；映射不上的非空值保留原值不覆盖，前端灰徽标兜底显示。
- normalized_requirement: parser._parse_workspace 归一 + migration 存量 CASE UPDATE + 前端未知值兜底渲染。
- impacts: FR-07；R-02；§8/§9。
- evidence: design.md §5.1/§5.3/§8。
- priority: P1

## D-004@v1 parser 产物不落 Workspace 表，FR-07 收敛为组件目录展示层归一

- type: consistency
- status: accepted
- source: design-grill（P0-A）
- question: design 初版称 parser 归一后经 service 落 Workspace 表——真实路径？
- answer: 2026-07-06-component-readonly-split 后 parser 产物仅供 component_catalog 只读展示，service.create 的 type 只来自 API payload。归一在 parser/展示层动态做；yaml description 经 ParsedWorkspace→ComponentRead 透传展示，不落库。
- normalized_requirement: FR-07 改述为组件目录展示归一；文件清单补 component_catalog_service.py。
- impacts: FR-07；§5.3/§6；D-003 仍然成立（映射规则不变，作用层变）。
- evidence: component_catalog_service.py:40-50 只读消费；design.md §5.3。
- priority: P0

## D-005@v1 Update omit=不改/null=清空；"未分类"筛选走 unclassified 参数

- type: definition
- status: accepted
- source: design-grill（P0-B + P1）
- question: Update None 语义与 NULL 筛选如何表达？
- answer: omit=不改 / 显式 null=清空（对齐现有 exclude_unset 实现）；`?type=` 等值匹配表达不了 NULL，"未分类"用专用 `?unclassified=true`（与 type 互斥）。
- impacts: FR-04；§5.3/§7/§9；前端 workspaces.ts Update/Create Input。
- evidence: schema.py:156 default_agent 同模式；design.md §5.3。
- priority: P0

## D-006@v1 移动端既有调用点最小收口

- type: boundary
- status: accepted
- source: design-grill（P0-C）
- question: Create 必填+422 化对移动端 m/workspaces 的被动回归怎么处理？
- answer: 非目标仅指"不做移动端新功能"；既有筛选/创建调用点同 change 最小修齐（删旧值筛选项、提交体补 type），§5.6 破坏面清单逐项收口。
- impacts: §3/§5.6；R-04/R-07；文件清单补 m/workspaces/page.tsx。
- evidence: m/workspaces/page.tsx:130/548 调用点；design.md §5.6。
- priority: P0
