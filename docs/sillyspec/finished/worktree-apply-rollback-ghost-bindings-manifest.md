# worktree apply 回滚残段 + 幽灵绑定 + 双横线解析（三连环收口坑）

- **记录时间**：2026-10-15 · 来源变更：2026-10-15-zcode-engine-appserver 归档期
- **状态**：活跃坑（三处工具补丁已实施于本仓工作区 **未提交**——需用户提交收编；数据侧残留已清）

## 负面 1：worktree apply 回滚不彻底——「已回滚」声明与工作区实态不符

- **现象**：apply --3way 冲突回滚后，主仓工作区仍残留 3 个文件为分支版内容（thinking-levels zcode 行/pre-session-picker zcode 钉/api-types zcode 字面量），下次 apply 以「未 commit 变更影响 apply」拦截，且报文自称「已回滚工作区到 apply 前状态（无半成品冲突标记）」。
- **根因**：`rollbackApply`（src/worktree-apply.js:2326）只对 patch 涉及文件做一轮 `checkout HEAD -- f`/删除新建，无回滚后完整性验证；一轮还原失败的文件静默流失（error 串拼接进 warnings 但主报文仍声称回滚成功）。
- **修复（已实施）**：`rollbackApply` 尾部加回滚完整性自证——`git status --porcelain -- <patchFiles>` 逐文件复核；残留则二次还原（checkout HEAD/删新建），复核后仍残留则如实降级报文（列出残留文件名 +「工作区并非完全回滚前状态，请先核对 git status」），返回值增 `leftovers` 字段。
- **验证**：apply-conflict-hardening 16/16 绿（无回归）；真机复跑 apply/--merge 全链路通过（2026-10-15-zcode-engine-appserver 归档收口）。

## 负面 2：幽灵绑定行——卡片文本误提的不存在路径进 test-trace

- **现象**：task-05 verify 命令笔误引用不存在的 `tests/interactive/providers.test.ts`（vitest 过滤器语义下不报错故未暴露）→ deps 推断/绑定扫描捕获 → test-trace.json 生成指向不存在文件的 active 行 → apply 悬空闸门恒拦（fail-closed 行为正确，但行不该存在），需手工 unbind。
- **根因**：绑定行创建链（卡片 allowed_paths/verify 文本 → deps 推断 → trace 行）无存在性过滤——任何形如测试路径的 token 都会铸行。
- **修复（已实施）**：`writeChangeTrace`（src/test-bindings.js）加幽灵过滤——machine 行 tests 条目按「变更目录上溯项目根 ∪ process.cwd()」多根存在性检查，不存在的丢弃并 `console.warn` 留痕；agent 行不动；行内全滤光保留原行交悬空闸门裁决（不在写侧静默删行）。
- **验证**：行为级验证（临时项目注入 ghost+real 双条目：machine 行 ghost 被滤、real 保留、agent 行不动三断言全过）+ flow-draft-binding-extract/gate-face-binding-parity/close-trace-* 套件绿。
- **数据侧残留**：归档版 task-05.md 的双横线行与 trace 幽灵行均已修正/清零。

## 负面 3：parseAllowedPaths 双横线行产出幽灵 allow 项——apply 越权误拦

- **现象**：归档版 task-05 卡 allowed_paths 存在手编辑残留嵌套子弹 `-   - sillyhub-daemon/tests/interactive/provider-registry.test.ts` → 解析剥一层外子弹后值仍带 `- ` 前缀 → allow 面混入 `- sillyhub-...` 幽灵项，真实路径反而不在 → apply 校验「review 声明了越权文件」误拦。
- **根因**：`parseAllowedPaths`（src/stages/plan-postcheck.js:74）子弹剥离只做一层，双横线（嵌套子弹）静默产出带前缀的伪路径。
- **修复（已实施）**：剥外层子弹后循环剥除连续 `- ` 前缀（任意空白形态）+ 列表去重；对真实归档卡回归验证：解析 8 条全部干净、含此前丢失的 provider-registry 行、零 `- ` 前缀幽灵。
- **验证**：dynamic-deps-comment-edge/dynamic-test-inference/residual-runner-parity 套件绿（25/25）。

## 汇总

- 三修位置：`C:/Users/qinyi/IdeaProjects/sillyspec/src/`（worktree-apply.js / test-bindings.js / stages/plan-postcheck.js）——**均未提交，需用户提交收编**。
- 工具侧回归：三批共 **66 用例全绿**（apply×3 + binding×4 + dynamic×3 套件）。
- 建议上游化：各补一例单测（rollback 残留自证三态 / writeChangeTrace 幽灵过滤 / parseAllowedPaths 双横线+去重）。

## 处置记录（2026-10-16）

**三连环全部已修并在树**（sillyspec 仓，本日逐项源码复核在场）：

1. **rollbackApply 完整性自证 ✅**：尾部 `git status --porcelain -- <patchFiles>` 逐文件
   复核 + 二次还原 + 仍残留则如实降级报文（`leftovers` 字段）——「已回滚」声明与实态
   不符的静默流失消除。
2. **writeChangeTrace 幽灵过滤 ✅**：machine 行 tests 条目按「变更目录上溯项目根 ∪
   process.cwd()」多根存在性检查，不存在丢弃 + warn 留痕；agent 行不动；全滤光保留
   原行交悬空闸门。
3. **parseAllowedPaths 双横线剥除 ✅**：循环剥连续 `- ` 前缀（任意空白形态）+ 去重。

**测试**：apply-conflict-hardening + binding-extract + dynamic 三族 24/24 本日复跑绿；
坑内「未提交需收编」注：补丁仍在工具仓工作树（`worktree-apply.js`/`test-bindings.js`/
`plan-postcheck.js` 为并行会话在途集），随其变更收口。归档。
