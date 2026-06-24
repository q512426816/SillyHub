---
author: qinyi
created_at: 2026-06-24 10:35:00
change: 2026-06-24-runtime-usage-stats
---

# Proposal

## 动机

运行时列表卡片当前只显示会话数,看不到该 runtime 的 LLM 实际消耗。用户需要在卡片上一眼看到输入/输出/缓存词元 + 总费用,并按时间(当日/7天/30天)看趋势,以做用量洞察与成本把控。

## 关键问题(现有方案不够)

1. **数据已落库但无聚合查询**:`agent_runs` 已有 `input_tokens`/`output_tokens`/`total_cost_usd`,但 `RuntimeService` 无任何 stats 方法,无法按 runtime + 时间窗汇总,前端拿不到聚合数据。
2. **cache 未采集**:Claude(`stream-json.ts`)、codex(`codex-app-server-driver.ts`)两个主力 runtime 只取 input/output,没采 cache(Claude 多轮对话里 cache 是 token 大头);DB 无 cache 列;仅 `ndjson.ts`(opencode 等)有 cache。
3. **前端无 token/cost 展示与折线图**:`RuntimeCard` 只有会话数;echarts 已引入但只有 bar/pie,无 line chart。

## 变更范围

- daemon cache 采集层补齐(Claude stream-json / codex driver / ndjson 确认)
- 后端:migration 加 cache 列 + service 解析 cache + 批量聚合接口(`LEFT JOIN` + `COALESCE` 去重)
- 前端:卡片 sparkline(输入/输出双线)+ 4 数字 + 顶部时间窗切换器

## 不在范围内(显式清单)

- 不做全局实时刷新(SSE 推卡片聚合)——进页面 + 切窗拉取即可(YAGNI)
- 不做费用币种换算(按数据原值 USD 显示)
- 不做多 runtime 合并的全局总览图(用户选「卡片内迷你图」)
- 不改 lease / session / agent_run 生命周期状态机(只读统计)

## 成功标准(可验证)

- 卡片显示输入/输出/缓存/费用 4 个数字 + sparkline 折线。
- 时间窗(当日/7天/30天)切换,数字与折线同步变化。
- 聚合不重复计算(interactive run 只算一次,`LEFT JOIN`+`COALESCE`,见 D-003@v2)。
- Claude runtime 缓存有数据(R-01 CLI 透传前提下);codex 缓存显示「—」。
- 新字段 nullable,老 daemon 不传 cache 不报错,聚合 `SUM` 忽略 NULL。
- 跨平台(windows/macos)无特殊处理。
