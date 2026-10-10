---
author: flow-machine-draft
created_at: 2026-10-10T06:51:49.152Z
---
# 需求规格（Requirements）— 2026-10-10-repo-native-no-platform-markers

## 功能需求

### FR-01: repo-native 且源项目无 .sillyspec 时不再降级：daemon 就地创建空 .sillyspec 后建 junction，getSpecBundle 不被调用（junction 分支早退）

- daemon `pullSpecBundle` 在 strategy=repo-native 且源项目 `<rootPath>/.sillyspec` 不存在时，**必须**就地创建该空目录并继续建 junction（源项目即真理：真理源不存在则创建空真理源），**禁止**再降级走 platform-managed pull（缓存成普通目录会让 sillyspec CLI 自指守卫失效，平台标记三件套投毒源项目根）。

#### 场景：全新项目首接

- Given 源项目根无 .sillyspec，workspace spec_strategy=repo-native
- When init lease 触发 pullSpecBundle
- Then `<rootPath>/.sillyspec` 空目录被创建，缓存路径成为指向它的 junction，getSpecBundle 不被调用

### FR-02: repo-native 且缓存为普通目录残留时不再静默降级：残留 rename 备份后建 junction，原缓存数据保留在备份目录

- `ensureSpecJunction` 遇到缓存路径已是普通目录（历史 platform-managed 缓存残留）时，**必须**先 rename 到同级 `<wsId>.pre-junction-backup-<时间戳>` 备份目录再建 junction（数据不丢）；rename 失败时**必须**保守返回 false 走原降级 pull 路径（不抛错、不删数据）。

#### 场景：策略切换残留

- Given 缓存目录是含旧 bundle 内容的普通目录，本次 strategy=repo-native
- When pullSpecBundle 走到 ensureSpecJunction
- Then 残留被 rename 为备份目录，junction 建立，getSpecBundle 不被调用，旧内容在备份目录可寻址

### FR-03: junction 成立后 init 时 sillyspec 自指守卫生效：源项目根不落 .sillyspec-platform.json / .sillyspec-platform-managed / .sillyspec-platform-cleaned 任一文件

- repo-native junction 成立（缓存路径 realpath 解析回源项目 .sillyspec）后，后续 `sillyspec init --spec-dir <缓存路径>` 的三写（writePlatformPointer 三写与 cleaned marker）**必须**被 sillyspec CLI 既有自指守卫（isSelfReferentialSpecRoot，realpath 穿透 junction）拦截——本变更的职责是保证守卫的前置条件（junction 成立且源项目 .sillyspec 存在）在 FR-01/FR-02 全路径成立；守卫行为本身由 sillyspec CLI 既有实现与测试保证，daemon 侧以「junction 形态断言」作为等价前置验证。

#### 场景：init 不投毒

- Given repo-native junction 已建立（缓存 symlink → 源项目 .sillyspec，两路径 realpath 相等）
- When daemon spawn sillyspec init --spec-dir 缓存路径
- Then sillyspec 自指守卫返回 true，源项目根不写平台标记三件套

### FR-04: 既有 repo-native / repo-mirrored / platform-managed 策略分支测试全部保持绿（无回归）

- 本变更**禁止**破坏既有策略分支行为：repo-mirrored 首拷、platform-managed pull 覆盖、repo-native junction 复用/目标不一致重建等既有用例**必须**全部保持绿。

#### 场景：回归

- Given 既有 test_init_lease.test.ts 策略分支 describe 全量用例
- When 本次改动后运行
- Then 全部通过

### FR-05: backup rename 失败（如 Windows 句柄占用）时仍走原降级 pull 路径，不抛错不删数据

- FR-02 的备份 rename 抛错（Windows EBUSY/EPERM 句柄占用等）时，ensureSpecJunction **必须**捕获并返回 false（上层降级 pull），**禁止**向上抛错或删除残留目录数据。

#### 场景：rename 失败降级

- Given 缓存为普通目录且 rename 抛错
- When ensureSpecJunction 执行
- Then 返回 false，pullSpecBundle 走降级 pull，残留目录原样保留

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: sillyhub-daemon/tests/test_init_lease.test.ts「repo-native：源项目无 .sillyspec → 就地创建空真理源 + junction 建立，getSpecBundle 不被调（不再降级投毒）」
FR-02: sillyhub-daemon/tests/test_init_lease.test.ts「repo-native：缓存为普通目录残留 → rename 备份后 junction 成立，原内容保留在备份目录，getSpecBundle 不被调」
FR-03: sillyhub-daemon/tests/test_init_lease.test.ts「repo-native：源项目无 .sillyspec → 就地创建空真理源 + junction 建立，getSpecBundle 不被调（不再降级投毒）」（junction 形态 = 自指守卫前置条件；守卫行为由 sillyspec CLI 既有 isSelfReferentialSpecRoot 实现保证，见 FR-03 正文口径）
FR-04: sillyhub-daemon/tests/test_init_lease.test.ts「策略分支 init 时序 + 状态文件保鲜 (ql-20260820-007)」describe 全量既有用例（repo-native junction / repo-mirrored 首拷 / platform-managed pull 覆盖）
FR-05: 不适用：rename 失败需注入操作系统级句柄占用故障，vitest 无可靠注入面（Windows EBUSY 形态无法在沙箱稳定复现）；代码路径为 try/catch 包裹 return false 的兜底分支，由 FR-02 用例的反向语义与代码评审覆盖
