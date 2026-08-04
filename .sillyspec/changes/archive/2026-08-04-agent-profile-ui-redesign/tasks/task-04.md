---
task_id: task-04
title: 重做表单(双栏预览 + 工作区上下文)
author: qinyi
created_at: 2026-08-04 13:11:27
priority: P0
depends_on: [task-02]
requirement_ids: [FR-06]
decision_ids: [D-003@v1, D-006@v1]
expects_from: task-02(可选,聚合类型); 数据源 listWorkspaces(@/lib/workspaces)
allowed_paths:
  - frontend/src/components/agent-profile-form.tsx
---

## goal
> 重做 `agent-profile-form.tsx` 为宽弹窗(~900px)双栏,左栏填字段、右栏实时预览 AgentProfileCard;保留原 8 字段分身份/大脑/能力三组;全局页(workspaceId 缺省)首字段加「工作区上下文」选择器,visibility 决定 workspace_id 落点。

## implementation
- Modal 宽度 640→~900px,内部双栏(左 form-col 7/12 填字段,右 preview-col 5/12 sticky 预览),右栏复用 task-03 的 AgentProfileCard 作预览体
- 左栏保留三组(① 身份 / ② 大脑 / ③ 工具能力)与现 8 字段完全一致不增减;Form.useWatch 订阅当前值合成预览卡入参,无后端往返
- workspaceId prop 改可选;缺省(全局页)首字段渲染「工作区上下文」Select,数据源 listWorkspaces().items,必填校验
- ws-scoped 数据源(useWorkspaceToolPolicies/useWorkspaceMcpConfig)实参改为「选择器值 或 路由 ws」;skill_refs 仍 user-scoped 不变
- visibility=workspace 时选择器值即归属 ws 传入 useCreateAgentProfile;visibility=private/platform 时仅作 sourcing,workspace_id 落 null(后端按 visibility 决定)
- 编辑态 private/platform(profile.workspace_id 空)用参考工作区默认 actor 首个可见 ws 可手切;ws 内页路由带 wid 无选择器;系统预置档全表单 disabled 只读

## acceptance
- 左栏改任一字段,右栏预览卡同步刷新(含 visibility 标签/模型行/能力 chip)
- 8 字段(name/visibility/provider/model/system_prompt/tool_policy_id/mcp_refs/skill_refs)齐全可填可校验
- 全局页选「工作区上下文」后 ③ 工具能力的 mcp/policy 下拉出现该 ws 数据;未选时禁用保存
- visibility=workspace 创建落库 workspace_id=该 ws,private/platform 落 null;ws 内页无选择器,系统预置档只读无保存

## verify
- `cd frontend && pnpm exec tsc --noEmit` 0 error;workspaceId 改可选后既有 agent-profile-form.test.tsx 需同步补 mock(task-07 统一跑)

## constraints
- 仍用 antd Modal 不改 Drawer(design §6);字段集不变(8 项)仅重排加选择器
- workspace_id 落点严格按 visibility 决定(D-006)
- UI 全中文,走 FRONTEND_PAGE_STYLE token + tailwind
