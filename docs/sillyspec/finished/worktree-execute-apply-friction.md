# worktree execute→apply 阶段四个摩擦点（✅ 已修复）

> 2026-07-30 变更 `2026-07-30-kanban-workload-heatmap` execute→verify 实测踩坑。四个点都围绕 worktree 隔离执行模式收尾（assess / apply / per-task review / docHash），属活跃坑，待 sillyspec 工具改进。
>
> **✅ 全部 4 坑已修复（2026-07-30，sillyspec 主线）**：
> - **坑1/4**（assess 顺带修复 allowed_paths 豁免 + 一次报全）：`worktree-apply.js assessApplyRisk` 的 Gate2 对 design §6 标注「顺带修复」的预存债文件豁免 allowed_paths 严格校验（降 warning 不 BLOCKED）；`applyWorktree(checkOnly)` 的 Gate1/Gate3 不再短路，assess 聚合各道 reasons 一次报全。新增 `change-list.js parseFileChangeListDetailed`（incidental 标记嗅探）。Gate2 allowed_paths 解析复用 `parseAllowedPaths` + `pathMatches`（消除内联字面弱匹配漂移）。
> - **坑2**（execute 收尾自动落 per-task review 草稿）：`task-review.js generateTaskReviewDrafts` 据 `resolveVerifyChangedFiles`（worktree-aware base..head diff）按各 task `allowed_paths` 归属，生成 `verdict=cannot_verify` + 非空 `requiredEvidence` 草稿到 `.runtime/execute-runs/<exec-id>/tasks/task-XX/review.json`。幂等（已存在跳过）；exec-id 与 Task Review Gate 同源。`complete.js` execute 块每次 `--done` 调用。
> - **坑3**（docHash CRLF/LF 双口径容忍，上轮已修）：`stage-review.js verifyStageReviewDocHash` 同时算原始字节 + LF 规范化两个 sha256，匹配任一即过。
>
> 测试：`test/worktree-apply-incidental.test.mjs`（坑1/4 豁免 + 一次报全）+ `test/task-review-draft.test.mjs`（坑2 草稿生成/幂等/exec-id 同源）+ `test/stage-review.test.mjs`（坑3 双口径）。

---

## 坑 1：worktree apply 三重阻断 + 「顺带修无关预存债」被 allowed_paths 卡死

### 现象

execute 全部完成后 `sillyspec worktree assess` 报 BLOCKED，apply 走不通：

1. 第一道：**变更文件不在 design.md 文件清单中**（`backend/app/modules/ppm/plan/tests/test_service.py`）。
2. 补进 design §6 文件清单后，第二道：**变更文件超出 allowed_paths**（该文件不属任何 task-NN.md 的 allowed_paths）。
3. 改用 `sillyspec worktree apply --merge` 降级，撞**主工作区已有 staged 改动**（brainstorm/plan 四件套 staged 未 commit）→ git merge 冲突 → auto-abort。

三道连环，最后只能 `git cherry-pick --no-commit <worktree-commit>` 手动落代码到主工作区（仅 meta.json 进度元数据冲突，`git checkout HEAD -- meta.json` 保留主工作区版 + `git cherry-pick --quit` 退出序列）。

### 根因

assess 同时叠加三重校验：design 文件清单 ⊇ 变更文件、每个变更文件 ∈ 某 task allowed_paths、主工作区 clean 才能 merge。而本变更新增 kanban 代码（合规）之外，**顺手修了 ql-20260728-007 留下的 2 个 plan 预存测试债**（CLAUDE.md 规则20「顺手补无关旧测试债」），该 plan 测试文件天然不属任何 kanban task 的 allowed_paths，被第二道卡死。

### 当前绕过

- 顺带修复文件补进 design §6 文件清单（过第一道）；
- allowed_paths 那道过不了 → 放弃 `worktree apply`，改 `git cherry-pick --no-commit` 手动落码（排除 meta.json）。

### 建议改进

允许「顺带修复」类文件在 design 声明（如 design §6 标注「顺带修复」+ 来源）后**绕过 allowed_paths 严格校验**——顺带修预存债是规则20鼓励的合规操作，不应被 task 边界卡死。

---

## 坑 2：per-task review.json 在 worktree execute（主 agent 直接实现）不落盘

### 现象

worktree execute 11/11 全部完成，但 `execute --done` 的 Task Review Gate 报「task-09/10/11 缺少 review.json」，期望路径 `.runtime/execute-runs/<exec-id>/tasks/task-XX/review.json`。实际该 exec run 目录根本不存在，**11 个 per-task review.json 一个都没落盘**。

### 根因

per-task review.json 的落盘流程绑定「子代理执行每个 task 后写 review」模式；当采用「主 agent 直接实现」（强依赖链/机械同构 task 由主 agent 统一写）时，不走子代理 review 落盘流程，per-task review.json 全缺。stage acceptance review（独立 QA 子代理）是另一套，会落盘，但 task 级不落。

