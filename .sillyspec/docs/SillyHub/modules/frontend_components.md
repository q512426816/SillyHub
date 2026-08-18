---
schema_version: 1
doc_type: module-card
module_id: frontend_components
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 前端可复用组件层（frontend_components）

## 定位
SillyHub 前端可复用组件层（frontend/src/components/**）。承载全局外壳（AppShell/TopBar/AntdProviders）、业务域组件（交互会话、变更详情、工作区管理、供应商表单、agent 控制台）、移动端组件族（mobile/）与 shadcn 风格基础件（ui/）。组件自治取数（内部调 @/lib/*），被 frontend_app 页面组装；自身依赖 frontend_lib 与 frontend_stores。

## 契约摘要
- 全局骨架：
  - `app-shell.tsx` — 侧栏按 SECTION_ORDER 渲染分组；菜单隔离（/ppm/* 只渲染 ppm section，其它路径只渲染非 ppm section）；条目经 `visibleMenusBySection(user, section)` 权限过滤；本文件仅管图标映射（MENU_ICON_MAP），菜单条目数据来自 menu-permissions。
  - `top-bar.tsx` — 顶栏（平台切换 / 菜单 section 隔离与 AppShell 一致）
  - `antd-providers.tsx` — ConfigProvider（zhCN locale + token + Table 主题，dayjs zh-cn 双保险）
  - `error-boundary.tsx` / `logout-confirm-dialog.tsx`
- 会话域（daemon/ + sessions/，两处共享子组件）：
  - `interactive-session-panel.tsx` — /runtimes 弹窗内交互会话主面板
  - `runtime-session-dialog.tsx` + `runtime-session-helpers.tsx`（logsToTurns / reply 流式 delta 直接 concat 不加 \n）/ `runtime-card-helpers.tsx`
  - `turn-timeline.tsx` / `session-input-bar.tsx` — /sessions 总入口复用
  - `machine-card.tsx` / `runtime-card.tsx` — 机器级与实例级卡片
  - `remote-folder-picker.tsx` — daemon list_roots/list_dir 懒加载目录树（自治：初始化根 / Tree loadData / 手输跳转校验 / 错误降级红条）
  - `session-list-layout.tsx` / `session-log-sanitize.ts` / `daemon-required-notice.tsx`
- sessions/（总入口配套）：
  - `session-list-panel` — 筛选 + 虚拟滚动 + 紧凑两行条目
  - `new-session-form` — 新会话四选择器（runtime / profile / 供应商 / 会话名）
  - `session-config-bar` — 运行中切换档案/供应商（点选即切换）
  - `ctx-usage-bar` — 上下文用量前端累计
- 变更域（changes/）：
  - `detail/` 子目录 — 变更详情展示组件族（文档矩阵 / Gate 面板 / 会话区等）
  - `change-session-section` / `change-step-badge` — 变更会话区与阶段徽标
  - `quicklog-drawer` / `quicklog-table` — quicklog 条目查看
- 工作区域：
  - 入口件：`workspace-card` / `workspace-scan-dialog` / `workspace-switcher` / `workspace-tabs`
  - 绑定与成员：`workspace-binding-dialog` / `workspace-binding-guard` / `workspace-member-row` / `workspace-member-add-dialog`
  - 配置与路径：`workspace-config-card` / `workspace-path-picker` / `workspace-path-fields` / `workspace-daemon-switcher` / `workspace-access-guide` / `workspace-session-section`
  - workspace/ 目录：`LinkWorkspaceDialog` / `LinkedProjectsSection`（PPM 项目链接）、`shared-daemon-manager` / `shared-daemon-toggle`（共享 daemon 管理与成员视图）
- 供应商域（llm-providers/）：
  - `llm-provider-form` — CRUD 表单（agent_kind / auth_field / api_format / 模型角色映射编辑）
  - `llm-provider-list` — 启停（set/unset-default）与列表
  - `model-input-with-fetch` — 拉上游 /v1/models 填充模型下拉
  - `usage-footer` — 余额/配额/用量两态展示（瞬时错误保上次值）
- agent 域：
  - `agent-run-panel.tsx` — agent 控制台（日志区无 max-width 撑满主区）
  - `agent-log-viewer.tsx` + agent-log/（normalize.ts 归一化 / tool-renderers.tsx 工具渲染器 / types.ts 共享类型）
  - `agent/` — borrowed-solution-files 借用方案文件面板
  - `mission-console.tsx` / `mission-summary-card.tsx` — 任务执行控制台与摘要
  - `AgentModelInput` / `AgentProviderSelect` — 模型与供应商选择
- 交互问答：`ask-user-dialog-card` — codex request_user_input / 可归一化 MCP elicitation 的 question/options 问答（每问下方常驻手动输入框；复杂 schema daemon 侧 fail-closed）。
- 移动端（mobile/）：`mobile-app-shell` / `mobile-top-bar` / `mobile-tab-bar`（底部导航）、`mobile-card-list`（卡片列表替代表格）、`mobile-filter-drawer` / `mobile-detail-sheet` / `milestone-sheet`（筛选/详情抽屉）、`mobile-batch-bar` / `mobile-action-menu` / `mobile-export-button`（批量/操作/导出）。
- 基础件（ui/，shadcn 模式）：button / input / badge / card / dialog / dropdown-menu / avatar / empty-state / json-editor / markdown-text / status-badge / confirm-captcha。
- 其余独立件：
  - 审批与权限：`permission-approval-card`
  - 文件中心：`file-upload` / `file-viewer` / `file-image`
  - 令牌：`mcp-token-create-dialog` / `api-key-create-dialog`
  - 技能：`custom-skill-edit-dialog` / `skill-content-drawer`
  - admin-*（用户抽屉 / 组织树 / 角色权限选择器）、ppm-*（资源表格 / 子表 / 状态动作 / 字典选择等）
  - `stage-team-config` / `team-progress`（阶段团队配置与进度）、charts/（图表）

## 关键逻辑
菜单隔离（app-shell）：
```
inPpm = pathname 以 /ppm 开头
SECTION_ORDER.filter(section => inPpm ? section==="ppm" : section!=="ppm")
→ ppm 与主平台菜单互不可见
→ 每组内 visibleMenusBySection(user, section) 按用户权限过滤条目
```
交互会话渲染（/sessions 页与 /runtimes 弹窗共享范式）：
```
历史 turn = getAgentSessionLogs → logsToTurns（SSE attach 前预取防丢事件）
实时 turn = streamSession SSE → TurnTimeline 渲染（reply 片段直接 concat）
发送 = injectSession；CtxUsageBar 按实时 turn input_tokens 前端求和
```

## 注意事项
- AppShell / TopBar / antd-providers 是全局组件，改动影响所有 dashboard 页面；菜单条目缺失是 menu-permissions 数据问题，app-shell 只管图标映射。
- interactive-session-panel 与 sessions 页共享 TurnTimeline / SessionInputBar / 事件处理语义：改会话渲染需两处回归（/runtimes 弹窗零回归是 sessions-portal 的硬约束）。
- reply 流式 delta 拼接不加 \n（delta 内部已保留换行），加了会破坏 markdown 连续渲染。
- ui/ 基础件遵循 shadcn 约定（CLI 添加为主，不手改生成物）；业务组件一律 "use client"。
- agent-log 归一化（去重 TOOL_USE / 合并 TOOL_RESULT / 识别 thinking）是纯函数，与渲染器分离便于单测；stdout [TOOL_USE]/[TOOL_RESULT] 文本事件也走同一解析。
- remote-folder-picker 是远程目录选择唯一入口（替代旧 browseFolder 系统弹窗——Web 用户看不到 daemon 宿主机原生弹窗）。
- 样式遵循 FRONTEND_PAGE_STYLE.md：按钮 antd 化、Badge→Tag、Drawer→Modal 等规范已在 ppm 系落地，新组件照此。
- 组件自治取数，但跨页/跨组件共享状态一律走 frontend_stores 或 react-query，不引入组件级全局变量。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
