---
author: qinyi
created_at: 2026-07-13 00:42:00
type: sillyspec-tool-defect
status: resolved
resolved_at: 2026-07-13 13:20:00
resolved_by: ql-20260713-001-3e46
---

> ✅ **已解决（ql-20260713-001-3e46, 2026-07-13）**：采用方案 1——`sillyspec/src/change-list.js:74` 的 `FILE_LIST_SECTION_RE` 加可选编号前缀 `(?:\d+[.)]\s*)?`，`## 6. 文件变更清单` / `## 6) 文件变更清单` 现可正常解析。回归测试加在 `test/design-coverage.test.mjs`（编号章节单元 + 覆盖对账集成两层）。npm test 全套通过。

# design.md 章节编号 vs plan-postcheck 文件清单正则不匹配

## 现象

plan 阶段 Step4（Wave 重排与可行性校验，CLI 自动 plan-postcheck）报错阻断：

```
❌ design.md 文件覆盖对账失败（清单中的文件未被任何 task 覆盖）：
   - design.md 缺少「文件变更清单」章节（或清单解析为空），无法做文件覆盖对账。
Error: planPostcheck: design file coverage check failed
```

但 design.md **实际有**「## 6. 文件变更清单」章节 + 完整 markdown 表格。

## 根因

`sillyspec/src/change-list.js:74`：

```js
const FILE_LIST_SECTION_RE = /^#{2,3}\s*(文件变更清单|变更文件清单|文件清单|File Changes|Files to Change)/im
```

正则要求 `##` 后**直接**跟"文件变更清单"（仅 `\s*` 间隔）。但 brainstorm Step11 模板鼓励 design 章节带编号（"## 6. 文件变更清单"），编号前缀 "6. " 不被 `\s*` 匹配 → sectionMatch 为 null → `parseFileChangeList` 返回空 Set → postcheck 判"清单解析为空"阻断。

## 矛盾

- **brainstorm 模板**（Step11 design 章节要求）：`6. **文件变更清单**（必填）` —— 鼓励编号
- **plan-postcheck 正则**：`^#{2,3}\s*文件变更清单` —— 不认编号

两处工具自身不一致。

## 修复（用户侧绕过）

design.md 文件变更清单章节标题**去掉编号**：`## 6. 文件变更清单` → `## 文件变更清单`。

design 其他章节可保留编号（postcheck 只解析文件清单章节）。

## 待修（sillyspec 工具侧）

二选一：
1. **改正则**（推荐）：`FILE_LIST_SECTION_RE` 允许编号前缀，如 `/^#{2,3}\s*(\d+\.\s*)?(文件变更清单|...)/im`
2. **改 brainstorm 模板**：design 章节标题不编号（但其他章节编号一致性问题更大）

## 复现

```bash
# design.md 含 "## 6. 文件变更清单"（带编号）+ 表格
sillyspec run plan --change <变更名>   # Step4 postcheck 报 design file coverage check failed
# 改为 "## 文件变更清单"（去编号）后通过
```

## 影响范围

所有 brainstorm 产出的 design.md 若文件清单章节带编号（默认行为），plan Step4 必然阻断。本变更（2026-07-12-worker-worktree-isolation）首次踩中。

## 关联

- `sillyspec/src/change-list.js:74` FILE_LIST_SECTION_RE
- `sillyspec/src/stages/plan-postcheck.js:636-643` validateDesignFileCoverage
- brainstorm Step11 design 模板（章节编号约定）
