---
author: flow-machine-draft
created_at: 2026-10-12T00:42:29.656Z
---
# 需求规格（Requirements）— 2026-10-12-daemon-path-guard-completion

## 功能需求

### FR-01: linked_repos_sync 与 linked_repos_snapshot 两 RPC 处理器在形态校验后、任何 spawn/fs 操作前必须过 assertWithinAllowedRoots(root_path, this._effectiveAllowedRoots())，越界抛 RpcError forbidden（对齐 get_spec_bundle DA-2 同款）

- 两 handler 必须在 payload 非空校验之后、`runLinkedReposSync`/`runLinkedReposSnapshot`（任何 spawn/fs）之前执行 `assertWithinAllowedRoots(root_path, this._effectiveAllowedRoots())`；越界必须抛 `RpcError`（code=forbidden），业务函数零调用（零 spawn、零写盘）。

#### 场景：越界拒止

- Given daemon config.allowed_roots=[tmpRoot]，handler 收到 root_path=C:\Windows（或 /etc）
- When 调用 linked_repos_sync / linked_repos_snapshot
- Then 抛 RpcError forbidden，runLinkedReposSync/runLinkedReposSnapshot 零调用

#### 场景：白名单内放行

- Given root_path=tmpRoot 本身（含等于 root）
- When 调用两 handler
- Then 业务函数被调用且 payload 原样透传

### FR-02: pullSpecBundle 在 opts.rootPath 提供时必须 isAbsoluteLikePath 校验，非绝对形态抛错先于任何 fs 操作；handleInitLease 入口对 params.rootPath 同款校验（形态非法 throw，对齐 linked-repos「数据级失败走结果体、归一非法 throw」既有口径）

- `pullSpecBundle` 在 `opts.rootPath !== undefined` 且非 isAbsoluteLikePath 绝对形态时必须抛错（错误信息含「rootPath 非绝对路径」），抛点先于 resolveSpecDir/sweep/mkdir/junction 等任何 fs 操作；`handleInitLease` 入口对 `params.rootPath` 同款抛错（先于 pull/init/writeLocalYaml 任何 fs/spawn）。

#### 场景：相对形态拒止

- Given pullSpecBundle 收 rootPath='rel/proj'（repo-native）、handleInitLease 收 rootPath='rel/proj'
- When 执行
- Then 均抛「rootPath 非绝对路径」，零 mkdir/零 spawn

#### 场景：绝对形态放行

- Given rootPath 为宿主绝对路径
- When pullSpecBundle 执行
- Then 不因形态抛错（后续策略行为与守卫无关）

### FR-03: 新增用例先红后绿：处理器层越界→forbidden 且零 spawn；snapshot 同款；pullSpecBundle/handleInitLease 相对形态→抛错且零 fs 副作用；既有 linked-repos-sync 25 用例与 init_lease/spec-sync 相关面全绿

- 新增守卫用例必须在修复前为红（处理器无 allowed_roots 门时越界放行、spec-sync 无形态门时相对路径照跑）修复后为绿；既有 linked-repos-sync/linked-repos-snapshot/test_init_lease/spec-sync 用例语义不变全绿。

#### 场景：先红后绿

- When 守卫实现前运行新增用例
- Then 越界/相对形态用例红；实现后全部绿

### FR-04: 兼容 Windows/Linux/macOS：allowed_roots 判定复用 isPathUnderAnyRoot（realpath+盘符归一+UNC 拒绝），绝对形态判定复用 isAbsoluteLikePath（POSIX 根/盘符/UNC 三形态）

- 守卫必须复用既有判定原语（assertWithinAllowedRoots/isPathUnderAnyRoot/isAbsoluteLikePath），禁止新写路径比较逻辑；测试的平台相关路径（C:\Windows vs /etc）按 process.platform 条件取值，三平台测试均可跑。

#### 场景：三平台可跑

- When 在任一平台运行守卫测试
- Then evil 路径按平台取值、断言语义一致

### FR-05: 仅跑本改动相关测试（规则 0）：新增守卫测试文件 + linked-repos-sync.test.ts + test_init_lease.test.ts + spec-sync.test.ts

- 本变更只必须运行上述 4 个测试文件，禁止跑全量测试套件（规则 0，全量留给 CI）。

#### 场景：相关面回归

- When 运行 4 文件
- Then 全部通过且 tsc --noEmit 零错

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: sillyhub-daemon/tests/daemon-linked-repos-guard.test.ts「linked_repos_sync：root_path 越界 → forbidden 且业务函数零调用（零 spawn）」「linked_repos_snapshot：root_path 越界 → forbidden 且业务函数零调用」
FR-02: sillyhub-daemon/tests/spec-sync.test.ts「rootPath 相对形态 → 抛错先于任何 fs 操作（repo-native mkdir/junction 不可达）」「rootPath 绝对形态 → 守卫放行（盘符/UNC/POSIX 三形态判定见 linked-repos-path 单测，此处钉不误杀）」
FR-03: sillyhub-daemon/tests/daemon-linked-repos-guard.test.ts「linked_repos_sync：root_path 在 allowed_roots 内 → 放行（业务函数被调、payload 透传）」
FR-04: sillyhub-daemon/tests/daemon-linked-repos-guard.test.ts「linked_repos_sync：root_path 越界 → forbidden 且业务函数零调用（零 spawn）」
FR-05: sillyhub-daemon/tests/daemon-linked-repos-guard.test.ts（+ 其余 3 文件全文件回归）
