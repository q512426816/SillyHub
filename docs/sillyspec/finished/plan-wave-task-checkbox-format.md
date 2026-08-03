---
author: WhaleFall
created_at: 2026-07-30 16:45:00
type: sillyspec-tool-defect
status: active
---

# plan.md Wave 任务行必须用 `- [ ] task-NN:` 复选框格式

> 2026-07-30 变更 `2026-07-30-daemon-heartbeat-dedup-fix` plan 阶段实测踩坑。

## 现象

plan.md 里 Wave 分组下的任务行，如果写成普通列表 `- task-NN: ...`（没有复选框 `[ ]`），CLI 虽然能在 plan Step4「生成 TaskCard」里**列出**任务清单，但后续 execute 解析 plan.md 任务、以及 doctor 自检，都会**解析不到**这些任务行。

具体：本次 plan.md 初稿 Wave1/2/3 写的是：
```
- task-01: PolicyCache.set 去 resolveRealPath...
- task-02: ...
```
independent plan-review 子代理把「Wave checkbox 格式」标为 **gap**（不阻断 plan 完成但警告「execute 若严格依赖 `[ ]` 会解析不到」）。

## 根因

sillyspec 解析 plan.md 任务的**正则要求复选框前缀**，纯 `- task-NN:` 不匹配：

- `sillyspec/src/doctor-diagnostics.js:413`（D5 维度，注释明说「真相源语义对齐 run.js:832 + execute.js」）：
  ```js
  const taskLine = /(?:^- \[[ x]\] )task-\d+[^:]*:?\s*.+$/gm;
  //            ^^^^^^^^^^^^^^^^^^ 这个非捕获组无 ? 量词 = 必需
  ```
  正则里的 `(?:^- \[[ x]\] )` 没有 `?`，是**必需**前缀 —— 行必须以 `- [ ] ` 或 `- [x] ` 开头才匹配。纯 `- task-NN:` 被跳过 → 解析结果为空（doctor 返回 null）。
- `run.js:832` + `execute.js` 的 checkbox 解析同此格式（注释声明对齐）。

## 矛盾

- **plan Step2「生成分级计划」prompt**：只要求「按 plan_level 选模板输出 plan.md」，**没有明示** Wave 任务行必须用 `- [ ] task-NN:` 复选框格式。
- **plan Step3 审查清单**：才提到「task 编号与 Wave checkbox 格式正确，execute 依赖此格式解析」。
- **解析正则**：硬性要求 `- [ ] / - [x]`。

生成阶段不强调、审查阶段才提、正则又是硬约束 —— 三处不一致，生成时极易漏写 `[ ]`。

## 修复（用户侧绕过）

plan.md 里每个 Wave 下的任务行，**统一用复选框格式**：
- 未完成：`- [ ] task-NN: 描述...`
- 已完成：`- [x] task-NN: 描述...`

（归档变更如 `2026-07-29-model-error-visibility/plan.md` 即用 `- [x] task-01:` 格式，照此惯例。）

注意：plan.md 改动后若该阶段已有 review.json，**必须重算 plan.md sha256 同步 docHash**，否则 Stage Review Gate 重算比对不符会判伪造（见 plan Step3 review.json 契约）。

## 待修（sillyspec 工具侧）

二选一：
1. **改 plan Step2 生成 prompt**（推荐）：在「按 plan_level 选模板」处明确要求 Wave 任务行用 `- [ ] task-NN:` 复选框格式，并在生成后自检。
2. **改正则放宽**：`(?:^- \[[ x]\] )?` 加 `?` 让复选框可选 —— 但这会弱化「未勾=未完成」的进度语义，不推荐。

## 复现

```bash
# plan.md Wave 行写 "- task-01: xxx"（无 [ ]）
sillyspec run plan --change <变更名>   # Step4 能列出 task，但 execute/doctor 解析为空
# 改为 "- [ ] task-01: xxx" 后 execute 可正确解析 task
```

## 影响范围

所有 plan.md 若 Wave 任务行漏写 `[ ]`，execute 阶段解析不到任务、任务蓝图断裂。本次变更首次踩中（靠 independent review + 源码核对发现，未到 execute 才暴露）。

## 关联

- `sillyspec/src/doctor-diagnostics.js:413` taskLine 正则（parsePlanTaskCheckboxState）
- `sillyspec/src/run.js:832` + `execute.js` checkbox 解析
- plan Step2 生成 prompt（未强调格式）/ plan Step3 审查清单（才提格式）
- 相关已修坑：`finished/design-section-number-vs-plan-postcheck.md`（同性质的「模板鼓励 vs 正则不认」不一致，那是 design 章节编号）
