---
author: qinyi
created_at: 2026-10-16 15:45:12
---
# 任务清单（Tasks）

> Wave 1 后端簇（task-01~04）与 Wave 2 前端簇（task-05~06）文件零交集，可并行；任务卡见 `tasks/task-0N.md`。

## Wave 1：后端——会话族吊销

- [ ] task-01: sessions 表加 family_id 列 + alembic 增量迁移（FR-01，D-001）
- [ ] task-02: service.py 族传递链（_issue_token_pair 加参/refresh 继承族）+ 复用检测改族级吊销 + AuthRefreshReused 文案（FR-01/FR-02，D-001/D-002）
- [ ] task-03: config 宽限窗默认 60→300 + description 同步（FR-03，D-003）
- [ ] task-04: 后端测试——新增族语义用例（族隔离/继承/legacy NULL 兜底/新族）+ 改造 test_refresh_grace_window.py 复用断言（FR-01/FR-02/FR-03）

## Wave 2：前端——5xx 不清会话

- [ ] task-05: token-refresh.ts doRefresh 状态码分流（5xx/408/429 抛 ApiError，4xx 返 null）+ api.ts 契约注释同步（FR-04/FR-05，D-004）
- [ ] task-06: 前端测试——token-refresh.test.ts 增分流用例 + 12 处 ensureFreshAccessToken 调用点抛错容错审计（FR-04/FR-05，R-04）

## 收尾（verify 阶段）

- [ ] task-07: auth-flow.md 同步（族级吊销语义 + grace 300s + TTL 数字纠错 15min/7d→30min/14d）（R-05）
