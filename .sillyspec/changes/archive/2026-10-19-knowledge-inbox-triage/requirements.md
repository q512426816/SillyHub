---
author: flow-machine-draft
created_at: 2026-10-19T05:36:14.829Z
---
# 需求规格（Requirements）— 2026-10-19-knowledge-inbox-triage

## 功能需求

### FR-01: uncategorized.md 16 条全部迁出至五个分类文件（known-issues/patterns/conventions/testing-gotchas/sillyspec-gotchas），收件箱归零并留清账记录

- 收件箱 `.sillyspec/knowledge/uncategorized.md` 中的全部 16 条待归类经验必须逐条判类迁出至五个分类文件（known-issues.md 6 条 / testing-gotchas.md 4 条 / conventions.md 3 条 / sillyspec-gotchas.md 2 条 / patterns.md 1 条）；迁出后 uncategorized.md 不得残留任何 `##` 知识条目，必须留下本次清账记录（日期、去向统计、变更名）。

#### 场景：主路径

- Given：uncategorized.md 含 16 条 2026-09-28 清账后新增的未归类经验（其中 4 条带【待确认】前缀，另有 1 条已完成迁移的历史面包屑残留）。
- When：逐条读内容、按文件头定性口径判类并迁出。
- Then：五个分类文件各追加对应条目（正文原样保真、保留来源与日期），uncategorized.md 清零并留清账记录。

### FR-02: INDEX.md 对应分类节补齐索引行，锚点与目标标题一致

- 每条迁出的知识必须在其目标分类文件对应的 INDEX.md 节新增一行索引（`关键词|关键词 → [标题](文件.md#锚点)`），锚点必须与目标条目标题的 GitHub slug 规则一致，禁止指向不存在的条目或错误分类节。

#### 场景：主路径

- Given：16 条知识已落入五个分类文件。
- When：在 INDEX.md 的 Conventions / Patterns / Known Issues / SillySpec Gotchas / Testing Gotchas 五节补索引。
- Then：新增 16 行索引全部可按锚点命中目标标题；`sillyspec knowledge validate` 无 broken_reference。

### FR-03: 已修复条目带状态标注（🟢/🟡 口径或文内注明），【待确认】逐条裁决留痕

- 迁出条目必须按分类文件既有口径标注状态：known-issues.md 条目用 🟢（已修复/已定案，标题带（已修复）类后缀）或 🟡（现行有效/缓解中）前缀；其余分类文件在条目尾注明「状态」行。
- 原文带【待确认】前缀的 4 条必须逐条裁决并在条目内留裁决记录：确认属实的去标记、未决事项显式转遗留，禁止未裁决照搬。本轮裁决：daemon.start() 系统代理黑洞（属实，修法已实证，推广待立项→testing-gotchas）；MissingGreenlet（属实，事故已修 commit 954cb88f→patterns）；require_permission 422（属实，实现行约束→known-issues 🟡）；.zcode 已跟踪文件（属实，仓库存量状态→known-issues 🟡）。

#### 场景：主路径

- Given：4 条【待确认】条目与 6 条 known-issues 候选。
- When：按正文证据（实测复现/修法落地/结构性风险）逐条裁决。
- Then：每条状态可追溯（🟢/🟡 前缀或条目尾状态行），【待确认】字样不再出现在迁出后的标题中。

### FR-04: sillyspec knowledge validate 无 errors

- 收口前 `sillyspec knowledge validate` 必须零 errors（broken_reference/empty_file 等）；如出现 warnings 须逐条修复或说明。

#### 场景：主路径

- Given：知识库迁移与索引更新已落盘。
- When：运行 `sillyspec knowledge validate`。
- Then：输出 errors 为空，退出码 0。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: 不适用：纯知识文档归类无代码/测试面；验收判据=条数对账（16 → known-issues 6 / testing-gotchas 4 / conventions 3 / sillyspec-gotchas 2 / patterns 1，收件箱 0）+ knowledge validate
FR-02: 不适用：锚点正确性由 knowledge validate 的 broken_reference 检查兜底，辅以 slug 生成脚本防手误
FR-03: 不适用：状态标注为文档语义无测试面；裁决留痕在条目正文可回溯
FR-04: 不适用：FR-04 本身即 CLI 校验命令（validate 退出码 0 为验收判据），无独立测试面
