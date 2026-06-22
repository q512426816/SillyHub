---
id: task-10
title: "[B3][sillyspec] 补顶层命令别名 doctor/scan/status/quick/explore 转发 runCommand"
priority: P1
depends_on: []
blocks: []
requirement_ids: [FR-06]
decision_ids: [D-004@v1]
allowed_paths:
  - C:\Users\qinyi\IdeaProjects\sillyspec\src\index.js
author: qinyi
created_at: 2026-06-22T21:19:09
---
# task-10: [B3][sillyspec] 补顶层命令别名 doctor/scan/status/quick/explore 转发 runCommand

## 修改文件
- `C:\Users\qinyi\IdeaProjects\sillyspec\src\index.js`
  - 第 44-46 行：`printUsage` help 文本里"可选阶段: scan, brainstorm, plan, execute, verify, archive / quick, explore, status, doctor" —— 宣称可用，但顶层 switch 不认
  - 第 175 行：`switch (command) {` 入口
  - 第 287-291 行：现有 `case 'run':` 转发 `runCommand(filteredArgs.slice(1), resolveEffectiveDir(dir), specDir)` —— 本任务对齐它的调用形式
  - 第 314-502 行：`case 'worktree':`（内嵌 `case 'doctor':` 子命令在 :468-495，是 worktree 健康检查，与本次新增的顶层 `sillyspec doctor` 完全不同语义，不得冲突）
  - 第 800-803 行往后：`switch` 末尾的 `default:` 分支报"未知命令"（实际文件尾在 :820，`main()` 在 :823）

## 覆盖来源 (design.md §5.2 / requirements.md FR-06)
- design.md §5.2 B3 doctor 幽灵命令：`src/index.js` switch(160-804) 缺顶层 `case 'doctor':` 等，help 列了但落到 default 分支报"未知命令"。
- design.md §5.2 修复：增 `case 'doctor':` `case 'scan':` `case 'status':` `case 'quick':` `case 'explore':`，内部转发 `runCommand([stageName, ...rest], dir, specDir)`，与 `case 'run':`(:287) 一致。
- design.md §5.2 验收：`sillyspec doctor` 和 `sillyspec run doctor` 都工作；`sillyspec scan` 同理。
- requirements.md FR-06：`sillyspec doctor` / `sillyspec scan` 等顶层命令直接可用（不再"未知命令"）。
- 辅助事实：`doctor`/`scan`/`status`/`quick`/`explore` 均已在 `C:\Users\qinyi\IdeaProjects\sillyspec\src\stages\index.js:15-26` 的 `stageRegistry` 注册（`scan`/`quick`/`explore`/`archive`/`status`/`doctor` 标 `auxiliary:true`），`sillyspec run <stage>` 已可执行，本任务只是补顶层入口别名。

## 实现要求 (编号步骤)
1. **定位插入点**：在 `index.js` 的 `switch (command)` 中，紧挨 `case 'run':`（:287-291）之后、`case 'dashboard':`（:292）之前（或在 `case 'run':` 之后任意相邻位置，保持 switch 内 case 顺序可读），新增 5 个 case。
2. **case 实现（统一转发）**：每个 case 的 body 与 `case 'run':` 完全等价 —— 把 `command` 作为 stage 名重新拼回 `filteredArgs.slice(1)` 等价的入参，调 `runCommand`：
   ```js
   case 'doctor':
   case 'scan':
   case 'status':
   case 'quick':
   case 'explore': {
     const { runCommand } = await import('./run.js');
     // 与 case 'run': 一致：把 command 当 stage 名传入（runCommand 内部会从 args[0] 取 stage）
     // filteredArgs[0] === command；filteredArgs.slice(1) 是 stage 后面的参数（--done/--json/--change 等）
     await runCommand(filteredArgs.slice(1), resolveEffectiveDir(dir), specDir);
     break;
   }
   ```
   说明：由于 `filteredArgs[0]` 已经是 `command` 本身（即 `doctor`/`scan`/...），`filteredArgs.slice(1)` 丢掉它后 `runCommand` 反而拿不到 stage 名。**正确做法**是直接透传 `filteredArgs`（包含 stage 名）或显式拼 `[command, ...filteredArgs.slice(1)]`。需在实现时验证 `runCommand` 签名（它从 `args[0]` 取 stage，所以应传 `filteredArgs`，**不 slice**）。execute 阶段需读 `src/run.js` 的 `runCommand(args, dir, specDir)` 头部确认 args[0] 是 stage 名，再决定是 `filteredArgs` 还是 `[command, ...rest]`。**推荐写法（最稳）**：
   ```js
   const stageArgs = [command, ...filteredArgs.slice(1)];
   await runCommand(stageArgs, resolveEffectiveDir(dir), specDir);
   ```
   这样不论 `filteredArgs[0]` 是否等于 `command`，都保证 stage 名在 args[0]。
