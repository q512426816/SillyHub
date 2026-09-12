---
title: 双形态契约坑——external 模式（无根会话）与 parent 链/根会话解析
date: 2026-09-11
status: 活跃（模式级风险守则；已知断裂点已修，防复发归人）
source: 2026-09-10-review-dispatch-platform-fixes 活体回执——external mission worker_done 404（ql-20260911-002，提交 d879ea247）
---

# 双形态契约：external 模式（无根）走不走得通？

> 一句话守则：**凡是按「parent 链爬根会话」「mission.session_id 找 mission」或
> 「会话树枚举分身」写的解析/治理逻辑，动手前必须问一句：external 形态
> （无根、无主控）走不走得通？走不通就补第二解析路径（run 归属回退）或
> 显式守卫（session_id is not None / first-run 锚），并配 external 形态测试。**

## 踩坑实录（2026-09-10/11 活体）

review-dispatch 经 MCP gateway 以 `orchestration_mode="external"` 派发的
read_only PI worker 正常完成（分支产物已 commit、`output_redacted` 503 字符），
但 `get_worker_result` 的 artifacts 恒空。证据链：

- daemon 侧代报已正确发出：backend 访问日志 `POST /api/missions/worker_done → 404`；
- 根因：`resolve_mission_for_session` 沿 `parent_session_id` 链爬根（external
  worker parent=NULL，爬到自身）按 `mission.session_id` 匹配（external=NULL）
  必 miss → 404；即便解析过，`mission_worker_sessions_tree` 对 external 恒
  `[]` 还会再 422（非分身成员）。

## 两种形态的数据形状

| | session/team 模式 | external 模式 |
|---|---|---|
| 主控会话 | 有（mission.session_id 指向它） | **无（NULL）** |
| worker 会话 parent | 指向主控/上层分身 | **NULL** |
| 会话树枚举 | 全树分身 | **恒空 []** |
| 分身归属锚 | 树成员资格 | **只剩首 run 双标记（mission_id + agent_session_id + role）** |

## 修复口径（已落地，供同类问题照抄）

1. **修在共享解析器源头**：`resolve_mission_for_session`（backend/app/modules/agent/model.py）
   爬根 miss 后按 **run 归属回退**（`_mission_from_session_runs`：会话下最早带
   mission_id 的 run 反查，active/terminal 双形态；普通会话无 mission run 仍
   None，404 语义不放宽）——一处修复，15+ 个调用端点（report_progress /
   mission_status / worker_done / 治理门等）同时受益。
2. **成员资格换锚**：`_worker_done_core` 对 external 以**首 run 锚**代替空树
   （session 模式树 422 判定序原样，主控根调用仍 422——存量语义有测试锁定）。
3. **唤醒/通知天然守卫**：`mission.session_id is not None` 已有的分支即 external
   的优雅跳过位，新写通知类逻辑沿用该守卫。

## 已核对的安全点（2026-09-11 审计，写新代码前可对照）

- `mission.py mission_derive_status` / `mission_worker_sessions`：树空 → 显式
  「存量 external 形态」分支回落 run 口径（设计时已考虑）；
- `control.py` 治理门 `_split_worker_forms`：sessions 空集 → 全量回落存量 run
  口径（注释明示）；
- `patrol.py`：多处显式 external 分支（「存量 external 保持原主 run 判定链路」）；
- `mission_context.py` 主控简报：external 无主控不可达；external converge 被
  `constraints.orchestration_mode == "external"` 短路（test_mission_external_mode
  AC-05 锁定）；
- `notify_orchestrator_workers_done`：调用侧 `session_id is not None` 守卫。

## 守护测试锚点

- `backend/app/modules/agent/tests/test_mission_external_mode.py`（AC-04/05）：
  external 建仓/converge 短路；
- `backend/app/modules/agent/tests/test_worker_subsession_done.py::TestExternalModeWorkerDone`
  （ql-20260911-002）：external worker_done 200+artifact+零唤醒 / 终态 409 / 无归属 404。
- **待补（建议）**：report_progress / mission_status 的 external 形态冒烟用例
  （走 resolve 的端点已被源头修复覆盖，测试是防回归锚）。

## 巡检注记（2026-09-12 定时扫描）

- 已知断裂点修复已验证在 main（d879ea247：resolve_mission_for_session run 归属回退 + external 首 run 锚成员资格，守护测试锚点齐）；本文件定位为「双形态契约守则」参考文档，长期有效。
- 待补建议（report_progress / mission_status 的 external 冒烟用例）属防回归增强，留属主/后续认领；守则本身随每次新写解析/治理逻辑复用。保持活跃（守则文档属性，不随单点修复归档）。
