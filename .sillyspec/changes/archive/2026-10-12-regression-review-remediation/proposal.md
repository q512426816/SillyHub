---
author: flow-machine-draft
created_at: 2026-10-12T02:29:15.575Z
---
# 提案书（Proposal）— 2026-10-12-regression-review-remediation

## 动机

任务原话转写：动机：回归复审（三代理）对六条防线修复的清偿项——高优先一条：daemon-path-guard-completion 给 linked_repos 两 RPC 加的 assertWithinAllowedRoots 白名单守卫与仓内既有产品决策 ql-20260831-006 冲突（工作区绑定路径不在机器白名单属合法形态，会话 cwd 守卫为此专门跳过白名单；仓内生产实证 E:\sgm、F:\WorkNew 两处工作区根均不在家目录白名单），现网存量部署的 linked_repos 同步会被首次 forbidden 拒止（功能回归）；另有复审小项：handleInitLease 头部 throw 违反自身「逐步 catch 返 ok:false」契约致 init 统计诊断链断、NaN 注释对旧危害表述夸大（污染窗口实为 1 轮非恒 NaN）、pi 延迟探测多轮收敛缺口未披露（backend workers 行按首 run id 锚定，追问轮 runId 恒 miss）、borrow JSDoc 调用计数失准、num_turns/duration_ms 裸 typeof 与 isFinite 口径不对称。
成功标准：
- linked_repos 两 RPC 的白名单守卫改为 ql-20260831-006 信任语义：root_path 是 backend 下发的绑定工作区根（与会话 lease workspaceRoot 同源同信任级），不再过机器白名单，错机派发保护由存在性检查承担（stat 非目录/不存在即抛错，业务函数零调用）；绝对形态门保持不变
- handleInitLease 形态门从 throw 改为返回 ok:false+error（对齐函数自身「逐步 catch 不上抛」契约与 init 统计链），pullSpecBundle 抛错语义不变（三处调用方均 catch 可见）
- daemon.ts NaN 门注释修正旧危害表述（污染窗口 1 轮）；pi 延迟探测注释补多轮收敛 caveat（追问轮 runId 与 workers 首 run id 错配、本探针跳过）；borrow truncateText JSDoc 计数改准确口径
- num_turns/duration_ms 两处 typeof 门叠 Number.isFinite（对齐同函数 cost/duration_api 口径），NaN 不进 payload；新增用例先红后绿
- 测试：linked-repos 守卫测试改写为新语义（白名单外但存在→放行、不存在→拒止零调用、快照同款）；handleInitLease 用例改 ok:false 断言；NaN 用例扩 num_turns/duration_ms；既有相关面全绿；仅跑相关测试（规则 0）

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. linked_repos 两 RPC 的白名单守卫改为 ql-20260831-006 信任语义：root_path 是 backend 下发的绑定工作区根（与会话 lease workspaceRoot 同源同信任级），不再过机器白名单，错机派发保护由存在性检查承担（stat 非目录/不存在即抛错，业务函数零调用）；绝对形态门保持不变
2. handleInitLease 形态门从 throw 改为返回 ok:false+error（对齐函数自身「逐步 catch 不上抛」契约与 init 统计链），pullSpecBundle 抛错语义不变（三处调用方均 catch 可见）
3. daemon.ts NaN 门注释修正旧危害表述（污染窗口 1 轮）；pi 延迟探测注释补多轮收敛 caveat（追问轮 runId 与 workers 首 run id 错配、本探针跳过）；borrow truncateText JSDoc 计数改准确口径
4. num_turns/duration_ms 两处 typeof 门叠 Number.isFinite（对齐同函数 cost/duration_api 口径），NaN 不进 payload；新增用例先红后绿
5. 测试：linked-repos 守卫测试改写为新语义（白名单外但存在→放行、不存在→拒止零调用、快照同款）；handleInitLease 用例改 ok:false 断言；NaN 用例扩 num_turns/duration_ms；既有相关面全绿；仅跑相关测试（规则 0）

## 成功标准（可验证）

1. linked_repos 两 RPC 的白名单守卫改为 ql-20260831-006 信任语义：root_path 是 backend 下发的绑定工作区根（与会话 lease workspaceRoot 同源同信任级），不再过机器白名单，错机派发保护由存在性检查承担（stat 非目录/不存在即抛错，业务函数零调用）；绝对形态门保持不变
2. handleInitLease 形态门从 throw 改为返回 ok:false+error（对齐函数自身「逐步 catch 不上抛」契约与 init 统计链），pullSpecBundle 抛错语义不变（三处调用方均 catch 可见）
3. daemon.ts NaN 门注释修正旧危害表述（污染窗口 1 轮）；pi 延迟探测注释补多轮收敛 caveat（追问轮 runId 与 workers 首 run id 错配、本探针跳过）；borrow truncateText JSDoc 计数改准确口径
4. num_turns/duration_ms 两处 typeof 门叠 Number.isFinite（对齐同函数 cost/duration_api 口径），NaN 不进 payload；新增用例先红后绿
5. 测试：linked-repos 守卫测试改写为新语义（白名单外但存在→放行、不存在→拒止零调用、快照同款）；handleInitLease 用例改 ok:false 断言；NaN 用例扩 num_turns/duration_ms；既有相关面全绿；仅跑相关测试（规则 0）
