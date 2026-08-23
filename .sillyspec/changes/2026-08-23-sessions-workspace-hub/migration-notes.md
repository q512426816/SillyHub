---
author: qinyi
created_at: 2026-08-23 09:59:00
change: 2026-08-23-sessions-workspace-hub
task: task-07
---

# NewSessionForm / WorkspaceSessionPicker 退役迁移清单（R-06 / D-109）

本文件是 task-07 退役 `frontend/src/components/sessions/new-session-form.tsx`、
`frontend/src/components/sessions/workspace-session-picker.tsx` 及其测试的**唯一
迁移对账落点**：旧断言语义 100% 有落点（迁移 / 有意删除均逐条注明）。

## 1. new-session-form.test.tsx（28 用例 → 落点映射）

### D-005 默认机器三级回退（3 用例）

| 旧用例 | 落点 | 状态 |
|---|---|---|
| 第一级：localStorage 上次选择且在线 → 直接选中 | `sessions/__tests__/sessions-portal.test.tsx` describe 6「resolveDefaultMachineId 迁移（D-005 三级回退）」第一级 | task-06 已迁移（函数与 LS_KEY 先迁，本卡删源后 portal 为唯一实现） |
| 第二级：无 localStorage → 最近会话所在的在线机器 | 同上 describe 6 第二级 | task-06 已迁移 |
| 第三级：无历史会话 → 最新心跳在线机器；离线不参与 | 同上 describe 6 第三级 | task-06 已迁移 |

约束（TaskCard constraints）：`NEW_SESSION_MACHINE_LS_KEY` 语义保留——**读侧**
（resolveDefaultMachineId 第一级回退链）随函数迁入 sessions-portal.tsx 继续在用；
**写侧**（表单创建成功后记住机器）随表单退役，当前无写入方（存量 localStorage
值仍被回退链读取，不回退断链）。

### 智能体联动 D-010（3 用例）

| 旧用例 | 落点 | 状态 |
|---|---|---|
| 默认选 Claude Code；不支持的 provider 置灰「暂不支持会话」 | `sessions/__tests__/pre-session-picker.test.tsx`「默认 Claude Code 高亮」（aria-pressed + 「默认」Tag）+「第二步仅列 claude/codex 在线智能体」（白名单=置灰语义的新形态：不可选项直接不出现） | 语义迁移（选择器形态由表单四选区改为两步浮层） |
| 智能体标签显示引擎名而非机器名（ql-20260815-001） | pre-session-picker.test「第二步仅列 claude/codex…」断言按钮名「Claude Code」（runtimeLabel 主显引擎名，组件内同款实现） | 语义迁移 |
| 切机器重置智能体：A 机器手选 Codex → 切 B 回落默认 Claude | pre-session-picker.test「取消后重开：重置回第一步」（重开重置）+「第二步仅列…」（换机器后第二步按新机器重列、默认 Claude 高亮） | 语义迁移（浮层两步天然隔离，无跨机器残留态） |

### 供应商锁定 engine≠claude（1 用例）

| 旧用例 | 落点 | 状态 |
|---|---|---|
| Claude 下可选供应商；切 Codex 后 Select 锁定且提交不带 llm_provider_id | **有意删除**：预会话/会话创建不再有会话级供应商选择步骤——供应商改为**会话内**切换（SessionConfigBar，既有 `session-config-bar.test.tsx` 承载切换与引擎约束）；创建请求不带 provider 由 `daemon/__tests__/session-panel-pre-session.test.tsx`「首句发送 → createSession…（不带 provider）」守护 | 交互形态有意变更（配置表单→会话内切换） |

### 档案 D-013（2 用例）

| 旧用例 | 落点 | 状态 |
|---|---|---|
| Codex 下档案选项标注「人格暂不支持」，仍可选且提交带 agent_profile_id | **有意删除（选择部分）**：预会话流程无档案选择步骤，档案改为会话内 SessionConfigBar 切换（session-config-bar.test 承载）；提交带 agent_profile_id 的可选参数语义保留在 daemon.ts createSession 契约（§7.5 生命周期表 agent_profile_id?） | 同上（交互形态有意变更） |
| Claude 下档案选项无标注，正常可选 | 同上 | 同上 |

### 开始会话提交（3 用例）

