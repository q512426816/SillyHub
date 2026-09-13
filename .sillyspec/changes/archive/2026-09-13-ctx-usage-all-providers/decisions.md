---
author: qinyi
created_at: 2026-09-13 00:57:27
---

# 决策记录 — 2026-09-13-ctx-usage-all-providers

## D-001@v1：ctx_tokens 派生位置——归一化器源头上报处派生（方案 A），否决消费侧统一派生（方案 B/C）

- type: architecture
- status: confirmed
- source: user
- question: 上下文窗口用量分子（ctx_tokens）在哪个层派生，才能既让 codex/pi/cursor 接入又可统一抽象防新引擎遗漏？
- answer: 用户原话指定方向：「都要接入的，并且需要统一抽象出来（我记得最近刚刚做了个统一抽象的事情，就是怕后面再接新 agent 又遗漏一些功能）」。据此选方案 A（各归一化器在 usage 构造处用共享 helper 派生 + ProviderCaps 第 11 键声明走既有三端生成与守护链）。
- normalized_requirement: ①codex/pi/cursor 三解析器在 usage 构造点派生 ctx_tokens（pi/cursor 净值三和、codex last 毛值直取），复用既有 ctx_tokens 全链路透传；②ProviderCaps 加 ctx_usage 键经 gen-provider-caps.mjs 三端生成 + 双守护测试强制；③派生公式共享 helper 单源；④前端按 caps 门控环渲染。
- impacts: daemon 三解析器 + providers.ts + gen 脚本；frontend provider-caps.ts（生成）+ ctx-usage-bar 门控；backend provider_caps.py（生成）+ alignment 守护测试；docs/agent-provider-onboarding.md。
- evidence: 方案选择轮（brainstorm step 4）+ 设计确认轮（step 5 用户「确认」）。三方案对比：

  | 方案 | 核心思路 | 裁决 | 理由 |
  |---|---|---|---|
  | A：归一化器源头派生 + caps 声明 | pi-events / cursor-events / codex driver 在各自 usage 构造点用共享派生 helper 注入 ctx_tokens；ProviderCaps 加 `ctx_usage` 键经 gen-provider-caps.mjs 三端生成，前端按 caps 门控环渲染 | **采纳** | 唯一满足用户「统一抽象防遗漏」明示诉求且数据形态可行的方案；完全复用 2026-09-11-provider-adapter-registry 的强制机制（satisfies TS2741 + 双守护测试 + 三端生成） |
  | B：session-manager 消费侧统一派生 | lift/上报平铺处统一算 ctx = input + cache_read + cache_creation | 否决 | **数据形态不可行**：codex usage_update 的 input_tokens 是本轮累计（Δ 求和）、claude 轮级 input 同为累计——消费侧拿不到「单次调用」值，统一求和会精确回归 2026-08-27-session-token-usage-fix 修掉的「环永远封顶 100%」缺陷（该变更 design §1 实证：一轮 66 次调用 Σ input=1,092,740） |
  | C：backend 聚合派生 | 从落库 usage 数据反推 ctx | 否决 | 同 B 的累计口径问题；且 claude 差分派生依赖的单调用 cache 快照在落库数据中已丢失，信息论上不可恢复 |

  方案 A 内部的轻量变体「仅共享 helper + 文档、不加 caps 键」（A2）一并否决：防遗漏弱一档（无编译/测试强制，纯文档约定），违背用户明说的「怕再接新 agent 又遗漏」动机；前端也无法区分「引擎不支持」与「数据未到」。
- priority: high
- 锚点: sillyhub-daemon/src/interactive/providers.ts:ProviderCaps（caps 键落点）+ sillyhub-daemon/src/interactive/usage-ctx.ts:ctxTokensFromNetInput（公式单源落点，execute 新建）
- 模块域: sillyhub-daemon, frontend, backend
