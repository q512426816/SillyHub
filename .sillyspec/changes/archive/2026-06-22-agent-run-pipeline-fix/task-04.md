---
id: task-04
title: "[B1][sillyspec] workflow.js checkOutput/_checkWorkflow 用 specBase 替代裸 cwd"
priority: P0
depends_on: []
blocks: [task-05]
requirement_ids: [FR-02]
decision_ids: [D-004@v1]
allowed_paths:
  - sillyspec/src/workflow.js
  - sillyspec/src/run.js
author: qinyi
created_at: 2026-06-22T21:19:09
---

# task-04: [B1][sillyspec] workflow.js checkOutput/_checkWorkflow 用 specBase 替代裸 cwd

## 修改文件

- `sillyspec/src/workflow.js:152-156`（`checkOutput(outputDef, projectName, cwd)` 签名 + `resolve(cwd, rawPath)`）— 增加 `specBase` 参数，`resolve(specBase, rawPath)` 替代 `resolve(cwd, rawPath)`
- `sillyspec/src/workflow.js:244-254`（`runPostCheck(wf, cwd, projectName, placeholders)` 签名 + 调 `_checkWorkflow`）— 增加 `specBase` 参数（第 4 位，placeholders 之后或之前，见实现要求），透传给 `_checkWorkflow`
- `sillyspec/src/workflow.js:256`（`_checkWorkflow(wf, cwd, projectName)` 签名）— 增加 `specBase` 参数
- `sillyspec/src/workflow.js:265-275`（`_checkWorkflow` 内遍历 roles 调 `checkOutput(outputDef, projectName, cwd)`）— 改为 `checkOutput(outputDef, projectName, specBase)`
- `sillyspec/src/workflow.js:312`（`const scanDir = join(cwd, '.sillyspec', 'docs', projectName, ...)`）— 改为 `join(specBase, 'docs', projectName, ...)`（specBase 已含 .sillyspec 或外部 specRoot）
- `sillyspec/src/workflow.js:331`（同 :312 的 no_empty_files 分支）— 改为 `join(specBase, 'docs', projectName, ...)`
- `sillyspec/src/run.js:2624`（`loadWorkflow(cwd, 'scan-docs')`）— 保持不变（loadWorkflow 用 cwd 找 workflow 文件，不受影响）
- `sillyspec/src/run.js:2647`（`runPostCheck(wf, cwd, pName)`）— 改为 `runPostCheck(wf, cwd, pName, specBase)`
- `sillyspec/src/run.js:2685`（archive 分支 `runPostCheck(resolved, cwd, 'sillyspec')`）— 改为 `runPostCheck(resolved, cwd, 'sillyspec', specBase)`
- `sillyspec/src/run.js:2638`（既有 `const projectsDir = join(specBase, 'projects')`）— 确认 `specBase` 变量已定义；若 :2620 作用域内 specBase 未定义，需在 scan post_check 块顶部补 `const specBase = platformOpts?.specRoot || join(cwd, '.sillyspec')`

**注**：sillyspec 仓库在 `C:\Users\qinyi\IdeaProjects\sillyspec`，不在本仓库内。改动在 sillyspec 源码改 + git 提交，提交信息回引本变更名（design §7 D-004）。

## 覆盖来源

- design.md §4.2 B1（workflow.js 硬编码 `.sillyspec`，resolve(cwd, rawPath)）
- design.md §4.2 修复步骤 1+2（run.js 调 runPostCheck 传 specBase；workflow.js checkOutput/_checkWorkflow 用 specBase）
- design.md §7 D-004 跨仓库管理（sillyspec 源码改 + npm link 全局生效）
- requirements.md FR-02

## 实现要求

1. **workflow.js `checkOutput` 签名扩展**（:152）：
   ```js
   function checkOutput(outputDef, projectName, cwd, specBase) {
     const effectiveBase = specBase || join(cwd, '.sillyspec')
     const rawPath = (outputDef.path || '').replace(/<project>/g, projectName)
     // 关键：用 specBase（可能是 platformOpts.specRoot，已含或不含 .sillyspec）
     // 替代裸 cwd。specBase 语义：docs/projects/changes/workflows 目录的父。
     const fullPath = resolve(effectiveBase, rawPath)
     // ...
   }
   ```
   `join` / `resolve` 已从 `node:path` import（workflow.js 顶部）。`cwd` 形参保留向后兼容（旧调用方仍传 cwd）。
