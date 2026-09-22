---
author: sillyspec-fr-index
created_at: 2026-09-22T17:32:23.010Z
---

# FR 索引 — claude-settings

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 模块卡：modules/claude-settings.md（域=模块 id 同构；行为条目↔模块契约互跳）

## FR-claude-settings-001 三键白名单透传
变更：2026-09-20-claude-autocompact-config
状态：active
摘要：合法配置写入；值守护；零回归
依据决策：D-002@v1、D-003@v1
场景正文：
- 场景：合法配置写入 — Given provider 的 settings_config 含 `autoCompactWindow`（正整数）/`autoCompactEnabled`（布尔）/`；When daemon spawn claude 会话前执行 applyClaudeSettings；Then `$CLAUDE_CONFIG_DIR/settings.json` 含对应键值（三键经 TOP_LEVEL_KEYS 白名单）
- 场景：值守护 — Given settings_config 中 `autoCompactWindow` 为 0/负数/非整数，或开关键为非布尔；When buildSettingsObject 处理；Then 该键跳过不写入（best-effort 零回归：不抛错不阻断 spawn）
- 场景：零回归 — Given settings_config 仅含 env 或既有白名单键（attribution 等）；When applyClaudeSettings；Then 行为与现状逐字一致（env 不写/既有键照写）
全文：.sillyspec/changes/archive/2026-09-20-claude-autocompact-config/requirements.md#FR-01
最近确认：83b402f6b

## FR-claude-settings-002 provider 级配置入口
变更：2026-09-20-claude-autocompact-config
状态：active
摘要：表单条件渲染；非 claude 引擎；提交语义
依据决策：D-001@v1、D-002@v1
场景正文：
- 场景：表单条件渲染 — Given 用户在 provider 表单且 agent_kind=claude；When 表单渲染；Then 显示「引擎自动压缩」区（autoCompactEnabled 开关/autoCompactWindow 数字输入/precomputeCompactionEna
- 场景：非 claude 引擎 — Given agent_kind != claude；Then 该区不渲染
- 场景：提交语义 — When 保存表单；Then 三键值写入 settings_config；控件留空/默认态剔除对应键（=跟随引擎默认）
全文：.sillyspec/changes/archive/2026-09-20-claude-autocompact-config/requirements.md#FR-02
最近确认：83b402f6b
