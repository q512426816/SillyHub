---
author: flow-machine-draft
created_at: 2026-10-26T15:08:59.742Z
---
# 任务注册表（Tasks）— 2026-10-26-ci-red-to-green

- [x] task-01: e2e-ci.yml PG service 镜像 postgres:16-alpine→pgvector/pgvector:pg16（验证：yml diff 仅 image 行变更，与 deploy/docker-compose.yml 镜像口径一致）
- [x] task-02: daemon.ts reportTurnPhase 与 onTurnMessage 桥拦截分支同步异常加固（try/catch 吞噬+观测日志，验证：spec-sync B1 单测——mock client 缺 notifyTurnPhase 时 create 链走通）
- [x] task-03: daemon 测试夹具修复——task-lifecycle 两处过滤断言排除 turn_phase_report；spec-sync mock 工厂 importOriginal 兜底+client mock 补 notifyTurnPhase（验证：三文件 66 用例本地全绿）
- [ ] task-04: frontend 5 个 CI 失败文件根因定位（CI 同条件复刻跑结论）与修复（验证：复刻跑全绿且零删断言）
- [x] task-05: backend-ci 失败判定与修复——非挂死非撞顶：Pytest 实跑 40:55 后 1 例真实断言失败（test_http_heartbeat_accepts_and_clears_sillyspec_status 期望键集缺 thin_flows，c326a4b2b DTO 增字段漏更）——测试对账更新（run 40341250526 终态 failure 留痕）
- [ ] task-06: 全量回归——daemon vitest 全量 + frontend 触及面全量（验证：零新增失败）
- [x] task-07: backend heartbeat 测试键集对账 thin_flows（验证：uv run pytest test_machine_sillyspec.py 39 passed）
