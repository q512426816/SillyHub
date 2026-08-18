---
schema_version: 1
doc_type: module-card
module_id: components-agent-profile
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 智能体档案组件（components-agent-profile）

## 定位
智能体档案（AgentProfile）UI 组件群：根级 `agent-profile-form.tsx`（新建/编辑双栏表单）、
`agent-profile-select.tsx`（发起任务时的档案下拉）与 `agent-profile/` 目录三件
（卡片墙 / 单卡 / 人设预览弹窗）。服务两个入口：全局页 /agent-profiles（跨工作区全集）
与工作区内页 /workspaces/[id]/agent-profiles。派生自 2026-08-02-agent-profile-layer
（task-12 表单/下拉）与 2026-08-04-agent-profile-ui-redesign（task-03/04 卡片墙 + 双栏表单重做）。

## 契约摘要
- `AgentProfileForm`（`agent-profile-form.tsx`）：宽弹窗（~900px）双栏表单。
  - 左栏三组 8 字段（身份/大脑/能力，D-011 分组）；右栏 `Form.useWatch` 实时预览
    角色卡（内联简化版，无后端往返、不依赖 AgentProfileCard）。
  - props：`mode: "create" | "edit"`（edit 需传 profile）、`workspaceId?`（全局页缺省）。
  - 全局页首字段「工作区上下文」选择器（D-006）：数据源 `listWorkspaces()`；
    visibility=workspace → 该 ws 即归属；private/platform → 仅作 sourcing，
    ws_id 由后端按 visibility 决定（PRIVATE/PLATFORM → ws_id=None）。
  - 导出 `toCreateBody(v)` / `toUpdateBody(v)`（line 119/134）：表单值 →
    AgentProfileCreate / AgentProfileUpdate；不引入 workspace_id 进 body。
  - 保存走 useCreateAgentProfile / useUpdateAgentProfile（react-query mutation）。
- `AgentProfileSelect`（`agent-profile-select.tsx`）：antd Select（showSearch +
  optionFilterProp="label"）。
  - 数据：`useWorkspaceAgentProfiles` + `usePlatformAgentProfiles` 合并去重。
  - option label 构造（buildOptionLabel）：`名 (供应商/模型) · 系统预置/可见范围`
    （对齐原型「代码审查助手 (claude/sonnet · 只读)」样式）。
  - 兜底项：`NO_PROFILE_VALUE`（空串）→ `onChange(null)`——后端走 run 显式 →
    workspace 默认 → 平台默认 → 无 profile 原路径，绝不因没绑档案卡住任务。
  - value 指向已删除/不可见档案时仍渲染该项并标「（已失效）」（对齐
    AgentProviderSelect 离线回退）；加载失败退化为仅兜底项不崩。
- `AgentProfileCardGrid`（`agent-profile/agent-profile-card-grid.tsx`）：卡片墙。
  - 全局页 `useMineAgentProfiles`（跨 ws 全集）/ ws 页（scopedToWorkspace）
    `useWorkspaceAgentProfiles`——两个内层 wrapper 组件分别调 hook，避免条件式 hook。
  - 筛选：搜索 Input 回车触发（匹配 name/system_prompt）+ 工作区 / 可见范围 / 供应商
    三个 Select（选项从数据派生；scoped 时隐藏工作区筛选项）。
  - 网格 grid-cols-3 gap-4 固定三列（不做响应式移动端）；空态 antd Empty；
  失败红条 + 重新加载。grid 自管"点卡片弹预览"，CRUD 回调由页面注入（缺省 no-op）。
- `AgentProfileCard`（`agent-profile/agent-profile-card.tsx`）：单张角色卡。
  - 头像按 provider 渐变（`AVATAR_GRADIENT_BY_PROVIDER`：claude 蓝/codex 绿/test 紫、
    default 琥珀）取名首字；系统预置显 ★ 与「只读」，无编辑/复制/删除按钮。
  - 结构：card-top（头像+名+Tag）/ prompt 摘要 line-clamp-2 / abilities chips
    （mcp_refs + skill_refs）/ card-foot（版本 + workspace_name + 操作 link）。
- `AgentProfilePreview`（`agent-profile/agent-profile-preview.tsx`）：只读预览 Modal。
  - 两段：system_prompt 原文（`<pre>` 可滚动）+ `buildSimulatedPrepend` 纯前端拼接的
    「模拟 prepend 到 CLAUDE.md 顶部」片段——不调 build_spec_bundle、不真注入 daemon
    （真正写入点在 daemon 侧读 agent_profile_snapshot 后落 CLAUDE.md）。
  - footer=null 纯只读；底部黄底 note 强调「档案只存引用，不存凭证」。

## 关键逻辑
- 数据源切换（grid 内）：
  ```
  if (scopedToWorkspace) → <WsGrid wid />      // useWorkspaceAgentProfiles
  else                   → <MineGrid />       // useMineAgentProfiles
  ```

## 注意事项
- 红线（design §10）：档案只存「用哪些」的引用（MCP server 名 / 技能池引用），
  严禁存任何 API Key / MCP 凭证——加字段前先过此关；预览弹窗黄条同义提醒。
- 角色卡是 FRONTEND_PAGE_STYLE 表格基准的显式特例（仅限 agent-profile 目录），
  勿外溢到其它列表页（agent-profile-card.tsx 头注释明示）。
- 预览的 prepend 片段是模拟展示，勿在前端加"应用/注入"动作。
- MCP / 技能选项来自当前 ws 的 .mcp.json（env 已脱敏，useWorkspaceMcpConfig）与
  用户技能池（useCustomSkills / usePlatformSkillsManifest）；供应商列表 listProviders。
- 表单遵循 FRONTEND_PAGE_STYLE §6（antd Modal + vertical Form + maskClosable=false +
  destroyOnClose），双栏布局是本页显式特例（design §10 R-02 / D-003）。
- 测试：`agent-profile/__tests__/`（card-grid / card 两套）。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
