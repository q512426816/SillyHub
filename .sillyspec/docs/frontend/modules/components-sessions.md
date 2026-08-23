---
schema_version: 1
doc_type: module-card
module_id: components-sessions
author: qinyi
created_at: 2026-08-18 01:45:00
updated_at: 2026-08-23 12:58:00
---

# 会话门户组件（components-sessions）

## 定位
会话门户（`/sessions`）的功能组件（`components/sessions/`），2026-08-14-sessions-portal 变更派生 + 切换静默化系列 quick 迭代（ql-20260817-010）+ 2026-08-23-sessions-workspace-hub 工作区中心化重构：
- `SessionsPortal`：共享门户组件——左列表 + 右**三分支**（真会话 / 预会话 / 空门户态）+ SessionPanel page 模式 + 页级数据，可选 `scope`（WorkspaceScope/ChangeScope 判别联合，类型自 SessionListPanel 导出）派生列表数据源/标题后缀；`?session=` 深链（挂载解析一次，getAgentSession 验证，无效静默落空门户态）；三入口（/sessions、/workspaces/[id]/sessions、/workspaces/[id]/changes/[cid]/sessions）渲染同一组件。2026-08-23-sessions-workspace-hub task-06/07 起双态接线：组头「＋」/change 页头按钮 → PreSessionPicker 浮层 → preContext 预会话态（详见契约摘要）。
- `SessionListPanel`（2026-08-23-sessions-workspace-hub task-05 重构）：左栏**工作区树**——全局/workspace scope 走两层筛选 tab + 工作区分组手风琴 + 机器小节（数据一次拉取 limit=500 客户端分组，D-103）；change scope 维持现状平铺列表（引擎胶囊/机器多选/虚拟滚动/真分页只在此分支保留）。
- `PreSessionPicker`（2026-08-23-sessions-workspace-hub task-04 新增）：全部态新建的两步轻选择浮层（①在线机器 → ②智能体，两步即达）。
- ~~`NewSessionForm`~~ / ~~`WorkspaceSessionPicker`~~：**已退役删除**（2026-08-23-sessions-workspace-hub task-07，D-109/X-12）——新建入口收敛为「组头＋→浮层→预会话态首句创建」，表单/双列选择器文件与 import 已删；`resolveDefaultMachineId`/`NEW_SESSION_MACHINE_LS_KEY` 迁入 sessions-portal.tsx。
- `SessionConfigBar`：会话顶部配置控件条（档案/供应商点选即切换）。
- `ctx-usage-bar.tsx`：上下文用量环 + 供应商额度胶囊。

组件自治约定：只收 props / 只调本域接口，不做 SSE 订阅与页面路由——组装归 `app-sessions-pages` 的 SessionPanel 页面（task-10）。

