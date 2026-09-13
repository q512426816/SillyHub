# verify noAI 沙箱混入并行会话 baseline overlay 部分态（ImportError 假败）

- 状态：活跃坑（待工具修复）
- 发现：2026-09-13，2026-09-13-ctx-usage-all-providers verify

## 现象

verify `--done` 的 noAI 质量扫描在隔离快照（`Temp/sillyspec-gate-*`）跑 backend 模块子集，
197 个测试 ERROR：`ImportError: cannot import name 'get_project_workspace_map' from
'app.modules.daemon.group.service.crud'`——该函数在快照的 crud.py 里不存在，但快照里另一
批文件引用它。主仓单跑同一批测试全绿。

## 根因

execute 启动时 CLI 把主仓**当时未提交的并行会话在途文件**（baseline overlay，本例 13 个）
作为 baseline checkpoint 提交进 worktree 分支；verify 快照 = HEAD + worktree overlay。并行
会话的在途改动是**部分态**（改了引用方没改被引用方、或反之），overlay 只截取了其中一部分
文件 → 快照内 import 图不闭合。与本变更代码零相关，但模块子集测试按「快照里该模块全部测试」
跑，殃及池鱼。

另一同源坑：快照不含 gitignored 生成物（`sillyhub-daemon/src/build-id.ts`，postinstall 产
出），daemon.ts 的 `./build-id.js` import 加载失败 48 行——见
`finished/worktree-deps-install-whitelist-rejects-chained-commands.md`（worktree 侧同坑）。

## 绕过（本次实证）

1. 先在主仓单跑快照里失败的测试文件定归属：主仓绿 → 快照环境问题；主仓红 → 并行在途债
   （G/K 组先例）。
2. CLI 自带对照通道：`SILLYSPEC_VERIFY_GATE_SNAPSHOT_OFF=1` 回退主仓真实态复跑（本次主仓
   232 passed 仅剩 1 个并行债用例）。
3. known_failures 按组留痕豁免（本次 J=build-id 沙箱缺生成物 / K=group_chat 并行债 /
   L·L-1=frontend 满载 flaky），local.yaml 注释含归因与复核条件。
4. lint 链主仓全量 >180s 超时时：沙箱已实测 exit 0 留痕 + `SILLYSPEC_VERIFY_LINT_GATE=
   advisory`（75e579d88 先例）。

## 修复建议（工具侧）

1. 快照构建时对 overlay 文件做 import 闭合冒烟（python -c import / vitest load）或在沙箱
   补跑各子项目 postinstall 生成脚本；
2. 或 baseline overlay 只收**本变更 allowed_paths 命中的文件**，不收并行会话在途文件；
3. 模块子集失败时自动输出「主仓单跑对照」提示（当前只有失败疑点排查顺序文案，需手动执行）。
