---
author: flow-machine-draft
created_at: 2026-10-12T00:42:29.656Z
---
# 设计记录（Design Record）— 2026-10-12-ci-guard-diagnosability

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

cc3c022b6 的两条守卫各自有已披露的 fail-closed 边缘：①build-and-save.sh 的 `grep -c '(head)'` 在计数 0 时退出码 1，`set -euo pipefail` 下赋值语句即死——「零条 head」形态在打印 ❌ 引导前静默退出；②test_migration_single_head.py 依赖 alembic.ini 的相对 `script_location=migrations`（alembic 按进程 CWD 解析），CI 用 working-directory=backend 钉住所以绿，本地从仓库根跑必 CommandError。修法：①计数赋值加 `|| true`（grep -c 照样打印 "0"，让既有 `[-ne 1]` 分支接管给全量引导）；②测试显式 `config.set_main_option("script_location", str(backend_root / "migrations"))`（基于 __file__ 的绝对路径，CWD 无关）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- build-and-save.sh：仅零条 head 形态的行为从「静默退出」变「引导后退出 1」（缺陷修复）；多头/单头路径逐字不变。测试文件：断言与文案零变化，仅 Config 构造两行。无 schema/端点变化，`pnpm gen:types` 不需跑。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   不适用：两者都是启动期同步单次检查，无事件流；alembic heads 输出格式按行解析，与到达时序无关。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   不适用：只读检查（alembic heads 不写库）；并行变更同时加迁移正是守卫要拦的形态，守卫本身无写面。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   不适用：进程级一次性校验；失败即退出，无状态残留。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   script_location 锚定本仓 backend/migrations（__file__ 推导），打包机/CI/本地三环境一致；不涉跨仓。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- 风险：`|| true` 把「grep 自身异常退出」与「计数 0」混为一谈——grep 非 0 非正常退出仅有内存/参数错误等病态场景，且计数变量此时为空串 → `[-ne 1]` 整数比较报语法错退出（仍是 fail-closed 有输出），不劣化于现状。
- 放弃方案 A：改用 `grep -c ... | wc -l` 或 awk 计数——多一层管道语义更绕；`|| true` 是 set -e 下容忍「0 计数即非零退出」的标准习语，一行最小改动。
- 放弃方案 B：迁移测试改 shell out `python -m alembic heads` 并断言输出——docstring 明言「走 alembic API 不 shell out（CI/本地环境无差异）」，改 shell 反而引入环境差异；set_main_option 是 alembic API 的正规覆盖通道。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 改 | deploy/scripts/build-and-save.sh | 计数赋值容忍 grep -c 零计数退出码 |
| 改 | backend/tests/test_migration_single_head.py | script_location 显式绝对路径（CWD 无关） |
