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
