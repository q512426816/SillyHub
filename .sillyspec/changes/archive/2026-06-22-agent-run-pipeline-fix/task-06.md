---
id: task-06
title: "[B4][sillyspec] scan post-check 失败补 return + completed 标记推迟 + 平台模式 exit(1)"
priority: P0
depends_on: []
blocks: [task-07]
requirement_ids: [FR-03]
decision_ids: [D-004@v1]
allowed_paths:
  - C:\Users\qinyi\IdeaProjects\sillyspec\src\run.js
author: qinyi
created_at: 2026-06-22T21:19:09
---
# task-06: [B4][sillyspec] scan post-check 失败补 return + completed 标记推迟 + 平台模式 exit(1)

## 修改文件
- `C:\Users\qinyi\IdeaProjects\sillyspec\src\run.js`
  - 第 2323 行：`stageData.status = 'completed'` 无条件赋值（在 post-check 之前）
  - 第 2433-2438 行：post-check 失败分支只改 status + console.error，无 return
  - 第 2439-2444 行：completed_with_warnings 分支（参照）
  - 第 2336-2448 行：scan 平台模式 post-check 整段 try/catch（被包裹在第 2337 行 if 条件内）

## 覆盖来源 (design.md §4.3 / requirements.md FR-03)
- design.md §4.3 B4 门控失效：根因是 `run.js:2433-2438` 失败分支无 return，控制流穿透到 `run.js:2603` 无条件 `return {stageCompleted:true}`；对照 plan contract `:2551` 失败时 `return {stageCompleted:false}` 写对了。
- design.md §4.3 修复 1+2：失败分支末尾补 `return { stageCompleted:false, currentIdx, nextPendingIdx: currentIdx }`；平台模式追加 `process.exit(1)`；`stageData.status='completed'`（:2323）推迟到 post-check 通过后。
- requirements.md FR-03：post-check 失败时阻断 scan 推进。

## 实现要求 (编号步骤)
1. **推迟 completed 标记**：将 `run.js:2323-2327` 的 `stageData.status='completed'` + `completedAt` + `_write` + `triggerSync` 这一组无条件赋值，迁移到第 2337 行 `if (stageName === 'scan' && (platformOpts.specRoot || platformOpts.runtimeRoot)) { ... }` post-check 块的**成功路径之后**（即第 2444 行 `else if (completed_with_warnings)` 分支末尾，或第 2438 行 failed 分支之外的成功路径）。对**非 scan 阶段**（或非平台模式 scan）仍保留原位置提前标记。
   - 简化方案：保留 :2323 提前标记，但 **:2433-2438 failed 分支在改写 status 后，立即重写 stageData 并 return**，避免穿透。优先选简化方案（影响面小，且 :2439-2444 warnings 分支已示范"重写 status"模式）。
2. **失败分支补 return**：`run.js:2433-2438` 失败分支末尾（第 2438 行 `console.error` 之后、`}` 之前）增加：
   ```js
   if (platformOpts.specRoot || platformOpts.runtimeRoot) {
     console.error('   平台模式：CLI 将以 exit code 1 退出，通知 SillyHub scan 失败。')
     process.exit(1)
   }
   return { stageCompleted: false, currentIdx, nextPendingIdx: currentIdx }
   ```
3. **接口对齐 plan contract**：返回结构必须与 `run.js:2551` 完全一致 `{ stageCompleted: false, currentIdx, nextPendingIdx: currentIdx }`，让上层 `runStage` 走同一条"完成但不推进"分支。
4. **try/catch 边界**：当前第 2337-2447 行整段在 try 中（catch 在 :2445），catch 只 console.warn 不阻断——保持不变，post-check 自身异常（如 scan-postcheck.js 抛错）继续走 catch 不影响失败语义；但**正常 status==='failed_post_check' 不应进 catch**（它是业务结果不是异常）。
5. **验证 status 来源**：第 2434 行 `SCAN_STATUS.FAILED_POST_CHECK` 常量（来自 `./constants.js:14`）保持不变，确保 `stageData.status === 'failed_post_check'`（task-07 依赖此字符串）。
6. **回写触发**：失败分支已调 `pm._write(cwd, progress, changeName)`（:2436）但**未调 `triggerSync`**——补 `triggerSync(cwd, changeName, platformOpts)` 让平台侧能感知状态变更（可选，与 :2327 一致即可）。

## 接口定义 (函数签名/DTO)
- `runStage(...)` 返回值契约（与 :2551 plan 分支对齐）：
  ```ts
  type RunStageResult = {
    stageCompleted: boolean  // false 表示阶段未通过门控，不推进
    currentIdx: number       // 当前 step 索引
    nextPendingIdx: number   // 下一个 pending step（失败时 == currentIdx）
  }
  ```
