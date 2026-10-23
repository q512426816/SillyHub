---
author: flow-machine-draft
created_at: 2026-10-23T03:49:04.072Z
---
# 需求规格（Requirements）— 2026-10-23-diff-copy-p3-cleanup

成功标准来源：上一变更 2026-10-23-diff-dialog-copy-fallback 的 review.json findings（P3-1/P3-2/P3-4）原文转写 + 用户「继续」确认。

## 功能需求

### FR-01: 复制按钮改用 getText 惰性取值，渲染期不构建 diff 文本，点击复制内容与现行为逐字一致

- TurnFileDiffDialog 的补丁段复制按钮**必须**改用 CopyButton 的 `getText` 惰性取值（点击时才调用 `diffRowsToText(section.rows)`），渲染期**禁止**全量构建复制文本；点击后写入剪贴板的内容**必须**与上一变更行为逐字一致（unified 前缀、剔除 hunk 分隔伪行、不截断）。

#### 场景：主路径

- Given 弹窗展示多段补丁，When 渲染完成（未点击），Then 未发生 diffRowsToText 全量构建；When 点击某段复制按钮，Then 剪贴板内容与既有一致（如 `-old line\n+new line`）。

### FR-02: 补丁区脚注含「不含 hunk 头，不可直接用于 git apply」语义的如实说明

- 弹窗补丁区底部脚注**必须**如实说明复制文本的边界：内容为行级文本、不含 hunk 头，**禁止**让用户误以为可直接用于 `git apply`（文案须含该语义；具体措辞可组织，但「hunk 头」与「git apply」语义必须出现）。

#### 场景：主路径

- Given 补丁段渲染完成，Then 脚注文本包含「hunk 头」与「git apply」语义的不可直接应用说明。

### FR-03: 无补丁说明态用例先等到说明文案出现再断言无复制按钮（不再在 loading 态误断言）

- 无补丁/删除说明态测试**必须**先 `findByText` 等待对应说明文案出现（确认 phase=ready 且无 sections）再断言无复制按钮；**禁止**以 loading 态即存在的 `turn-file-diff-body` 节点作为 ready 判据。

#### 场景：主路径

- Given 日志返回空，When 渲染弹窗，Then 用例等待「未来自本轮 agent 的编辑工具」说明出现后才断言无「复制该段 diff」按钮；删除态等「本轮被删除」后断言。

### FR-04: 触及面测试绿 + tsc 零错

- file-changes 全族 + turn-timeline 挂载测试**必须**全绿，`tsc --noEmit` **必须**零类型错误，lint 新增面零警告。

#### 场景：主路径

- When 运行触及面 vitest 与 tsc，Then 全部通过、零类型错误。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/file-changes/__tests__/turn-file-diff-dialog.test.tsx「每段补丁有常显复制按钮，点击写入完整 diff 文本（FR-01）」（点击路径断言复制内容）+「超 2000 行：复制内容不截断（FR-02）」（惰性取值后仍全量）
FR-02: frontend/src/components/daemon/file-changes/__tests__/turn-file-diff-dialog.test.tsx「补丁区脚注声明复制文本边界（不含 hunk 头/不可直接 git apply）」
FR-03: frontend/src/components/daemon/file-changes/__tests__/turn-file-diff-dialog.test.tsx「无补丁说明态 / 删除说明态不出现复制按钮（FR-03）」
FR-04: frontend/src/components/daemon/file-changes 全族 vitest + pnpm exec tsc --noEmit 构建证据
