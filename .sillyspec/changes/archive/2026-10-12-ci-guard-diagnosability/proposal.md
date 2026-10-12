---
author: flow-machine-draft
created_at: 2026-10-12T02:00:40.987Z
---
# 提案书（Proposal）— 2026-10-12-ci-guard-diagnosability

## 动机

任务原话转写：动机：24h 风险审查两条已披露 fail-closed 边缘路径的可诊断性清偿（cc3c022b6 评审记录自披露、零生产风险但误导排障）：①deploy/scripts/build-and-save.sh:39 在 set -euo pipefail 下 grep -c 输出 0 时退出码 1，「零条 head」（versions 目录被清空等异常形态）会在打印引导信息之前静默 exit 1；②backend/tests/test_migration_single_head.py 用 alembic.ini 的相对 script_location=migrations（按进程 CWD 解析），从仓库根跑该测试直接 CommandError: Path doesn't exist 而非给出设计的多头提示（CI 已用 working-directory 钉住所以绿，本地从根跑必红）。
成功标准：
- build-and-save.sh 零条 head 不再静默退出：grep -c 的非零退出被容忍（|| true），计数 0 走既有 [-ne 1] 分支打印 alembic heads 全文与解法引导后退出 1；多头路径行为逐字不变
- test_migration_single_head.py 对 CWD 不敏感：Config 显式 set_main_option script_location 为 backend_root/migrations 绝对路径，从仓库根与从 backend/ 两处跑均绿且多头时给出设计的中文提示（bash -n 校验脚本语法）
- 仅跑本改动相关测试（规则 0）：pytest 该测试文件（backend/ 与仓库根两处 CWD 各跑一次）+ bash -n 脚本语法校验 + grep 计数模拟

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. build-and-save.sh 零条 head 不再静默退出：grep -c 的非零退出被容忍（|| true），计数 0 走既有 [-ne 1] 分支打印 alembic heads 全文与解法引导后退出 1；多头路径行为逐字不变
2. test_migration_single_head.py 对 CWD 不敏感：Config 显式 set_main_option script_location 为 backend_root/migrations 绝对路径，从仓库根与从 backend/ 两处跑均绿且多头时给出设计的中文提示（bash -n 校验脚本语法）
3. 仅跑本改动相关测试（规则 0）：pytest 该测试文件（backend/ 与仓库根两处 CWD 各跑一次）+ bash -n 脚本语法校验 + grep 计数模拟

## 成功标准（可验证）

1. build-and-save.sh 零条 head 不再静默退出：grep -c 的非零退出被容忍（|| true），计数 0 走既有 [-ne 1] 分支打印 alembic heads 全文与解法引导后退出 1；多头路径行为逐字不变
2. test_migration_single_head.py 对 CWD 不敏感：Config 显式 set_main_option script_location 为 backend_root/migrations 绝对路径，从仓库根与从 backend/ 两处跑均绿且多头时给出设计的中文提示（bash -n 校验脚本语法）
3. 仅跑本改动相关测试（规则 0）：pytest 该测试文件（backend/ 与仓库根两处 CWD 各跑一次）+ bash -n 脚本语法校验 + grep 计数模拟
