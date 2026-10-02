---
author: qinyi
created_at: 2026-10-02
---
# 提案书（Proposal）

## 动机

本地 CLI（ZCode / Claude Code 等）直接本地跑 sillyspec 命令的会话已上报平台：日志元信息落 `platform_agent_logs`、自动建会话行并绑定变更——但 **token 用量不落库**，只在会话回放时经 daemon 实时解析展示。结果用户在会话回放页看得到用量，变更中心（2026-08-30-change-center-usage-stats 已交付的用量卡与「执行」列）对这类执行恒为空。数据本身就在本地日志文件里、daemon 已有现成解析器与 RPC 通道，缺的只是落库触发与聚合出口。

## 关键问题

1. **用量不落库**：`platform_agent_logs` 无任何 token 列，回放页每次实时 RPC 解析，变更中心这类批量聚合场景无法消费实时解析结果。
2. **聚合集合不含本地 CLI 会话**：`ChangeUsageQueryService` 只聚 `agent_runs` 双锚点集合（backend/app/modules/change/usage_service.py:130-151），本地 CLI 会话（origin=tool_report）没有 runs，即使绑定了变更也贡献不了用量。
3. **双计风险**：同一会话若既有平台派发 runs 又有本地 CLI 日志快照，两段都 SUM 会重复计数，需要明确二选一口径。

## 变更范围

- 后端存储：`platform_agent_logs` 加 5 列用量快照（四维 token + usage_parsed_at，一次 alembic 迁移，全部 nullable）。
- 后端摄取：上报链路（`POST /api/agent-logs`）落库后 fire-and-forget 异步任务，复用回放 RPC 通道让 daemon 解析日志，覆盖写快照（节流 + 并发限 + 全降级不抛）。
- 后端聚合：`usage_service` 详情/列表/quicklog 各加「本地段」（会话级二选一防双计，`NOT EXISTS agent_runs`），并入「本地 CLI」桶行，totals = Σ by_model 口径守恒。
- 前端展示：用量卡明细表「本地 CLI」绿阶桶行（请求列「—」）+ 注脚口径更新；列表「执行」列数字自动并入（无 UI 结构变化）。

## 不在范围内（显式清单）

- 不做成本（total_cost_usd）展示——解析器无成本输出，现有变更中心口径也不含。
- 不做本地 CLI 按模型明细——解析器 totalUsage 仅四项累计（YAGNI）。
- 不做 daemon 周期推送任务（方案 B 已否决，D-002@v1）；daemon 零改动。
- 不改会话回放页——继续实时解析，不切换快照源。
- 不做历史回填——旧 entry 快照 NULL 显示与现状一致，下次上报自然补齐。
- 不动移动端页面。

## 成功标准（可验证）

- 本地 CLI 跑命令上报后，`platform_agent_logs` 对应 entry 出现非空四维快照（usage_parsed_at 非空）。
- 变更中心（变更 + 快速修复）用量卡与列表摘要包含本地 CLI 会话用量：totals 四维并入、by_model 出现「本地 CLI」桶行、totals = Σ by_model。
- 同会话既有平台派发 runs 又有本地快照时不双计（run 权威，快照不计）。
- 上报响应时延与失败语义不变（摄取异步 best-effort，daemon 离线/超时/解析失败仅记日志）。
- 聚合数字与 DB 手工 SUM 一致（测试覆盖：纯本地、混合双计防护、节流、存量 NULL）。
