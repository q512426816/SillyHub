---
author: flow-machine-draft
created_at: 2026-10-12T01:17:18.791Z
---
# 提案书（Proposal）— 2026-10-12-daemon-path-guard-completion

## 动机

任务原话转写：动机：24h 风险审查 P2-3 + 同族 P3——daemon 路径写入口防线不一致：①linked_repos_sync/linked_repos_snapshot 两 RPC（daemon.ts:6656/6682）是写/读宿主路径的入口，却只校验非空+绝对形态（af5daeca2），没有 assertWithinAllowedRoots 归属校验——同文件 get_spec_bundle（daemon.ts:6845，DA-2 审计先例）对同一性质的 backend 下发路径都有白名单守卫，失陷 backend 可下发宿主任意绝对路径让 daemon 在其下落 .sillyspec/projects 结构；②spec-sync.ts 的 pullSpecBundle（opts.rootPath，repo-native 会 mkdir rootPath/.sillyspec 并建 junction）与 handleInitLease（params.rootPath，runSillyspecInit --dir + writeLocalYaml）对相对形态 rootPath 零防御——join 相对路径按 daemon 进程 cwd 解析，写进错误位置。
成功标准：
- linked_repos_sync 与 linked_repos_snapshot 两 RPC 处理器在形态校验后、任何 spawn/fs 操作前必须过 assertWithinAllowedRoots(root_path, this._effectiveAllowedRoots())，越界抛 RpcError forbidden（对齐 get_spec_bundle DA-2 同款）
- pullSpecBundle 在 opts.rootPath 提供时必须 isAbsoluteLikePath 校验，非绝对形态抛错先于任何 fs 操作；handleInitLease 入口对 params.rootPath 同款校验（形态非法 throw，对齐 linked-repos「数据级失败走结果体、归一非法 throw」既有口径）
- 新增用例先红后绿：处理器层越界→forbidden 且零 spawn；snapshot 同款；pullSpecBundle/handleInitLease 相对形态→抛错且零 fs 副作用；既有 linked-repos-sync 25 用例与 init_lease/spec-sync 相关面全绿
- 兼容 Windows/Linux/macOS：allowed_roots 判定复用 isPathUnderAnyRoot（realpath+盘符归一+UNC 拒绝），绝对形态判定复用 isAbsoluteLikePath（POSIX 根/盘符/UNC 三形态）
- 仅跑本改动相关测试（规则 0）：新增守卫测试文件 + linked-repos-sync.test.ts + test_init_lease.test.ts + spec-sync.test.ts

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. linked_repos_sync 与 linked_repos_snapshot 两 RPC 处理器在形态校验后、任何 spawn/fs 操作前必须过 assertWithinAllowedRoots(root_path, this._effectiveAllowedRoots())，越界抛 RpcError forbidden（对齐 get_spec_bundle DA-2 同款）
2. pullSpecBundle 在 opts.rootPath 提供时必须 isAbsoluteLikePath 校验，非绝对形态抛错先于任何 fs 操作；handleInitLease 入口对 params.rootPath 同款校验（形态非法 throw，对齐 linked-repos「数据级失败走结果体、归一非法 throw」既有口径）
3. 新增用例先红后绿：处理器层越界→forbidden 且零 spawn；snapshot 同款；pullSpecBundle/handleInitLease 相对形态→抛错且零 fs 副作用；既有 linked-repos-sync 25 用例与 init_lease/spec-sync 相关面全绿
4. 兼容 Windows/Linux/macOS：allowed_roots 判定复用 isPathUnderAnyRoot（realpath+盘符归一+UNC 拒绝），绝对形态判定复用 isAbsoluteLikePath（POSIX 根/盘符/UNC 三形态）
5. 仅跑本改动相关测试（规则 0）：新增守卫测试文件 + linked-repos-sync.test.ts + test_init_lease.test.ts + spec-sync.test.ts

## 成功标准（可验证）

1. linked_repos_sync 与 linked_repos_snapshot 两 RPC 处理器在形态校验后、任何 spawn/fs 操作前必须过 assertWithinAllowedRoots(root_path, this._effectiveAllowedRoots())，越界抛 RpcError forbidden（对齐 get_spec_bundle DA-2 同款）
2. pullSpecBundle 在 opts.rootPath 提供时必须 isAbsoluteLikePath 校验，非绝对形态抛错先于任何 fs 操作；handleInitLease 入口对 params.rootPath 同款校验（形态非法 throw，对齐 linked-repos「数据级失败走结果体、归一非法 throw」既有口径）
3. 新增用例先红后绿：处理器层越界→forbidden 且零 spawn；snapshot 同款；pullSpecBundle/handleInitLease 相对形态→抛错且零 fs 副作用；既有 linked-repos-sync 25 用例与 init_lease/spec-sync 相关面全绿
4. 兼容 Windows/Linux/macOS：allowed_roots 判定复用 isPathUnderAnyRoot（realpath+盘符归一+UNC 拒绝），绝对形态判定复用 isAbsoluteLikePath（POSIX 根/盘符/UNC 三形态）
5. 仅跑本改动相关测试（规则 0）：新增守卫测试文件 + linked-repos-sync.test.ts + test_init_lease.test.ts + spec-sync.test.ts