3. **不破坏 worktree doctor 子命令**：`case 'worktree':`（:314）内部的 `case 'doctor':`（:468）是在 `switch (wtSubCmd)` 里，作用域隔离，与顶层 `case 'doctor':` 无命名冲突（JS switch case 标签在不同 switch 内可同名）。
4. **不新增 help 文本**：help（:44-46）已列这些阶段名，无需改动；若 help 里某阶段名拼写与 stageRegistry key 不一致（例如大小写），以 stageRegistry 为准，不改 help（超范围）。
5. **保留现有 exit code 语义**：`runCommand` 内部失败会自己 `process.exit`，新增 case 不额外包 try/catch 改写退出码。

## 接口定义 (函数签名/DTO)
- 顶层 switch 新增 5 个 case 标签：`'doctor' | 'scan' | 'status' | 'quick' | 'explore'`。
- 转发签名（复用现有）：`runCommand(args: string[], dir: string, specDir: string | undefined): Promise<void>`（来自 `./run.js`，:288 已 dynamic import）。
- 入参构造：`stageArgs = [command, ...filteredArgs.slice(1)]`，确保 `stageArgs[0]` 是 stage 名。

## 边界处理 (≥5条)
1. **worktree doctor 子命令不冲突**：`case 'worktree':`（:314-502）内 `switch (wtSubCmd)` 的 `case 'doctor':`（:468）是 worktree 健康检查（调 `wm.doctor`），与顶层 `sillyspec doctor`（调 `runCommand` 跑 doctor 阶段）语义不同但命名合法 —— JS 嵌套 switch 的 case 标签独立，不冲突。验证方式：`sillyspec worktree doctor` 仍走 worktree 分支，`sillyspec doctor` 走新顶层分支。
2. **参数透传**：`--json` / `--change <name>` / `--fix`（doctor 的修复选项）/ `--spec-dir <path>` 等通用选项必须原样透传到 `runCommand`。由于 `filteredArgs` 是顶层已解析的剩余参数，`slice(1)` 去掉 stage 名后剩余选项保留；`stageArgs = [command, ...rest]` 重组后 `runCommand` 仍能正确解析。
3. **未知 stage 仍报错**：若用户写 `sillyspec foobar`，没有对应 case，落 default 分支报"未知命令"（:800+），行为不变。本次只加 5 个已知 stage，不开"任意字符串都转发 run"的口子（避免误把 `init`/`setup`/`progress` 等 case 之外的命令误转发）。
4. **case fall-through 规避**：5 个 case 共享同一 body 时，用连续 `case 'doctor': case 'scan': ... { ... }` 语法（C 风格 fall-through），最后一个 case 带 `{ body; break; }`。或每个 case 独立写 body（冗余但清晰）。**禁止**忘记 `break` 导致穿透到下一个不相关 case（如 `dashboard`）。
5. **与 `case 'run':` 行为完全一致**：同一 stage 名（如 `doctor`）无论走 `sillyspec doctor` 还是 `sillyspec run doctor`，`runCommand` 拿到的 args 必须等价。验证：`runCommand(['doctor'], dir, specDir)`（来自 `sillyspec doctor`）与 `runCommand(['doctor'], dir, specDir)`（来自 `sillyspec run doctor`，`filteredArgs.slice(1)` 去掉 `run` 留 `['doctor']`）字节一致。
6. **`filteredArgs` vs `args`**：index.js 里有两个变量 —— `args`（原始 process.argv.slice(2)）和 `filteredArgs`（已剥离 `--json`/`--tool`/`--dir` 等顶层选项后的位置参数）。`case 'run':` 用的是 `filteredArgs.slice(1)`（:289），本任务必须对齐用 `filteredArgs`，**不要误用 `args`**（会包含 `--json` 等顶层选项导致 runCommand 解析混乱）。验证：读 :80-130 顶部选项解析逻辑确认 `filteredArgs` 定义。

