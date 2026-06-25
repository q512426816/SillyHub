---
author: qinyi
created_at: 2026-06-25 10:10:00
type: sillyspec-defect
stage: brainstorm
---

# Defect：brainstorm 阶段校验不识别 decisions.md 的 supersede 关系

## 现象
`decisions.md` 中一个决策被新版本 supersede（`D-004@v1` status=superseded，`D-004@v2` supersedes=D-004@v1）后，brainstorm 阶段完成时的「阶段校验警告」仍机械地检查 design.md / requirements.md / tasks.md 是否引用了 **D-004@v1**，对未被引用的旧版本报：

```
- design.md 未引用 decisions.md 中的 D-004@V1
- requirements.md 未引用 decisions.md 中的 D-004@V1
```

## 复现
- 变更：`2026-06-25-frontend-error-handling`
- `decisions.md` 同时含 `D-004@v1`（status: accepted，后被取代）与 `D-004@v2`（supersedes: D-004@v1）
- `design.md §11` 与 `requirements.md` 决策覆盖表引用 `D-004@v2`
- 校验仍警告 `D-004@v1` 未被引用

## 期望
阶段校验应解析 `supersedes` 字段：被 supersede 的旧版本（status=superseded）不再要求被 design/requirements/tasks 引用；只校验「当前生效版本」是否被引用。

## 当前绕过
在被引用的 v2 行里手动补 `(supersedes D-004@v1)` 字样，让校验在文档中 grep 到 `D-004@v1` 字符串从而消除警告。本变更已采用此绕过（design §11 / requirements 决策表）。

## 影响
- 误报警告噪音，干扰判断真实遗漏。
- 绕过写法污染决策表语义（为满足检查而写字样）。

## 相关
- `docs/sillyspec/plan-blueprint-frontmatter-missing-metadata.md`（另一处 SillySpec 校验缺陷）
