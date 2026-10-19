---
author: flow-machine-draft
created_at: 2026-10-19T05:48:31.294Z
---
# 提案书（Proposal）— 2026-10-19-preview-card-empty-turn-fix

## 动机

任务原话转写：切换档案产生的静默轮（started_at 空、无日志、无 error_code 的终态轮）刷新后进入轮次大纲，被归并层渲染成「（无内容记录）· 点击展开」预览卡；点击后单轮加载查回 0 条日志走 empty 静默短路，卡片永久展不开且无任何反馈（实测会话 54317e42 第 2/4/7 轮，均 0 条日志）。方案经用户确认实施（选道声明：成功标准转写自 2026-10-14-session-turn-preview-cards/design.md 非目标「不改静默配置切换轮的紧凑配置行语义」+ 实测数据库证据，非推断）。

成功标准：
- preview-merge 归并层对「started_at 为空 + 无 error_code + previewTurnStatusOf 映射终态完成/中止族」的大纲条目不再合成预览卡：命中已加载轮/孤儿配置行时原引用透传并盖 seq，未命中时不生成条目
- 失败族（status failed/error 或 error_code 非空）与活跃族（running/pending 等）大纲条目仍照旧合成预览卡，展开/跳转/预取链路行为不变
- handleExpandPreview 对 empty 结果给出 notify 轻提示（该轮无对话内容），不再纯静默；failed 提示语义不变
- 新增单测覆盖无内容终态条目透传与跳过两分支、error_code 轮仍出卡、running 轮仍出卡
- 既有 preview-merge / turn-preview-card / session-preview-integration 相关测试面全部通过，零回归

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. preview-merge 归并层对「started_at 为空 + 无 error_code + previewTurnStatusOf 映射终态完成/中止族」的大纲条目不再合成预览卡：命中已加载轮/孤儿配置行时原引用透传并盖 seq，未命中时不生成条目
2. 失败族（status failed/error 或 error_code 非空）与活跃族（running/pending 等）大纲条目仍照旧合成预览卡，展开/跳转/预取链路行为不变
3. handleExpandPreview 对 empty 结果给出 notify 轻提示（该轮无对话内容），不再纯静默；failed 提示语义不变
4. 新增单测覆盖无内容终态条目透传与跳过两分支、error_code 轮仍出卡、running 轮仍出卡
5. 既有 preview-merge / turn-preview-card / session-preview-integration 相关测试面全部通过，零回归

## 成功标准（可验证）

1. preview-merge 归并层对「started_at 为空 + 无 error_code + previewTurnStatusOf 映射终态完成/中止族」的大纲条目不再合成预览卡：命中已加载轮/孤儿配置行时原引用透传并盖 seq，未命中时不生成条目
2. 失败族（status failed/error 或 error_code 非空）与活跃族（running/pending 等）大纲条目仍照旧合成预览卡，展开/跳转/预取链路行为不变
3. handleExpandPreview 对 empty 结果给出 notify 轻提示（该轮无对话内容），不再纯静默；failed 提示语义不变
4. 新增单测覆盖无内容终态条目透传与跳过两分支、error_code 轮仍出卡、running 轮仍出卡
5. 既有 preview-merge / turn-preview-card / session-preview-integration 相关测试面全部通过，零回归
