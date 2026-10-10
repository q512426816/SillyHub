# 符号影响面报告

> tasks.md 内容指纹（生成时）: 01c9e2a18dce7d12——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。

- task-01: 签名级变更——`_stamp_borrow_sandbox_metadata`（backend/app/modules/agent/placement.py:139）增第 4 个可选参数 workspace_context（dict | None = None），缺省值保证既有 3 处调用点零改造兼容；本次同步改三调用点传参，全在任务范围内。新增模块级函数 `_load_borrow_workspace_context`（纯新增无既有调用点）。无其它签名变更。
- task-02: 无签名级变更——build_claim_payload（backend/app/modules/daemon/lease/context.py:496）函数体加白名单透传分支，签名与返回结构不变（payload dict 增可选键，消费方按缺键穿透惯例安全）。
- task-03: 接口级变更——LeaseCtx（sillyhub-daemon/src/types.ts:394）增可选字段 borrowWorkspaceContext（Record 类型，可选不破坏既有实现/消费方，tsc strict 下新增可选字段零强制适配）；新增导出 BORROW_CONTEXT_FILENAME 与 renderBorrowSandboxContext（NEW 模块，无既有调用点）；daemon.ts 归一化对象加键（对象字面量扩展，非签名变更）。
- task-04: 无签名级变更——_startInteractiveSession（sillyhub-daemon/src/daemon.ts:8495）函数体 marker 分支加渲染落盘 try/catch，签名不变；新增对 renderBorrowSandboxContext/BORROW_CONTEXT_FILENAME 的 import（消费 task-03 契约，在任务范围内）。
