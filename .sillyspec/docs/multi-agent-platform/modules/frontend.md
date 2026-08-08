---
schema_version: 1
doc_type: module-card
module_id: frontend
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:16:42
---
# frontend

## 定位

multi-agent-platform 的 Web 控制台，用户操作平台的唯一图形入口。基于 Next.js 14 App Router + React 18 + TypeScript 构建，向用户呈现工作区、运行时会话、SillySpec 变更中心、PPM 项目管理、Agent 运行面板、权限审批、健康状态等功能。运行时依赖 backend 的 `/api` 接口；daemon 相关交互经 frontend 的 `/api/daemon*` route handler 与后端/守护进程协调。

技术栈：Next.js 14.2、React 18、TypeScript、Tailwind CSS 3.4、Ant Design 6 + @ant-design/icons、Radix UI、TanStack React Query（数据层）、Zustand（状态）、Zod（校验）、ECharts（图表）、@xyflow/react（流程图）、Vitest（单测）、Playwright/Puppeteer（E2E）、pnpm。

## 契约摘要

对外契约是浏览器渲染的页面与少量 BFF route：

- **页面路由**（App Router）：根 `page.tsx`；`(auth)/login` 登录；`(dashboard)/` 下含 workspaces、runtimes、settings、admin、ppm、**agent-profiles** 等区域，各自带 `layout.tsx`。
- **AgentProfile 前端**（2026-08-04-agent-profile-ui-redesign）：`(dashboard)/agent-profiles` 全局卡片墙页（独立一级菜单，跨工作区聚合视图）+ ws 内页 `workspaces/[id]/agent-profiles`（复用卡片墙 + workspace 预筛）；组件 `components/agent-profile/`（agent-profile-card 角色卡 / card-grid 卡片墙 / preview 人设预览）+ 重做 `agent-profile-form`（900px 双栏左填右实时预览 + 工作区上下文选择器）+ `agent-profile-select`（选档下拉 antd Select）。
- **BFF route handlers**：`src/app/api/` 下 daemon、daemon-chat、workspaces，承接需要服务端代理的 daemon 通信与 SSE/WS 转发。
- **后端依赖**：所有领域数据来自 backend `/api/*`；daemon 实时会话走 WebSocket/SSE。**模型错误可见性**：run failed 时 `listSessionRuns`（`lib/daemon.ts`）取 `GET /api/daemon/sessions/{id}/runs` 的 error_detail，normalize（`agent-log/normalize.ts`）生成 error 类日志项，`RunErrorItem` 渲染原因/hint/actions（重发/切换供应商/详情）；agent 页（agent-run-panel）与 runtime 聊天窗（interactive-session-panel）两面接通。
- **构建产物**：`next build` 产出独立 Node 服务，Docker 中以独立容器运行，端口对 backend 反代或直连。

## 关键逻辑

- **目录组织**：`src/app`（路由）、`src/components`（40+ 业务组件，含 daemon/、agent-log/、layout/、charts/、permissions/、ui/ 子树及大量 ppm-/workspace-/admin- 前缀组件）、`src/lib`（工具/API 封装）、`src/stores`（Zustand）、`src/styles`、`src/test`。
- **核心组件**：app-shell（外壳布局）、top-bar、workspace-tabs、mission-console（任务控制台）、agent-run-panel、agent-log-viewer、runtime-session-dialog、permission-approval-dialog、ask-user-dialog-card、health-card、server-status-card、sillyspec-step-progress、**run-error-item**（模型调用失败结构化展示：type→图标/颜色/文案/hint/actions）。
- **数据层**：React Query 管理服务端状态，Zustand 管 UI/会话状态；daemon 聊天与权限流为长连接交互。
- **脚本**：dev/build/start/lint/typecheck/test，CI 跑 lint+typecheck+test+build 全链路。

## 注意事项