2. **workflow.js `runPostCheck` 签名扩展**（:244）：
   ```js
   export function runPostCheck(wf, cwd, projectName, placeholders = {}, specBase) {
     // ... 既有 replaceProjectPlaceholder / placeholders 替换
     return _checkWorkflow(resolved, cwd, projectName, specBase)
   }
   ```
   **注意签名顺序**：`placeholders` 是第 4 位已有默认值 `{}`，`specBase` 加到第 5 位避免破坏既有调用。run.js:2647 调用 `runPostCheck(wf, cwd, pName)` 不传 placeholders，需改为 `runPostCheck(wf, cwd, pName, {}, specBase)` 显式传空 placeholders + specBase。
3. **workflow.js `_checkWorkflow` 签名扩展**（:256）：
   ```js
   function _checkWorkflow(wf, cwd, projectName, specBase) {
     const effectiveBase = specBase || join(cwd, '.sillyspec')
     // ...
     // :273 checkOutput 调用改为：
     const checkResults = checkOutput(outputDef, projectName, cwd, effectiveBase)
     // ...
   }
   ```
4. **workflow.js `join(cwd, '.sillyspec', ...)` 替换**（:312 / :331）：
   - `const scanDir = join(cwd, '.sillyspec', 'docs', projectName, check.path || 'scan/')` → `join(effectiveBase, 'docs', projectName, check.path || 'scan/')`
   - 注意：`effectiveBase` 已含 `.sillyspec` 语义（`platformOpts.specRoot` 指向 specDir 本身，见 run.js:633-634 注释 `platformOpts.specRoot 现在指向 specDir 本身`）；非平台模式 `effectiveBase = join(cwd, '.sillyspec')`。所以 `join(effectiveBase, 'docs', ...)` 是正确路径（不再额外拼 `.sillyspec`）。
5. **run.js scan post_check 块顶部补 specBase**（:2620 附近）：
   ```js
   if (stageName === 'scan' && steps[currentIdx]?.name?.includes('深度扫描')) {
     const specBase = platformOpts?.specRoot || join(cwd, '.sillyspec')
     try {
       // ... 既有逻辑
   ```
   确认 `platformOpts` 在该作用域可见（run.js 上文已定义 platformOpts，:631 `platformOpts?.specRoot` 已用）。`join` / `existsSync` / `readdirSync` 已 import。
6. **run.js:2647 调用改**：
   ```js
   const result = runPostCheck(wf, cwd, pName, {}, specBase)
   ```
7. **run.js archive post_check 块（:2677-2685）同步**：在 `if (stageName === 'archive' ...)` 块顶部补 `const specBase = platformOpts?.specRoot || join(cwd, '.sillyspec')`，:2685 调用改 `runPostCheck(resolved, cwd, 'sillyspec', {}, specBase)`。
8. **不动 workflow.js 其他 join(cwd, '.sillyspec')**（:26 / :119 / :639）：
   - :26 / :119 是 `loadWorkflow` 内 `join(cwd, '.sillyspec', 'workflows')`，加载 workflow yaml 文件用——workflow 定义文件位置与 docs 产物位置解耦，不应改（yaml 仍在 cwd/.sillyspec/workflows，除非 platformOpts.specRoot 也指向 workflow 文件目录，但当前 scan-docs.yaml 是 sillyspec 内置 templates，loadWorkflow 从 templates fallback）。
   - :639 是 `saveWorkflowRun` 写 workflow-runs 归档，非 docs 产物，本任务不动。
9. **不动 `src/scan-postcheck.js`**（design §4.2 说它行为已正确用 specDir）；不强行合并两套 post-check（design §12 非目标）。
10. **TDD**：写测试覆盖 specBase 透传。

## 接口定义