## 契约摘要
- `SessionsPortal`（task-06/07 双态接线）：props `{ scope? }`；右侧三分支优先级 = 真会话（selectedSessionId → `SessionPanel mode="page" key={id}`）> 预会话（preContext → `SessionPanel sessionId=null` + preContext + onPreSessionCreated，key=`pre:{workspaceId ?? "-"}:{runtimeId}`）> 空门户态（`data-testid="sessions-empty-portal"` 轻引导，深链无效/无参亦落此）。
  - 组头「＋」onNewInGroup(workspaceId, filter) → 筛选态直带链（ql-20260823-001 补齐 D-107 第一段）：两层筛选 tab（机器+智能体）均已选具体值且该引擎有在线 runtime 时**跳过浮层直接合成 preContext**；缺任一层或无在线 runtime 回退 PreSessionPicker 两步浮层（默认高亮 Claude）；onPick 合成 preContext `{ workspaceId(组), runtimeId }` 并清选中。
  - change scope（ql-20260823-003 修订）：左侧同树形态（单组+组头「＋」，预展开该组）；页头「新建会话（本变更）」按钮已移除（入口收敛组头「＋」，经 handleNewInGroup 直带/浮层均双传 `{ workspaceId, changeId, runtimeId }`，X-13）。
  - 状态机（FR-03 零残留）：首句创建成功（onPreSessionCreated）→ setSelectedSessionId（key 重挂载状态机自然接管）+ 清 preContext + invalidate `["agentSessions"]`；用户列表 onSelect 切走 → 清 preContext（首句未发 = 零服务端实体）。
  - `?new=1` 直达新建（ql-20260823-005，ppm/projects「发起团队」等外部入口）：挂载解析一次（autoNewDoneRef 守卫），`?session=` 深链优先（同传只恢复选中）；机器数据就绪后 `resolveDefaultMachineId`（D-005）解析默认机器 → 取其在线 claude/codex runtime（默认 Claude）经 `enterPreSession` 直接进预会话态；未命中自动弹两步浮层兜底（预绑定组 = workspace/change scope 锁本组，全局 null）。`enterPreSession(runtimeId, workspaceId)` 自原 handlePickerPick 主体提取，浮层 onPick 与 ?new=1 两入口共用（change scope 双传 X-13 语义不变）。
  - workspace 深链预展开（FR-06）：scope.workspaceId → SessionListPanel `defaultExpandedWorkspaceId`。
  - 页级数据：`useDaemonMachines`（面板离线判定 + 浮层数据源共用）、`listProviders`（CtxUsageRing 分母）；删除逐条 `deleteAgentSession` + invalidate 前缀 `["agentSessions"]`（覆盖全局/scope 单一路径）。
  - 底部纯函数区：`NEW_SESSION_MACHINE_LS_KEY` + `resolveDefaultMachineId(machines, sessions)`（D-005 三级回退，task-06 自 NewSessionForm 迁入、task-07 删源后此处为唯一实现）。
- `SessionListPanel`（task-05 工作区树）：props `{ selectedSessionId?, onSelect?, onDeleteSessions?, scope?, onNewInGroup?, defaultExpandedWorkspaceId? }`；全部 scope 统一 WorkspaceTreeList（ql-20260823-003：change 平铺分支 ChangeScopeFlatList 退役删除，D-106 修订——change 数据带 change_id+workspace_id 端点过滤单组渲染，筛选/搜索客户端过滤）。
  - 工作区树数据：`useQuery` 一次拉取 `listAgentSessions({ limit: AGENT_SESSIONS_TREE_FETCH_LIMIT=500 })`（D-103，>500 余量底部提示「仅显示最近 N 条」）；workspace scope 维持端点过滤（D-003@v2 只多传 workspace_id，单组、名称解析失败兜底「当前工作区」）；分组 = 客户端按 workspace_id 分桶 + 工作区列表序（0 会话组仍显示）+「未知工作区」桶（workspace_id 无法解析，无「＋」）+「非工作区」固定末尾组（有「＋」，workspaceId 传 null，D-105）。
  - 筛选（纯视图过滤不进数据层）：标题搜索（回车应用）+ 状态下拉（X-11 保留）+ 两层筛选 tab（D-107）——第一层机器胶囊（含「全部」清空），选中后出第二层智能体（⚡Claude Code/◎Codex + 「全部」）；筛选态隐藏机器小节标题；筛选变化重置展开态与「显示全部」（豁免当前选中会话所在组，R-05）。
  - 树渲染：工作区分组手风琴（组头=▶展开箭头+📂名称+会话数+「＋」新建+多选入口）→ 组内机器小节（机器名+在线 Badge 点，runtime_id→机器映射缺席回退 config_snapshot.machine_name）→ 条目；组内超 50 截断 + 「显示全部」（GROUP_ITEM_LIMIT=50，R-03）。
  - 保留能力（X-11）：状态下拉/标题搜索（树形态=组内视图过滤）；批量删除（组头「多选」入口→组内勾选/全选本组/删除选中，一次一个组）；单条 hover 删除。全局 `useVirtualizer` 已退役（R-04，分组结构+组内截断取代）。
  - 退役清单（全局形态，X-11）：引擎胶囊 tab（Segmented）→ 两层筛选 tab 智能体层取代；机器多选 Select → 机器 tab 取代；三者仅在 change 分支保留原实现（PAGE_SIZE=50 真分页/ROW_HEIGHT=96 虚拟滚动/引擎胶囊四维筛选均平铺分支专属）。
  - 条目紧凑两行（D-006）：第一行=状态点+标题截断+相对时间+hover 删除；第二行 chips——树形态=引擎/**创建人（👤 owner_name，null 显"—"，D-108@v2）**/档案/供应商/轮数（工作区/机器由组头与小节承载不重复）；flat 形态=工作区/机器/引擎/档案/供应商/轮数（现状）。chips 优先读 `config_snapshot` 直显，缺省回退基础字段。
  - 导出 `WorkspaceScope`/`ChangeScope`/`SessionListScope`（scope 判别联合）、`formatRelativeTime(iso, now?)`。
