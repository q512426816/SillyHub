---
author: flow-machine-draft
created_at: 2026-10-11T04:49:03.217Z
---
# 提案书（Proposal）— 2026-10-11-linked-repos-path-guard

## 动机

任务原话转写：linked_repos 两条 RPC 对路径参数零校验（24h 审查 P3-2 遗留）：daemon.ts 的 linked_repos_snapshot/linked_repos_sync 对 root_path 只做非空校验即用作外部 CLI 的 cwd 与参数，rel_path/abs_path 仅 trim 后直传 sillyspec 写命令（对比 name 有正则白名单）；backend 侧 MyPathUpdate.path 只限长度不限形态，daemon 无第二道边界——backend 数据被污染或未来新增调用方时，daemon 成为以其进程权限执行任意路径命令的跳板。修复（形态校验，不动既有约定）：新增 isAbsoluteLikePath 助手（POSIX 根 / Windows 盘符 / UNC 任一绝对形态；裸 path.isAbsolute 会在 Linux CI 打翻 Windows 盘符 fixture）；快照 root_path 与 sync root_path 非绝对形态 throw；sync 逐仓 rel_path 须相对路径（../ 兄弟仓是既有合法约定，不禁 ..）、abs_path 须绝对路径，违者该层 failed 不 spawn，合法形态逐字透传零回归。
成功标准：
- runLinkedReposSnapshot 收到相对形态 root_path（如 ws-root、../x）时抛错，不 spawn 任何 CLI
- runLinkedReposSync 收到相对形态 root_path 时抛错；POSIX / 根、Windows 盘符 C:/、UNC \\srv\share 三种绝对形态均放行
- sync 逐仓 rel_path 为绝对形态（/a、C:/a）→ projects_yaml 层 failed（路径非法）且不 spawn
- sync 逐仓 abs_path 为相对形态（a/b、../x）→ repos_registry 层 failed 且不 spawn
- 合法约定零回归：rel_path '../platform-specs' 兄弟相对路径、abs_path 绝对路径照常 spawn；既有两测试文件全绿
- 新增校验用例先红后绿 + daemon tsc 零错（Linux CI 兼容：助手不依赖运行平台）

## 变更范围

按成功标准机械推导，共 6 条验收面：
1. runLinkedReposSnapshot 收到相对形态 root_path（如 ws-root、../x）时抛错，不 spawn 任何 CLI
2. runLinkedReposSync 收到相对形态 root_path 时抛错；POSIX / 根、Windows 盘符 C:/、UNC \\srv\share 三种绝对形态均放行
3. sync 逐仓 rel_path 为绝对形态（/a、C:/a）→ projects_yaml 层 failed（路径非法）且不 spawn
4. sync 逐仓 abs_path 为相对形态（a/b、../x）→ repos_registry 层 failed 且不 spawn
5. 合法约定零回归：rel_path '../platform-specs' 兄弟相对路径、abs_path 绝对路径照常 spawn；既有两测试文件全绿
6. 新增校验用例先红后绿 + daemon tsc 零错（Linux CI 兼容：助手不依赖运行平台）

## 成功标准（可验证）

1. runLinkedReposSnapshot 收到相对形态 root_path（如 ws-root、../x）时抛错，不 spawn 任何 CLI
2. runLinkedReposSync 收到相对形态 root_path 时抛错；POSIX / 根、Windows 盘符 C:/、UNC \\srv\share 三种绝对形态均放行
3. sync 逐仓 rel_path 为绝对形态（/a、C:/a）→ projects_yaml 层 failed（路径非法）且不 spawn
4. sync 逐仓 abs_path 为相对形态（a/b、../x）→ repos_registry 层 failed 且不 spawn
5. 合法约定零回归：rel_path '../platform-specs' 兄弟相对路径、abs_path 绝对路径照常 spawn；既有两测试文件全绿
6. 新增校验用例先红后绿 + daemon tsc 零错（Linux CI 兼容：助手不依赖运行平台）
