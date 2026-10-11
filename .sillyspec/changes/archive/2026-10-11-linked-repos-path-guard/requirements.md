---
author: flow-machine-draft
created_at: 2026-10-11T04:49:03.217Z
---
# 需求规格（Requirements）— 2026-10-11-linked-repos-path-guard

## 功能需求

### FR-01: runLinkedReposSnapshot 收到相对形态 root_path（如 ws-root、../x）时抛错，不 spawn 任何 CLI

- 快照例程入口**必须**校验 root_path 为绝对路径形态（POSIX `/` 根 / Windows 盘符 / UNC 任一），相对/空/垃圾形态**必须**抛错且**禁止** spawn 任何 CLI（root_path 是两条读命令的 cwd 与 `--spec-dir` 参数，当前零校验直传——24h 审查 P3-2 纵深防御缺口）。

#### 场景：相对形态拒绝

- Given deps.exec 为记录调用的 mock
- When runLinkedReposSnapshot('ws-root') 或 ('../x')
- Then 抛错（消息含「非绝对路径」）；exec 零调用

### FR-02: runLinkedReposSync 收到相对形态 root_path 时抛错；POSIX / 根、Windows 盘符 C:/、UNC \\srv\share 三种绝对形态均放行

- 同步例程入口**必须**对 payload.root_path 同款校验抛错（cwd 是全部写命令的公共落点，payload 级失败=RPC 错误，对齐 handler 缺参 throw 语义）；三种绝对形态**必须**放行——助手**禁止**依赖运行平台（裸 `path.isAbsolute` 在 Linux 上拒 Windows 盘符形态，会打翻 ubuntu-latest CI 的 `C:/` fixture）。

#### 场景：三形态放行 + 相对拒绝

- When root_path ∈ {'/ws', 'C:/ws', '\\\\srv\\share\\ws'}
- Then 照常执行（不因形态抛错）
- When root_path ∈ {'ws-root', '../x', ''}
- Then 抛错

### FR-03: sync 逐仓 rel_path 为绝对形态（/a、C:/a）→ projects_yaml 层 failed（路径非法）且不 spawn

- 逐仓 rel_path **必须**为**相对**路径形态（`../` 兄弟仓是既有合法约定——工作区根的兄弟目录，**禁止**禁 `..`）；绝对形态**必须**该层 `failed`（detail 含「须相对路径」）且不 spawn——逐条数据级失败走结果体，不抛 RPC 错误（对齐模块「能力降级与命令失败都是数据」契约）。

#### 场景：绝对形态 rel_path

- Given repos=[{name:'a', rel_path:'C:/a'}]
- When runLinkedReposSync
- Then projects_yaml 层 failed；exec 未收到该层的 spawn

### FR-04: sync 逐仓 abs_path 为相对形态（a/b、../x）→ repos_registry 层 failed 且不 spawn

- 逐仓 abs_path **必须**为绝对路径形态（本机路径注册语义）；相对形态**必须**该层 `failed`（detail 含「须绝对路径」）且不 spawn；绝对路径内容（含 `..` 段）**不**受限——用户登记本机任意仓库路径是功能本体。

#### 场景：相对形态 abs_path

- Given repos=[{name:'a', abs_path:'a/b'}]
- When runLinkedReposSync
- Then repos_registry 层 failed；该层无 spawn

### FR-05: 合法约定零回归：rel_path '../platform-specs' 兄弟相对路径、abs_path 绝对路径照常 spawn；既有两测试文件全绿

- 既有合法形态**必须**逐字透传零回归：`../platform-specs` 相对约定、`C:\...`/`/...` 绝对本机路径、name 白名单、skipped/failed/unsupported 三态语义；linked-repos-snapshot.test.ts 与 linked-repos-sync.test.ts 既有用例全绿。

#### 场景：合法 fixture 零回归

- When 运行既有两测试文件
- Then 全绿（fixture 的 'C:/Users/me/works/platform' root_path 与 '../platform-specs' rel_path 不受影响）

### FR-06: 新增校验用例先红后绿 + daemon tsc 零错（Linux CI 兼容：助手不依赖运行平台）

- 新用例在旧实现上**必须**先红（旧实现无校验，相对 root_path 不抛错/非法形态照 spawn）；实现后全绿；`tsc --noEmit` 零错；助手为纯函数无平台依赖（CI ubuntu-latest 与本机 Windows 行为一致）。

#### 场景：先红后绿

- When 旧实现运行 FR-01~04 新用例
- Then 失败（红）；实现后全绿

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例」`；空行/待填在 flow done 拒收）

FR-01: test/sillyhub-daemon/tests/linked-repos-snapshot.test.ts「相对形态 root_path 抛错不 spawn CLI」
FR-02: test/sillyhub-daemon/tests/linked-repos-sync.test.ts「root_path 三种绝对形态放行 + 相对形态抛错」
FR-03: test/sillyhub-daemon/tests/linked-repos-sync.test.ts「rel_path 绝对形态该层 failed 不 spawn」
FR-04: test/sillyhub-daemon/tests/linked-repos-sync.test.ts「abs_path 相对形态该层 failed 不 spawn」
FR-05: test/sillyhub-daemon/tests/linked-repos-sync.test.ts「合法约定零回归：兄弟相对路径与绝对本机路径照常 spawn」（既有用例组）
FR-06: test/sillyhub-daemon/tests/linked-repos-snapshot.test.ts「UNC 与 POSIX 绝对形态放行」
