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
  - `agent-log-card.tsx` — 本地 Agent 会话（tool_report）日志条目卡；「查看内容」对话化回显（2026-08-23-agent-log-conversation-view）：先调 messages 端点，parsed 时直构段列表渲染（用户气泡/MarkdownText/思考折叠/tool_use↔tool_result 按 tool_use_id 配对、失配「结果未记录」中性徽章禁「执行中」）+「对话/原文」tab + truncated 加载更早；status≠parsed/ApiError 静默回落原文 <pre> 黄条提示；不走 session-log-assembler（Grill B2 裁决）
- sessions/（总入口配套）：
  - `session-list-panel` — 筛选 + 虚拟滚动 + 紧凑两行条目
  - `workspace-session-picker` — 新建会话工作区选择器（自治取数 listWorkspaces + fetchMyBindings；首项「不使用工作区」，选中工作区按绑定 daemon_id 联动带出在线机器；空列表禁用提示 + 失败重试，2026-08-19-sessions-workspace-selector）
  - `new-session-form` — 新会话五选择器（工作区 / runtime / profile / 供应商 / 会话名；选中工作区提交体带 workspace_id 并显示项目目录运行提示条）
  - `session-config-bar` — 运行中切换档案/供应商（点选即切换）
  - `ctx-usage-bar` — 上下文用量前端累计
- 变更域（changes/）：
  - `detail/` 子目录 — 变更详情展示组件族（文档矩阵 / Gate 面板 / 会话区等）
  - `change-session-section` / `change-step-badge` — 变更会话区与阶段徽标
  - `quicklog-drawer` / `quicklog-table` — quicklog 条目查看
- 工作区域：
  - 入口件：`workspace-card` / `workspace-scan-dialog` / `workspace-switcher` / `workspace-tabs`
    （workspace-card 带类型徽标、workspace-scan-dialog 带类型必选下拉+描述
    textarea，均消费 lib/workspace-types，2026-08-18-workspace-role-type）
  - 绑定与成员：`workspace-binding-dialog` / `workspace-binding-guard` / `workspace-member-row` / `workspace-member-add-dialog`
  - 配置与路径：`workspace-config-card` / `workspace-path-picker` / `workspace-path-fields` / `workspace-daemon-switcher` / `workspace-access-guide` / `workspace-session-section`
  - workspace/ 目录：`LinkWorkspaceDialog` / `LinkedProjectsSection`（PPM 项目链接）、`shared-daemon-manager` / `shared-daemon-toggle`（共享 daemon 管理与成员视图）；LinkWorkspaceDialog 已关联/可选两侧均按词表徽标渲染
    工作区类型（title 带 role/description 摘要）
- 供应商域（llm-providers/）：
  - `llm-provider-form` — CRUD 表单（agent_kind / auth_field / api_format / 模型角色映射编辑）；结构化字段（base_url/兜底模型/角色模型/认证字段）↔ 配置 JSON `settings_config.env` 同名键联动（仅键已存在时跟随，字段清空删键；ql-20260823-007，防 JSON 过期值覆盖字段——曾致空占位盖掉真实 key → 会话 Not logged in）
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
交互会话渲染（/sessions 页与 /runtimes 弹窗共享范式，2026-08-19-session-stream-ux 起统一走装配器）：
```
历史 turn = getAgentSessionLogs → logsToTurns（内部走装配器 logsToSegments + 兼容投影）
实时 turn = streamSession SSE → envelope 归一 → applyLogToSegments（session-log-assembler.ts
           纯函数：分段装配/归属路由/override 撤回/双路去重，输出 TurnSegment[] 结构化段模型）
渲染 = TurnTimeline v2：turn 带 segments 走段渲染（turn-segment-views 六类段组件
       + 内置 TurnStatusBar 轮级状态条）；segments 缺省回退旧渲染路径（brownfield）
子代理 = parent_tool_use_id 归属嵌套进 Task 工具段 children（depth>1 递归）+
         sessions/subagent-catalog 头部目录（仅 /sessions 页）
发送 = injectSession；计时锚点三源（live 占位 Date.now / attach run.started_at / 首条 log）
文件段（2026-08-23-agent-file-upload-mcp）= tool_kind='FileUpload' 日志行（content 为
       六字段 JSON）经 classifySessionLog(toolKind) 优先映射 file 段（不再误产 tool_use 段，
       坏 JSON 回退不丢行）→ FileMessageCard（图片 isImageMime 缩略图/通用图标卡+downloadFile）；
       run 详情产出文件区=changes/detail/run-file-artifacts.tsx（listAgentFileArtifacts
       GET /api/agent/file-artifacts?run_id=，useQueries 去重倒序；禁用 /api/file/list——
       其非 admin 把 owner_id 当 workspace id 会 404，D-010@v1）
```

## 注意事项
- AppShell / TopBar / antd-providers 是全局组件，改动影响所有 dashboard 页面；菜单条目缺失是 menu-permissions 数据问题，app-shell 只管图标映射。
- interactive-session-panel 与 sessions 页共享 TurnTimeline / SessionInputBar / 事件处理语义：日志处理已收敛到 session-log-assembler 单一装配器（2026-08-19-session-stream-ux），改会话流逻辑只改装配器一处；但改 TurnTimeline 渲染仍需两处回归（/runtimes 弹窗零回归是 sessions-portal 的硬约束）。
- session-log-assembler 是纯函数模块（零 React 依赖），分类函数（classifySessionLog 等）实现已迁入其中，session-log-sanitize.ts 保留 re-export 垫片——新代码 import 分类一律从 assembler 取。
- ui/ 基础件遵循 shadcn 约定（CLI 添加为主，不手改生成物）；业务组件一律 "use client"。
- agent-log 归一化（去重 TOOL_USE / 合并 TOOL_RESULT / 识别 thinking）是纯函数，与渲染器分离便于单测；stdout [TOOL_USE]/[TOOL_RESULT] 文本事件也走同一解析。
- remote-folder-picker 是远程目录选择唯一入口（替代旧 browseFolder 系统弹窗——Web 用户看不到 daemon 宿主机原生弹窗）。
- 样式遵循 FRONTEND_PAGE_STYLE.md：按钮 antd 化、Badge→Tag、Drawer→Modal 等规范已在 ppm 系落地，新组件照此。
- 组件自治取数，但跨页/跨组件共享状态一律走 frontend_stores 或 react-query，不引入组件级全局变量。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->

## 变更索引

- ql-20260824-004-9783 | /sessions 用户消息气泡上方空行修复：page 模式占位轮 displayPrompt 无附件时拼出前导换行（61a1b709 引入），改走 joinAttachmentMarkers（runtime-session-helpers，parse 逆操作、语义对齐 backend inject 落库）；dialog 模式 submitFollowup 不受影响
- 2026-08-19-sessions-workspace-selector | 新建会话工作区选择器：workspace-session-picker 组件 + new-session-form 接入（工作区→绑定机器联动、提交体 workspace_id）
- ql-20260819-001-b742 | 会话列表和面板头部增加工作区信息显示（session-list-panel chips + session header badge）
- 2026-08-19-session-stream-ux | 会话流结构化重构：共享装配器 session-log-assembler（分段/归属嵌套/override 撤回收敛两处副本）+ turn-segment-views 段渲染族 + turn-status-bar 轮级状态条 + subagent-catalog 子代理目录 + TurnTimeline v2 段模型渲染（FR-01..06）
