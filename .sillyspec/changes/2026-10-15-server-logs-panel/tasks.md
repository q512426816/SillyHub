---
author: qinyi
created_at: 2026-10-15 16:20:00
change: 2026-10-15-server-logs-panel
---
# 任务清单（Tasks）— 2026-10-15-server-logs-panel

<!-- 依据 design.md 文件变更清单与 Wave 编排拆分；实现+单测同卡，无仪式卡（聚焦回归并入 task-04 acceptance） -->

- [ ] task-01: 后端日志落盘——logging.py FileWriter processor（JSON 双写+5MB×3 轮转 rename 链+写失败降级）+ config.py log_dir 派生（repo_root/data/logs）+ test_server_log_filer.py（轮转/双写一致/降级/幂等） (depends_on: -)
  - target_files: backend/app/core/logging.py, backend/app/core/config.py, NEW:backend/tests/test_server_log_filer.py
- [ ] task-02: 后端日志端点——log_reader.py（tail 尾部回读/JSON 解析降级/白名单）+ health/router.py 两端点（GET /api/server-logs + /download，挂 system_status:read）+ test_server_logs_api.py（tail/解析/白名单防遍历/三态鉴权） (depends_on: task-01)
  - target_files: NEW:backend/app/modules/health/log_reader.py, backend/app/modules/health/router.py, NEW:backend/tests/test_server_logs_api.py
- [ ] task-03: 前端数据层与日志组件——health.ts getServerLogs/downloadLogFile（fetch blob 鉴权下载）+ server-log-panel.tsx（行数切换/级别着色/展开原始 JSON/文件选择下载/安全提示/5s 轮询）+ 组件测试 (depends_on: -)
  - target_files: frontend/src/lib/health.ts, NEW:frontend/src/components/server-log-panel.tsx, NEW:frontend/src/components/__tests__/server-log-panel.test.tsx
- [ ] task-04: 页面改造与聚焦回归——page.tsx 删业务统计卡（含 StatCell 组件）+ ServerLogPanel 满宽置底 + page.test.tsx 断言更新（删统计卡断言/日志卡在场）+ 聚焦回归（后端日志测试+前端 admin 域+tsc/eslint） (depends_on: task-02, task-03)
  - target_files: frontend/src/app/(dashboard)/admin/server-status/page.tsx, frontend/src/app/(dashboard)/admin/server-status/__tests__/page.test.tsx
