---
author: flow-machine-draft
created_at: 2026-10-12T01:17:18.792Z
---
# 任务注册表（Tasks）— 2026-10-12-daemon-path-guard-completion

- [x] task-01: linked_repos_sync 与 linked_repos_snapshot 两 RPC 处理器在形态校验后、任何 spawn/fs 操作前必须过 assertWithinAllowedRoots(root_path, this._effectiveAllowedRoots())，越界抛 RpcError forbidden（对齐 get_spec_bundle DA-2 同款）
- [x] task-02: pullSpecBundle 在 opts.rootPath 提供时必须 isAbsoluteLikePath 校验，非绝对形态抛错先于任何 fs 操作；handleInitLease 入口对 params.rootPath 同款校验（形态非法 throw，对齐 linked-repos「数据级失败走结果体、归一非法 throw」既有口径）
- [x] task-03: 新增用例先红后绿：处理器层越界→forbidden 且零 spawn；snapshot 同款；pullSpecBundle/handleInitLease 相对形态→抛错且零 fs 副作用；既有 linked-repos-sync 25 用例与 init_lease/spec-sync 相关面全绿
- [x] task-04: 兼容 Windows/Linux/macOS：allowed_roots 判定复用 isPathUnderAnyRoot（realpath+盘符归一+UNC 拒绝），绝对形态判定复用 isAbsoluteLikePath（POSIX 根/盘符/UNC 三形态）
- [x] task-05: 仅跑本改动相关测试（规则 0）：新增守卫测试文件 + linked-repos-sync.test.ts + test_init_lease.test.ts + spec-sync.test.ts