- UI 文案与文档尽量用中文（项目硬性规则），仅专业术语保留英文。
- frontend 容器 healthcheck 曾因 busybox wget 走 Docker 注入代理误报 unhealthy，属探针问题非服务故障；当前 Dockerfile 用 node20 内置 fetch 零依赖探测。
- 改 daemon 交互类组件（runtime-session-dialog 等）要同步看 backend daemon 模块与 sillyhub-daemon protocol 的契约一致性。
- **daemon-client changes 入口（2026-06-26-daemon-client-spec-sync-fix）**：daemon-client workspace 新建 change 调 `POST /api/workspaces/{id}/changes/proxy-create`（带 `runtime_id=workspace.daemon_runtime_id`），由 backend 经 `daemon_change_writes` lease-polling 让 daemon 代写文件；daemon 离线时按钮禁用 + tooltip 引导，端点返 `DAEMON_CLIENT_NO_SESSION`(400)。区别于 server-local/repo-native 走原 `changes/create`。

## 人工备注
<!-- MANUAL_NOTES_START -->

## 变更索引
- ql-20260624-003-a7f1 | 优化 /runtimes 会话弹窗布局样式：扩大 RuntimeSessionDialog 工作区，改造会话列表为左侧栏，统一交互式会话与历史回看面板高度和输入栏间距。
- ql-20260624-004-c8a2 | 优化 /settings/api-keys 页面和 API Key 创建弹窗：统一页面容器、标题区、卡片、状态和空态样式，补充统计概览与表格密度整理。
- ql-20260625-003-4d7a | 优化 Agent/会话运行日志展示：默认突出用户消息、Agent 回复和思考缩略，补充 token/cache 用量、额外日志类型开关，以及会话实时/历史消息技术日志折叠。
- ql-20260626-001-4a8e | 修复 agent 日志展示：thinking 多行渲染对齐 normalize（mergedThinkingContent!=null 即走折叠，修多行思考裸露成 INFO）+ 顶部「对话/全部」单选 tab 默认隐藏工具调用（真正落地 ql-003 丢失的对话视图诉求）+ 放宽 content 截断。改 agent-log-viewer.tsx（isThinking 判定 + viewMode/defaultViewMode + isConversationLog 过滤）。
- 2026-06-26-daemon-client-spec-sync-fix | daemon-client changes proxy-create 入口（带 runtime_id）+ daemon 离线禁用引导（FR-08/09）。
- ql-20260702-002-4ee9 | agent 控制台 pending run 可见性修复：pending 并入活跃面板（排队中琥珀徽标+角标），原 runningRuns/completedRuns 两派生流都过滤 pending 但"总运行"=runs.length 计入致数字与列表不一致。

- ql-20260709-001-7e3a | BashToolPreview 加 100000 字符展示兜底（displayResult 截断+标注，标题行数与正文同源，复制按钮保留完整原文，防超大命令输出 OOM；后端/daemon 已截断的双保险）。改 tool-renderers.tsx。

- ql-20260709-002-1b8c | Write content 预览 5千→5万 + Agent prompt 预览 3千→2万（tool-renderers.tsx），A 类日志截断放宽。

- ql-20260709-003-a2f5 | normalize.ts [SYSTEM:thinking_tokens] 行默认 hidden + 不打断 thinking 合并（修 thinking 被 token 估算行穿插切成碎片；推翻 D-002@v2 折叠显示决策）。

- ql-20260709-004-f0a1 | 变更详情页「变更文件」区增强：① html/.htm 文件渲染预览（iframe srcDoc + sandbox=allow-scripts allow-popups，不设 allow-same-origin 隔离唯一源，安全）；② 内容区交互反转——默认预览、点「编辑」才进文本编辑（.md→Markdown / .html→iframe / 纯文本→只读源码，统一默认预览）；模式切换保留未保存改动。改 change-file-tree.tsx（抽 FilePreview + mode 状态）。

