# execute worktree 模式多处故障(Windows):orphan 误删 / git list 不同步 / deps provision 与 step meta 脱节

- 发现时间：2026-07-01
- sillyspec 版本：全局安装（nvm v24.15.0 node_modules/sillyspec）
- 触发场景：`sillyspec run execute --change <变更>` 的 worktree 隔离模式

## 故障链（3 个独立 bug 叠加，导致 worktree 模式不可用）

### Bug-1：worktree doctor --fix 误删 worktree（路径斜杠 orphan 误判）

execute 成功创建 worktree（`.sillyspec/.runtime/worktrees/<change>/`，输出「🔗 worktree 已创建」）后，运行 `sillyspec worktree doctor --fix --change <变更>` 报：

```
⚠️ [orphan-git-entry] .../worktrees/<change>: git worktree 引用存在但目录不存在
🔧 修复完成：✅ pruned orphan: .../worktrees/<change>
```

实际目录真实存在（刚创建并已装好依赖），但 doctor 用正斜杠 `C:/...` 检测，与实际路径形式不匹配，误判「不存在」直接 prune 掉 worktree。doctor 本意是修 depsStatus=unknown，结果把整个 worktree 删了。

### Bug-2：execute worktree 与 git worktree list / sillyspec worktree list 都不同步

execute 创建的 worktree：
- `git worktree list` 只显示 main，不显示 execute worktree
- `sillyspec worktree list` 报「无活跃 worktree」
- `sillyspec worktree meta <change>` 报「未找到 worktree meta」

即 execute 的 worktree 注册体系与 `sillyspec worktree` 命令族、与 git worktree list 三方都不同步。execute worktree 没写 meta.json（或写到三方都不读的位置）。

### Bug-3：execute run 不识别已存在 worktree，每次都 create（branch already exists 死循环）

worktree + 分支已存在时，重跑 `sillyspec run execute` 不走「已存在 worktree 的 deps 自检」（run.js 222-247 的 re-provision 路径），而是直接报：

```
❌ worktree 创建失败: branch already exists: sillyspec/<change>. Run cleanup first.
```

只能 cleanup（删 worktree + 分支）后重建，但重建后 provisionDeps 结果仍未写入 execute step meta（见 Bug-4）。

### Bug-4：provisionDeps 结果未写入 execute step meta（depsStatus 恒为 unknown）

`provisionDeps`（worktree-deps.js:141）逻辑正确，必返回 `linked/installed/n/a/failed` 之一。worktree 创建后手动装好依赖（backend `uv sync`、frontend/daemon `pnpm install` 均成功），但 `sillyspec run execute --done` 仍报：

```
❌ 拒绝 --done：依赖未就绪（depsStatus=unknown）
```

run.js:2207 `meta?.depsStatus` 读到 unknown，说明 provisionDeps 的返回没写进 `--done` 校验的那个 meta（execute step meta 与 worktree meta 脱节）。

## 规避

用 `--no-worktree` 跳过 worktree 隔离，在主仓库 feature 分支（手动 `git checkout -b`）直接 execute。主仓库依赖本就就绪，`--no-worktree` 模式不检查 depsStatus。

```bash
git checkout -b feature/<change>      # 手动分支隔离（替代 worktree）
sillyspec run execute --no-worktree --change <change>
```

## 建议（给 sillyspec 工具方）

1. doctor 的 orphan 检测统一路径形式（`path.normalize` + 同基准比较），勿在目录真实存在时误 prune。
2. execute worktree 与 `sillyspec worktree` 命令族共用同一注册表（meta.json 位置一致），让 `list/meta/doctor` 能看到 execute worktree。
3. execute run 识别已存在 worktree 时走 deps 自检 re-provision（run.js 222-247），而非直接 create 报 branch already exists。
4. provisionDeps 返回值写入 execute step meta（`--done` 校验的那个 meta），勿让 depsStatus 恒 unknown。
5. Windows 路径全面用 `path.posix` 或归一化后再比较。
