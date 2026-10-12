---
author: flow-machine-draft
created_at: 2026-10-12T00:42:29.656Z
---
# 设计记录（Design Record）— 2026-10-12-regression-review-remediation

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

回归复审（三代理对抗审查）对六条防线修复的清偿：①**高优先**——daemon-path-guard 给 linked_repos 两 RPC 加的机器白名单守卫与 ql-20260831-006 产品决策冲突（用户决策明确「工作区绑定会话的默认工作目录就在工作区内，机器白名单不该拦截它」，仓内生产实证 E:\sgm/F:\WorkNew 两处工作区根均不在家目录白名单；会话 cwd 守卫 interactive-cwd-guard 为此专门跳过白名单、错机保护走存在性检查），现网存量部署会被首次 forbidden 拒止。修法：两 handler 白名单门改存在性检查（stat 非目录/不存在即抛错），与 interactive-cwd-guard 同一信任语义；②handleInitLease 头部 throw 穿透 _runInitLease 的「逐步 catch 不上抛」契约 → 改 ok:false 结果体（保 init 统计诊断链），pullSpecBundle 抛错不动（三处调用方均 catch 可见）；③注释勘误：NaN 污染窗口实为 1 轮（set 随即覆写，非「恒 NaN」）、pi 延迟探测补多轮收敛 caveat（workers 行按首 run id 锚定，追问轮 runId 恒 miss——ql-20260911-028 既有行为非本窗口引入）、borrow JSDoc 去具体计数；④num_turns/duration_ms 裸 typeof 叠 isFinite 对齐口径（NaN 单轮字段 NULL 面消除）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- linked_repos_sync/snapshot：错误形态从「白名单越界 forbidden」变「不存在/非目录 plain Error」；白名单外但存在的合法工作区从「被拒」恢复为「放行」（回归修复）。get_spec_bundle 的 DA-2 白名单门不动（手动 import 场景，非本变更面）。
- handleInitLease：非绝对 rootPath 从异常变为 ok:false 结果体（错误信息经 result.error 透传，backend init 统计链恢复）；其余行为零变化。
- num_turns/duration_ms：非有限值不再进 payload（此前 NaN→null）；有限值逐字不变。无 schema/端点变化，`pnpm gen:types` 不需跑。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   存在性检查在 spawn/fs 前同步执行，与到达时序无关；存在性 TOCTOU 窗口（检查后目录被删）由既有 execFile cwd 失败路径承接（与 interactive-cwd-guard 同款边界）。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   不适用：守卫为只读 stat；两 handler 并发各自独立判定，无共享可变状态。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   ok:false 结果体走既有 init 失败上报链（complete 携 spec_version=0），终态/统计一致性由既有路径保证；throw 路径删除后无 aborted 事务面。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   存在性检查针对本 workspace 绑定根，无跨工作区数据流；白名单移除不改变 backend 侧绑定归属校验（授权面在 backend，daemon 信任 backend 下发的绑定根——与会话路径同一信任模型）。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- 风险：移除机器白名单后，linked_repos 对「失陷 backend 下发任意存在路径」的防线回落到与会话路径相同的信任模型（backend 绑定 vouch + 存在性检查）——这是 ql-20260831-006 已裁决的平台信任边界，本变更是恢复一致性而非新增暴露；残余面（lease/spec-sync 路径同样信任 backend rootPath）在此一并留档为已知边界。
- 放弃方案 A：保留白名单但 forbidden 降级为结果体 skipped——同步仍然不做（功能回归未修复），只是把 5xx 变安静失败，更难排障。
- 放弃方案 B：机器主人把工作区根手工加入 allowed_roots 作为上线前提——把配置负担转嫁用户且与 ql-20260831-006「不该拦截」的裁决直接相悖。
- 放弃方案 C：num_turns/duration_ms 保持裸 typeof（危害止于单轮 NULL）——与同函数另两字段口径统一是一行事，成本两行。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 改 | sillyhub-daemon/src/daemon.ts | 两 handler 白名单门改存在性检查；NaN 注释勘误；pi 探测多轮 caveat；num_turns/duration_ms isFinite |
| 改 | sillyhub-daemon/src/spec-sync.ts | handleInitLease 形态门 throw→ok:false 结果体 |
| 改 | sillyhub-daemon/src/borrow-sandbox-context.ts | truncateText JSDoc 去具体计数 |
| 改 | sillyhub-daemon/tests/daemon-linked-repos-guard.test.ts | 用例与头注改新语义（放行/拒止矩阵） |
| 改 | sillyhub-daemon/tests/test_init_lease.test.ts | 形态门用例改 ok:false 断言 |
| 改 | sillyhub-daemon/tests/daemon-interactive-bridge.test.ts | 新增 num_turns/duration_ms 非有限值用例 |