| 旧用例 | 落点 | 状态 |
|---|---|---|
| 全部选中：runtime_id/可选 id/manual_approval/ask_user_only 正确 + onCreated 回调 + 记住机器 | `daemon/__tests__/session-panel-pre-session.test.tsx`「首句发送 → createSession 含 runtime_id + prompt + manual_approval/ask_user_only…上报 onPreSessionCreated」（提交参数+回调语义）| 语义迁移（onCreated→onPreSessionCreated，task-03）；「记住机器」写入侧随表单退役（见 D-005 注） |
| 未选项不进请求体 | session-panel-pre-session.test「preContext 带 workspaceId + changeId → 条件展开双传（X-13）」+ 非工作区用例（sessions-portal.test「首句创建成功」请求体仅 4 字段） | 语义迁移（条件展开同款实现） |
| 创建失败 → 内联错误提示，不回调 onCreated | session-panel-pre-session.test describe「预会话首句创建失败（R-02）」：输入保留 + 内联错误 + 不建流 + 原地重试 | 语义迁移（且比旧表单更强：R-02 失败保留输入可重试） |

### 必选缺失禁用按钮（1 用例）

| 旧用例 | 落点 | 状态 |
|---|---|---|
| 无消息 → 按钮禁用；无可用智能体（全部离线）→ 按钮禁用 | session-panel-pre-session.test「空文本不发首句」+「preContext 目标机器离线：输入禁用 + 离线占位文案」+「无 preContext…输入禁用引导文案」 | 语义迁移（禁用门控同构） |

### 工作区选择器联动（5 用例）

| 旧用例 | 落点 | 状态 |
|---|---|---|
| ⓪ 工作区标签存在（编号不冲突） | **有意删除**：工作区不再经表单选择器选择，由组头「＋」所在分组决定（树形态组头=工作区，`session-list-panel.test.tsx` 组头渲染断言） | 形态有意变更 |
| 选工作区且绑定机器在线 → 机器自动切换到绑定机器 | **有意降级（D-107 降级说明，task-06）**：SessionListPanel 筛选 tab 未暴露受控 prop → 统一弹两步浮层人工选择（pre-session-picker.test 覆盖浮层本身）；「与筛选一致的意图」经浮层默认 Claude 高亮承接 | 降级已在 task-06 文件头注明（待 SessionListPanel 加受控 prop 后恢复直取） |
| 选工作区无绑定 → 机器不动 | 同上（浮层人工选择天然覆盖） | 同上 |
| 改回「不使用工作区」→ 仅清 workspaceId 不动机器 | **有意删除**：预会话上下文锁定不可改（D-104），换工作区=取消重来（浮层取消/切走零残留，sessions-portal.test「浮层取消」「不发言切走零残留」） | 锁定语义有意变更（创建后不可换） |
| 提交含 workspace_id / 不选零回归 2 用例 | sessions-portal.test describe 5「workspace 组＋ → preContext 带组 workspaceId → 首句 createSession 带 workspace_id」+ describe 4 非工作区用例（请求体不含 workspace_id/change_id 字段） | 语义迁移（bindWorkspaceId → preContext.workspaceId） |

### 锁定绑定 bindWorkspaceId / bindChangeId（2 用例）

| 旧用例 | 落点 | 状态 |
|---|---|---|
| bindWorkspaceId：WorkspaceSessionPicker 不渲染 + 已锁定提示在；提交含 workspace_id=绑定值 | sessions-portal.test describe 5 workspace 用例（preContext 继承绑定语义；「锁定不可换」由上下文行 🔒 提示 + D-104 只读断言承接，session-panel-pre-session.test「上下文行…完全只读」） | 语义迁移 |
| bindChangeId（+bindWorkspaceId）：change_id 与 workspace_id 双传 | **本卡补齐**：sessions-portal.test describe 5「change 入口（task-07 / X-13）」——页头「新建会话（本变更）」→ 浮层 → preContext 双传 → 首句 createSession 双传；面板参数展开层另由 session-panel-pre-session.test「X-13 语义」承接 | 本卡（task-07）迁移 |

### 聊天优先 ql-20260822-010（3 用例）

