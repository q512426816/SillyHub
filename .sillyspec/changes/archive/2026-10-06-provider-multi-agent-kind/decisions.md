---
author: qinyi
created_at: 2026-10-06 14:24:12
---

# 决策记录 — 2026-10-06-provider-multi-agent-kind

- **D-001@v1** | type: architecture | source: user
  question: 供应商「支持的 Agent 种类」是否改为多选？
  answer: 改（方案 A 完整多选）。用户明确选择完整多选而非轻量「复制到其它引擎」按钮。
  evidence: 主会话方案选择轮（2026-10-06），用户答「方案 A」。

- **D-002@v1** | type: scope | source: user
  question: 存量重复供应商（同 key 同地址多行）如何处理？
  answer: 仅新数据生效——多选只对新建/编辑生效，现有重复行不动，用户手动清理；不做合并/自动迁移。
  evidence: 需求澄清轮 AskUserQuestion，用户选「仅新数据生效（推荐）」。

- **D-003@v1** | type: architecture | source: user
  question: 多选供应商「设为默认」对哪些引擎生效？
  answer: 全引擎生效——设默认后对其勾选的每个引擎都成为默认（同引擎互斥仍保留，设默认时清所勾各引擎的兄弟默认行）。
  evidence: 需求澄清轮 AskUserQuestion，用户选「全引擎生效（推荐）」。

- **D-004@v1** | type: architecture | source: user
  question: 多选的数据模型？
  answer: 单列改数组——agent_kind 单值列迁移为 agent_kinds JSON 数组列（存量行旧值自动转 [旧值]），读写单源真相；兼容生产 PG + 测试 SQLite。否决双列过渡（双源真相，项目未上线无需兼容）与关联表（枚举集合范式化过度）。
  evidence: 技术方案选择轮 AskUserQuestion，用户选「单列改数组（推荐）」。

- **D-005@v1** | type: design | source: ai
  question: 解析/下发语义如何保持注入链不变？
  answer: 解析链 agent_kind 精确匹配改「集合包含」；下发 provider_config.agent_kind 盖为会话引擎值——daemon 注入器按会话引擎分发的既有契约零改动。pi×openai_chat 禁配从行级改组合级（勾集含 pi 且 api_format=openai_chat 即 422，文案沿用现有）。
  evidence: 代码事实（context.py resolve_bound/default 注入点 + credential-injector getInjector(agent_kind) 分发），AI 自答项（用户已授权方案细节由架构裁定）。

- **D-006@v1** | type: design | source: ai
  question: Grill P1 修正——默认行扩张引擎集合与热切换扇出语义？
  answer: ①is_default=True 行经 update 扩张 agent_kinds 时，同样必须清「新增引擎」的兄弟默认行（互斥不变量按 (user, 引擎) 粒度恒成立，杜绝双默认）；②notify_provider_switch 从单 config 广播改为按目标会话的引擎分组扇出——每个会话收到的 provider_config.agent_kind 恒为该会话引擎值（多引擎默认行对不同引擎会话下发不同 agent_kind 的 config）。
  evidence: Design Grill 首轮 P1-2/P1-3（独立审查子代理 2026-10-06，锚点 provider_switch.py:45-98 / service.py update 路径）。
