---
id: task-07
title: "[B4][sillyspec] checkTransition failed_post_check 门控 + workflow anyFailed 阻断"
priority: P0
depends_on: [task-06]
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-004@v1]
allowed_paths:
  - C:\Users\qinyi\IdeaProjects\sillyspec\src\stage-contract.js
  - C:\Users\qinyi\IdeaProjects\sillyspec\src\run.js
author: qinyi
created_at: 2026-06-22T21:19:09
---
# task-07: [B4][sillyspec] checkTransition failed_post_check 门控 + workflow anyFailed 阻断

## 修改文件
- `C:\Users\qinyi\IdeaProjects\sillyspec\src\stage-contract.js`
  - 第 592 行：`export function checkTransition(fromStage, toStage)`，目前签名**仅**接收 from/to 阶段名，不读 stageData
- `C:\Users\qinyi\IdeaProjects\sillyspec\src\run.js`
  - 第 1415-1427 行：`runStage` 内 `const transition = checkTransition(prevStage, stageName)` 调用点（需改签名传参）
  - 第 2620-2675 行：scan "深度扫描" step 后的 workflow post_check 段，`anyFailed` 只 console.log 不阻断（:2668-2670）

## 覆盖来源 (design.md §4.3 / requirements.md FR-03)
- design.md §4.3 修复 3：`stage-contract.js:592` `checkTransition` 加防御——`stageData.status==='failed_post_check'` 时从 scan 进下游阶段 `return {allowed:false, reason:'scan post-check 未通过，需修复重跑'}`。
- design.md §4.3 修复 4：`run.js:2645-2670` workflow post_check 的 `anyFailed` 触发 `return {stageCompleted:false}`（B1 那套同样只报不挡）。
- requirements.md FR-03：scan post-check 未通过时，阻断向 brainstorm/plan/execute 推进。

## 实现要求 (编号步骤)
1. **扩展 checkTransition 签名**：`stage-contract.js:592` 改为
   ```js
   export function checkTransition(fromStage, toStage, options = {}) {
     const { fromStageData } = options  // { status?: string } | undefined
     ...
   }
   ```
   保留第 3 位 options 为可选，旧调用（只传 2 参）完全兼容。
2. **加 failed_post_check 门控**：在第 592 行函数体开头、第 593 行 `const contract = contracts[toStage]` 之后，插入：
   ```js
   if (fromStage === 'scan' && fromStageData?.status === 'failed_post_check' && toStage !== 'scan') {
     return {
       allowed: false,
       reason: 'scan post-check 未通过（failed_post_check），需修复后重跑 scan 再进入 ' + toStage,
     }
   }
   ```
   - 必须放在第 599 行 `auxiliaryStages.includes(toStage)` 早返之前？**不**——辅助阶段（doctor/status）允许跑（用户可能要诊断）；只阻断进 brainstorm/plan/execute/verify/archive 主流程。因此插在 toStage 非 scan 且 fromStage==='scan' 的主流程检查路径上（第 634 行主流程跳转检查前后均可）。**推荐位置：第 626 行 `if (!fromStage)` 之前**，确保所有主流程跳转分支都被覆盖。
3. **run.js 调用点传参**：`run.js:1419` 改为
   ```js
   const fromStageData = progress.stages?.[prevStage] || undefined
   const transition = checkTransition(prevStage, stageName, { fromStageData })
   ```
4. **workflow post_check anyFailed 阻断**：`run.js:2668-2670` 修改为
   ```js
   if (anyFailed) {
     console.log(`\n⚠️ 存在检查失败项，请按上面的重试提示修复后再继续。`)
     return { stageCompleted: false, currentIdx, nextPendingIdx: currentIdx }
   }
   ```
   - 注意此分支在 `runStage` 函数尾部（非平台模式 scan 完成路径 :2606 之后的 step 推进路径），返回结构与 task-06 失败分支一致。
5. **扫描器辅助阶段允许**：`auxiliaryStages`（`stages/index.js:29`）含 `scan`，所以 `sillyspec run scan` 同阶段重跑（修复后重扫）走第 603-606 行 `fromStage === toStage` 允许——这是修复路径，不能被门控挡。
6. **门控消息可读**：reason 字符串包含"failed_post_check"和"重跑 scan"提示，用户能看到具体动作。

## 接口定义 (函数签名/DTO)
- checkTransition 新签名：
  ```ts
  function checkTransition(
    fromStage: string,
    toStage: string,
    options?: {
      fromStageData?: { status?: string } | undefined
    }
  ): { allowed: boolean; reason?: string }
  ```
- options 第 3 位可选，省略时行为与旧版完全相同（向后兼容）。
- run.js 调用点从 `progress.stages[prevStage]` 提取 `{ status }` 传入；progress.stages 结构由 `stages/index.js` 定义，scan stage data 含 status 字段（task-06 写入）。

