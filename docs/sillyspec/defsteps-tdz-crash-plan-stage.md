# SillySpec 工具缺陷：plan 阶段 completeStep 引用未定义的 defSteps（TDZ 崩溃）

- 发现时间：2026-06-26
- sillyspec 版本：当前 nvm v24.15.0 全局安装版
- 文件：`node_modules/sillyspec/src/run.js`

## 现象
`sillyspec run plan --done` 在 plan 阶段任一 step 完成时崩溃：
```
ReferenceError: Cannot access 'defSteps' before initialization
    at completeStep (run.js:2205)
```
brainstorm 阶段 `--done` 不受影响（不进 plan 分支）。

## 根因
`completeStep`（run.js:2092）自身作用域内**没有定义 `defSteps`**（它只在 `runCommand`:1704 与另一处 :1879 的作用域里 `const defSteps = await getStageSteps(...)`）。但 completeStep 的 plan 分支（:2205 `const currentStepDef = defSteps?.[currentIdx]`）直接引用 `defSteps`。JS 对未初始化的 `const`（TDZ）抛 ReferenceError。

`defSteps?.[currentIdx]` 的可选链写法暗示原作者预期 defSteps 可能为 undefined，但 TDZ 在运行时直接抛错，可选链根本没机会生效。

## 临时 workaround（本机 node_modules）
在 run.js:2205 之前补一行，用 module-scope 的 `getStageSteps`（:507）按需解析：
```js
if (stageName === 'plan') {
  const defSteps = await getStageSteps(stageName, cwd, progress, options?.platformOpts?.specRoot || null)
  const currentStepDef = defSteps?.[currentIdx]
  ...
```
打补丁后 `sillyspec run plan` 正常推进。

## 建议正式修复（sillyspec 源仓库）
`completeStep` 函数顶部统一解析一次 `defSteps = await getStageSteps(stageName, cwd, progress, specDir)`（与 runCommand:1704 / :1879 一致），plan/scan 分支复用。避免在分支里重复解析。

## 备注
- 此为 sillyspec CLI 自身 bug，与本项目代码无关。
- 本机已打临时 workaround 继续推进 plan 阶段。