- **`runPostCheck(wf, cwd, projectName, placeholders = {}, specBase)`**（第 5 参 specBase，可选；未传时回退 `join(cwd, '.sillyspec')`）。
- **`_checkWorkflow(wf, cwd, projectName, specBase)`**（第 4 参 specBase，可选；同上回退）。
- **`checkOutput(outputDef, projectName, cwd, specBase)`**（第 4 参 specBase，可选；同上回退）。
- **specBase 语义**：docs / projects / changes / workflows / knowledge 目录的父目录。平台模式 = `platformOpts.specRoot`（指向 specDir 本身，run.js:633-634 已确认）；非平台模式 = `join(cwd, '.sillyspec')`。
- **路径合成规则**：
  - checkOutput `fullPath = resolve(specBase, rawPath)`（rawPath 来自 yaml outputs.path，task-05 改为 `{SPEC_ROOT}/docs/<project>/scan/X.md`，其中 `{SPEC_ROOT}` 已被 run.js:645 替换为 specSillyspec=specBase，所以 rawPath 进 checkOutput 时已是 `specBase/docs/<project>/scan/X.md` 绝对路径 → resolve 是幂等绝对路径返回自身）。
  - `_checkWorkflow` workflow_level `scanDir = join(specBase, 'docs', projectName, 'scan/')`（不拼 `.sillyspec`，specBase 已含）。

## 边界处理（≥5 条，覆盖 null/兼容性/异常/不可变/歧义）

1. **specBase 为空（undefined / null）** — `effectiveBase = specBase || join(cwd, '.sillyspec')` → 回退到 cwd/.sillyspec（非平台模式旧行为，向后兼容）。旧调用方（如 index.js:743 `runPostCheck(resolvedWf, dir, projectName, placeholders)`）不传 specBase，行为不变。
2. **非平台模式 specBase = join(cwd, '.sillyspec')** — 与改动前 `resolve(cwd, rawPath)`（rawPath=`.sillyspec/docs/...`）等价（`resolve(cwd, '.sillyspec/docs/X')` === `resolve(join(cwd,'.sillyspec'), 'docs/X')`）。回归无差异。
3. **平台模式 specBase = platformOpts.specRoot（外部路径）** — `resolve(specBase, rawPath)` 中 rawPath 已是绝对路径（run.js:645 把 `{SPEC_ROOT}` 替换为 specSillyspec 绝对路径）→ resolve 幂等返回 rawPath 自身。`join(specBase, 'docs', projectName, 'scan/')` 拼出绝对路径。平台模式 scan 产物落在 specBase 下真实目录。
4. **workflow.js 其他调用点** — :26 / :119 / :639 用 `join(cwd, '.sillyspec', ...)` 是加载/归档 workflow 文件，非 docs 产物，**不改**（见实现要求 8）。若误改会导致 loadWorkflow 从 specBase/workflows 找 yaml，而 scan-docs.yaml 是 sillyspec templates 内置，不在 specBase 下——会找不到。本任务严格只改 docs 产物路径相关行（:152 / :312 / :331）。
5. **placeholders 签名顺序** — `runPostCheck(wf, cwd, projectName, placeholders={}, specBase)` 把 specBase 加在第 5 位，避免破坏既有 `runPostCheck(wf, cwd, name, {k:v})` 调用（index.js:743）。run.js:2647 需显式传 `{}` 占位。
6. **scan-postcheck.js 不受影响** — design §4.2 明确 scan-postcheck.js 已正确用 specDir（:54 `projectName=basename(cwd)` / :86 `join(specDir,'docs',projectName,'scan')`），本任务不动它，两套 post-check 行为对齐即可（不强行合并，design §12 非目标）。
7. **archive 分支同步** — run.js:2685 archive post_check 同样硬编码 cwd，若只改 scan 不改 archive，archive 阶段会复现 B1 bug。本任务同步改 archive（实现要求 7）。
8. **`existsSync(scanDir)` 路径不存在** — 平台模式下 specBase/docs/<project>/scan 若未创建（agent 未写产物），`existsSync` 返回 false → `workflowCheckResults.push({status:'fail', detail:'目录不存在'})`，行为正确（post-check 该失败就失败，不静默通过）。

## 非目标

