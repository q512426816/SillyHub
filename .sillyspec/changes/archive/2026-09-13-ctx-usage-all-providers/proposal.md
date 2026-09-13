---
author: qinyi
created_at: 2026-09-13 00:53:34
---
# 提案书（Proposal）

## 动机

会话页的上下文用量环目前只有 Claude 会话显示真实百分比，codex / pi / cursor 会话显示未知态「—」。用户明确要求：所有 agent 都要接入，且必须走统一抽象（复用 2026-09-11-provider-adapter-registry 的防遗漏机制），避免未来接新引擎时再漏掉这类功能。

## 关键问题

1. **功能缺口**：codex / pi / cursor 三个解析器都产出四维 token 数据（input/output/cache_read/cache_creation），但都不派生上下文窗口分子 `ctx_tokens`（最近一次调用的提示词大小）——数据都在，只差最后一步派生，环因此永远未知态。
2. **防遗漏机制缺位**：usage 五字段短名契约（含 ctx_tokens）和 `AgentEventUsage.ctx_tokens` 可选键早已存在，但三个旧引擎是契约定稿前接入的，被祖父豁免从未回填；ProviderCaps 能力矩阵没有 ctx 用量这一键，新引擎漏派生不会被任何编译/测试机制拦截。
3. **历史教训**：2026-08-27-session-token-usage-fix 已实证「轮累计 input ≠ 上下文大小」（一轮 66 次调用 Σ=1,092,740，环永远封顶 100%），派生必须在源头上报处按单调用口径做——这也决定了本提案的派生位置设计。

## 变更范围

- daemon：pi-events / cursor-events / codex driver 三解析器在 usage 构造点派生 ctx_tokens（pi/cursor 净值三和、codex `last.inputTokens` 毛值直取）；派生公式抽共享 helper（claude 同步改引用，口径单源）。
- caps：ProviderCaps 第 11 键 `ctx_usage`（四引擎 true）+ gen-provider-caps.mjs 三端生成 + 双守护测试同步。
- frontend：CtxUsageBar 按 caps 门控环渲染（false 只渲染额度胶囊；当前四引擎全 true 界面零变化）。
- docs：agent-provider-onboarding.md usage 契约节补两种派生口径说明。
- 验证：codex `last` 字段真机验证（唯一未实证点）+ pi 语义真机复核。

## 不在范围内（显式清单）

- 不改 Claude 既有派生口径与 main 桶限定（NG-01）
- 不做后端聚合列 / 历史数据迁移（NG-02，历史 run NULL 保持未知态）
- gemini 不在范围——非 interactive 引擎，未来接入时 satisfies 强制其声明（NG-03）
- 不动 budget / 会话累计台账 / _liftSessionUsage replace 语义（NG-04）
- 不改环组件视觉 / 阈值 / 分母四级链（NG-05）
- 不接入批量层 protocol adapter（NG-06）

## 成功标准（可验证）

- pi / cursor / codex 真机会话环显示真实百分比（fixture 断言 + 真机冒烟）
- ProviderCaps 三端生成产物含 ctx_usage 键，双守护测试绿；人为抽走键 → 编译红/测试红（防遗漏实证）
- 前端 caps=false 不渲染环、true/null 照常（vitest 断言）
- 既有链路零回归：claude 测试全绿、旧 daemon/历史数据行为不变、REST DTO 零变化
