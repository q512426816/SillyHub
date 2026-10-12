---
author: flow-machine-draft
created_at: 2026-10-12T00:42:29.656Z
---
# 需求规格（Requirements）— 2026-10-12-regression-review-remediation

## 功能需求

### FR-01: linked_repos 两 RPC 的白名单守卫改为 ql-20260831-006 信任语义：root_path 是 backend 下发的绑定工作区根（与会话 lease workspaceRoot 同源同信任级），不再过机器白名单，错机派发保护由存在性检查承担（stat 非目录/不存在即抛错，业务函数零调用）；绝对形态门保持不变

- 两 handler 必须删除 `assertWithinAllowedRoots` 机器白名单门（ql-20260831-006 用户决策：工作区绑定根不在机器白名单属合法形态，仓内生产实证 E:\sgm/F:\WorkNew；会话 cwd 守卫 interactive-cwd-guard 为此专门跳过白名单），改为存在性检查：`stat` 失败或非目录必须抛错（含「不存在或非目录」文案），业务函数零调用；`linked-repos-sync.ts` 的 isAbsoluteLikePath 绝对形态门零变化。

#### 场景：白名单外但存在 → 放行

- Given root_path 为存在的目录且在 allowed_roots 之外
- When 调用 sync/snapshot
- Then 业务函数被调用（ql-20260831-006 语义钉）

#### 场景：不存在 → 拒止

- Given root_path 指向不存在的目录（错机派发形态）
- When 调用 sync/snapshot
- Then 抛「不存在或非目录」，业务函数零调用

### FR-02: handleInitLease 形态门从 throw 改为返回 ok:false+error（对齐函数自身「逐步 catch 不上抛」契约与 init 统计链），pullSpecBundle 抛错语义不变（三处调用方均 catch 可见）

- `handleInitLease` 对非绝对 rootPath 必须返回 `{ok:false, specVersion:0, error, daemonState:null, specDir:null}` 结果体（不再 throw——头部 throw 会穿透 task-runner _runInitLease 的刻意不加 try/catch，落顶层 generic failed 且丢 init_error 诊断）；先于任何 fs/spawn 的次序不变；`pullSpecBundle` 的形态抛错与三处调用方 catch 保持不变。

#### 场景：结果体失败

- Given rootPath='rel/proj'
- When handleInitLease
- Then 返回 ok:false、error 含「rootPath 非绝对路径」、specVersion=0，无异常上抛

### FR-03: daemon.ts NaN 门注释修正旧危害表述（污染窗口 1 轮）；pi 延迟探测注释补多轮收敛 caveat（追问轮 runId 与 workers 首 run id 错配、本探针跳过）；borrow truncateText JSDoc 计数改准确口径

- 注释三处勘误必须落盘：①NaN 门注释「污染基线（后续合法快照误差分）」改为「基线随即被 set(NaN) 覆写、污染窗口 1 轮」（回归复审 F3 勘误：非恒 NaN）；②pi 延迟探测注释补「workers 行 id=分身首 run id，追问轮 runId 恒 miss、多轮收敛押首轮 timer+末文缓存」caveat（回归复审 F6）；③truncateText JSDoc 去具体计数（调用点随渲染面增长）。

#### 场景：注释勘误

- When 审阅三处注释
- Then 表述与实现/复审结论一致

### FR-04: num_turns/duration_ms 两处 typeof 门叠 Number.isFinite（对齐同函数 cost/duration_api 口径），NaN 不进 payload；新增用例先红后绿

- 两处门必须叠加 `Number.isFinite`（对齐同函数 cost/duration_api 既有口径）：非有限值不进 payload（NaN 序列化 null 的单轮字段 NULL 面消除）；有限值行为逐字不变；新增 NaN/Infinity 用例先红后绿。

#### 场景：口径统一

- Given num_turns=NaN、duration_ms=Infinity、duration_api_ms=12000
- When onTurnResult
- Then 前两键 undefined、duration_api_ms=12000（合法值差分不受影响）

### FR-05: 测试：linked-repos 守卫测试改写为新语义（白名单外但存在→放行、不存在→拒止零调用、快照同款）；handleInitLease 用例改 ok:false 断言；NaN 用例扩 num_turns/duration_ms；既有相关面全绿；仅跑相关测试（规则 0）

- 守卫测试文件头注与用例语义必须同步新信任模型（含与 ql-20260831-006 的关系说明）；handleInitLease 用例改断言 ok:false 结果体；bridge 新增非有限值用例；三个测试文件全绿；只跑相关测试（规则 0）。

#### 场景：相关面回归

- When 运行三个测试文件 + tsc
- Then 全部通过

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: sillyhub-daemon/tests/daemon-linked-repos-guard.test.ts「linked_repos_sync：root_path 白名单外但存在 → ql-20260831-006 语义放行（机器白名单不拦工作区根）」「linked_repos_sync：root_path 不存在 → 抛错且业务函数零调用（错机派发保护）」
FR-02: sillyhub-daemon/tests/test_init_lease.test.ts「rootPath 相对形态 → ok:false 结果体（对齐「逐步 catch 不上抛」契约，先于任何 fs/spawn；2026-10-12-regression-review-remediation F3 改判）」
FR-03: 不适用：注释勘误由 change.patch 冻结面 diff 直接核验，无独立测试面
FR-04: sillyhub-daemon/tests/daemon-interactive-bridge.test.ts「num_turns/duration_ms 非有限值 → 不进 payload（isFinite 口径统一，2026-10-12-regression-review-remediation F1）」
FR-05: sillyhub-daemon/tests/daemon-linked-repos-guard.test.ts（+ test_init_lease + daemon-interactive-bridge 三文件全文件回归）
