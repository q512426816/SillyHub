# verify 门禁三缺陷（worktree 模式 + 跨仓 + node:test 噪音误计）

> 记录时间：2026-09-21 · 来源变更：2026-09-21-scan-docs-ops-panel verify 收口实测
> 状态：活跃坑（已用 workaround 绕过完成验收，待工具修复后回收窄豁免段）

## 缺陷一：快照 overlay 冒烟 cwd 假阳性 → 交付文件被回退 HEAD

现象：verify 隔离快照对 `backend/app/modules/scan_docs/router.py`/`service.py` 冒烟报
`ModuleNotFoundError: No module named 'app'` 并「已回退 HEAD 版」——回退后快照内
service.py 无 `stats()`，test_stats.py 随即 `AttributeError: object has no attribute 'stats'`。

根因推断：冒烟 import 检查在快照根而非 `backend/` 目录下执行（backend 不是快照根的
顶层包），`app` 不可导入属 cwd 假阳性；被误判为「并行会话半成品部分态」触发回退。

期望修复：冒烟在 `backend/` cwd 下跑（或 `PYTHONPATH=backend`），确认是真半成品才回退。

## 缺陷二：worktree 模式变更叠加未提交 quick 文件时，快照必破（结构性）

现象：本变更 page.tsx 依赖 quick（ql-20260921-003，未提交）的 `stripPathPrefix`，
该文件不在本变更 14 文件集内 → 快照 = HEAD + 本变更 14 文件缺依赖 →
`TypeError: stripPathPrefix is not a function`。

根因：快照面 = 本变更文件集，不包含主仓未提交的其它变更内容；worktree 的 baseline
overlay 让 worktree 内自洽，但快照只拷「本变更 declared 集」。叠加在同一文件上的
多变更（quick+full 混合）无法被单变更快照表达。

已用 workaround：`SILLYSPEC_VERIFY_GATE_SNAPSHOT_OFF=1` 回退主仓复跑（工具自文档的
出口）；主仓暂存面 = quick+本变更全量（自洽）。

期望修复：快照 overlay 对「本变更文件在主仓工作区的实际版本」与 worktree 版本取
并集（worktree 版本本身已含 baseline 携带的叠加内容），或对 declared 集内文件的
依赖做闭包拷贝。

## 缺陷三：跨仓 node:test 套件 fixture 噪音被失败行正则误计（PER_TEST_FAIL_RE 跨仓残留面）

现象：sillyspec 仓 `npm test` EXIT=0 全绿，但主仓 gate 把其 stdout 中通过用例的
预期错误文案（`❌ QUICKLOG 条目…双占用`、`API parity check failed`、
`Boom-counter test failed`、`deadbeef 不是有效 commit`、`结果: N passed, 0 failed`、
`--- 场景横幅 ---` 等 58 行）全部计入「未豁免失败行」阻断 verify。

根因：主仓 vitest 误计面已随 v3.27.10 修复，但跨仓 node:test 输出面未覆盖；
且跨仓判定读取**跨仓仓自身** local.yaml 的 known_failures（彼时为占位空表），
主仓清单（含 AssertionError 等通配）对跨仓不生效。

已用 workaround：sillyspec 仓 `.sillyspec/local.yaml` known_failures 增补 C 段
窄域豁免（带注释、注明工具修复后删）。实证豁免前后 npm test 均 EXIT=0。

期望修复：失败行判定对 node:test 输出用 TAP/摘要级判定（`ℹ fail N`/exit code），
而非行级正则；跨仓豁免清单来源与主仓打通或文档化。

## 处置记录（2026-09-22 定时收口：缺陷一已修，二留设计项，三待复现）

- **缺陷一（冒烟 cwd 假阳性）已修复**——正是 2026-09-16 冒烟实现的 bug：`smokeImportPython` 包根从浅到深循环里**首个 import 类错误立即判坏**——浅根（快照根）下 `No module named 'backend'`（backend 不是快照根顶层包）属 cwd 假阳性，却触发健康交付文件被回退 HEAD。修复：全根耗尽后才定性——任一根成功=健康；SyntaxError 立即判坏（根无关）；`cannot import name` 判坏（模块已解析缺名=真部分态）；`ModuleNotFoundError` 仅当缺失模块映射到另一 overlay .py 才判坏（第三方依赖缺失/浅根前缀=环境问题不判坏）。新增回归用例④（backend/app/modules 布局的健康 overlay 不被回退）4/4 绿，原 3 用例（真部分态回退/健康保留/无解释器 fail-open）零回归。
- **缺陷二（同文件叠加多变更快照破）留设计项**：期望的「主仓工作区版本 ∪ worktree 版本」合并或依赖闭包拷贝，涉快照隔离语义重构（快照面=本变更 declared 集是隔离的设计前提）——与 SNAPSHOT_OFF 逃生通道并存的架构决策，留专项。本变更已用 workaround 完成验收，窄豁免段随本处置保留（缺陷一修复后新变更不再踩此形态）。
- **缺陷三（node:test 行级误计）待复现**：`judgeWithKnownFailures` 在 exitCode===0 时直接返回 passed——「EXIT=0 仍被计入未豁免失败行」的实际路径（疑似跨仓包装命令退出码丢失）无法静态定位，需要一次复现取证；sillyspec 仓 known_failures C 段窄豁免（工具修复后删）继续留痕兜底。
- **本文件保持活跃（缺陷二设计项 + 缺陷三待复现）**；缺陷一处置即时生效（随 sillyspec 下次发版）。

## 处置进展补记（2026-09-23 定时收口：缺陷三按期望口径落地）

- **缺陷三（node:test 行级误计）已修复（坑文档期望的摘要级判定）**：`runCrossRepoFullTest` 对非 0 退出码做 TAP 摘要覆盖——输出含 node:test 权威摘要行 `ℹ fail 0` + `ℹ pass N≥1` 时判「外层命令链退出码丢失」（管道/包装脚本吞掉内层 exit 0），按摘要覆盖为通过 + warn 留痕；摘要 fail>0 维持失败（行级台账归因），无摘要输出零变化。测试双层锚定（源码契约 + 真实 node:test 输出形态，防版本升级摘要格式漂移静默失效）2/2 绿；跨仓回归 14 用例零失败——期间复现实证了 ql-20260919-007 同款 NODE_TEST_CONTEXT 嵌套继承坑（测试夹具已剥除）。
- **sillyspec 仓 known_failures C 段窄豁免（工具修复后删）现可回收**——按其注释约定，随下一次 sillyspec 发版生效后删除。
- 缺陷二（同文件叠加多变更快照破）仍为设计项。**本文件保持活跃（仅缺陷二余项）**。