- `PreSessionPicker`：props `{ open, machines, onCancel, onPick }`——纯展示受控组件（零数据请求，machines 父层注入）。① 仅在线机器卡（Badge+别名||hostname+心跳时间+在线智能体数）；② 该机器 runtimes 过滤 provider∈{claude,codex}（`SESSION_SUPPORTED_PROVIDERS`）且在线，默认 Claude Code 高亮（主色边框+「默认」Tag）；选完智能体立即 `onPick(runtimeId)` 关闭（两步即达无确认按钮）；取消/遮罩点击仅 onCancel（open 受控父层，重开重置回第一步）；空态引导（无在线机器/无可用智能体）。
- `SessionConfigBar`：props `{ sessionId, running, ended, agentProfileId, llmProviderId, configSnapshot, runtimeId?, engine?, switchPrompt?, onSwitched? }`。
  - 四控件（机器/智能体/供应商/档案）展示会话当前配置（`agent_sessions.config_snapshot` 为展示名来源）。
  - 可切：档案、供应商——idle 点开下拉点选即切换（ql-20260817-009 去掉确认行/提示消息步骤）→ `injectSession(sessionId, prompt, 带新配置)`。
  - 供应商下拉含「不指定（本机默认）」→ `llm_provider_id: ""` 切回本机默认（task-16 契约）。
  - 纯展示：机器/智能体——下拉仅展示可选项并整体置灰，跨机器标「二期」、跨引擎标「需开新会话」（每机每引擎唯一 runtime，无切换目标）。
  - running 全置灰 + 「🔒 本轮完成后解锁切换」；ended/failed 只读（无锁提示）。
  - 切换 toast「下一轮生效」，历史消息保留当时配置（who 行按轮快照渲染归 turn-timeline，本组件不管消息流）。
  - 导出 `buildDefaultSwitchPrompt(p)`（默认切换轮提示文案）、`SWITCH_NO_PROVIDER_VALUE`、类型 `SessionConfigCtrlKind`（machine/agent/provider/profile）/ `SessionConfigSwitchField`（agent_profile_id/llm_provider_id）。
- `ctx-usage-bar.tsx`（FR-08 / D-009 / D-014，输入框上方一行组件）：
  - `CtxUsageRing`：环形上下文用量（props 含 usedTokens——父层 SSE turn usage + attach 历史 logs 累计后传入，本组件不累计）。
  - `QuotaPill({ providerId })`：供应商额度胶囊，自调 `getProviderQuota` 显示额度+重置时间（`formatQuotaResetTime` 导出）。
  - `CtxUsageBar`：Ring+Pill 组合条。
  - 分母三级降级链 `resolveCtxWindowTokens(roleMapping, fallbackModel)`（D-014）：
    - 供应商 role mapping 勾选 1M（one_m=true，injector 模型名后缀 [1m]）→ 1_000_000。
    - 有模型名（role mapping.model → fallbackModel）→ `MODEL_CTX_WINDOW_TABLE` 常量表（小写子串匹配，未命中取 `DEFAULT_CTX_WINDOW_TOKENS=200_000`）。
    - 既无 one_m 也无模型名 → null（无分母，只显累计 token）。
  - 阈值常量 `CTX_WARN_THRESHOLD_PCT=50`（黄）/ `CTX_CRIT_THRESHOLD_PCT=80`（红）。

