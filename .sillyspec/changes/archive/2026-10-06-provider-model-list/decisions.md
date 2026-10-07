---
author: qinyi
created_at: 2026-10-06 21:22:47
---

# 决策记录 — 2026-10-06-provider-model-list

- **D-001@v1** | type: architecture | source: user
  question: 模型列表怎么落地？
  answer: 彻底重构——新「模型列表」取代 model 单值 / model_role_mappings 4 角色槽 / multimodal 供应商级三态三个旧字段（迁移后删列，规则 11 不留兼容双源）。
  evidence: 需求澄清轮 AskUserQuestion，用户选「彻底重构（推荐）」。

- **D-002@v1** | type: architecture | source: user
  question: Claude Code 的 4 角色槽怎么跟模型列表关联？
  answer: 列表内标角色——每条模型条目可标承担的 Claude 角色档（主/快速/强大/想象），注入器照旧发 ANTHROPIC_DEFAULT_*_MODEL + ANTHROPIC_MODEL；其它引擎不标角色只用模型名。不限制模型条数。
  evidence: 需求澄清轮 AskUserQuestion，用户选「列表内标角色（推荐）」。

- **D-003@v1** | type: design | source: user
  question: 模型级多模态标记口径？
  answer: 三态下沉积承——每条模型 auto/true/false；auto 沿用 supports_multimodal_by_model_name 启发式（中转站别名免填）；附件门控查「会话当前生效模型在列表里的标记」，供应商级 multimodal 字段退役。
  evidence: 需求澄清轮 AskUserQuestion，用户选「三态下沉积承（推荐）」。

- **D-004@v1** | type: scope | source: user
  question: 存量配置怎么迁移？
  answer: 自动折算——迁移把 model + model_role_mappings 4 槽的模型名去重折算成列表条目（多模态标 auto，角色标记映射到条目 roles，one_m 后缀保留在条目上），用户无感不丢配置。
  evidence: 需求澄清轮 AskUserQuestion，用户选「自动折算（推荐）」。

- **D-005@v1** | type: architecture | source: user
  question: 模型列表存储形态？
  answer: JSON 列——llm_providers 加 models JSON 数组列（条目含 name/multimodal/roles/one_m），与 agent_kinds 变更同构（模式成熟、改动集中、行级读写无 join）；否决独立子表（当前体量过度设计）。
  evidence: 方案选择轮 AskUserQuestion，用户选「JSON 列（推荐）」。
