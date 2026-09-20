---
author: qinyi
created_at: 2026-09-20 17:19:12
---
# 需求规格（Requirements）— claude 引擎 autocompact 配置（provider 级）

## 角色

| 角色 | 说明 |
|---|---|
| 平台用户 | 在 provider 表单配置 claude 引擎压缩行为的用户 |
| daemon | sillyhub-daemon（claude-settings 写盘机制） |

## 功能需求

### FR-01: 三键白名单透传
覆盖决策：D-002@v1, D-003@v1

#### 场景：合法配置写入
Given provider 的 settings_config 含 `autoCompactWindow`（正整数）/`autoCompactEnabled`（布尔）/`precomputeCompactionEnabled`（布尔）任一
When daemon spawn claude 会话前执行 applyClaudeSettings
Then `$CLAUDE_CONFIG_DIR/settings.json` 含对应键值（三键经 TOP_LEVEL_KEYS 白名单）

#### 场景：值守护
Given settings_config 中 `autoCompactWindow` 为 0/负数/非整数，或开关键为非布尔
When buildSettingsObject 处理
Then 该键跳过不写入（best-effort 零回归：不抛错不阻断 spawn）

#### 场景：零回归
Given settings_config 仅含 env 或既有白名单键（attribution 等）
When applyClaudeSettings
Then 行为与现状逐字一致（env 不写/既有键照写）

### FR-02: provider 级配置入口
覆盖决策：D-001@v1

#### 场景：表单条件渲染
Given 用户在 provider 表单且 agent_kind=claude
When 表单渲染
Then 显示「引擎自动压缩」区（autoCompactEnabled 开关/autoCompactWindow 数字输入/precomputeCompactionEnabled 开关 + window 超实际窗口撞硬限的风险提示）

#### 场景：非 claude 引擎
Given agent_kind != claude
Then 该区不渲染

#### 场景：提交语义
When 保存表单
Then 三键值写入 settings_config；控件留空/默认态剔除对应键（=跟随引擎默认）

## 非功能需求

- 兼容性：零迁移、零协议改动、后端零改动（settings_config 自由 dict 既有校验）
- 可回退：白名单键移除即回退；运行中会话不受影响（下一 spawn 生效）
- 可测试：daemon 纯函数单测（buildSettingsObject）+ 前端组件测试

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-02 | 仅 provider 级（用户实答） |
| D-002@v1 | FR-01, FR-02 | 方案 A 白名单直达（用户实答） |
| D-003@v1 | FR-01 | 三键集合与触发机制依据（SDK 实证） |
