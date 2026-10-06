---
author: flow-machine-draft
created_at: 2026-10-06T04:34:20.646Z
---
# 决策记录（Decisions）— 2026-10-06-opencode-settings-config-poison

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：清 NULL 后丢失的 enabledPlugins/skipDangerousModePermissionPrompt/model=fable 等键原本是否被用户依赖——判定不依赖：这些键来自 openai_chat 时代/导入残留，与 anthropic 直连链路冲突且正是本次故障根因，属毒数据（若用户后续要插件开关，前端表单可重配）。放弃的方案：①保留 settings_config 仅删 env 子键——保留的 model=fable 仍会改 claude settings.json 行为且其余键语义未审计，不如整清干净；②代码层加「settings_config.env 含 ANTHROPIC_BASE_URL 时告警」防护——属产品设计面（规则 7 的优先级是有意设计），超出本事故修复范围，坑文档留教训即可。