## 关键逻辑
```
SessionsPortal 右侧三分支（task-06/07）:        // 优先级：真会话 > 预会话 > 空门户
  selectedSessionId → SessionPanel key={id}（key 变化清 SSE/轮询/队列）
  preContext        → SessionPanel sessionId=null（首句 createSession 原地接管）
  else              → 空门户态轻引导
  组头＋/change 页头按钮 → PreSessionPicker → onPick 合成 preContext（清选中）
  ?new=1（ql-20260823-005）→ D-005 默认机器+默认 Claude 直接预会话，
    未命中自动弹浮层；?session= 深链优先于 ?new=1
  首句创建成功（onPreSessionCreated）→ 切 sessionId + 清 preContext
    + invalidate ["agentSessions"]（新会话落对应分组顶部）
  列表 onSelect 切走 → 清 preContext（首句未发 = 零服务端残留，FR-03）

resolveDefaultMachineId（sessions-portal.tsx 底部，D-005 三级回退；task-06 自
  NewSessionForm 迁入，源已删此处唯一实现）:
  无在线机器 → null
  localStorage 上次选择（仍在线）→ saved
  sessions 按 last_active_at 排序 → runtimeToMachine 命中在线机 → mid
  否则 → 最新心跳的在线机器

SessionConfigBar 切换:                          // ql-20260817-009 点选即切
  点下拉项 → PendingSwitch{field, value, label}
  → injectSession(sessionId, switchPrompt ?? buildDefaultSwitchPrompt(p), {[field]: value})
  → toast「下一轮生效」 → onSwitched(resp, field, value)

CtxUsageRing 分母: roleMapping.one_m → 1_000_000
  else model 命中常量表 → 表值 | DEFAULT(200_000)
  else 无模型名 → null（只显示 token 数）
```

## 注意事项
- 切换语义（设计定版）：配置切换走 `injectSession` 带新配置+prompt，session 维持 active 不重建；空 prompt 切换不产生消息与模型回应（切换静默化）。
- 供应商「不指定（本机默认）」用空串 `""` 作 Select 值，提交侧必须转 `llm_provider_id: ""`，未选项从请求体剔除。
- 智能体显示名规则：主显引擎名（Claude Code/Codex），`runtime.name` 默认是机器主机名不得作主标签；有自定义别名时「别名 · 引擎名」并呈。
- 树形态筛选是纯视图过滤（机器/智能体 tab、状态、搜索均不进数据层）；筛选态经 onNewInGroup 第二参快照透出（空串=未筛），门户据此直带/回退浮层（ql-20260823-001，D-107 直带链已落地）。ql-20260823-003：筛选智能体后条目隐藏引擎 chip（hideEngineChip，全组同引擎冗余；清空恢复），与筛选机器隐藏机器小节标题（hideMachineTitles）同一去冗余语义。
- `owner_name` chip 读后端列表注入字段（本人隔离视图下恒为本人，为未来共享场景预留，D-108@v2）；null 显「—」。ql-20260823-003：后端注入改 display_name 展示名优先、回退 username 登录名（用户反馈显示名称而非登录名）。
- `config_snapshot` 是条目 chips 的免查询直显源，旧会话快照为 null 时回退基础字段渲染；机器小节的 runtime→机器映射缺席（分页外/已删机器）回退快照 machine_name（按离线渲染）。
- ctx 用量环分子（usedTokens）由父层累计传入；改分母逻辑须同步 `MODEL_CTX_WINDOW_TABLE` 与 `DEFAULT_CTX_WINDOW_TOKENS`。
- 空值统一显示 `—`、日期显式 `zh-CN`（项目规则）；机器多选过滤（change 平铺分支）受后端仅支持单 machine_id 限制。
- NewSessionForm/WorkspaceSessionPicker 已删（2026-08-23-sessions-workspace-hub）：旧 import/测试引用须改走 PreSessionPicker + 预会话态链路，勿复活表单形态。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
