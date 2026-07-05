---
author: qinyi
created_at: 2026-06-24 10:35:00
change: 2026-06-24-runtime-usage-stats
---

# Tasks

任务列表(名称 + 文件路径 + 覆盖 FR/D),实现细节在 plan 阶段展开。

## Wave 1 · daemon cache 采集层

| ID | 任务 | 文件 | 覆盖 |
|---|---|---|---|
| T-01 | stream-json.ts(Claude)补 cache 采集 | `sillyhub-daemon/src/adapters/stream-json.ts` | FR-02, D-001@v1 |
| T-02 | codex-app-server-driver.ts cache 尽力而为 | `sillyhub-daemon/src/interactive/codex-app-server-driver.ts` | FR-02, D-001@v1 |
| T-03 | ndjson.ts 确认 cache 透传到 TaskResult.usage | `sillyhub-daemon/src/adapters/ndjson.ts` | FR-02, D-001@v1 |

## Wave 2 · 后端数据层

| ID | 任务 | 文件 | 覆盖 |
|---|---|---|---|
| T-04 | migration 加 cache_read/cache_creation_tokens 列 | `backend/migrations/versions/<新>_add_agent_cache_token_fields.py` | FR-02 |
| T-05 | AgentRun 模型加 cache 两字段 | `backend/app/modules/agent/model.py` | FR-02 |
| T-06 | `_METADATA_FIELDS` 加 cache(batch 路径) | `backend/app/modules/agent/service.py` | FR-02 |
| T-07 | run_sync 解析 cache(interactive 路径) | `backend/app/modules/daemon/run_sync/service.py` | FR-02 |

## Wave 3 · 后端聚合接口(方案 A)

| ID | 任务 | 文件 | 覆盖 |
|---|---|---|---|
| T-08 | `RuntimeService.get_runtimes_usage`(LEFT JOIN+COALESCE) | `backend/app/modules/daemon/runtime/service.py` | FR-03, D-002@v1, D-003@v2, D-004@v1 |
| T-09 | RuntimeUsage* Pydantic schema | `backend/app/modules/daemon/schema.py` | FR-03 |
| T-10 | `GET /api/daemon/runtimes/usage` 端点 | `backend/app/modules/daemon/router.py` | FR-03 |

## Wave 4 · 前端展示

| ID | 任务 | 文件 | 覆盖 |
|---|---|---|---|
| T-11 | `getRuntimesUsage` + 类型 | `frontend/src/lib/daemon.ts` | FR-01, FR-03 |
| T-12 | RuntimeUsageLineChart 组件(echarts line) | `frontend/src/components/charts/RuntimeUsageLineChart.tsx` | FR-04, D-002@v1 |
| T-13 | charts/index.tsx dynamic 导出 + `toLineSeries` | `frontend/src/components/charts/index.tsx`, `frontend/src/lib/ppm/aggregations.ts` | FR-04 |
| T-14 | runtimes 页时间窗切换器 + RuntimeCard 用量区 | `frontend/src/app/(dashboard)/runtimes/page.tsx` | FR-01, FR-04, D-004@v1 |

## Wave 5 · 测试

| ID | 任务 | 文件 | 覆盖 |
|---|---|---|---|
| T-15 | 三子项目单测(daemon cache 提取 / backend 双路径聚合+分组 / frontend 图表渲染+格式化) | 各子项目 tests/ | FR-01~05, R-03 |

> 注:T-08 为本变更正确性核心(聚合去重),plan 阶段优先;R-01(Claude CLI cache 透传)为 execute 首要实测验证项。
