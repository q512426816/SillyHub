---
plan_level: full
---

# 实现计划（Plan）

author: qinyi
created_at: 2026-08-29 02:55:00

## Wave 1 — 无依赖起步（并行）

- task-01
- task-09

## Wave 2 — backend 契约（依赖 task-01）

- task-02

## Wave 3 — 落库与 daemon 上报（依赖 task-01/02；各 task 文件互不冲突）

- task-03
- task-04
- task-05
- task-06
- task-07

## Wave 4 — 测试补齐与前端级联（依赖 Wave 3 产出；各 task 文件互不冲突）

- task-08
- task-10
- task-11
- task-12

## Wave 5 — 全链路自测（依赖 task-01..12）

- task-13

## Wave 6 — 文档收尾（依赖 task-13）

- task-14

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | agent_run_model_usage ORM + alembic 迁移 | W1 | P0 | — | FR-01-1 | head 接 6756e634f119 |
| task-02 | schema 扩展（InteractiveRunResultRequest model_usage/api_requests；RuntimeUsageRead.by_provider）+ gen:types | W2 | P0 | task-01 | FR-01-3, FR-04-1, NFR-03 | 契约先行，W2/W3 消费 |
| task-03 | close_interactive_run 明细落库 + run 列填充（llm_provider_id 仅空时，R-08） | W3 | P0 | task-01,02 | FR-01-2/3 | best-effort 兜底 |
| task-04 | complete_lease batch 明细落库 + run 列填充 | W3 | P0 | task-01,02 | FR-01-2/4 | |
| task-05 | get_runtimes_usage by_provider 查询 | W3 | P0 | task-01,02 | FR-04-1/3, NFR-02 | COALESCE 模式沿用 |
| task-06 | daemon interactive 明细行 + assistant 计数 + payload | W3 | P0 | task-02 | FR-01-3, FR-02-1 | _modelUsageRows 拆分 |
| task-07 | daemon batch model/message_start 计数 + hub-client 透传 | W3 | P0 | task-02 | FR-01-4, FR-02-2 | adapter 计数 reset 清零 |
| task-08 | daemon 测试（bridge/stats-passthrough/stream-json） | W4 | P0 | task-06,07 | FR-01/02 | |
| task-09 | session-config-bar 四块→两块 | W1 | P0 | — | FR-03-1 | 删机器/智能体块+无用 hook |
| task-10 | 供应商+模型级联 + injectSession(model)（含 provisional/Codex 锁定） | W4 | P0 | task-09 | FR-03-2/3/5, D-002 | 候选去重保序 |
| task-11 | backend inject_session 扩 model + 兜底模型快照同步（R-07） | W4 | P0 | task-02 | FR-03-3/4 | 422 守卫：model 需供应商 |
| task-12 | runtime-card by_provider 分组明细 + 口径 footnote | W4 | P1 | task-02,05 | FR-04-2, FR-02-3, NFR-04 | mock 补 by_provider |
| task-13 | 全链路自测（真实会话明细=run 四维；切模型 env 生效；用量卡窗口） | W5 | P0 | task-01..12 | 验收口径 | R-07 真实切换用例 |
| task-14 | 模块文档变更索引 + QUICKLOG 引用 | W6 | P1 | task-13 | — | |

## 关键路径

task-01 → task-02 → task-03 → task-06 → task-13（backend 契约→落库→daemon 上报→全链路自测，决定最短交付周期）

## 全局验收标准

1. 相关模块单测全绿（backend daemon/agent/runtime + daemon 三个测试文件 + frontend 涉及组件），mypy/ruff/tsc 净
2. 真实会话（含子代理）跑一轮：明细行四维总和 == run 四维；api_requests ≥ assistant 消息数
3. 会话页切供应商+模型后发起对话，daemon 收到 ANTHROPIC_MODEL=所选模型（含配置了兜底模型的供应商，R-07）
4. runtimes 用量卡出现 by_provider 分组明细，1d/7d/30d 窗口数值随动；summary/daily 原值零回归
5. 老 daemon / 老数据：明细无行、requests NULL、分组归「未记录」，close 正常不阻塞
6. gen:types 产物（api-types.ts + openapi.json）随 schema 改动同提交

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01~05, 12 | 明细表 + by_provider 分组 |
| D-002@v1 | task-10 | 级联候选 = 供应商高级设置体系 |
| D-003@v1 | task-05, 12 | 用量卡扩展不建新页 |
| D-004@v1 | task-09 | 四块→两块，pre-session 不动 |
| FR-01 | task-01~04, 06, 07 | 明细落库全链路 |
| FR-02 | task-06, 07, 12 | 计数与口径标注 |
| FR-03 | task-09, 10, 11 | 级联与切换链路 |
| FR-04 | task-05, 12 | 分组展示 |
| R-07/R-08 | task-03, 11, 13 | Grill 修订两项的落地验证 |