| 旧用例 | 落点 | 状态 |
|---|---|---|
| 默认收起配置区：chips 摘要 + 首句零配置直接开始 | **有意删除（版式不复存在）**：聊天优先版式整体被预会话同构空态取代（session-panel-pre-session.test「面板头/时间线容器/输入区均在…发送第一句话开始对话」即新形态的「零配置直接开始」） | 版式有意变更 |
| 点「修改配置」展开后选择器可改，chips 联动更新 | 同上（配置收敛：机器/智能体锁定于上下文行，供应商/档案会话内改） | 同上 |
| 锁定绑定：chips 行常显「🔒 工作区已锁定」 | 上下文行 🔒「上下文已锁定 · 创建会话后不可更换」（sessions-portal.test「组头＋→…上下文行=分组+机器+智能体」断言「上下文已锁定」） | 语义迁移（chips 行→锁定上下文行） |

## 2. workspace-session-picker.test.tsx（7 用例 → 落点映射）

组件随 NewSessionForm 退役（真实消费仅表单；绑定映射语义由门户 preContext
解析继承，design §6 删除行注明）。

| 旧用例 | 落点 | 状态 |
|---|---|---|
| 空态：listWorkspaces 返回空 → 「你还未加入工作区」 | **有意删除**：工作区选择器不复存在；树形态 0 工作区时仍渲染「非工作区」组（session-list-panel.test 树渲染用例） | 形态有意变更 |
| 有数据：Select 渲染选项 + 首项「不使用工作区（默认）」 | **有意删除**：「不使用工作区」= 点「非工作区」组头「＋」（D-105，sessions-portal.test 组头用例） | 同上 |
| onChange 回调 / value 控制透传 2 用例 | **有意删除**：受控选择器退场；工作区决定入口=分组（onNewInGroup(workspaceId) 回调，session-list-panel.test 组头回调断言） | 同上 |
| 切换回 null（value='ws-1' 显示选中态） | **有意删除**（同「改回不使用工作区」：锁定语义 D-104） | 同上 |
| disabled=true → Select 禁用 | **有意删除**（无提交期禁用态：两步浮层与首句创建异步由 creating 态承接，session-panel-pre-session.test） | 同上 |
| 加载失败：listWorkspaces reject → 错误提示条 | **有意删除**：listWorkspaces 失败时树形态组名走兜底文案（「当前工作区」/「未知工作区」桶，session-list-panel.test 兜底断言），无阻断性错误条 | 同上 |

## 3. page.test.tsx（app/(dashboard)/sessions，18 用例基线红 → 全绿）

基线：HEAD（task-06 后）18/18 红——根因 `@/lib/daemon` mock 缺
`AGENT_SESSIONS_TREE_FETCH_LIMIT`（task-05 树形态常量，该文件 allowed 归本卡）
+ 缺 `deleteAgentSession`/`@/lib/workspaces`（树面板新消费）。本卡修复 mock
并迁移表单系断言（18=18 编号保持，见文件头「迁移映射」）：

| 旧用例 | 新语义 |
|---|---|
| 1 右「新建会话表单」 | 右「空门户态」（未选会话且无 preContext） |
| 2 页头出现「新建会话」按钮 | X-12 移除：断言页头两按钮不在 + 组头「＋」在 |
| 3 页头「新建会话」→ 回表单态（SSE 关闭） | 组头「＋」→ 两步浮层 → 预会话态（真会话卸载 SSE 关闭、未发首句零创建） |
| 4 NewSessionForm onCreated → createSession → s-new 面板 | 预会话首句发送 → createSession(runtime_id) → onPreSessionCreated → s-new 面板 |
| 17 经「新建会话」清选中重挂 | 经组头「＋」→ 浮层 → 预会话（清选中）→ 再选列表条目重挂 |
| 5-16、18 | SessionPanel page 模式语义原样（mock 修复后直接复绿） |

## 4. 源文件退役确认

- `frontend/src/components/sessions/new-session-form.tsx`：删除。全仓 grep
  `NewSessionForm` 仅剩注释性提及（历史依据说明，非代码引用）。
- `frontend/src/components/sessions/workspace-session-picker.tsx`：删除。同上。
- `resolveDefaultMachineId` / `NEW_SESSION_MACHINE_LS_KEY`：task-06 已迁入
  sessions-portal.tsx 导出（本卡删源后唯一实现），测试新家 sessions-portal.test。
- 四标识 grep 守护（NewSessionForm / WorkspaceSessionPicker /
  NEW_SESSION_MACHINE_LS_KEY / resolveDefaultMachineId）：代码零残留（注释中
  的历史出处说明保留——CLAUDE.md 18 条要求注释与实现一致，历史迁移说明属
  依据引用）。
