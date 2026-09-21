# quick gate 会卷入并行全流程变更的未声明脏文件，误伤无关会话

**状态：活跃坑（待工具修复）｜发现于 2026-09-21（ql-20260921-008-b962 收尾时）**

## 现象

quick 会话（纯前端测试改动，边界声明 32 文件、零 backend 文件）在 `--done` 门禁连续两轮 BLOCK：

- `test: failed ← module[frontend,scan_docs]`——失败用例全部来自并行**全流程变更**（2026-09-21-scan-docs-ops-panel）的 WIP 文件 `backend/app/modules/scan_docs/tests/test_stats.py`（先 ImportError 后 9 failed）；
- `lint: failed`——`ruff format` 要求重排的 `router.py`/`schema.py` 同为该并行变更的半成品。

## 根因

quick 审计的"他者文件自动豁免"只认**其他 quick 会话 `--files` 显式声明的文件**；并行**全流程变更**（brainstorm→plan→execute 走 changes/ 目录的那类）不写 quick `--files`，其未提交脏文件在时间窗内无人认领 → 被并入本会话的隔离快照（"HEAD + 本会话 33 个文件"）与模块选择（frontend + scan_docs）→ 本会话被并行 WIP 的红挡死。修复他者文件又违反 CLAUDE.md 规则 19（活跃 change 隔离不重叠），死锁。

## 护栏 / 绕过

- 短期：`SILLYSPEC_QUICK_TEST_GATE=skip`（审计留痕通道）+ 在 `--solution` 里写明红的归属证据（失败文件清单、本地实测数据），CI push 后全量再验。
- 工具建议：gate 的模块选择应只取 `allowedFiles ∩ 实际变更` 命中的模块；窗口内未声明脏文件保持"审计：归属切分"记录即可，不应进快照实测面。

## 证据

- 收尾输出：`C:\Users\qinyi\.zcode\cli\exec\...\call_e2aaff27097a4b368bc4fa19-stdout.log`（第二轮 BLOCK 全文，含 test_stats.py 9 failed 与 ruff-format 尾部）；
- QUICKLOG ql-20260921-008-b962「方案/结果」字段（skip 留痕与本地实证）。
