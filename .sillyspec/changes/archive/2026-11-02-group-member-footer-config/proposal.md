---
author: flow-machine-draft
created_at: 2026-11-02T05:29:44.707Z
---
# 提案书（Proposal）— 2026-11-02-group-member-footer-config

## 动机

任务原话转写：群成员配置块对齐会话底部四选口径

动机：用户实证（群聊 6fa8df96 委派场景）——群聊新增/修改 agent 成员的配置块当前为【引擎供应商/模型（LLM 供应商）/智能体方案/机器】，缺具体模型与思考等级两维：模型下拉实际选的是 LLM 供应商（标签错位，选不到 deepseek-v4.1-flash 一类具体模型），无思考等级（无法选「最高」），机器下拉在 runtime 无别名时错误兜底成引擎名（显示「机器: Claude Code」）。要求对齐会话底部（sessions/session-config-bar.tsx）的供应商、模型、思考等级、档案四选口径。依据：session-config-bar 既有级联与档位实现（数据源 listProviders/useMineAgentProfiles/provider-caps，THINKING_LEVEL_OPTIONS 七档）、群成员数据面（agent_group_members 无 model/thinking 列；shadow.py:684/832 现走 llm_provider 主模型兜底 + config_snapshot.model=供应商名的语义错位）、影子派发链（shadow.py 建 run + lease metadata 可透传 model/thinking_level，同 session inject task-05 先例）。

成功标准：
- 群聊「添加 Agent」表单、建群向导同源表单、「切换配置」弹窗的配置块包含与会话底部同口径的供应商、模型、思考等级、档案四项：模型下拉级联出所选供应商配置的具体模型（可选到 deepseek-v4.1-flash 形态的具体模型名），思考等级按引擎能力门控可选档位（含「最高」）
- 机器下拉选项不再以引擎名兜底（「机器: Claude Code」形态消失，显示机器别名/主机名）
- 影子会话派发按成员所选模型与思考等级执行（run.model + lease metadata thinking_level 透传，未选时维持供应商主模型/引擎默认兜底），成员卡片展示所选模型与思考等级
- 前端表单（渲染/级联/提交payload）与后端（成员schema/存储/影子派发透传）均有自动化测试覆盖

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. 群聊「添加 Agent」表单、建群向导同源表单、「切换配置」弹窗的配置块包含与会话底部同口径的供应商、模型、思考等级、档案四项：模型下拉级联出所选供应商配置的具体模型（可选到 deepseek-v4.1-flash 形态的具体模型名），思考等级按引擎能力门控可选档位（含「最高」）
2. 机器下拉选项不再以引擎名兜底（「机器: Claude Code」形态消失，显示机器别名/主机名）
3. 影子会话派发按成员所选模型与思考等级执行（run.model + lease metadata thinking_level 透传，未选时维持供应商主模型/引擎默认兜底），成员卡片展示所选模型与思考等级
4. 前端表单（渲染/级联/提交payload）与后端（成员schema/存储/影子派发透传）均有自动化测试覆盖

## 成功标准（可验证）

1. 群聊「添加 Agent」表单、建群向导同源表单、「切换配置」弹窗的配置块包含与会话底部同口径的供应商、模型、思考等级、档案四项：模型下拉级联出所选供应商配置的具体模型（可选到 deepseek-v4.1-flash 形态的具体模型名），思考等级按引擎能力门控可选档位（含「最高」）
2. 机器下拉选项不再以引擎名兜底（「机器: Claude Code」形态消失，显示机器别名/主机名）
3. 影子会话派发按成员所选模型与思考等级执行（run.model + lease metadata thinking_level 透传，未选时维持供应商主模型/引擎默认兜底），成员卡片展示所选模型与思考等级
4. 前端表单（渲染/级联/提交payload）与后端（成员schema/存储/影子派发透传）均有自动化测试覆盖
