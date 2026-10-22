---
author: flow-machine-draft
created_at: 2026-10-22T00:09:27.498Z
---
# 提案书（Proposal）— 2026-10-22-file-card-hide-empty

## 动机

任务原话转写：文件变更卡无数据时整轮不再出卡

用户实测 58 轮历史会话每轮都挂一张「仅工具编辑」卡（文案「daemon 未上报工作区快照，本卡只含 Edit/Write 工具编辑」），零信息且误导，明确裁决：没有信息就隐藏卡片，顶部汇总也不要留缺口提示。
根因：这些轮跑在 daemon 0.2.0 / 平台 10-22 00:43 部署之前，backend 无 daemon_run_snapshots 行 → capability 按设计退 tool_only；前端把「无能力 / 无快照 / 采集失败」一律渲染成一张降级卡。daemon 侧实测无故障（0.2.0 采集器 status=ok / 46 files / 165ms；清单来自 git status，子代理与 Write 改动均计入）。

成功标准：
- capability=tool_only、快照缺失、status=failed|unavailable 的轮一律不出卡、不出占位（全树不再出现「仅工具编辑」卡）
- 有真实文件清单的轮照常出卡：逐文件 +/−、归因、并行会话横幅零变化
- 会话级汇总只汇总真实有改动的轮，不再输出「N 轮无工作区快照」缺口提示；零文件时整卡零渲染
- 全树仍不出现「本轮无改动」字样；file-changes 相关用例按新口径更新后全绿，tsc --noEmit 退出 0

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. capability=tool_only、快照缺失、status=failed|unavailable 的轮一律不出卡、不出占位（全树不再出现「仅工具编辑」卡）
2. 有真实文件清单的轮照常出卡：逐文件 +/−、归因、并行会话横幅零变化
3. 会话级汇总只汇总真实有改动的轮，不再输出「N 轮无工作区快照」缺口提示；零文件时整卡零渲染
4. 全树仍不出现「本轮无改动」字样；file-changes 相关用例按新口径更新后全绿，tsc --noEmit 退出 0

## 成功标准（可验证）

1. capability=tool_only、快照缺失、status=failed|unavailable 的轮一律不出卡、不出占位（全树不再出现「仅工具编辑」卡）
2. 有真实文件清单的轮照常出卡：逐文件 +/−、归因、并行会话横幅零变化
3. 会话级汇总只汇总真实有改动的轮，不再输出「N 轮无工作区快照」缺口提示；零文件时整卡零渲染
4. 全树仍不出现「本轮无改动」字样；file-changes 相关用例按新口径更新后全绿，tsc --noEmit 退出 0
