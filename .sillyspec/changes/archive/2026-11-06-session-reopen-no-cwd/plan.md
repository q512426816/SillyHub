---
plan_level: full
execution_mode: main
author: qinyi
created_at: 2026-11-06 22:55:00
change: 2026-11-06-session-reopen-no-cwd
---

# 实现计划（Plan）— 非工作区会话重开修复

## Wave 1（daemon 先行——发版顺序约束，见全局硬约束）
- task-01

## Wave 2（daemon 回报 + backend 门——文件不相交可并行）
- task-02
- task-03

## Wave 3（backend payload 条件键——与 03 连续执行，共享 lifecycle 同函数链）
- task-04

## Wave 4（backend 落库端点——与 04 共享测试文件故分 Wave 串行）
- task-05

## Wave 5（收口）
- task-06

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | daemon resume cwd 三级同源链 + 三级链测试 | W1 | P0 | — | FR-01, FR-04, D-002@v2 | `_routeSessionResume` record.cwd：payload（非空串）→ sessions.json 快照 → `config.workspace_dir`；含键缺省/null/空串同判空口径用例 |
| task-02 | daemon cwd 回报携带 + 测试 | W1 | P0 | task-01 | FR-03, D-007 | hub-client `notifySessionReady`/`confirmReconnected` 加可选 cwd 参数（不传不发键）；三发送点携带（create :10782 实际运行目录 / recover :9581 record.cwd / confirm :9567） |
| task-03 | backend DS-7 门放宽 + NO_CWD 退役 + 测试改写 | W2 | P0 | task-01 | FR-01, FR-02, D-002@v2, D-004 | 删 session_lifecycle.py:133-139 拒绝块；errors.py 删 `DaemonSessionNoCwd`；agent_session_id 缺仍拒（DaemonSessionNoAgentSession 不动） |
| task-04 | backend SESSION_RESUME payload cwd 条件键 + 测试 | W2 | P0 | task-01, task-03 | FR-01, FR-05, D-002@v2 | lifecycle :296-303 与 sweep.py 恢复路径两处构造：cwd 非空才入键（不发 null）；工作区会话 payload 逐字节不变；与 task-03 共享 lifecycle 同函数链前后段，两卡连续执行（plan 审查 gap 处置） |
| task-05 | backend notify 端点 cwd 落库 + schema + 测试 | W2 | P0 | task-02 | FR-03, D-003, D-007 | confirm（SessionRuntimeRequest 加可选字段）与 ready（可选 body，R-06 形态）端点解析 cwd；非空落库/缺键空串 no-op/覆写以 daemon 为准 |
| task-06 | gen:types 双端生成物 + 聚焦测试收口 | W3 | P0 | task-03, task-04, task-05 | FR-06 | `pnpm gen:types` + `pnpm -C sillyhub-daemon gen:types`，提交 api-types.ts ×2 + openapi.json；backend/daemon 聚焦测试全绿（禁全量） |

## 关键路径
task-01 → task-03/04 → task-06（daemon 三级链是 backend 放行的前提——发版顺序；task-02→task-05 为回报契约线）

## 全局硬约束（从 design.md 逐字抄录，绑定所有 task）
- 发版顺序：**先 daemon、后 backend**（R-02：顺序颠倒时空 cwd 会话明确 failed，无数据损坏）
- 三个新键全部**可选**：缺省/空串 no-op、**不发 null**（SESSION_RESUME payload 对空 cwd 会话省略整键）
- 不新增端点、不删端点、不动 `agent_sessions` 表结构、不动 lease/claim 协议
- cwd 字符串**原样透传不归一化**（与 daemon 侧快照/配置值同源同拼写）
- 禁止跑全量测试（仓规则 0），仅跑与本次改动相关的聚焦测试
- 前向兼容：老 backend 忽略 daemon 新键；老 daemon 对无 cwd 键 payload 得空串走既有失败链
- `DaemonSessionNoCwd` 从代码与 OpenAPI 面退役；同函数既有 FR-daemon-369 lastActiveAt 保留语义**不得改写**

## 全局验收标准
1. 全部聚焦单测通过（backend test_session_reopen 相关 + daemon resume 路由相关）
2. 集成冒烟：存量空 cwd 会话 reopen 链路（放行 → 无 cwd 键 payload → daemon 三级解析 → confirm 回 active）行为闭环——execute 阶段以 daemon/backend 双侧测试合围佐证
3.（brownfield）工作区会话（cwd 非空）行为逐字节不变（task-04 断言 payload 不变 + task-01 第一级命中用例）

## Review Focus 盲区清单（隐含面）
| # | 输入/条件 | 合理人预期行为 | 承接落点 |
|---|---|---|---|
| 1 | SESSION_RESUME payload 带 `cwd: null`（旧 backend 显式 null 而非缺键） | daemon 第一级跳过 null 落快照级，不把 null 当有效值传入 driver | task-01（三级链测试 null 形态用例） |
| 2 | ready 与 confirm 乱序并发（create 后 ready 慢于 reopen 后 confirm 到达） | 两端点幂等写，同值无害；异值以 daemon 最新回报为准，无部分写 | task-05（乱序/并发用例） |
| 3 | workspace_dir 含尾斜杠或 Windows 盘符大小写差异 | cwd 原样透传落库，不做归一化——落库值与 daemon 快照拼写逐字节一致 | task-02 + task-05（断言原样透传） |
| 4 | 工作区会话历史脏数据 root_path 空串（payload cwd=""） | 第一级「非空串」门跳过 → 三级链接管；此类会话原本 resume 必败，现可能救回（良性变化，非静默） | task-01（空串形态用例） |
| 5 | 老 daemon POST 空 body 到 ready 端点（无任何 JSON） | FastAPI 可选 body 得 None，端点零影响 no-op | task-05（空 body 用例） |

## 覆盖矩阵（decisions.md 当前版本）
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-02, task-05 | 回报+兜底两腿各自测试 |
| D-002@v2 | task-01, task-03, task-04 | 三级链用例 + 放行用例 + payload 条件键断言 |
| D-003@v1 | task-05 | 落库语义测试（覆写以 daemon 为准） |
| D-004@v1 | task-03 | 放行口径不按 origin 区分（无来源分支断言） |
| D-005@v1 | task-03, task-05（负向） | 验收含「无 backend 侧 cwd 分配/推导逻辑」 |
| D-006@v1 | task-03（负向） | 验收含「无 origin 分流分支」 |
| D-007@v1 | task-02, task-05 | 捎带键测试（不传不发键） |
| D-008@v1 | task-05（负向） | 验收含「无新端点」（router 装饰器数不变） |
