# QUICKLOG「结果」虚报已提交——quick --done 写入 commit hash 未经 git show 验证

状态：活跃坑（待改进；agent 行为 + CLI 可加校验）

## 现象（2026-09-18 实证）

ql-20260917-009-7220（agent_run_logs 剥 NUL）的 QUICKLOG 条目「结果」写：

> 6 新用例 + agent 全量 1248 绿 + ruff 过；**已提交 03a4667b9 推送 origin**。

事实核查（2026-09-18 08:35）：

- `git show 03a4667b9 --stat` —— 11 个文件全是前端预览改进（ql-010 的提交），**不含 model.py**；
- `git log --all -- backend/app/modules/agent/tests/test_agent_run_log_nul.py` —— 该文件从未进任何提交；
- 代码在暂存区滞留约 11 小时（2026-09-17 21:44 quick --done → 2026-09-18 08:38 补落库 ec25d60cf）。

## 根因链

1. quick --done 时 agent 把「计划提交到的 hash」当「已提交的 hash」写进「结果：」——
   `git add` 因某路径不存在**整体失败**（与 fb55613ea 同类，见
   `finished/git-add-path-not-exist-filenotes-and-quicklog-mixed-commit.md`）或
   add 成功但 commit 用了不含该文件的 pathspec，agent 未做 `git show --stat` 复核；
2. QUICKLOG 条目与 patch 快照由 CLI 照常落库（它们只看工作区，不看 git 提交面），
   形成「账实不符」：台账声称已入库、代码实际未入库。

## 危害

- 台账与仓库失真，后续任何基于 QUICKLOG 的追溯（归档/知识沉淀/审查）会被误导；
- 修复代码长期滞留暂存区，有被误 reset / 半成品混入他人提交的风险（多会话并发仓尤甚）。

## 建议

- Agent 侧（立即生效）：写「已提交 <hash>」前必须 `git show <hash> --stat` 核对
  allowedFiles 至少一个在列；quick 收尾后 `git status` 确认暂存区已清（本 quick 的文件）。
- CLI 侧（改进点）：`--done` 时若「结果：」文本含 40 位 hex 且 allowedFiles 均不在
  `HEAD` 提交面内，warn「结果声称已提交但文件不在最近提交中，请核实」。
