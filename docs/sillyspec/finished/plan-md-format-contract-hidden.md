---
author: WhaleFall
created_at: 2026-08-12T14:05:00
---

# plan.md 格式契约隐性要求（execute 契约校验踩坑）

**状态**：已解决（sillyspec commit `ac85304` 报错精度，2026-08-13）

> **修复**：`validatePlanForExecute`（execute.js）新增 `diagnoseNoTaskRootCause` 诊断，无 checkbox task 时按 4 条隐性契约根因分别报错——①缺任务区（full 需 `## Wave N` / light 需 `## Tasks`）；②Wave 标题格式不对（`## W1`/`## Wave1`/`## 波次1` 不识别，须字面 `## Wave N`）；③task 用了 `### task-XX:` 标题（会打断 Wave 段）；④checkbox 不在任务区。agent 不再靠试错定位。

## 现象

plan 阶段 `--done` 进 execute 时，`Plan → Execute Contract 校验` 连续报错，错误信息精简但隐性约束没在 skill 文档说清，靠试错定位。变更 2026-08-12-dispatch-bind-agent-profile 卡了 4 轮才通过。

## 根因（execute.js / plan-postcheck.js 的隐性格式契约）

1. **Wave 标题必须字面 `## Wave N`**：`parseWavesFromPlan` 正则 `/^#+\s*Wave\s+(\d+)/i`。写 `## W1` / `## 波次1` / `## Wave1`（无空格）都不匹配 → 所有 checkbox task 被判"不在 Wave 段"跳过 → 报"没有找到 checkbox task"。
2. **task 必须是 `- [ ] task-XX:` checkbox 格式**：`### task-XX：名称`（中文冒号、无 checkbox）不被识别。checkbox 行才算 task 定义。
3. **task id 文档顺序必须连续（01,02,...15）**：`allTasks` 按文档出现顺序收集，sort 后检查 `ids[i] === i+1`。按 Wave 分组写（W1: 01-04,08；W2: 05,07,06）会导致文档顺序不连续 → "task id 不连续"。**必须把 task 按 01..N 物理顺序排**（跨 Wave 也连续），不能按 Wave 分组编号。
4. **`###` 标题会打断 Wave 段**：`parseWavesFromPlan` 遇任何非 Wave 标题行（含 `### task-XX:`）会 `currentWave=null` → 后续 checkbox 被跳过。所以 task 标题**不能**用 `### task-XX:`——只用 `- [ ] task-XX: 名称`，详情（allowed_paths 等）作为 checkbox 后的 bullet，不要再加 `###` 标题。

## 正确的 plan.md task 写法

```markdown
## Wave 1：主题

- [ ] task-01: 名称
- **allowed_paths**: `path/to/file.py`
- **改动**：...
- **完成标准**：...
- **依赖**：无

- [ ] task-02: 名称
- **allowed_paths**: ...
...
```

注意：① `## Wave 1`（Wave + 空格 + 数字）；② task 用 `- [ ] task-XX:`（英文冒号）；③ 跨 Wave 编号连续；④ 不加 `### task-XX:` 标题。

## 建议（工具改进）

- skill 文档（sillyspec-plan/execute SKILL.md）应明确写出这 4 条格式契约，附正确/错误示例。
- 或 CLI 在 `parseWavesFromPlan` 失败时报更精准的错误（区分"无 Wave 标题"vs"task 不在 Wave 段"vs"非连续"），而不是笼统的"没有找到 checkbox task"。
- task 跨 Wave 连续编号这条约束本身值得商榷——按 Wave 分组编号（W1 内 01-05、W2 内 06-08）更符合人直觉，工具应支持。

## 关联

变更 2026-08-12-dispatch-bind-agent-profile 的 plan 阶段踩坑实录见该变更 plan.md git 历史。
