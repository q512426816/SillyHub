---
schema_version: 1
doc_type: module-card
module_id: frontend_components
author: qinyi
created_at: 2026-08-18 01:45:00
updated_at: 2026-09-02 12:00:00
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
  - `session-usage-bar.tsx` — 会话用量条（2026-08-29-session-usage-stats；ql-20260830-013-14b3 小型化）：摘要行五指标+缓存命中率为图标化小号形态（lucide 图标 + 11px 值，指标名收敛为 antd Tooltip 悬浮提示（触发元素 aria-label，ql-20260830-014-74f5）；命中率 cache_read÷(cache_read+input)，分母 0「—」）+按模型折叠明细（ChevronDown 图标按钮 aria-label 保语义）；自取数（useEffect+refreshSignal prop，零 react-query 对齐 dialog 渲染约束），session-panel page（头部下方）/dialog（输入框上方）双模式挂载，轮次终态递增信号重取
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
- 群聊（group-chat/，2026-09-01-session-group-chat）：
  - `group-chat-panel.tsx` — 群聊主视图：平铺消息流按 log timestamp 全局排序
    （实时与回放顺序一致，**不消费单聊 run 分组 turn 模型**——多成员交错回复时 run
    锚分组会把迟到回复吸回触发组）；用户/agent 气泡按 sender_member_name 与投影行
    metadata.member_* 还原身份（落库时刻快照，改名不回填）；复用 session-log-assembler
    分类原语 + turn-timeline 渲染单元；SSE 消费含 typing 分支与刷新回放。
    自动滚底五要素（02df074e4 + ql-20260903-002 修正）：onScroll 距底 <80px ref /
    仅贴底跟随 / **自己**（isSelf）刚发送强制回底——群时间线所有成员发言都是
    kind:"user"，不过滤 isSelf 时他人发言会把上滚读历史的视口拽底；首帧回底
    同时播种 own-send 基线（回放里已有的自己消息不算「刚发送」）/ 选中文字不滚底；
    群 P3 体验/性能 quick（ql-20260903-010）：GroupTimelineRow memo 化（props 全稳定——
    entry 不可变归并引用、空 replying 模块常量、onPin/onQuote useCallback，流式期间
    仅变化行重渲染）；回放分页（初始 limit 200 取代全量拉回，顶部「加载更早消息」
    before 游标向上翻页、归并同 applyGroupTimelineEvent、scrollTop 增量保持视口）；
    回到底部悬浮按钮（离开底部出现，离开期间新消息计「N 条新消息」，回底清零）
  - `create-group-wizard.tsx` — 建群向导三步：群名→邀请用户→配置 agent 成员
    （六要素表单可添加多个，不内置角色模板）
  - `member-panel.tsx` — 成员面板：用户成员 presence 绿点/移除；agent 成员六要素
    展示+热切换弹窗（引擎/模型/方案下轮生效；机器/工作区切换提示记忆重置）+重置记忆
  - sessions portal 群聊分区（数据统一走 GET /api/daemon/group-chats 按成员过滤；
    群视图>真会话>预会话优先级；建群与 agent_sessions 变更信号 invalidate
    ["groupChats"]）；session-mention-popover 判别联合加 `{kind:'member'}`
    （群成员+@全体，既有六 kind 零改动）
- 变更域（changes/）：
  - `detail/` 子目录 — 变更详情展示组件族（文档矩阵 / Gate 面板 / 会话区等）
  - `detail/change-usage-card` — 变更/快速修复执行用量卡（2026-08-30-change-center-usage-stats）：useQuery 自取数（queryKey=域+组件+kind+workspaceId+refKey，对齐 change-sessions-card 先例无轮询），按 kind 分派 getChangeUsage/getQuicklogUsage；四态（loading 骨架/error「暂无用量数据」/无执行引导/正常）；摘要行十项（开始/结束/耗时/进行中 chip=started 有值 finished 缺/轮次/四维 token/请求次数/命中率=cache_read÷(cache_read+input) 分母 0→「—」）+ 分模型折叠明细（「未记录」兜底桶灰阶恒末位）+ kind 分叉口径注脚；token/时长格式化与命中率口径锚定 session-usage-bar 惯例
  - `change-session-section` / `change-step-badge` — 变更会话区与阶段徽标
  - `quicklog-drawer` / `quicklog-table` — quicklog 条目查看；两者均含「执行」列/用量卡消费（drawer 底 sessions 卡旁挂 change-usage-card kind=quicklog；table 加「执行」紧凑两行列——耗时+进行中标记/N 万 tok·N 次[·N 轮]/悬浮起止/usage null→「—」，2026-08-30-change-center-usage-stats）；变更中心列表页 columns 同款「执行」列（UsageExecCell，page.tsx 模块级）