- 2026-07-25-daemon-borrow-for-business | 借用 daemon 前端：lender 工作空间设置「共享我的 daemon」开关（shared-daemon-toggle）+ owner 成员/设置页管理共享列表/撤销/授 business_member 角色（shared-daemon-manager + workspace-member-row 加业务成员选项）+ 业务人员触发 agent 无感借用（agent/page 门禁放宽 canBorrowSharedDaemon）+ 方案查看（borrowed-solution-files/-panel + workspaces/[id]/files/page + lib/file/api listFiles + lib/workspace-binding canBorrow/共享端点封装）。

- ql-20260726-004-e9db | 业务人员工作空间入口门禁放宽（agent 页 task-13 已放宽，入口门禁漏补）：列表页 workspaces/page + 顶栏 switcher + 移动端 m/workspaces + 详情 guard 的未绑定分支加 canBorrowSharedDaemon 判定——business_member（无自有 daemon + daemon:borrow 权限）未绑定时直接进入（靠借用），不弹/不渲染 daemon 绑定 Dialog/表单。switcher 测试补 mock 导出 + beforeEach 重置默认 false + 加 business_member 放行用例。

- 2026-07-26-ungate-workspace-entry | 工作区入口门禁后移（daemon 要求下沉到操作点）：列表 workspaces/page + 顶栏 switcher + 移动端 m/workspaces + 详情 guard 四入口移除未绑定→拦分支，always 导航/切换/提示电脑端；guard unbound→return null（降级为已绑定编辑入口）；新建 DaemonRequiredNotice 组件（feature/workspaceId/canBorrow/onConfigured，复用 WorkspaceAccessGuide，内联非阻断）+ runtime/scan-docs 无 binding 主区渲染空态；components 页 daemon 无关不接入（数据走 getWorkspaceComponents backend API）；概览复用既有 WorkspaceConfigCard 为可选配置入口。纯前端零回归，无后端/schema/API 变更。

- ql-20260728-002-21aa | 登录爆破防护前端（配合后端 423 need_captcha）：登录失败达阈值 → 弹 `SliderCaptcha` 拖拉滑块（指针事件支持鼠标+触控，凹槽垂直固定 CSS `calc(50%-22px)` 对齐后端 `_SLIDER_Y=53`），拖对取 captcha_token 后自动带 token 重试登录。新建 `components/ui/slider-captcha.tsx`；改 `app/(auth)/login/page.tsx`（needCaptcha/captchaToken 状态 + doLogin 拆分 + handleVerified 自动重试）+ `lib/auth.ts`（login 加 `captcha_token` 形参 + fetchSliderCaptcha/verifySliderCaptcha，类型暂手写待 `pnpm gen:types`）。

- ql-20260728-003 | 滑块下线换「我不是机器人」点按 + 登录页 UI 现代化 + 修 token 闭包 bug：删 `slider-captcha.tsx`，新建 `components/ui/confirm-captcha.tsx`（点按一次性 captcha_id→token，lucide Shield/ShieldCheck/Loader2 四态）；`lib/auth.ts` 改 `fetchConfirmCaptcha`/`verifyConfirmCaptcha`（去 x）。**关键 bug 修复**：`handleVerified` 原 `setCaptchaToken(token)` 后立即 `doLogin`，闭包读到 setState 前的旧 `captchaToken` → login 漏带 token 仍 423（"验证过了登不进"根因）；改为 `doLogin(values, token)` 直传。`(auth)/login/page.tsx` UI 重写为现代深色品牌风（左侧深蓝渐变+网格+光斑+lucide 特性条，右侧亮色玻璃拟态卡，token primary #2563EB，无新依赖）；`m/login/page.tsx` 补齐原本缺失的整套 423/验证码链路并接入 ConfirmCaptcha。

