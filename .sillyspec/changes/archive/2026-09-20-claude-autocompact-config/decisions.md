---
author: qinyi
created_at: 2026-09-20 17:19:12
---

# 决策记录 — 2026-09-20-claude-autocompact-config

格式：id / status / source / question / answer / normalized_requirement / impacts / evidence。修正走新版本 D-xxx@v2 + supersedes。

---

- id: D-001
- status: accepted
- source: user
- question: autocompact 配置落点（provider 级 vs profile 级 vs 双级）？
- answer: 仅 provider 级（用户 AskUserQuestion 确认推荐项）——落 `llm_providers.settings_config`（既有自由 dict JSON 列，零迁移零协议改动）；profile 级不做（agent_profiles 无 JSON 列需加列迁移，且 autocompact 属模型窗口特性=provider 语义）。
- normalized_requirement: 配置项存 settings_config 顶层；agent_profiles 零改动。
- impacts: [FR-1, task-*]
- evidence: 用户轮次 1（AskUserQuestion 实答）

- id: D-002
- status: accepted
- source: user
- question: 实现方案（settings_config 白名单直达 vs SDK settings 内联）？
- answer: 方案 A 白名单直达（用户 AskUserQuestion 确认）：daemon `claude-settings.ts` TOP_LEVEL_KEYS 加三键 + 前端 provider 表单 claude 分支「引擎自动压缩」区；方案 B（改 lease 协议+driver options 内联）否决——同等能力成本翻倍。
- normalized_requirement: 复用 settings_config→lease 透传→claude-settings 白名单→$CLAUDE_CONFIG_DIR/settings.json 既有管道，零协议/零迁移。
- impacts: [FR-1, FR-2]
- evidence: 用户轮次 2（AskUserQuestion 实答）

- id: D-003
- status: accepted
- source: docs
- question: 可配置项集合与语义依据？
- answer: SDK 0.3.247 Settings 接口可写 autocompact 字段三枚（sdk.d.ts）：`autoCompactWindow`（:7567 压缩窗口，配大于 believed limit→更高水位才触发）/ `autoCompactEnabled`（:5792 开关）/ `precomputeCompactionEnabled`（:5794 后台预计算摘要）；无 threshold 可写项。触发机制：引擎按 resolved window 的默认比例（≈80%，预留压缩调用缓冲）触发，200K×80%=160K 与生产会话 6e213eb3 实测吻合。
- normalized_requirement: 三键全量支持；window 值类型守护（正整数）+ 风险提示（超模型实际窗口会撞硬限报错而非压缩）。
- impacts: [FR-1, FR-3]
- evidence: sdk.d.ts Settings 块（:5398-7880）；生产库 6e213eb3 COMPACT_STATUS 日志时间线
