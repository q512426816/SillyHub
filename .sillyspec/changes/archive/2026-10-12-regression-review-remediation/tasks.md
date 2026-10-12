---
author: flow-machine-draft
created_at: 2026-10-12T02:29:15.576Z
---
# 任务注册表（Tasks）— 2026-10-12-regression-review-remediation

- [x] task-01: linked_repos 两 RPC 的白名单守卫改为 ql-20260831-006 信任语义：root_path 是 backend 下发的绑定工作区根（与会话 lease workspaceRoot 同源同信任级），不再过机器白名单，错机派发保护由存在性检查承担（stat 非目录/不存在即抛错，业务函数零调用）；绝对形态门保持不变
- [x] task-02: handleInitLease 形态门从 throw 改为返回 ok:false+error（对齐函数自身「逐步 catch 不上抛」契约与 init 统计链），pullSpecBundle 抛错语义不变（三处调用方均 catch 可见）
- [x] task-03: daemon.ts NaN 门注释修正旧危害表述（污染窗口 1 轮）；pi 延迟探测注释补多轮收敛 caveat（追问轮 runId 与 workers 首 run id 错配、本探针跳过）；borrow truncateText JSDoc 计数改准确口径
- [x] task-04: num_turns/duration_ms 两处 typeof 门叠 Number.isFinite（对齐同函数 cost/duration_api 口径），NaN 不进 payload；新增用例先红后绿
- [x] task-05: 测试：linked-repos 守卫测试改写为新语义（白名单外但存在→放行、不存在→拒止零调用、快照同款）；handleInitLease 用例改 ok:false 断言；NaN 用例扩 num_turns/duration_ms；既有相关面全绿；仅跑相关测试（规则 0）