- 失败分支返回：`{ stageCompleted: false, currentIdx, nextPendingIdx: currentIdx }`
- 成功分支保持：`{ stageCompleted: true, currentIdx, nextPendingIdx: -1 }`（:2603）

## 边界处理 (≥5条)
1. **非平台模式不 exit**：本地 `sillyspec run scan --done` 在源码目录跑时，platformOpts.specRoot/runtimeRoot 为空 → 只 `return false`，不 process.exit(1)，避免误杀本地交互式 CLI。
2. **currentIdx / nextPendingIdx 语义**：失败时 `nextPendingIdx: currentIdx` 表示"重跑当前 step"，与 plan contract :2551 一致；上层据此决定提示用户修复。
3. **post-check 抛异常不被吞**：第 2337 行 try/catch 的 catch（:2445）仅 warn，不会把 `failed_post_check` 业务状态包成异常；新增 return 只在 status==='failed_post_check' 显式分支生效，catch 路径仍穿透（已知行为，本任务不修）。
4. **已 completed 变更重跑**：用户若对已 completed 的 scan 再次 `--done`，:2323 会重写 status；新增 return 不影响该路径（postResult.status 此时通常为 completed）。如已 failed_post_check 再次 --done，走失败分支再 return false（幂等）。
5. **exit(1) 让 daemon/SillyHub 感知**：daemon 调 sillyspec 子进程时拿到非 0 退出码，SessionManager/TaskRunner 据此把 AgentRun.status 标 failed；SillyHub 前端可显示 scan 失败。需确认 daemon 不会因 exit(1) 把已写入的 manifest.json 回滚（manifest 在 :2419 已 writeFileSync，exit(1) 不会撤销）。
6. **completed 标记语义保留**：平台模式 scan 在 failed 分支已将 status 改写为 `failed_post_check`（:2434）覆盖了 :2323 的 completed——即 :2323 提前标记被 :2434 覆盖，最终状态正确。简化方案依赖此覆盖顺序，需确保 :2434 的赋值在 :2323 之后（同函数顺序执行，满足）。

## 非目标
- 不改 `run.js:2645-2670` workflow post_check 的 anyFailed 阻断（属 task-07）。
- 不改 `stage-contract.js:592` checkTransition 门控（属 task-07）。
- 不重构两套 post-check（workflow.js + scan-postcheck.js）的合并。
- 不改非 scan 阶段（brainstorm/plan/execute/archive）的完成语义。
- 不改 manifest.json 写入路径或字段结构。

## TDD 步骤
1. **Red**：新增测试 `sillyspec/test/run-scan-postcheck-fail.test.js`（或扩展现有 test），mock `runScanPostCheck` 返回 `{status:'failed_post_check', checks:[...]}`，调用 `runStage(...scan done, platformOpts={specRoot:'<tmp>'})`，断言：
   - 返回值 `{stageCompleted:false, nextPendingIdx: currentIdx}`
   - `progress.stages.scan.status === 'failed_post_check'`
   - 平台模式下 `process.exit` 被 spy 调用（用 Sinon stub `process.exit(1)` 避免真退出）
2. **Green**：按"实现要求"补 return + exit，跑测试通过。
3. **Red**：再补一个非平台模式用例（platformOpts={}），断言 return false 但 `process.exit` **未**被调用。
4. **Green**：确认 if 条件 `platformOpts.specRoot || platformOpts.runtimeRoot` 守住 exit。
5. **手动验证**：在 `myaaa` 目录对故意残缺的 scan 产出跑 `sillyspec run scan --done --spec-root <tmp>`，确认：
   - 控制台输出 `❌ scan post-check 失败`
   - `echo $?`（bash）或 `%ERRORLEVEL%`（cmd）为 1
   - progress.json 中 stage scan.status = failed_post_check
6. **回归**：跑 `sillyspec/test/` 全套 scan 相关测试，确认未破坏 happy path（completed / completed_with_warnings）。

## 验收标准 (表格)
| 验收点 | 期望 | 验证方式 |
|---|---|---|
| post-check 失败时 --done 被拒 | `runStage` 返回 `stageCompleted:false`，currentStep 不推进 | 单测断言 + progress.json 检查 |
| CLI exit code 1（平台模式） | `process.exit(1)` 被调用，daemon 收到非0退出码 | 单测 spy process.exit + 手动 `echo $?` |
| stage 状态 failed_post_check | `progress.stages.scan.status === 'failed_post_check'` | 读 progress.json |
| 对照 plan contract 行为一致 | 失败分支返回结构与 `run.js:2551` 完全相同（键名+值语义） | 代码 diff 比对 |
| 非平台模式不 exit | platformOpts 为空时仅 return false | 单测 |
| completed_with_warnings 仍推进 | warnings 分支（:2439）不受影响，status='completed' | 现有测试回归 |
| manifest.json 已写入保留 | exit(1) 之前 manifest.json 已落盘 | 检查 spec_root 下 manifest.json 存在 |