## 非目标
- 不合并/重命名 `case 'worktree':` 内的 `doctor` 子命令（worktree doctor 是独立功能）。
- 不改 help 文本（:44-46 已正确）。
- 不改 `runCommand` 内部逻辑（本任务只是补路由）。
- 不加 `archive` 顶层别名（archive 已在 stageRegistry，但 design §5.2 只点名 doctor/scan/status/quick/explore；archive 可后续按需补，不在本任务范围）。
- 不改 sillyspec 全局安装方式（`npm link` 属 task-01 范围）。

## TDD 步骤
1. **Red**：新增测试 `sillyspec/test/cli-top-level-aliases.test.js`，spawn 子进程 `node src/index.js doctor --spec-dir <tmp>`（或在 tmp 项目目录），断言：
   - exit code 0（doctor 跑完不报未知命令）
   - stdout 不含 "未知命令" / "unknown command"
   - 实际调用了 doctor 阶段（可 mock `runCommand` 用 `--json` 输出断言 stage==='doctor'）
2. **Green**：在 `index.js:287` 后新增 5 个 case，跑测试通过。
3. **Red**：对 `scan` / `status` / `quick` / `explore` 各补一个用例（最小：只断言不落 default 报错；进阶：断言转发到 runCommand 的 stage 名正确）。
4. **Green**：5 个 case 全部生效，测试通过。
5. **回归**：
   - `sillyspec run doctor` 仍可用（`case 'run':` 未动）
   - `sillyspec worktree doctor` 仍走 worktree 分支（worktree 内 case 未动）
   - `sillyspec foobar` 仍报"未知命令"（default 分支未动）
6. **手动验证**：`npm link` 后在任意项目目录跑 `sillyspec doctor`、`sillyspec scan`，确认行为与 `sillyspec run doctor`、`sillyspec run scan` 完全一致。

## 验收标准 (表格)
| 验收点 | 期望 | 验证方式 |
|---|---|---|
| `sillyspec doctor` 可用 | exit 0，不报"未知命令"，走 doctor 阶段 | 子进程 spawn + stdout 断言 |
| `sillyspec scan` 可用 | exit 0（或 scan 自身 exit code），不报"未知命令" | 同上 |
| `sillyspec status` / `quick` / `explore` 可用 | 三者均不报"未知命令" | 同上 |
| `sillyspec run doctor` 仍可用 | 行为不变 | 回归测试 |
| `sillyspec worktree doctor` 仍可用 | 走 worktree 健康检查分支，不受新 case 影响 | 回归测试（:468 分支） |
| `sillyspec foobar` 仍报未知命令 | default 分支行为不变 | 负向测试 |
| 选项透传 | `sillyspec doctor --json` / `--change xxx` / `--fix` 正确传到 runCommand | mock runCommand 断言 args |
| 行为与 `sillyspec run <stage>` 字节一致 | 同 stage 名两路径 runCommand 入参相同 | 代码 diff / 单测对比 |
