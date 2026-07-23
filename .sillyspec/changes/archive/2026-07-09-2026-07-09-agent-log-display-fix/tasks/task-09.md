---
id: task-09
title: cache_creation 按 task-01 实证结果三分支落地
author: qinyi
created_at: 2026-07-09 06:17:11
priority: P1
depends_on: [task-01]
blocks: []
requirement_ids: [FR-07]
decision_ids: [D-004@v2]
expects_from:
  task-01:
    - contract: "cache_creation 恒 0 根因的三处 dump 实证结论（result.usage 原始 JSON / _accumulatedUsage 终值 / assistant 事件 message.usage 是否含 cache_creation_input_tokens）"
      needs: ["分支归属判定：A1 / A2 / B 之一"]
allowed_paths:
  - sillyhub-daemon/src/adapters/stream-json.ts
  - frontend/src/lib/format-token.ts
---

## 目标

依据 task-01 实证结果，从 A1/A2/B 三条根因路径中择一修复 cache_creation_tokens 恒 0 的问题，使 token 面板 cache 维度显示真实值或统一的"—/未知"占位（而非误导性 0）。对应 D-004@v2（supersedes D-004@v1，补 accumulated 漏采第二路径）。

## 实现步骤

据 task-01 实证结论择一分支执行：

### 分支 A1（Claude result.usage 返回 cache_creation_input_tokens 且 accumulated 也采到）
- 根因：daemon 字段映射/聚合层漏读
- 改 `sillyhub-daemon/src/adapters/stream-json.ts` extractResultStats（约 1092-1162，重点 1137-1148 replace/max 聚合处）
- 在 result.usage → usage stats 映射补 `cache_creation_input_tokens` 字段透传

### 分支 A2（result.usage 缺失/为 0 回落 accumulated，而 accumulated 也没采到 cache_creation）
- 根因：assistant 事件 usage_update 采集层漏采 cache 维度
- 改 `sillyhub-daemon/src/adapters/stream-json.ts`：
  - parseAssistant/usage_update 周边（约 548-553）assistant 事件 cache 提取补 cache_creation_input_tokens
  - _currentTurnUsage commit 处（约 678-683）补 cache 维度累加

### 分支 B（Claude 本就不返回 cache_creation_input_tokens，三处 dump 均无）
- 根因：上游不提供
- 改 `frontend/src/lib/format-token.ts`：当 cache_creation 为 0 或 null 时显示"—/未知"占位（消除误导性 0）

## 测试

- A1/A2：daemon vitest，新加 fixture 带或缺失 cache_creation_input_tokens 的 result.usage / assistant 事件 → 断言 extractResultStats 输出真实值（非 0）
- B：frontend vitest，format-token cache_creation=0 / null → 渲染"—/未知"
- 真实 run 端到端：跑一次 Claude run，token 面板 cache 维度非误导性 0

## 验收标准

- AC-07：cache_creation 真实值或"—/未知"占位（据 task-01 实证分支）
- AC-11：全量回归 backend pytest + frontend vitest + daemon vitest 全绿

## 依赖说明

- depends_on task-01：spike 前置实证决定分支归属，实证未出前无法确定改 daemon 还是前端
- expects_from task-01：须产出 A1/A2/B 明确结论 + 三处 dump 原始值记录，作为本 task 选分支的依据
- 风险缓解：若 task-01 结论模糊，按 B 兜底（至少消除"误导性 0"，不阻塞 Wave 3 其余 task）