## 边界处理 (≥5条)
1. **failed_post_check 从 scan 进 brainstorm/plan/execute 被拦**：reason 明确提示"重跑 scan"，exit 1（已有 :1425 process.exit(1)）。
2. **--reset 后 status 重置允许 transition**：若 progress 被 `sillyspec reset` 重置（status 变回 pending/in_progress），门控放行。本任务不实现 reset，但确保门控只看当前 status 字段，不缓存历史。
3. **scan 在 auxiliaryStages 的 transition 规则**：`stages/index.js:29` `auxiliaryStages = ['scan','quick','explore','archive','status','doctor']`，scan 既是主流程起点又是辅助阶段——门控只对 `fromStage==='scan' && status==='failed_post_check'` 生效，其他状态（completed/in_progress）不受影响。
4. **stageData 可能无 status 字段（旧数据）**：用可选链 `fromStageData?.status === 'failed_post_check'`，旧 progress.json 无此字段时 `undefined === 'failed_post_check'` 为 false，门控不触发——向后兼容（design.md §9）。
5. **workflow 门控与 transition 双重防御**：`run.js:2668` workflow anyFailed 阻断在**同阶段 step 推进路径**（scan 内部），`stage-contract.js:592` 门控在**跨阶段 transition**——两层独立，任意一层未改也能挡住一部分（defense in depth）。
6. **skip-approval 绕过保留**：`run.js:1424` 已有 `if (!skipApproval)` 守卫，用户显式 `--skip-approval` 可绕过门控（紧急逃生通道，符合现有设计）；本任务不修改此行为。
7. **toStage === 'scan' 不门控**：允许 `sillyspec run scan` 重跑修复（fromStage==='scan' && toStage==='scan'），第 3 步 if 条件 `toStage !== 'scan'` 守住此路径。

## 非目标
- 不改 `auxiliaryStages` 列表内容（task 不涉及新增辅助阶段）。
- 不改 `SCAN_STATUS` 常量值（task-06 依赖的 `'failed_post_check'` 字符串保持）。
- 不实现 `sillyspec reset` 命令（如有）。
- 不改 brainstorm/plan/execute/archive 自身的 stage 合约 allowedFrom。
- 不合并 workflow post_check（B1 那套）与 scan-postcheck.js（C1 平台模式那套）。

## TDD 步骤
1. **Red**：`sillyspec/test/stage-contract.test.js` 新增用例
   ```js
   assert.equal(
     checkTransition('scan', 'brainstorm', { fromStageData: { status: 'failed_post_check' } }).allowed,
     false
   )
   assert.match(result.reason, /scan post-check 未通过/)
   ```
2. **Green**：按"实现要求"步骤 2 插入门控。
3. **Red**：补兼容性用例
   - `checkTransition('scan', 'brainstorm')`（无 options）→ 行为同旧版（按 allowedFrom 规则）
   - `checkTransition('scan', 'brainstorm', { fromStageData: { status: 'completed' } })` → allowed
   - `checkTransition('scan', 'scan', { fromStageData: { status: 'failed_post_check' } })` → allowed（允许重跑）
   - `checkTransition('scan', 'doctor', { fromStageData: { status: 'failed_post_check' } })` → allowed（doctor 辅助阶段允许）
4. **Green**：确认所有用例通过。
5. **Red**：`sillyspec/test/run-scan-workflow-block.test.js` mock `runPostCheck` 返回 `{status:'fail'}`，调用 `runStage(...)` 走 :2621 workflow 分支，断言返回 `{stageCompleted:false, nextPendingIdx:currentIdx}`。
6. **Green**：按"实现要求"步骤 4 修改 :2668-2670。
7. **集成**：手动制造 failed_post_check 状态的 progress.json，跑 `sillyspec run brainstorm --done`，确认被 transition 拦截 + exit 1。

## 验收标准 (表格)
| 验收点 | 期望 | 验证方式 |
|---|---|---|
| failed_post_check 状态下 sillyspec run brainstorm --done 被 transition 拦 | allowed=false, reason 含"scan post-check 未通过" | stage-contract 单测 |
| 允许 sillyspec run scan 重跑修复（fromStage===toStage） | allowed=true | 单测：checkTransition('scan','scan', failed_post_check) → allowed |
| 旧数据无 status 字段不误拦 | options 省略或 status 为 undefined 时行为同旧版 | 单测：checkTransition('scan','brainstorm') → 按 allowedFrom 规则 |
| workflow anyFailed 阻断推进 | runStage 返回 stageCompleted:false | run.js 集成测试 |
| skip-approval 仍可绕过 | `--skip-approval` 时 transition.allowed=false 不 exit | 手动验证 |
| 辅助阶段（doctor/status）可执行 | checkTransition('scan','doctor', failed_post_check).allowed === true | 单测 |
| 跨阶段 transition reason 可读 | 字符串含"重跑 scan"提示 | 单测断言 reason match |
