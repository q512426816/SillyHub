---
author: flow-machine-draft
created_at: 2026-10-23T03:31:55.136Z
---
# 需求规格（Requirements）— 2026-10-23-diff-dialog-copy-fallback

动机：清偿上一变更 2026-10-23-file-card-agent-grouping 评审留档 P3-1（用户「继续」确认）。DiffView 超 2000 行截断脚注承诺「完整内容用「复制」按钮」，TurnFileDiffDialog 此前未提供复制入口。

## 功能需求

### FR-01: 弹窗每段补丁标题行有常显复制按钮（非 hover 才可见），点击复制该段完整 diff 文本

- TurnFileDiffDialog 的每个补丁段标题行**必须**渲染常显复制按钮（不依赖 hover 才浮现），点击后**必须**将该段完整 diff 文本写入剪贴板；复制内容**必须**由 DiffRow 重建为 unified 行前缀文本（del 行 `-`、add 行 `+`、ctx 行 ` ` 前缀，行序与 DiffView 一致）。

#### 场景：主路径

- Given 弹窗打开且该段补丁渲染成功，When 点击该段「复制」按钮，Then 剪贴板收到该段完整 diff 文本（每行带 `-`/`+`/空格 前缀），按钮反馈「✓ 已复制」。

### FR-02: 复制文本含全部 diff 行（含超过 2000 行渲染上限的部分），hunk 分隔伪行不进入文本

- 复制文本**必须**包含该段 rows 的全部行（DiffView 的 2000 行上限只是渲染截断，不得进入复制内容）；parseStructuredPatch 在多 hunk 间插入的「…」分隔伪行（type=ctx 且 oldNo/newNo 均 null）**必须**从复制文本中剔除。

#### 场景：主路径

- Given 某段补丁超过 2000 行，When 复制，Then 文本行数 = rows 长度（无截断、无 ` …` 伪行）。

### FR-03: 无补丁说明态/删除说明态不出现复制按钮

- 弹窗处于无补丁说明态、删除说明态、加载态或失败态时**禁止**渲染复制按钮（没有可复制内容时不给出误导入口）。

#### 场景：主路径

- Given 日志无该文件补丁，When 弹窗展示说明文案，Then DOM 中无复制按钮（无 patch-rows 段）。

### FR-04: 相关测试绿（diffRowsToText 纯映射 + 弹窗按钮与复制内容）+ tsc 零错

- 新增 `diffRowsToText` 纯映射单测与弹窗复制行为测试**必须**全绿，触及面既有测试零回归，`tsc --noEmit` 零类型错误。

#### 场景：主路径

- When 运行触及面 vitest 与 tsc，Then 全部通过、零类型错误。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/file-changes/__tests__/turn-file-diff-dialog.test.tsx「每段补丁有常显复制按钮，点击写入完整 diff 文本」
FR-02: frontend/src/components/daemon/file-changes/__tests__/turn-file-diff.test.ts「diffRowsToText：前缀重建、分隔伪行剔除、不截断」+ turn-file-diff-dialog.test.tsx「超 2000 行复制仍完整」
FR-03: frontend/src/components/daemon/file-changes/__tests__/turn-file-diff-dialog.test.tsx「无补丁/删除说明态无复制按钮」
FR-04: frontend/src/components/daemon/file-changes/__tests__/turn-file-diff.test.ts + 触及面 vitest + pnpm exec tsc --noEmit 构建证据
