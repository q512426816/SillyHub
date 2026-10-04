---
author: flow-machine-draft
created_at: 2026-10-04T14:02:30.624Z
---
# 提案书（Proposal）— 2026-10-04-takeover-tier3-agent-cwd-fallback

## 动机
<!-- MACHINE-DRAFT:proposal-motivation:6b60f9630aadcf5cb736be1f03d2a4625eb44a46f4244e164c8521a6eb9a1852:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-04-takeover-tier3-agent-cwd-fallback 留痕重锚 -->
任务原话转写：动机：tool_report 会话接手（takeover）tier3 读会话行 cwd 做 allowed_roots 匹配，但 platform_sync 建桶/刷新从不写会话行 cwd，旧 CLI（无 machine 块）上报的存量会话四级匹配全落空 409——协议文档 docs/platform-agent-log-protocol.md §4 明确 tier3 应按 entry 级 agent_cwd ∈ allowed_roots 匹配；线上实例：会话 7ea5177a（harness=zcode，agent_cwd=C:/Users/qinyi/IdeaProjects/multi-agent-platform，本机 daemon 在线且白名单覆盖）无法继续对话。
成功标准：
- resolve_takeover_machine 在会话行 cwd 为空时，取该会话最新 platform_agent_logs 条目的 agent_cwd（主日志优先，缺省任一条目）参与 tier3 匹配
- 真实形态（会话行 cwd 为空、entry 带 agent_cwd、单机白名单覆盖）下 tier3 唯一命中在线机器并完成接手
- 会话行与 entry 均无 cwd 时维持原 409 文案与行为（回归不变）
- 新增回退路径有单测覆盖，daemon 模块现有 takeover 测试全绿
<!-- MACHINE-DRAFT:proposal-motivation:end -->

<!--AGENT:槽1 动机例外裁决——例外裁决书写面（机器段之外合法） -->

## 变更范围
<!-- MACHINE-DRAFT:proposal-scope:c5fa9bef1485889abbaaa8042825c43c2f45b7311006dab565ed9dc4ac87cd4b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-04-takeover-tier3-agent-cwd-fallback 留痕重锚 -->
按成功标准机械推导，共 4 条验收面：
1. resolve_takeover_machine 在会话行 cwd 为空时，取该会话最新 platform_agent_logs 条目的 agent_cwd（主日志优先，缺省任一条目）参与 tier3 匹配
2. 真实形态（会话行 cwd 为空、entry 带 agent_cwd、单机白名单覆盖）下 tier3 唯一命中在线机器并完成接手
3. 会话行与 entry 均无 cwd 时维持原 409 文案与行为（回归不变）
4. 新增回退路径有单测覆盖，daemon 模块现有 takeover 测试全绿
<!-- MACHINE-DRAFT:proposal-scope:end -->


## 成功标准（可验证）
<!-- MACHINE-DRAFT:proposal-criteria:146ab1ad78365f86d2d4fba548702599864216859d068ac65d399febe8846456:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-04-takeover-tier3-agent-cwd-fallback 留痕重锚 -->
1. resolve_takeover_machine 在会话行 cwd 为空时，取该会话最新 platform_agent_logs 条目的 agent_cwd（主日志优先，缺省任一条目）参与 tier3 匹配
2. 真实形态（会话行 cwd 为空、entry 带 agent_cwd、单机白名单覆盖）下 tier3 唯一命中在线机器并完成接手
3. 会话行与 entry 均无 cwd 时维持原 409 文案与行为（回归不变）
4. 新增回退路径有单测覆盖，daemon 模块现有 takeover 测试全绿
<!-- MACHINE-DRAFT:proposal-criteria:end -->

<!--AGENT:槽2 成功标准例外裁决（增删条目在此书写）——例外裁决书写面（机器段之外合法） -->
