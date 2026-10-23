---
author: flow-machine-draft
created_at: 2026-10-23T04:09:43.536Z
---
# 决策记录（Decisions）— 2026-10-23-session-dialog-input-align

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：- 最大风险：立即清空后「失败窗口期」用户误以为发送成功。缓解：失败路径既有 errorMsg/notify（不变）且文本自动回填；与 page 模式同一口径。 - 放弃方案 A「只在 dialog 内部给 idle 态加 nonce/重挂载」：宿主已用 key 表达会话切换（`attachSession?.id ?? "live"`），再叠一层 nonce 会与宿主 key 语义重复；改由「idle 不回读草稿」直接消除残留来源，更小改动面。 - 放弃方案 B「dialog 与 page 合并为同一实现」：两模式 2334 行 vs 6163 行、渲染容器/队列 hook/SSE 生命周期不同（dialog 零 react-query、page 挂 react-query），合并属重构级改动，本次不扩面（记为长期项）。 - 放弃方案 C「失败恢复用 setInput(prompt) 无条件覆盖」：会吞掉用户在失败窗口期新输入的内容；与本仓 `handleInterrupt` 回退、page 版「仅空时回填」口径冲突。 - 明确边界（可接受）：`handleResend`（时间线失败卡「重新发送」）不走输入框语义，失败不把该轮 prompt 回填输入框——用户未在输入框输入该文本，回填属越权写；保持现状。 - 明确边界（可接受）：`cancelSched`/定时发送相关路径清空语义不变（`confirmSchedCreate` 保留原 trim 比对清空），定时创建成功不属「发送受理」，不回填。
