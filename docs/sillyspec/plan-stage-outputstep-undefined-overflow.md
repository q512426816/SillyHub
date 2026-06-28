# SillySpec 工具缺陷：plan 阶段 outputStep step 数组越界（step.name undefined 崩溃）

- 发现时间：2026-06-28
- sillyspec 版本：当前 nvm v24.15.0 全局安装版
- 文件：`node_modules/sillyspec/src/run.js`
- 关联：[[defsteps-tdz-crash-plan-stage]]（该 bug 本机补丁后的衍生问题）

## 现象
`sillyspec run plan --done --change <变更>` 在 plan 阶段 step 2 完成后、进入 step 3 时崩溃：
```
✅ Step 2/4 完成：生成分级计划与自检
---
stage: plan
step: 3/2
file:///.../sillyspec/src/run.js:645
  console.log(`stepName: ${step.name}`)
                                ^
TypeError: Cannot read properties of undefined (reading 'name')
    at outputStep (run.js:645:33)
    at completeStep (run.js:2984:11)
```

注意 total 步数显示前后不一致：step 1/3 → step 2/4（完成）→ step 3/2（崩溃）。

## 根因（推断）
`[[defsteps-tdz-crash-plan-stage]]` 记录的 plan 阶段 `defSteps` TDZ 崩溃，本机打了补丁（在 `completeStep` plan 分支补 `const defSteps = await getStageSteps(...)`）。补丁让 defSteps 不再 TDZ 崩，但：

- `getStageSteps('plan', ...)` 返回的 step 数组**实际长度**（约 2）< plan 流程的 **totalSteps**（progress 记 4）；
- `completeStep` 推进到 `currentIdx=2`（第 3 步）时，`defSteps[2]` 为 `undefined`；
- `outputStep`（run.js:645）读取 `step.name` → `undefined.name` → TypeError。

即 step 定义数量（getStageSteps 返回）与流程期望步数（progress.totalSteps）不一致，越界访问未做边界检查。

## 复现
1. 任一变更完成 brainstorm，进入 plan 阶段
2. `sillyspec run plan --change <变更>`（step 1/3 正常）
3. `sillyspec run plan --done ...`（step 2/4 完成）
4. 自动推进 step 3 时崩溃（step 3/2，name undefined）

## 影响
阻塞 plan 阶段 step 3 及后续。但 plan.md 核心产出（step 2 生成）已完成，不阻塞实际工程进展。

## 临时 workaround
plan.md 已在 step 2 生成且自检通过，step 3 多为"用户确认 plan"之类。直接绕过：
- 人工向用户展示 plan.md 摘要并确认；
- 用户确认后直接进入 execute 阶段（`sillyspec run execute --change <变更>`）。
- 不依赖 sillyspec 走完 plan 的 step 3。

## 建议正式修复（sillyspec 源仓库）
1. `completeStep` / `outputStep` 对 `defSteps[currentIdx]` 加边界检查：`if (!step) { /* total 与定义不一致，收敛流程 */ return; }`；
2. 核对 `getStageSteps('plan')` 返回的 step 数组长度与写入 progress.totalSteps 的值是否一致（plan 阶段 full/light/none 分支可能动态改变 step 数，但 total 未同步）；
3. 与 `defsteps-tdz-crash-plan-stage` 一并修复（同一 plan 阶段 step 定义/索引管理的根本问题）。