- 2026-07-28-llm-provider-presets-and-usage | LLM 供应商预设模板 + 用量/余额查询前端：新增 `config/llmProviderPresets.ts`（10 家 claude 风格预设常量，6 家标 `usage:{type:balance|token_plan}`，settings_config env 块抄 cc-switch）+ form 顶部预设选择器（网格按钮、分类排序 官方/国内官方/聚合站、💰可查用量标记、＋自定义重置，点预设 setState 填 name/base_url/auth_field/model/website_url，api_key 留空）；`lib/api/llm-providers.ts` 加 `queryUsage(id)` + `detectUsageProvider` + UsageResult/UsageData 类型；新增 `usage-footer.tsx`（多 tier 余额条逐 UsageData 渲染 + 翻红 + keep-last-good 保留上次成功值 10 分钟，移植 cc-switch `resolveDisplayUsage` + 不支持文案）；list 每行挂 UsageFooter + 💰 徽标 + 进页面自动查 + 手动单家刷新。3 件 `__tests__/*.test.tsx`。
- ql-20260729-004-5845 | 补 model-error-visibility 测试债：normalize.test.ts 追加 task-08「模型错误可见性」describe 块——buildErrorLogItem 8 类 type 参数化映射 + type 非法→unknown + message 缺失→「运行失败」 + retryable 严格===true + code/hint/raw 缺失/非字符串→null + null/非对象→null；isAssistantApiErrorText 识别 API Error/Request rejected 且不误判普通回复；classifyLog [ASSISTANT]+API Error→error（修正原 :352 全归 assistant 缺陷）；normalizeLogs errorDetail 追加结构化 error 项（hidden=false, R-02 不进 NOISE）+ 有结构化错误时 [ASSISTANT] API Error 行 hidden；brownfield runStatus=failed 无 errorDetail→兜底「运行失败（无详情）」；成功路径不追加 error 项零回归。normalize.test.ts 60 tests 全过。

- ql-20260729-005-6122 | /runtimes 会话弹窗对话/过程分流 + 气泡视觉升级：session-log-sanitize 新增 classifySessionLog（reply/thinking/tool/stderr 分类，丢弃规则与原函数一致）；SessionTurnView 加 details 过程项，实时 SSE onLog 与历史 logsToTurns 两链路分流，output 只装答复正文；面板头部加「对话/全部」二态切换（参考 agent-log-viewer 无二级筛选），全部视图过程项=思考折叠块（复用 CollapsibleSection）+工具行+stderr 行；气泡大圆角+助手 Bot 图标+text-sm leading-6+运行中「正在思考…」三点动效占位。改 interactive-session-panel.tsx/session-log-sanitize.ts/runtime-session-helpers.tsx + 新增 runtime-session-helpers.test.tsx，受影响 6 文件 83 测试全绿。【补漏】实测对话仍显示 tool——daemon task-runner 工具调用双发（channel=stdout 的 [TOOL_USE] 文本行 + channel=tool_call 的 JSON），原分类只拦 JSON，[TOOL_USE]/[TOOL_RESULT] 文本行漏判成 reply；classifySessionLog 补按内容前缀识别 [TOOL_USE]/[TOOL_RESULT]（含 channel=null）归 tool 剥前缀，实时+历史两链路同源，补 3 测试后 78 全绿。

- 2026-07-29-sidebar-menu-restructure | 侧边栏菜单信息架构重组：`menu-permissions.ts` MenuSection 改 6 值（workspace/agent/config/governance/system/ppm）+ 菜单按功能域重组 5 组（工作区 8 / 智能体 4 / 配置中心 4 / 协作治理 3 / 系统管理 4，ppm 14 项隔离不变），新增 3 独立菜单技能管理 + MCP 管理（智能体组，平台级 /settings/skills、/settings/mcp，复用 settings:admin）、我的供应商（配置中心，独立页 /settings/providers 复用 LlmProviderSection，新增 llm_provider:read 显隐）；守护进程运行时归配置中心（D-006）。`app-shell.tsx` MENU_ICON_MAP 补 Puzzle/PlugZap/Cloud，emoji icon 字段确认无渲染消费者（侧边栏图标按 href 解析）。`settings/page.tsx` 瘦身移除 4 EntryCard 卡片入口 + providers Tab，仅留工作区信息/智能体配置/安全策略/集成 4 Tab 默认工作区信息。受影响测试 4 文件（menu-permissions 37 + permission + picker 40 + 新 providers 页 2）+ settings 相关全绿，前端全量 121 文件 1224 全绿 + typecheck exit 0。

