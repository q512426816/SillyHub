---
schema_version: 1
doc_type: module-card
module_id: components-sessions
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 会话门户组件（components-sessions）

## 定位
会话门户（`/sessions`）的四个功能组件（`components/sessions/`），2026-08-14-sessions-portal 变更派生 + 切换静默化系列 quick 迭代（ql-20260817-009/010）：
- `SessionListPanel`：左栏会话列表（筛选 + 虚拟滚动 + 后端真分页）。
- `NewSessionForm`：新建会话四选择器联动表单。
- `SessionConfigBar`：会话顶部配置控件条（档案/供应商点选即切换）。
- `ctx-usage-bar.tsx`：上下文用量环 + 供应商额度胶囊。

组件自治约定：只收 props / 只调本域接口，不做 SSE 订阅与页面路由——组装归 `app-sessions-pages` 的 SessionPanel 页面（task-10）。

## 契约摘要
- `SessionListPanel`：props `{ selectedSessionId?, onSelect? }`。
  - 筛选四维（FR-02）：
    - 引擎胶囊 tab（Segmented 全部/claude/codex → provider 参数，单选即查）。
    - 状态下拉（active/ended/failed → status 参数，即查）。
    - 机器多选（`useDaemonMachines`；恰好选中 1 台走 server 侧 machine_id，多台退化客户端过滤——后端仅支持单 machine_id）。
    - 标题搜索（回车触发 q 参数）。
  - 列表：`useInfiniteQuery` + `listAgentSessions` 后端真分页（PAGE_SIZE=50，加载更多）。
  - 渲染：`useVirtualizer` 虚拟滚动只渲染可视区（ROW_HEIGHT=96 容纳 chips 至多 3 行、OVERSCAN=6）。
  - 条目紧凑两行：第一行=状态点+标题截断+相对时间；第二行=chips（机器/引擎/档案/供应商/轮数）。
  - chips 优先读 `config_snapshot` 直显免二次查询；快照缺省（旧数据 null）回退 runtime/provider 基础信息（机器名经 runtime_id→机器映射）。
  - 导出 `formatRelativeTime(iso, now?)`（中文相对时间，空/非法→—）。
- `NewSessionForm`：props `{ onCreated?(session, values) }`，导出 `NewSessionFormValues`。
  - ①机器（必选，仅在线）：`useDaemonMachines`；默认走 `resolveDefaultMachineId(machines, sessions)` 三级回退。
  - ②智能体（必选）：选中机器 runtimes 过滤在线 + provider∈{claude,codex}（`SESSION_SUPPORTED_PROVIDERS`）；不支持的 provider 置灰「暂不支持会话」；切机器重置选择。
  - ③供应商（可选）：`listProviders` + 「不指定（本机默认）」（`NO_PROVIDER_VALUE=""`）；engine≠claude 锁定（Codex 无会话级供应商）。
  - ④档案（可选）：`useMineAgentProfiles` 跨工作区聚合，不做引擎过滤；Codex 智能体下标注「人格暂不支持」。
  - 提交 `createSession({ runtime_id, agent_profile_id?, llm_provider_id?, prompt, manual_approval: true, ask_user_only: true })`；未选项不进请求体。
  - 导出 `NEW_SESSION_MACHINE_LS_KEY`（localStorage 记住上次机器）。
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
resolveDefaultMachineId:                        // D-005 三级回退
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
- `config_snapshot` 是条目 chips 的免查询直显源，旧会话快照为 null 时回退基础字段渲染。
- ctx 用量环分子（usedTokens）由父层累计传入；改分母逻辑须同步 `MODEL_CTX_WINDOW_TABLE` 与 `DEFAULT_CTX_WINDOW_TOKENS`。
- 空值统一显示 `—`、日期显式 `zh-CN`（项目规则）；机器多选过滤受后端仅支持单 machine_id 限制。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
