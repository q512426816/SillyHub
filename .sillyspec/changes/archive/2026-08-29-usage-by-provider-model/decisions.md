# decisions — 2026-08-29-usage-by-provider-model

author: qinyi
created_at: 2026-08-29 02:37:13

## D-001@v1

- type: architecture
- source: user
- question: 用量统计细化做到什么程度（方案 A 明细表 / B 只到供应商 / C 只做会话模型选择）？
- answer: 用户选 **A 完整版**——新表 agent_run_model_usage 记录 run×模型 四维明细 + API 调用次数，用量卡按供应商×模型分组展示；会话页供应商+模型级联选择同步做。理由：能准确回答「同供应商不同模型（含子代理模型）各消耗多少」，且按次数计费套餐的调用数可对照；B 后续补明细要返工，C 推迟统计价值。
- evidence: brainstorm step4 方案选择（AskUserQuestion 用户拍板，2026-08-29 02:40）。

## D-002@v1

- type: design
- source: user
- question: 会话页模型级联的候选列表来源？
- answer: 供应商高级设置已有模型体系（model_role_mappings 四角色 model + default_fallback_model + model 字段去重保序）+「默认（跟随供应商配置）」首项；不新建模型列表维护功能，不做上游 /v1/models 持久化。
- evidence: brainstorm step3 澄清（用户答「供应商里面高级设置里面不是有模型选择了吗」，2026-08-29 02:35）。

## D-003@v1

- type: design
- source: user
- question: 按供应商/模型统计展示位置？
- answer: 现有 runtimes 用量卡扩展（by_provider 分组明细 + 调用次数 + 计费口径 footnote），不建新独立统计页。
- evidence: brainstorm step3 澄清（AskUserQuestion 用户选「现有运行时用量卡扩展（推荐）」，2026-08-29 02:35）。

## D-004@v1

- type: design
- source: user
- question: 会话页底部四个选择块的处理？
- answer: 移除「机器」「智能体」两个展示块，只保留「供应商（升级为供应商+模型级联）」「档案」；新会话入口 pre-session-picker 不动；Codex 供应商锁定语义保持。
- evidence: 用户原始需求原话（2026-08-29 02:30）。