- ql-20260730-003-f13c | /runtimes 会话弹窗工具 use/result 配对+状态徽章+思考按序合并+md 渲染：classifySessionLog 拆 tool→tool_use/tool_result + isToolResultDenied 纯函数（拒绝/denied/error/失败/fail 判 deny）；SessionTurnView 改 processItems 有序过程项（替代 toolEvents+details），onLog 与 logsToTurns 两链路按真实到达顺序构建——tool_use 推 running、tool_result 配对最近 running 设 ok/deny、孤儿降级 raw 空 tool 项兜底；TurnDetailsList 连续同类合并（连续 thinking 拼成一个卡片，被工具穿插则分段保持顺序，修「一股脑全合并丢顺序」）；ToolEventCard 工具结果默认折叠（太长）+ ✓/✗/⏳ 徽章；思考与工具结果均 MarkdownText 渲染（与对话气泡一致）。daemon 测试全绿 + tsc 0 错。

- ql-20260731-001-3abf | 平台技能清单显示每个技能描述：`lib/custom-skills.ts` 加 `PlatformSkillSummary` 类型（name/description/file_count）+ `PlatformSkillsManifest` 加可选 `skills` 字段（manifest 端点返回 dict[str,Any] 未进 OpenAPI 生成范围，继续手写对齐后端）；`settings/skills/page.tsx` 的 `deriveSkillGroups` 回退结构对齐（skill→name / fileCount→file_count），`platformGroups` 优先用 `manifest.skills`（兜底 deriveSkillGroups），表格「说明」列渲染 `g.description || 通用文案`（原所有技能写死同一句废话）；`page.test.tsx` 加 description 渲染测试（mock manifest 带 skills），7 passed + tsc 0 错。

- ql-20260803-003-cb34 | 添加工作区对话框对「复用已存在工作区」显式提示：`useNotify` 补 `warning` 键（antd message.warning）；`workspace-scan-dialog.tsx` 创建成功读 `ws.creation_notice` 非空即弹 warning（复用/激活/复活文案来自后端），否则 `success("工作区已创建")`，杜绝静默 201「创建成功却看不到/绑定没生效」困惑。

- ql-20260804-001-4a3e | borrow 前端清债（change 2026-07-25-daemon-borrow-for-business 收尾）：workspace-binding.ts 本地兜底类型 MemberBindingWithShared（intersection）与 SharedDaemonView（interface）切回 OpenAPI 生成类型——api-types.ts 已含 MemberBindingView.shared 与 SharedDaemonView，无需 gen:types，消费方 import 名不变零改动；borrowed-solution-files.tsx 删过时「后端无按 owner_type list 端点」注释（容器层 panel 已调 listFiles）；shared-daemon-manager.tsx:180 适配生成类型 optional（daemon_id ?? null 归一化匹配本地 shortId(string|null)）。tsc 0 错。

- ql-20260807-004-e5bf | opencode 供应商预设：初版建的 `config/opencodeProviderPresets.ts`（8 家 opencode agent 供应商数据）方向有误——cc-switch 调研确认 opencode 在 cc-switch 是 agent 模式（与 Claude Code 并列，写 ~/.config/opencode/）非供应商，平台当前也 claude-only。该数据模块及其测试已删除；改在 `config/llmProviderPresets.ts` 聚合站组加 **OpenCode Go** 预设（opencode.ai 官方 API，base_url https://opencode.ai/zen/go，模型 deepseek-v4-flash，照 cc-switch claudeProviderPresets 同名条目剔 affiliate，commit ea966414）。

<!-- MANUAL_NOTES_END -->
