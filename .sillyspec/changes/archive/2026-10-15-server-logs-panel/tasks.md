---
author: qinyi
created_at: 2026-10-15 16:20:00
change: 2026-10-15-server-logs-panel
---
# 任务清单（Tasks）— 2026-10-15-server-logs-panel

<!-- 依据 design.md 文件变更清单与 Wave 编排拆分；实现+单测同卡，无仪式卡（聚焦回归并入 task-04 acceptance） -->

- [x] task-01: 后端日志落盘——logging.py FileWriter processor（同 JSONRenderer 实例双写+per-write 句柄+5MB×3 轮转 rename 链+写失败降级）+ config.py log_dir + paths.py resolve_log_dir 派生 + test_server_log_filer.py（轮转/双写逐字一致/降级/幂等/句柄无残留） (depends_on: -)
  - target_files: backend/app/core/logging.py, backend/app/core/config.py, backend/app/core/paths.py, NEW:backend/tests/test_server_log_filer.py
- [x] task-02: 后端日志端点——log_reader.py（读取/JSON 解析降级/白名单）+ health/router.py 两端点（GET /api/server-logs + /download，挂 system_status:read）+ test_server_logs_api.py（tail/解析/白名单防遍历/三态鉴权）+ 契约同步 gen:types 双端（openapi.json/frontend+daemon api-types，规则 21+闸门⑨） (depends_on: task-01)
  - target_files: NEW:backend/app/modules/health/log_reader.py, backend/app/modules/health/router.py, backend/openapi.json, frontend/src/lib/api-types.ts, sillyhub-daemon/src/api-types.ts, NEW:backend/tests/test_server_logs_api.py
- [x] task-03: 前端数据层与日志组件——health.ts getServerLogs（类型引用生成物）/downloadLogFile（fetch blob 鉴权下载）+ server-log-panel.tsx（行数切换/级别着色/展开原始 JSON/文件选择下载/安全提示/5s 轮询）+ 组件测试 (depends_on: task-02)
  - target_files: frontend/src/lib/health.ts, NEW:frontend/src/components/server-log-panel.tsx, NEW:frontend/src/components/__tests__/server-log-panel.test.tsx
- [x] task-04: 页面改造与聚焦回归——page.tsx 删业务统计卡（含 StatCell 组件；页头注释同步）+ ServerLogPanel 满宽置底 + 副标题文案更新 + page.test.tsx 断言更新（**全用例扫描**：128 四值断言出现在 3 个用例、stat-grid 相关全部改日志卡在场断言；文件头注释同步）+ 聚焦回归（后端三测试含 test_health 非回归+前端 admin 域+tsc/eslint） (depends_on: task-03)
  - target_files: frontend/src/app/(dashboard)/admin/server-status/page.tsx, frontend/src/app/(dashboard)/admin/server-status/__tests__/page.test.tsx
