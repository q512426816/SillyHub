# 计划：群聊触发链锁窗口优雅降级 + 共识任务行先行提交

- change: 2026-09-12-group-trigger-lock-graceful
- date: 2026-09-12
- author: qinyi
- complexity: standard（2 源文件 + 1 新测试文件；无迁移/无前端/无跨模块 API 变化）
plan_level: full

## 任务拆分（依赖：01→03→04；02→03→04）

| task | 交付 | target_files | 验收核心 |
|---|---|---|---|
| task-01 | 三段式锁语义（无锁快查复用/FOR UPDATE 原样/55P03 超时 rollback 重读复用或 4xx 报忙） | backend/app/modules/daemon/group/service/shadow.py | grep 三段结构；既有 direct/p2 用例不回归 |
| task-02 | 共识任务行 gather 前显式 commit（标量预取防 expire） | backend/app/modules/daemon/group/service/messages.py | 普通路径零变化；consensus 21 用例不回归 |
| task-03 | 三用例（超时→复用/超时→报忙+部分失败收集/任务行存活性） | NEW:backend/app/modules/daemon/tests/test_group_trigger_lock.py | 三用例绿；mock 只注入锁超时事实 |
| task-04 | 208 存量回归 + ruff/mypy + 真实环境并发前后对照 | backend/app/modules/daemon/tests/test_group_trigger_lock.py | 208+新增全绿；真实复验无 500、任务落库、sweeper 收口 |

## 执行顺序

1. task-01 + task-02（源码，worktree 分支 sillyspec/2026-09-12-group-trigger-lock-graceful）
2. task-03（测试，注入真实签名）
3. task-04（回归 + verify_consensus 独立库真实复验，环境沿用 archive/2026-09-10 搭建方式）

## 风险提示（承接 design §7）

- 55P03 判定双口径（类型 + sqlstate），asyncpg 不顶层 import（SQLite 环境防 ImportError）
- commit 前标量预取（ORM expire 既有惯例）
- SQLite 无真锁 → 锁超时 monkeypatch 注入