- 工作区域：
  - 入口件：`workspace-card` / `workspace-scan-dialog` / `workspace-switcher` / `workspace-tabs`
    （workspace-card 带类型徽标、workspace-scan-dialog 带类型必选下拉+描述
    textarea，均消费 lib/workspace-types，2026-08-18-workspace-role-type）
  - git-log/（工作区 Git 日志视图，2026-08-25-workspace-git-log）：`commit-graph`（SVG 泳道渲染 + lanePalette 三主题色板）/ `commit-list`（react-virtual 虚拟滚动行）/ `commit-detail-drawer`（提交详情 + diff 按需展开）/ `file-tree`（变更文件按 `/` 聚合目录树、目录节点 +x/-y）/ `git-status-bar`（共享 Git 状态条 full/compact 双形态：git-log 页完整态 + sessions 门户紧凑态 Tooltip 展开；自治取数 useGitLogStatus，状态色经 statusBarPalette → 组件级 `--sb-*` 变量注入零硬编码 hex；五边界形态——fetch 降级黄条/无 upstream/detached HEAD/空仓库/no_git 返 null，2026-08-26-workspace-git-status）；workspace-tabs TABS 追加「Git 日志」项（纯三字段）
  - 绑定与成员：`workspace-binding-dialog` / `workspace-binding-guard` / `workspace-member-row` / `workspace-member-add-dialog`
  - 配置与路径：`workspace-config-card` / `workspace-path-picker` / `workspace-path-fields` / `workspace-daemon-switcher`（两步切换：点选非当前 daemon 先进路径确认态——WorkspacePathPicker 绑定新 daemon 预填旧 root_path 可改可浏览，确认才一并提交 daemon_id+root_path，不再沿用旧路径，ql-20260828-010-ca22）/ `workspace-access-guide` / `workspace-session-section`
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
- 移动端（mobile/）：`mobile-app-shell` / `mobile-top-bar` / `mobile-tab-bar`（底部导航）、`mobile-card-list`（卡片列表替代表格）、`mobile-filter-drawer` / `mobile-detail-sheet` / `milestone-sheet`（筛选/详情抽屉）、`mobile-batch-bar` / `mobile-action-menu` / `mobile-export-button`（批量/操作/导出）。ql-20260827-012：外壳容器改 `fixed inset-0 + overflow-hidden`（body 锁死不可滚，内容区自管滚动）；`mobile-top-bar` 加 actions 动作槽，外壳默认注入桌面同款 `ThemeToggle`（移动端主题切换入口，useThemeStore persist 同源）。
- 基础件（ui/，shadcn 模式）：button / input / badge / card / dialog / dropdown-menu / avatar / empty-state / json-editor / markdown-text / status-badge / confirm-captcha。
- 其余独立件：
  - 审批与权限：`permission-approval-card`
  - 文件中心：`file-upload` / `file-viewer` / `file-image`
  - 统一文件预览（2026-08-25-session-attachment-preview）：`files/` 目录——`file-preview-modal`（antd Modal 壳：标题栏元信息+下载+关闭、loading/error 重试态，body 按注册表分发）+ `preview-registry`（matchRenderer：blob.type > meta.mime > 扩展名 → RendererKey；ql-20260826-013 起 xls/xlsx 不再映射在线渲染，直接 fallback 下载引导）+ `use-object-url`（blob 拉取/竞态防护/卸载自动 revoke）+ `previewers/` 渲染器（image=antd Image、pdf=pdf.js 画布逐页渲染 ql-20260827-001——iframe+原生查看器不可依赖，>50 页截断提示、含全屏 fill 态、mcp. worker 静态资源 public/pdf.worker.min.mjs、docx=docx-preview 动态 import+异常降级、markdown=必经 MarkdownText 防 XSS、fallback=下载引导；xlsx 渲染器保留但 registry 不再路由）。office 前置尝试层 + OnlyofficePreviewer（api.js 动态加载/替换式挂载/60s 兜底降级）随 OnlyOffice 退役处于休眠态（office-config 503 → 自动走本地链，代码保留）。三入口：`daemon/attachment-chips`（chips 全部可点击弹预览）、`daemon/file-message-card`（通用卡片主体可点击，下载 stopPropagation，图片形态不动）、`file-viewer`（非图片项加预览入口）
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
- AppShell / TopBar / antd-providers 是全局组件，改动影响所有页面；菜单条目缺失是 menu-permissions 数据问题，app-shell 只管图标映射。
- interactive-session-panel 与 sessions 页共享 TurnTimeline / SessionInputBar / 事件处理语义：日志处理已收敛到 session-log-assembler 单一装配器（2026-08-19-session-stream-ux），改会话流逻辑只改装配器一处；但改 TurnTimeline 渲染仍需两处回归（/runtimes 弹窗零回归是 sessions-portal 的硬约束）。
- session-log-assembler 是纯函数模块（零 React 依赖），分类函数（classifySessionLog 等）实现已迁入其中，session-log-sanitize.ts 保留 re-export 垫片——新代码 import 分类一律从 assembler 取。
- partial/complete 双向收编（quick-9f86d2c3，2026-08-27，会话 e87622aa 直播重复段+光标常闪）：正向=dropPrefixPartialReply（完整行吸收尾部 partial 前缀段）；反向=bucketCoveredByFullText（迟到 partial 是在场完整行前缀 → 跳过落段）；两向吸收/override 撤回都封存 segmentId（SUPERSEDED_SEG_IDS 内部 Set 随 turn 链流转），同 segmentId 后续重放窗口一律免疫；面板 onLog（dialog 与进度两路径）对终态轮的迟到 log 补跑 finishTurn（非当前活跃 run 才跑——healToRunning 自愈场景流式光标照常）。根因：partial 行 Redis 发布丢失 → turn_completed 后轮后对账重放到终态轮，原装配器无反序收编且 finishTurn 已跑过永不再清。
- 乱序胶水段治愈（quick-0e56260f，2026-08-27，会话 0ef651b6）：直播窗口 Redis 发布**部分**丢失 → 前端按到达序拼出非前缀「胶水段」（内容交错挪位），双向前缀收编全部失效；backend 在完整行落库点合成 override 令箭（daemon 信号生产失效的替代，见 daemon.md run_sync 条），前端既有 override 撤回按段 id **任意位置**移除胶水段（不依赖前缀）+ 封存。logsToSegments 的 override 去重键含 segmentId（`override:<segId>`）——同轮多枚标记（每条完整行一枚）各自生效，刷新路径 raced partial 也撤干净。
- ui/ 基础件遵循 shadcn 约定（CLI 添加为主，不手改生成物）；业务组件一律 "use client"。
- agent-log 归一化（去重 TOOL_USE / 合并 TOOL_RESULT / 识别 thinking）是纯函数，与渲染器分离便于单测；stdout [TOOL_USE]/[TOOL_RESULT] 文本事件也走同一解析。
- remote-folder-picker 是远程目录选择唯一入口（替代旧 browseFolder 系统弹窗——Web 用户看不到 daemon 宿主机原生弹窗）。
- 样式遵循 FRONTEND_PAGE_STYLE.md：按钮 antd 化、Badge→Tag、Drawer→Modal 等规范已在 ppm 系落地，新组件照此。
- 组件自治取数，但跨页/跨组件共享状态一律走 frontend_stores 或 react-query，不引入组件级全局变量。

