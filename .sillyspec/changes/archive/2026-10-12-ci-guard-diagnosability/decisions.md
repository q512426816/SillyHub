---
author: flow-machine-draft
created_at: 2026-10-12T02:04:03.650Z
---
# 决策记录（Decisions）— 2026-10-12-ci-guard-diagnosability

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：- 风险：`|| true` 把「grep 自身异常退出」与「计数 0」混为一谈——grep 非 0 非正常退出仅有内存/参数错误等病态场景，且计数变量此时为空串 → `[-ne 1]` 整数比较报语法错退出（仍是 fail-closed 有输出），不劣化于现状。 - 放弃方案 A：改用 `grep -c ... | wc -l` 或 awk 计数——多一层管道语义更绕；`|| true` 是 set -e 下容忍「0 计数即非零退出」的标准习语，一行最小改动。 - 放弃方案 B：迁移测试改 shell out `python -m alembic heads` 并断言输出——docstring 明言「走 alembic API 不 shell out（CI/本地环境无差异）」，改 shell 反而引入环境差异；set_main_option 是 alembic API 的正规覆盖通道。