- 不合并 workflow.js 与 scan-postcheck.js 两套 post-check（design §12）。
- 不改 `loadWorkflow`（:26 / :119 的 workflows 目录）——yaml 文件位置不动。
- 不改 `saveWorkflowRun` 归档路径（:639）。
- 不改 `<project>` / `<change-name>` 占位符替换逻辑（task-05 处理 yaml 占位符）。
- 不处理 scan-postcheck.js（已正确）。
- 不改 workflow.js 测试以外的 sillyspec 内部模块（如 stages/scan.js:121 只是文档示例注释，不改）。
- 不动 index.js:743 `runPostCheck` 调用（非平台模式，specBase 留空回退）。

## TDD 步骤

1. **写测试**：扩展 `sillyspec/test/workflow.test.js`（或同级测试文件，确认存在；若无需新建）：
   - `checkOutput` 收到 `specBase='/tmp/fake-spec'` + outputDef.path=`/tmp/fake-spec/docs/proj/scan/X.md`（绝对路径，模拟 run.js:645 替换后） → `fullPath === '/tmp/fake-spec/docs/proj/scan/X.md'`（resolve 幂等）。
   - `checkOutput` 不传 specBase + cwd='/tmp/proj' + outputDef.path=`.sillyspec/docs/proj/scan/X.md` → `fullPath === resolve('/tmp/proj/.sillyspec/docs/proj/scan/X.md')`（回退旧行为，向后兼容）。
   - `_checkWorkflow` 收到 specBase='/tmp/fake-spec' + workflow file_count check → `scanDir === join('/tmp/fake-spec', 'docs', projectName, 'scan/')`（不拼 `.sillyspec`）。
   - `_checkWorkflow` 不传 specBase → `scanDir === join(cwd, '.sillyspec', 'docs', projectName, 'scan/')`（回退旧行为）。
2. **写测试**：扩展 `sillyspec/test/run.test.js` 或集成测试：
   - scan post_check 调用 `runPostCheck(wf, cwd, pName, {}, specBase)` 时 specBase 透传到 _checkWorkflow（可通过 spy / mock runPostCheck 内部 _checkWorkflow 验证，或端到端跑一次 scan post_check 看 scanDir 路径）。
3. **确认失败**：改代码前跑测试，specBase 相关断言全部失败（当前硬编码 cwd）。
4. **写代码**：按"实现要求"改 workflow.js（checkOutput / runPostCheck / _checkWorkflow 签名 + :312 / :331 join）+ run.js（specBase 补全 + :2647 / :2685 调用改）。
5. **确认通过**：重跑测试，全部通过。
6. **回归**：`cd sillyspec && node bin/sillyspec.js doctor`（若 doctor 仍幽灵，task-10 修）；对一个小 fixture 项目跑 `sillyspec scan` 验证 post-check 不再报"目录不存在 .sillyspec/docs/frontend/scan/"；既有 scan-postcheck.js 行为不受影响。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 平台模式跑 scan，platformOpts.specRoot='/data/spec-workspaces/abc' | post-check 检查路径含 `/data/spec-workspaces/abc/docs/<project>/scan/`，不含 cwd/.sillyspec |
| AC-02 | 非平台模式跑 scan（specBase 未传） | post-check 检查路径含 `<cwd>/.sillyspec/docs/<project>/scan/`（旧行为，向后兼容） |
| AC-03 | scan 产物实际写到 specBase/docs/<project>/scan/ | post-check file_exists / file_count / no_empty_files 全 pass（不再"目录不存在"） |
| AC-04 | `runPostCheck(wf, cwd, name)` 不传 specBase | 行为与改动前完全一致（回归无差异） |
| AC-05 | `runPostCheck(wf, cwd, name, {}, specBase)` 显式传 specBase | specBase 透传到 _checkWorkflow / checkOutput，路径用 specBase |
| AC-06 | archive post_check（extract-module-impact） | 同样用 specBase，不报"目录不存在 .sillyspec/docs/sillyspec/..." |
| AC-07 | grep `workflow.js` 内 `join(cwd, '.sillyspec', 'docs'` | 无命中（:312 / :331 已改）；`:26` / `:119` / `:639` 的 workflows / workflow-runs 不动（grep `'.sillyspec', 'workflows'` / `'.runtime'` 仍命中） |
| AC-08 | sillyspec 单测（新增 specBase 测试） | 全部通过 |
| AC-09 | grep `run.js` 内 `runPostCheck(` 调用点 | scan（:2647）与 archive（:2685）均传 `specBase` 参数 |
