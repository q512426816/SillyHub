---
author: qinyi
created_at: 2026-09-16 00:06:44
generated_by: sillyspec-fourpiece-init
---
# 提案书（Proposal）

## 动机
会话日志向上翻页游标（before<=）无 id tiebreaker：单事务 ≥100 行（页大小）同 timestamp 批次使游标停摆——重复拉页、React key 撞号、批内前段行永久不可达。2026-09-16 24h 风险审查发现（c318553a6 引入的 <= 放宽暴露了批次不可达问题）。

## 关键问题
- 纯 ts 游标在同 ts 批内无前进自由度：`older[0].timestamp` 同值 → 同页重拉。
- 排序是 run 块序（anchor_ts→ts→id）而非全局 ts 序——不能简单换全局 (ts,id) keyset（前端轮序按 run 首见序派生会漂移）。
- 前端无进度守卫只防死循环，修不了可达性（批内更小 id 行永远翻不到）。

## 变更范围
backend 新增可选 before_id 查询参数 + 块内复合过滤 `(ts<before) OR (ts=before AND id<before_id)`（ORDER BY 零改动、缺省保持现行 <= 语义）；openapi/gen:types 同步；前端游标 (ts,id) 二元组 + pageKey 后缀 + 进度判定二元组化；双端测试。

## 不在范围内（显式清单）
- 不做不透明 cursor token（before 参数形态不变）
- 不改全局排序/logsToTurns 轮序派生
- 不动 after 增量路径与 q 搜索路径
- 不调整 HISTORY_PAGE_SIZE 等容量参数
- 不建前端全量 log-id 去重索引
- 不做 keyset 索引优化（执行计划观察留后续）

## 成功标准（可验证）
- 同 ts 150 行批、页 100：翻两页批内全部行可达且零重叠（backend 测试断言）
- 不传 before_id：行为与现行 <= 逐字节一致（回归用例）
- 单独传 before_id 无 before：422
- 前端 loadEarlierOnce 同 ts 不同 id 判定有进度（跳转循环不误 break）
- gen:types:check 过、双端相关测试全绿
