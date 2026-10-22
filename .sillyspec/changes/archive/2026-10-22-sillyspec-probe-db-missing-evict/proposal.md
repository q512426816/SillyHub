---
author: flow-machine-draft
created_at: 2026-10-22T15:16:34.258Z
---
# 提案书（Proposal）— 2026-10-22-sillyspec-probe-db-missing-evict

## 动机

任务原话转写：已删工作区探针自动淘汰与诊断增强

动机与背景：centos8 daemon 每 10 分钟对 /mnt/e/Java/crrc/qmdp/urgent 跑 sillyspec progress show --json，exit_code=2（envelope code=db_missing：该项目从未初始化进度库）；该工作区在平台已删除，但根仍持久化在 sillyspec-status-roots.json 被反复探测，日志噪音与 sillyspec_status_error 常驻非空。根治：探针对 db_missing 这类「项目侧永久缺库」自动淘汰目标并增强失败诊断。

成功标准：
- progress show 失败且 stdout envelope codes 含 db_missing 时，连续 3 次后该工作区根从采集目标淘汰（回调通知 daemon 删 _sillyspecStatusRoots 并持久化），不再探测、心跳 map 清除该槽位，日志留 evicted 记录
- 非 db_missing 的非零退出保持既有 nonzero_exit 记账不变，且日志附带 stdout 首行便于诊断
- 采集成功重置连败计数；淘汰后若根被重新 claim 注册则恢复采集
- daemon 定向测试全绿，既有采集/降级语义零回归

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. progress show 失败且 stdout envelope codes 含 db_missing 时，连续 3 次后该工作区根从采集目标淘汰（回调通知 daemon 删 _sillyspecStatusRoots 并持久化），不再探测、心跳 map 清除该槽位，日志留 evicted 记录
2. 非 db_missing 的非零退出保持既有 nonzero_exit 记账不变，且日志附带 stdout 首行便于诊断
3. 采集成功重置连败计数；淘汰后若根被重新 claim 注册则恢复采集
4. daemon 定向测试全绿，既有采集/降级语义零回归

## 成功标准（可验证）

1. progress show 失败且 stdout envelope codes 含 db_missing 时，连续 3 次后该工作区根从采集目标淘汰（回调通知 daemon 删 _sillyspecStatusRoots 并持久化），不再探测、心跳 map 清除该槽位，日志留 evicted 记录
2. 非 db_missing 的非零退出保持既有 nonzero_exit 记账不变，且日志附带 stdout 首行便于诊断
3. 采集成功重置连败计数；淘汰后若根被重新 claim 注册则恢复采集
4. daemon 定向测试全绿，既有采集/降级语义零回归
