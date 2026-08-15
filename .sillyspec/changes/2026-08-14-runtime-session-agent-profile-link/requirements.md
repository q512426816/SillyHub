---
author: WhaleFall
created_at: 2026-08-14 15:00:50
---

# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 平台用户 | 在 `/runtimes`（或变更详情页）发起/继续会话，选择与切换智能体档案 |
| 档案管理员 | 既有的档案管理者（platform 级 admin / workspace 级成员），本变更不改变其职能 |

## 功能需求

### FR-01: 会话区单一档案选择器
覆盖决策：D-005@v1
Given 用户打开会话对话框处于建会话（idle）态
When 会话区渲染
Then 只显示一个「智能体档案」下拉（列可见档案：platform + 个人 private + 当前 workspace，每条标注所属引擎，含"不指定，用默认"项），不再显示独立的「智能体提供方」「智能体模型」控件

Given 用户选择了某个档案
When 发起会话（createSession）
Then 请求只携带 `agent_profile_id`（不传 provider/model），引擎与模型由后端从档案派生

### FR-02: 选档案后注入档案人格与配置
覆盖决策：D-003@v1（Claude 部分）
Given 用户选了含 `system_prompt` 的 Claude 档案并发起会话
When daemon 创建 SDK query
Then system prompt 为 `preset:claude_code + append:档案.system_prompt`（经既有 `_apply_profile_to_lease` → lease metadata → claim payload 管道，daemon 基础注入零改动）

Given 用户选了 Codex 档案
When 会话执行
Then 引擎/模型/凭证跟随档案，但人格不注入（Codex StartOptions 无 systemPrompt，UI 在 Codex 档案选项上标注"人格暂不支持"）

### FR-03: 未选档案维持现状
Given 用户选择"不指定，用默认"
When 发起会话
Then 行为与现状一致：默认引擎（runtime.provider 或 claude 兜底）、模型走既有默认链（provider_config.model）、无人格注入；不调用 `_apply_profile_to_lease`

### FR-04: 同引擎内切换档案（历史无缝）
覆盖决策：D-002@v1, D-006@v1, D-007@v1
Given 会话处于 active 且当前轮已完成（turn_completed 后输入框启用）
When 用户点「切换」并选择**同引擎**的新档案、发送新一轮消息
Then inject 请求携带新 `agent_profile_id` + prompt；后端建新 AgentRun（带新档案快照）并下发 `SESSION_SWITCH_PROFILE`（原子含 profile 字段 + prompt/run_id/claim_token）；daemon 在 idle 立即/turn 边界关旧 query、用新 systemPrompt 重建 driverOpts、`driver.start({resume})` 重载完整对话历史后喂入 prompt——会话不中断、历史连续、新人格生效

Given 切换时 daemon 正在执行一轮（running）
When `SESSION_SWITCH_PROFILE` 到达
Then 挂 `pendingProfileSwitch` 至 `_onResult` 边界再 reload（不中断在跑轮次）

### FR-05: 档案按会话隔离
覆盖决策：D-001@v1
Given 用户在会话 A 切换了档案
When 其他会话 B（同用户）继续对话
Then 会话 B 的档案、人格、模型完全不受影响；每个 `AgentSession` 独立持有自己的 `agent_profile_id`

### FR-06: 跨引擎切换被拒绝
覆盖决策：D-002@v1
Given 会话当前引擎为 claude
When 用户尝试以 codex 档案发起切换（绕过前端过滤）
Then 后端 `inject_session` 校验 `profile.provider == session.provider`，不一致返回 4xx 错误；前端切换列表本就只列同引擎档案

### FR-07: 档案 model 真正生效
覆盖决策：D-004@v2
Given 档案填写了 `model`
When 该档案被用于会话（建会话或切换）
Then 实际模型 = 档案 model（优先于绑定/默认 provider_config.model）：`_apply_profile_to_lease` 将 profile.model 写入 lease metadata 并带 `model_source="profile"` 显式标记；`_inject_provider_config` 见标记跳过 model 覆盖

Given 档案未填 model（或未选档案）
When 会话执行
Then 模型走既有覆盖链（provider_config.model 优先），与现状一致（零回归）

## 非功能需求

- **兼容性**：`agent_sessions` 新列 nullable，旧会话不受影响；未选档案路径零行为变化；非档案会话的 model 覆盖链不变。
- **可回退**：前端不传 `agent_profile_id` 即退化为现状；daemon 切换逻辑与既有路径共用 reload 内核，可独立回退。
- **可测试**：model 优先级矩阵（档案标记/绑定 provider/默认 provider/workspace 默认）有后端单测；daemon reload（resume+新 systemPrompt）有单测；切换校验有 API 测试。
- **跨平台**：Windows/Linux/macOS 兼容（路径、WS 消息、无平台特定调用）。
- **类型同步**：后端 schema 变更同变更内跑 `pnpm gen:types` 并提交 `api-types.ts` + `openapi.json`（规则 20）。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-05 | 档案按会话隔离 |
| D-002@v1 | FR-04, FR-06 | 同引擎内切换 + 跨引擎拒绝 |
| D-003@v1 | FR-02 | Codex 人格第一期不注入 |
| D-004@v2 | FR-07 | profile.model 显式标记优先（supersedes D-004@v1） |
| D-005@v1 | FR-01 | UI 只留档案选择器，引擎/模型去掉 |
| D-006@v1 | FR-04 | daemon 热切换 reloadWithProfile |
| D-007@v1 | FR-04 | 切换消息原子化（prompt/run_id/claim_token） |