## 人工备注

<!-- MANUAL_NOTES_START -->
- ql-20260901-002：/team 指令消息显示原始输入——session-panel 发送链路（page 预会话首句 / page 会话内 / dialog 三处 handleSend）不再剥离 "/team" 前缀，发原文使消息气泡与历史回放（user_input 日志）显示 "/team 目标"（对齐 /sillyspec:quick 等技能指令显示形态）；agent 不接收字面前缀，剥离收口到后端派发层（daemon session service `_strip_team_command_prefix`）。裸 /team（无目标文本）守卫保留在前端发送处不发送；拦截弹层（无活跃 mission）语义零改动。
- ql-20260831-004：失败轮错误卡原因透出——session-panel 三处失败轮构造（SSE 终态回补 displayTurns、两条 turn_completed 拉取路径）由「error_detail 为空即『运行失败（无详情）』」升级为逐级兜底：error_detail（模型层 ModelError）→ buildSystemFailureItem（normalize 新增；消费 run.failure_summary（后端映射 output_redacted）+ error_code 中文映射，SESSION_LIMIT_REACHED 撞闸原文识别成可操作提示「结束旧会话/等 30 分钟」）。SessionRunRead（lib/daemon.ts + api-types）同步加 failure_summary。注意：仅 failed 轮消费该字段——成功轮 output_redacted 是 agent 输出摘要。
<!-- MANUAL_NOTES_END -->