### 当前绕过

用 python 脚本批量补写 11 个 per-task review.json（schema 见历史样本 `execute-runs/*/tasks/task-01/review.json`：`{schemaVersion, task, base, head, changedFiles, specVerdict, qualityVerdict, reviewerNotes, requiredEvidence}`），base/head 取 worktree 分支 merge-base 与 commit，changedFiles 按 task 映射（须 ⊆ base..head diff）。

### 建议改进

worktree execute 收尾（`--done` 进 Task Review Gate 前）**自动生成 per-task review.json 草稿**（据 git diff base..head 按 allowed_paths 归属到 task，verdict 待填），避免主 agent 实现模式全缺。

---

## 坑 3：docHash 连锁（design 每改一次都要重算 + LF/CRLF 字节差异致反复不匹配）

> **✅ 子问题(b) 已修（2026-07-30，sillyspec v3.25.5+）**：`src/stage-review.js` 的 `verifyStageReviewDocHash` 改**双口径容忍**——gate 重算「原始字节 sha256」与「LF 规范化 sha256」两个值，agent 写的 docHash 匹配任一即过，消除 Windows CRLF/LF 在 git add / eol 规范化前后字节漂移导致的反复「疑似伪造」误报。不改 agent 行为（仍可 `sha256sum` 原始字节）、不破坏存量 review.json、不改契约文档。测试 `test/stage-review.test.mjs` 加 CRLF 双口径用例。
> **子问题(a) 保留为设计特性**：design 每改一次都要重算 docHash 是防伪造的设计（docHash 锚定主文档内容）。「流程性修订不失效」需引入标记机制，属产品决策，暂不做。

### 现象

execute step7 产 acceptance review.json 时 docHash = design.md 的 sha256。之后 design.md 改了两次（§6 补「顺带修复」文件清单行、frontmatter 加 `risk_level`），每次都要 `sha256sum` 重算 + 更新 review.json docHash，否则 Stage Review Gate 报「docHash 与主审查文档实际内容不匹配 → 疑似伪造」。

更坑的是：**Edit 写入后立即 `sha256sum` 算的值，与稍后再 `sha256sum` 的值偶发不一致**（同一个工作区文件，sha256 从 66502df4 → 6658547f），疑似 LF/CRLF 在 git add 等操作前后字节差异，导致 gate 反复报不匹配、要反复重算。

### 根因

docHash 锚定 design.md 原始字节，design 任何改动（含流程中补文件清单/风险声明）都使旧 docHash 失效；叠加 Windows LF/CRLF 规范化时机不确定，sha256 不稳定。

### 当前绕过

每次 design 改动后：`cd .sillyspec && sha256sum changes/<change>/design.md | cut -d' ' -f1` 取最新值，写回 `.runtime/stage-reviews/<execute-review-*>/review.json` 的 docHash；archive 前若 design 再改也要同步更新（防 archive 回查）。

### 建议改进

- gate 改用 **git blob hash**（`git hash-object`，git 内部已规范化）或**规范化（统一 LF）后再算 sha256**，消除 LF/CRLF 字节漂移；
- design 流程性改动（补文件清单/风险声明）不应触发 docHash 失效，或提供「流程性修订」标记跳过 hash 重算。

---

## 坑 4：assess 文件清单 vs allowed_paths 双重校验口径不一、修一道还有一道

### 现象

assess BLOCKED 先报「文件不在 design.md 清单」，补进 design §6 后又报「超出 allowed_paths」——两道校验口径不同（design 文件清单 vs 各 task allowed_paths），逐道排查，体验割裂。

### 根因

文件清单（design §6，人维护的总账）与 allowed_paths（各 task TaskCard frontmatter，机器校验的边界）是两套来源，未对账；「顺带修复」文件进了 design 清单却进不了任何 task allowed_paths，卡在第二道。

### 当前绕过

见坑1：放弃 assess/apply，cherry-pick 手动落码。

### 建议改进

- assess 一次报全所有不合规文件 + 各自卡在哪道（文件清单 / allowed_paths），不要逐道挤牙膏；
- design §6 标注「顺带修复」的文件豁免 allowed_paths 校验（与坑1建议一致）。

---

## 综合建议

四个坑同源：**worktree execute 的「主 agent 直接实现 + 顺带修预存债」真实工作流，与工具假设的「每 task 子代理 + 严格 task 边界」模型不匹配**。改进方向：

1. allowed_paths 对「顺带修复（design 声明）」开口子（坑1/4）；
2. worktree execute 收尾自动落 per-task review 草稿（坑2）；
3. docHash 用 git blob hash / 规范化后算，流程性修订不失效（坑3）。

整体：靠 memory 里 worktree/verify/archive 的踩坑记录一路见招拆招（cherry-pick 落码 / per-task review 批量补 / risk_level 声明 / 后台大 timeout），工具能驾驭但有明显摩擦。
