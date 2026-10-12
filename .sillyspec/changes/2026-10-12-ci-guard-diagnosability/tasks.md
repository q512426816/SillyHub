---
author: flow-machine-draft
created_at: 2026-10-12T02:00:40.987Z
---
# 任务注册表（Tasks）— 2026-10-12-ci-guard-diagnosability

- [x] task-01: build-and-save.sh 零条 head 不再静默退出：grep -c 的非零退出被容忍（|| true），计数 0 走既有 [-ne 1] 分支打印 alembic heads 全文与解法引导后退出 1；多头路径行为逐字不变
- [x] task-02: test_migration_single_head.py 对 CWD 不敏感：Config 显式 set_main_option script_location 为 backend_root/migrations 绝对路径，从仓库根与从 backend/ 两处跑均绿且多头时给出设计的中文提示（bash -n 校验脚本语法）
- [x] task-03: 仅跑本改动相关测试（规则 0）：pytest 该测试文件（backend/ 与仓库根两处 CWD 各跑一次）+ bash -n 脚本语法校验 + grep 计数模拟