## 变更索引

- ql-20260903-001-4d6e | 视口补拉时序修复（ql-010 部署后实测未解决）：初始/翻页触发原 setTimeout(0) 早于 React DOM 提交与布局——scrollHeight=0 被守卫拦下且无重试，补拉链断在首跳（偶发成功属时序竞争）；scheduleAutoFill 双 rAF 等提交+布局，布局不可读继续 rAF 重试至多 10 帧（~160ms）后放弃，两处触发统一走调度；新增布局延迟就绪用例（前 2 读 0 后可读）
- ql-20260902-016-3a75 | variant 回归锚补同步（CI 修复）：ql-009 给会话主体加 display:contents 挂载点（触顶自动加载滚动监听）后 session-panel-variant.test.tsx 锚未跟着走——desktop 断 scroll.parentElement=panel、mobile 断外包层=scroll 父级，CI 连挂 4 次；锚更新为「挂载点布局透明（className=contents）+ 挂载点直挂面板根（desktop）/ 挂载点父级=mobile 横向外包层（min-h-0 flex-1 + 表格横滚锁类仍全在，CSS 后代选择器穿透 contents 照常生效）」
- ql-20260902-010-f493 | 触顶自动加载补口（视口补拉链）：初始 100 条日志装配的对话可能不足一屏——容器无滚动条 scroll 事件永不触发成死路；maybeAutoFill 在「容器有布局高度且 scrollHeight ≤ clientHeight 且有更早」时自动续拉一页（初始满页后 + 每次翻页满页后 setTimeout 复查 DOM 提交后状态），撑出滚动条即停走正常触顶；连拉上限 10 防极端空渲染批量请求，换会话重置；jsdom 无布局（scrollHeight=0）不触发保既有用例零影响
- ql-20260902-009-0d92 | 「加载更早消息」交互升级触顶自动加载：捕获阶段监听 TurnTimeline 滚动容器（scrollTop ≤ 48px 触发，shadow-session-viewer 同款模式）；同步 ref 锁防高频双拉；prepend 滚动锚按 scrollHeight 增量补回视口（正在读的内容不被顶走）；加载中顶部行内提示（session-load-earlier-hint）；到头（不满页）后触顶自挡零请求；稳定 callback ref 驱动主体挂载时重挂监听（骨架早退渲染先于主体，sessionId 单维依赖挂不上）
- ql-20260902-008-3723 | 分身会话查看器「加载更早消息」点击无反应修复：handleLoadEarlier 的 run 级去重把与当前窗口同 run 的更早日志整 turn 丢弃——团队分身会话整段执行是单个长 run（跨游标恒同 run）＝100% 丢弃；改伪 runId 变体（`#e`+游标短码防多次翻页 key 撞）插入该 turn 之前，realRunId 保持原值（SSE 增量/孤儿 run 补建匹配零影响），before 游标保证内容不重叠
- ql-20260831-016-6eb5 | confirm 图标槽结构修正（ql-015 迭代）：antd v6 confirm icon 槽对裸 lucide svg 的尺寸/间距样式不命中（实测压成 12x20 且与标题零间距）——封 confirmIcon(Icon, cls) helper 外包固定尺寸 span（h-6 w-6=24px shrink-0 防 flex 压缩 + mr-3=12px 间距），6 处 confirm 换用，实测 24x24 + 12px 间距
- ql-20260831-015-c6fe | 确认弹窗图标功能语义化 + 「全部状态」含已归档（后端 archived 三态）：6 个 Modal.confirm 传 lucide 语义图标（删除=Trash2 destructive 红 / 归档=Archive / 取消归档=ArchiveRestore brand-600，h-5 w-5 适配 antd 32px icon 槽不变形）；后端 list_agent_sessions 与 facade archived: bool|None=False 三态、router Query(default=None)（HTTP 不传=全部含已归档），移动端默认视图与 use-daemon-machines 会话计数显式 archived=false 保持原语义；openapi+api-types 同步再生成。**quick 2026-09-01 风险审查修**：桌面树原「不传参即全部」改为非归档视图（默认+全部状态+各状态筛选）一律显式 archived=false——否则归档会话混入默认列表与状态筛选（与 ql-013 弹窗文案「归档后将从默认列表隐藏」矛盾、挤占 limit=500 取数名额），归档行只进「已归档会话」视图
- ql-20260831-014-c6fe | 会话列表 6 个确认弹窗去渐变色块图标（antd v6 confirm icon 槽压成 16x32 瘦条变形），对齐仓库主流 confirm 风格；ql-015 迭代为功能语义图标
- ql-20260831-013-9043 | 会话归档 UX 重做（session-list-panel + sessions-portal + floating-session-host）：行级归档/取消归档按钮按 archived_at 二选一（原两按钮无条件齐显、点错侧后端幂等静默）；已归档行加「已归档」徽标（含归档时间 title）+ 整行 opacity-60 降调（hover 恢复）；归档视图顶部上下文横幅（数量 + 恢复指引）；归档/取消归档/批量操作加 useNotify toast——回调契约改返回失败个数（Promise.allSettled 口径，两个调用方同步），allSettled 不再吞失败
- ql-20260831-012-5f60 | 输入胶囊 ＋ 功能按钮放大显形（session-input-bar）：antd text Button 的 h-10 w-10 被 .ant-btn height:32 钳成 40x32 椭圆、透明无边框不显眼 → 改原生 button（同菜单项模式）真实 40x40 圆形 + border/bg-card 可点击外形，hover/展开态 brand 语义色（双主题换肤）；发送按钮同根因 h-9 w-9 → !h-9 !w-9（!important 压 antd，惯例见 message-queue-bar）恢复 36x36 正圆
- ql-20260829-006 | MachineCard 机器头新增「删除」按钮（仅离线可点，危险红字）+ runtimes 页 handleDeleteMachine（modal.confirm 二次确认 → deleteDaemonMachine → machines cache 就地移除 + 本机会话过滤 + 悬浮锁清理）；lib/daemon.ts 增 deleteDaemonMachine
- ql-20260828-010-ca22 | 切换守护进程两步确认：workspace-daemon-switcher 点选非当前 daemon 后先进路径确认态（WorkspacePathPicker 绑定新 daemon、预填旧 root_path 可改可浏览），确认才一并提交 daemon_id+root_path——本地路径机器相关，跨机切换不再沿用旧路径
- ql-20260827-005-a660 | /sessions 整页滚动条修复：sessions-portal 门户容器 calc(100vh-56px) 与 TopBar h-16(64px) 不符溢出 8px，对齐 calc(100vh-64px)（explorer/page.tsx 同款惯例）
- quick-9f86d2c3 | 直播重复段+光标常闪（会话 e87622aa）：终态轮迟到 partial 反向收编 + segId 封存 + 面板终态轮 finishTurn 兜底（详见注意事项「partial/complete 双向收编」条）
- ql-20260824-004-9783 | /sessions 用户消息气泡上方空行修复：page 模式占位轮 displayPrompt 无附件时拼出前导换行（61a1b709 引入），改走 joinAttachmentMarkers（runtime-session-helpers，parse 逆操作、语义对齐 backend inject 落库）；dialog 模式 submitFollowup 不受影响
- 2026-08-19-sessions-workspace-selector | 新建会话工作区选择器：workspace-session-picker 组件 + new-session-form 接入（工作区→绑定机器联动、提交体 workspace_id）
- ql-20260819-001-b742 | 会话列表和面板头部增加工作区信息显示（session-list-panel chips + session header badge）
- 2026-08-19-session-stream-ux | 会话流结构化重构：共享装配器 session-log-assembler（分段/归属嵌套/override 撤回收敛两处副本）+ turn-segment-views 段渲染族 + turn-status-bar 轮级状态条 + subagent-catalog 子代理目录 + TurnTimeline v2 段模型渲染（FR-01..06）
