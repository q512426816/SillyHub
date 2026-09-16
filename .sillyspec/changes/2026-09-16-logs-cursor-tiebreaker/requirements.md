---
author: qinyi
created_at: 2026-09-16 00:06:44
generated_by: sillyspec-fourpiece-init
---
# 需求规格（Requirements）

## 角色
| 角色 | 说明 |
|---|---|
| 会话页用户 | 向上滚动加载更早日志的最终受益者（超大批次历史完整可见、无重复块） |
| API 调用方 | 日志端点的既有消费者（旧客户端必须零感知） |

## 功能需求

### FR-01: 同 ts 批次逐页可达
Given 单事务写入 ≥HISTORY_PAGE_SIZE(100) 行同 timestamp 的日志批次
When 前端带 (before, before_id) 复合游标向上翻页
Then 每页返回批内 id 严格更小的行，批内全部行经有限页可达（150 行批两页取尽）

### FR-02: 边界行零重叠
Given 复合游标（before, before_id）
When 请求下一页
Then 返回行集与已加载行集交集为空（(ts,id) 严格小于游标，`<=` 的单行重叠同时消除）

### FR-03: 旧客户端零回归
Given 调用方不传 before_id
When 带 before 请求
Then 过滤行为与现行 `timestamp <= before` 完全一致（回归用例逐字节断言）
And 单独传 before_id 无 before → 422 fail-explicit

### FR-04: 轮序派生零影响
Given 本变更部署后
When 前端 logsToTurns 按 run_id 首见序装配轮次
Then 输入行序仍为 run 块序（ORDER BY 零改动），轮序与现状一致（同 ts 批次翻页跨页拆块的场景除外——该场景现状本就不可达，属修复目标）

## 非功能需求
- 兼容性：before_id 可选参数增量，openapi/gen:types 同步提交（rule 21 不欠类型债）
- 性能：复合过滤只减少进入排序的行数（方向变快），分页测试耗时无显著回退
- 跨端：查询参数/游标处理不涉平台分支

## 决策覆盖矩阵（如存在 decisions.md）
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01, FR-02, FR-03, FR-04 | 方案 A 四项 normalized_requirement 与 FR 一一对应 |
