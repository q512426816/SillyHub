---
author: qinyi
created_at: 2026-09-13T00:10:00
plan_level: full
---

# 实现计划（Plan）— 会话直播展示保真五修复

## Spike 前置验证

无需 Spike——根因诊断已闭环（生产 DB 证据 + 源码链路核对 + 独立审查双 pass），无技术不确定性。

## Wave 1（并行，无依赖）— 三端独立修复

- task-01
- task-03
- task-04
- task-05
- task-06

## Wave 2（依赖 Wave 1）— 前端装配收编（与 task-01 同文件，串行）

- task-02

## Wave 3（依赖 Wave 1-2 全部）— 验证

- task-07

## Wave 4（依赖 Wave 3）— 部署

- task-08

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | revokePartialSegments 全树扫描撤回 | W1 | P0 | — | FR-1.1, D-001@v1 | 删前缀特判，全树 DFS 按 derivesFromSegmentId 移除（含嵌套） |
| task-02 | dropPrefixPartialReply 全桶收编 + F7 cell 失效 | W2 | P0 | task-01 | FR-1.2, FR-1.3, D-001@v1 | 全桶前缀扫描移除 + seal；移除即失效 F7 cell（细节见 design §R1.2） |
| task-03 | 运行中轮计时锚点优先 run 快照 | W1 | P1 | — | FR-4.1, FR-4.2 | enrichOne 活跃态强制取快照（细节见 design §R4） |
| task-04 | extractCode 原因短语锚定 + 静默断流文案 | W1 | P0 | — | FR-2.1~2.3, D-003@v1 | 裸数字分支替换为原因短语锚定；truncation 签名文案覆写（细节见 design §R2） |
| task-05 | 纯切换轮跳过 user_input/turn_count | W1 | P0 | — | FR-3.1~3.4, D-002@v1 | 复用 silent_config_switch 收口三处判定 |
| task-06 | chain-limit 停跑补 hint + 标记 | W1 | P1 | — | FR-5.1, FR-5.2, D-004@v1 | error_detail.hint 覆写 + auto_resume_stopped，type/code/raw 不动 |
| task-07 | 三端相关面测试 + lint/typecheck 全绿 | W3 | P0 | task-01~06 | 全 FR | 三端相关面（禁全量，规则 0） |
| task-08 | 部署验证（镜像 + daemon bundle + 生产实测） | W4 | P0 | task-07 | 全 FR | integration-critical 集成证据：直播无碎片、失败卡文案、切换轮计数 |

## 关键路径

task-01 → task-02 → task-07 → task-08（前端装配链最长；W2/W3 与 W1 并行）

## 全局验收标准

1. 三端相关面测试全绿（frontend vitest 装配器/page-helpers 面、daemon model-error 面、backend daemon session 面）+ 各端 lint/typecheck 通过。
2. 集成冒烟（integration-critical）：部署后生产会话实测——pi 引擎直播轮刷新前后渲染等价（无前缀碎片气泡）；失败卡显示「上游输出流中断」无伪 code；切换供应商不产生空 user_input 行且轮次计数不变；运行中轮 elapsed 与真实时长一致。
3. brownfield 零回归：普通轮/带消息切换轮/Claude main: 前缀撤回/401/502 出码等既有断言不变。

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01, task-02 | AC-2（直播刷新等价） |
| D-002@v1 | task-05 | AC-2（切换轮计数不变）+ AC-3 |
| D-003@v1 | task-04 | AC-2（失败卡无伪 code）+ AC-3 |
| D-004@v1 | task-06 | AC-2（链上限提示） |

| FR | 覆盖任务 |
|---|---|
| FR-1.1 | task-01 |
| FR-1.2 / FR-1.3 | task-02 |
| FR-1.4 | task-01 + task-02（集成用例） |
| FR-2.1~2.3 | task-04 |
| FR-3.1~3.4 | task-05 |
| FR-4.1 / FR-4.2 | task-03 |
| FR-5.1 / FR-5.2 | task-06 |
