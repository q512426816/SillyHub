# execute baseline overlay 会把并行会话的半成品坏文件同步进 worktree

- **日期**：2026-09-15
- **状态**：活跃坑（待工具修复）

## 现象

`2026-09-15-background-task-permission-lockout` execute 启动时，worktree 基线
checkpoint（72a72f50）把主仓**未提交**的并行会话半成品同步了进去——其中
`sillyhub-daemon/src/interactive/codex-app-server-driver.ts` 当时是**语法坏文件**
（`import { decodeProcessOutputMaybe } ...` 插进 `import type {` 块中间，esbuild
Expected "as"），导致 worktree 内一切 import 该文件链的测试无法收集
（session-manager → driver-factory → 全部 driver）。主仓随后由并行会话提交修复
（7b80bf54），但 worktree 基线已固化坏版本。

## 影响

- execute 期 worktree 内相关测试（task-lifecycle 等经 SessionManager import 链的）
  全部收集失败，只能靠「同步主仓修复版进 worktree」自救——又导致
  `worktree assess` 判「变更文件超出 allowed_paths」BLOCKED，需要还原基线再 assess
  （多绕一整轮）。
- 生成文件（`src/build-id.ts`，gitignore）不在基线里，worktree 缺失同样炸
  `Failed to load url ./build-id.js`。

## 期望

1. baseline overlay 隔离并行会话在途文件时应**语法校验**（tsc --noEmit 单文件 /
   esbuild transform 探测）——坏的半成品不该进基线；至少给明确告警与「按主仓
   HEAD 版本取该文件」的一键选项。
2. `.gitignore` 生成物（build-id.ts）应随 worktree 供给链自动补（对齐
  node_modules junction 的处理）。
3. `worktree assess` 对「与主仓 HEAD 内容一致的文件」不应计入 changed files
  （本次 5 个文件 diff 内容=主仓 HEAD，apply 是 no-op，却被 BLOCKED）。

## 临时绕过

- 坏文件：`git show <主仓HEAD>:<path> > <worktree>/<path>` 同步修复版；assess
  前再 `git -C <worktree> checkout -- <path>` 还原基线。
- build-id.ts：从主仓 copy 一份。

## 处置记录（2026-09-16 定时收口，三期望全有着落，归档）

- **期望 2（gitignore 生成物供给）已修复**（sillyspec 仓 42cef77③）：`local.yaml worktree.supplyFiles` 新键——worktree create 时按 glob 供给生成物（上限 200/fail-open），meta.supplyFiles 留痕；build-id.ts 类 `Failed to load url ./build-id.js` 消失。
- **期望 3（assess 不计 HEAD 一致文件）已修复**（42cef77②）：`applyWorktree detectNoOpFiles`——worktree 工作区 blob = 主仓 HEAD blob 的 no-op 文件剔出 changedFiles/deletedFiles，apply/assess 同口径单点；「5 个文件 diff=主仓 HEAD 却 BLOCKED」形态消除。
- **期望 1（overlay 坏文件防护）主体已修复**（42cef77①）：baseline overlay 三道（staged/unstaged/untracked）经 **own/foreign oracle** 剔除并行会话显式声明文件（worktree 取基线 HEAD 版本）+ 隔离清单打印——本坑事故形态（并行会话的在途 codex-driver.ts）属其显式工作面，oracle 命中即取 HEAD 健版。完整语法冒烟（未声明的坏 WIP 文件 tsc/esbuild 探测）留后续增强，oracle 覆盖声明面已是主场景。
- **验证**：`test/worktree-dual-truth-gates.test.mjs` 12/12 复跑绿（overlay oracle / no-op / supply / 双根证据四组）。临时绕过（git show 同步修复版 + checkout 还原）不再需要。归档。
