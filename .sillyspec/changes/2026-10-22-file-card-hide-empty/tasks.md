---
author: flow-machine-draft
created_at: 2026-10-22T00:09:27.498Z
---
# 任务注册表（Tasks）— 2026-10-22-file-card-hide-empty

- [x] task-01: capability=tool_only、快照缺失、status=failed|unavailable 的轮一律不出卡、不出占位（全树不再出现「仅工具编辑」卡）
- [x] task-02: 有真实文件清单的轮照常出卡：逐文件 +/−、归因、并行会话横幅零变化
- [x] task-03: 会话级汇总只汇总真实有改动的轮，不再输出「N 轮无工作区快照」缺口提示；零文件时整卡零渲染
- [x] task-04: 全树仍不出现「本轮无改动」字样；file-changes 相关用例按新口径更新后全绿，tsc --noEmit 退出 0
