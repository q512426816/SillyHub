---
author: qinyi
created_at: 2026-10-06 14:25:00
---
# 提案书（Proposal）

## 动机

供应商（llm_providers）每行只支持一个 Agent 种类，同一份上游凭证服务多引擎必须重复建卡。生产实证（2026-10-06）：admin2 同一份智谱 key 建 4 条（claude×3+pi×1），另两用户各 2 条。根因是全链路按「引擎 == 供应商 agent_kind 单值」精确匹配。用户已确认做完整多选（D-001）。

## 关键问题

1. 重复建卡：同一 key/地址/模型配置因引擎不同要建 N 条，密钥轮换要改 N 处，易漏改漏删。
2. 解析链单值假设：context.py / inject_gates.py / capability.py / mcp_gateway tools.py 四处 == 匹配，任何一处遗漏改造都会造成多选行不命中或 AttributeError。
3. 热切换单 config 广播：notify_provider_switch 不分引擎推送，多引擎默认行无法保证每会话收到「agent_kind=本会话引擎」的 config。

## 变更范围

- 数据层：agent_kind 单值列迁移为 agent_kinds JSON 数组（存量自动转单元素数组，索引 drop/rebuild）。
- 服务层：创建/编辑/默认互斥（逐引擎清兄弟、扩张清新增引擎兄弟）、pi×openai_chat 组合级禁配。
- 解析链：四处 == 匹配集合化；下发 provider_config.agent_kind 恒盖为会话引擎值；热切换按会话引擎分组扇出。
- 前端：表单引擎多选（openai 格式禁 pi 前置）、列表多徽标、配置条/档案表单过滤口径、api-types 重生成。

## 不在范围内（显式清单）

- 不做存量重复供应商合并/一键清理（D-002，用户手动删）
- 不支持只对部分勾选引擎设默认（D-003 全引擎生效）
- 不做按引擎差异化的模型配置（一条供应商一套配置，注入各取所需）
- 不改 sillyhub-daemon 仓（注入链契约零改动，D-005）
- 不改预设（llmProviderPresets 无 agent_kind 字段，Grill P2-1 核正）

## 成功标准（可验证）

- 存量未编辑供应商行为逐项等价（单元素数组语义不变，迁移测试锁定）
- 一条多引擎供应商（勾 claude+pi）分别被 Claude 会话与 Pi 会话命中，claim payload 的 provider_config.agent_kind 分别为 claude/pi
- 设默认对全部勾选引擎生效且同引擎互斥恒成立（含扩张引擎场景）
- openai_chat 格式勾 pi 被 422 拒绝（前后端双端一致）
- 热切换：多引擎默认行变更后，不同引擎的活跃会话各收到本引擎 config（单引擎场景回归等价）
