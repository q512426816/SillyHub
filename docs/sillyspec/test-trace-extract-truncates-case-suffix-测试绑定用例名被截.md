# test-trace 摘录截断 `::用例` 后缀 → 测试绑定粒度在展示面退化为文件级

- **状态**:活跃坑(工具侧 sillyspec CLI,待修)
- **发现时点**:2026-09-26,用户质疑「测试绑定应该绑到具体测试方法,怎么全是一个类」

## 现象与证据

变更详情页「沉淀资产卡 · 测试绑定」与知识库 FR 条目里,测试绑定粒度远粗于手写层:

1. **手写层(普遍精细)**:归档变更 requirements.md 的测试绑定行大多写到用例/类级,如
   - `tests/knowledge-hits-periodic.test.ts::mtime 变化触发/append 后再触发 用例`(2026-09-26-daemon-hits-periodic-upload)
   - `tests/test_full_sync_convergence.py::TestResurrectMissingFiles 三个用例共该前置`(2026-09-25-full-sync-resurrect-missing,用户看到的「一个类」即此粒度——写到 pytest 测试类,未下钻具体 test_ 方法)
2. **摘录层(截断)**:flow done 把绑定行落盘 test-trace.json 时,`tests` 数组只保留 `::` 前的文件路径,用例/类名全部丢弃——上述两条在 test-trace.json 里均只剩 `tests/xxx.py`。全库统计:归档 test-trace 109 条绑定**零条**含 `::`。
3. **展示层(无米之炊)**:资产卡对 test-trace 行「原样投影」,前端只能显示文件级;数据源里用例名已不存在,展示层无法恢复。

## 影响评估

- 多条 FR 绑同一测试文件时(如 full-sync 变更 5 条 FR 全指同一文件),无法区分哪条
  FR 由哪个用例覆盖——追溯与腐烂检测(FR 改了但对应用例没跟)都缺锚点。
- 审计件已冻结,存量数据不可补;只影响以后的变更。

## 建议(工具侧)

1. **摘录保真**:test-trace.json 的 `tests` 条目保留绑定行完整 `文件::用例` 形态,
   不截断(若设计上 tests 字段须是纯路径供对账,可另加 `test_refs` 原文数组)。
2. **粒度约定**:书写提示从「test 文件路径或用例名」收紧为「尽量到具体测试方法
   (pytest `file::test_func` / `file::Class::test_func`;vitest `file::用例描述`),
   类级仅在该类全部用例共享同一前置时使用」。
3. **展示层**:资产卡/知识库条目显示 `文件::用例` 完整锚点(前端 tests 字段原样
   渲染即可,修复摘录后自然生效)。

## 关联

- 同族问题:test-trace 摘录对英文括号切分碎片(flow start 警告但不拦)——摘录器
  对绑定行的「保真」整体值得复盘:摘录应忠实原文,归一/截断应显式声明。
