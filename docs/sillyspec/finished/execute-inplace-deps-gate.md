---
author: WhaleFall
created_at: 2026-07-08 11:10:00
---

# execute in-place worktree 模式漏写 meta.depsStatus 致 deps 门控误阻断

> 发现于 2026-07-07-daemon-machine-runtime-hierarchy execute Step 1（2026-07-08）。
> CLAUDE.md 规则 14：SillySpec 工具缺陷记录。

## 现象

Windows 环境下 `sillyspec run execute` 启动时，`git worktree add` 因路径过长
（`.sillyspec/changes/archive/.../tasks/.sillyspec/.runtime/artifacts/<长名>.txt`
Filename too long，Windows MAX_PATH 限制）失败，CLI 降级为 **in-place-fallback**
模式（worktreePath=主仓库，分支 sillyspec/<change>）。降级时**漏调 `provisionDeps`**，
meta.json 无 `depsStatus` 字段。

随后 `sillyspec run execute --done`（任意 step）触发 `enforceDepsGate`（src/run.js:2389）：
- 读 `meta.depsStatus` → undefined → 非 linked/installed/n/a → **阻断**
- 提示 `sillyspec worktree doctor --fix`，但 doctor 返回"健康无异常"（不写 depsStatus）
  → 死锁，无法 --done 推进，整个 execute 卡死。

## 根因

- `provisionDeps`（src/worktree-deps.js:141）对 `generic` project.type + 无
  `commands.install` 返回 `{depsStatus: 'n/a'}`（合法放行值，enforceDepsGate run.js:2399 放行 n/a）。
- 但 in-place-fallback 分支（src/worktree.js createInPlace ~L413）创建 meta 时
  **未调 provisionDeps**，meta 缺 depsStatus。
- `enforceDepsGate` 把缺失的 depsStatus 当 unknown 阻断（run.js:2398-2421）。
- `worktree doctor` 不补 depsStatus（健康检查与 deps 门控判定逻辑不一致）。

## 影响

in-place-fallback 模式（Windows 长路径 / 沙箱限制触发）下，execute 无法 --done 推进。

## 临时修复（用户侧）

手动在 `.sillyspec/.runtime/worktrees/<change>/meta.json` 补 depsStatus 字段：

```json
{
  ...,
  "depsStatus": "n/a",
  "depsMethod": null,
  "depsSource": null,
  "depsLockHash": null,
  "depsCheckedAt": "<ISO8601 时间戳>"
}
```

依据：本项目 generic + 无 commands.install，provisionDeps 源码必然返回 n/a
（worktree-deps.js:151-153 `if (!installCmd) return {depsStatus:'n/a'}`）。
补的是 CLI 本该写的值，**非绕过门控**——真实构建/测试仍照常跑。

## 建议（工具侧修复）

优先级从高到低：
1. `createInPlace`（worktree.js）创建 meta 后调一次 `provisionDeps` 补 depsStatus
   （与 native-worktree 路径行为一致）。
2. `enforceDepsGate` 对 in-place-fallback 模式放宽：该模式下 worktreePath=主仓库，
   依赖本就来自主 checkout，无独立 deps 供给需求 → 直接放行（或按 project.type 判 n/a）。
3. `worktree doctor --fix` 应补齐缺失的 depsStatus（与 --done 门控判定一致，避免 doctor
   说"健康"但 --done 仍阻断的死锁）。

## 复现

- Windows + 长规范目录路径（archive 内含嵌套 .sillyspec/.runtime/artifacts 长文件名）
- `sillyspec run execute --change <change>` → 触发 in-place-fallback
- `sillyspec run execute --done --change <change>` → ❌ deps 门控阻断（depsStatus=unknown）
