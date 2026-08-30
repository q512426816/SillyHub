---
author: WhaleFall
created_at: 2026-08-28 16:00:48
---

# 符号影响面报告（Symbol Impact）

> execute「加载上下文」步产物：plan.md 每个 task 一行签名级结论。依据：plan.md 任务总表 + design.md 接口定义 + 源码现状。

| task | 签名级结论 |
|---|---|
| task-01 | 无签名级变更——queries.py 两函数（resolve_representative_binding / resolve_daemon_instance_for_workspace）签名与返回 shape 不变，仅 SQL 内部补 ORDER BY + JOIN（行为级变更：多绑定选机从非确定变全序确定）。 |
| task-02 | 新增签名（新函数，非修改）：placement.py 模块级 `fetch_daemon_allowed_roots(session, daemon_instance_id) -> list[str]` 与 `path_definitively_outside_roots(path, roots) -> bool`。无既有符号修改；RunPlacementService 类零改动。消费方 task-03（新增 import）。 |
| task-03 | 无签名级变更——`_dispatch_worker_core` 签名不变，内部：删 own_rt 分支、预检两段式、新增 A3 预检调用（消费 task-02 新函数）。新增 import：`fetch_daemon_allowed_roots` / `path_definitively_outside_roots`（from app.modules.agent.placement）。 |
| task-04 | 无签名级变更——仅测试文件（重写 :736 用例 + 夹具微调 + 新用例）；夹具 `_seed_context` 增可选参数属测试内部符号，非生产签名。 |
| task-05 | 新增签名（新文件）：`checkWorkspaceBoundCwd(cwd, exists, roots) -> CwdGuardVerdict`（sillyhub-daemon/src/interactive-cwd-guard.ts）。复用 file-rpc.ts 既有导出 `assertWithinAllowedRoots`，无修改。 |
| task-06 | 无签名级变更——daemon.ts 认领段内部接线（消费 task-05 新函数 import + 既有 `assertWithinAllowedRoots` / `notifyRunResult` / `mkdir`）；不改任何导出签名。 |
| task-07 | 无签名级变更——回归收口 task，仅修测试/实现缝隙，不触及签名。 |
