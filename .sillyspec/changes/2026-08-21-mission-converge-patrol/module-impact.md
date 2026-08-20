---
author: qinyi
created_at: 2026-08-21 07:35:00
---

# 模块影响分析：mission 收敛巡检

## 影响模块清单

| 模块 | 影响文件 | 变更类型 | 说明 |
|---|---|---|---|
| backend | `backend/app/modules/agent/patrol.py` | 新增 | MissionPatrolService 三职责 + 巡检循环（本变更核心新文件） |
| backend | `backend/app/modules/agent/orchestrator.py` | 修改 | schedule_loop 信号 1 zombie 豁免分支（新 error_code 值触发的纯新增分支） |
| backend | `backend/app/core/config.py` | 修改 | Settings 四项（mission_patrol_*） |
| backend | `backend/app/main.py` | 修改 | lifespan 接线巡检协程（create_task + cancel/gather） |
| backend | `backend/app/modules/agent/tests/test_patrol.py` | 新增 | 巡检单测 |
| backend | `backend/app/modules/agent/tests/test_orchestrator.py` | 修改 | 豁免逻辑用例追加 |
| backend | `backend/app/core/tests/test_patrol_settings.py` | 新增 | 配置默认值/边界单测 |

## 共享/敏感文件回归面

- **orchestrator.py**（被多测试依赖）：豁免分支只对 `error_code == "orchestrator_zombie"`
  生效（全库新引入值，Plan Review 代码级核验既有断言零触发）。调用方
  `run_sync._handle_team_run_completion` 与既有 test_orchestrator / test_advance_team_stage /
  test_team_change_lifecycle 断言不受影响。
- **main.py lifespan**（启动路径）：新增 create_task 为纯追加；enabled=False 时零行为变化。
  conftest 的 client fixture 用 ASGITransport 不触发 lifespan，既有 HTTP 测试不受影响。
- **config.py**：新 Field 纯追加，无既有字段语义变化。

## 模块文档同步点（task-10 落实）

- `.sillyspec/docs/multi-agent-platform/modules/backend.md` MANUAL_NOTES 追加本变更条目。
- `docs/project-team-mission-review-2026-08-21.md` 「登记不做」章节：BE-P1-6 关联的
  "项目维度 mission 收敛兜底接线"条目更新为已落地（指向本变更）。

## 部署影响

- 无 schema/migration（zombie 标记复用 constraints JSON）。
- 新配置项均带默认值，部署即生效；`mission_patrol_enabled=False` 可一键关停回退。
