---
author: flow-machine-draft
created_at: 2026-09-30T02:01:54.240Z
---
# 决策记录（Decisions）— 2026-09-30-assets-testfile-nodeid-anchor

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：锚界符（::/#/>）误伤真实路径片段——若测试文件名本身含这些字符会被截短，但本仓测试文件命名无此形态，且截短后仍有 basename 同名搜索 + 唯一后缀救回兜底，最坏退化为多候选点选而非误报未找到。半角 ( 出现在合法文件名中（如 file(1).py），为降误伤面只剥全角（，半角不剥（本轮实证数据全部为全角）。试过放弃的方案：① 改 test-trace.json 存量数据剥锚——归档件是冻结审计件不可补（先例 2026-09-26 摘录保真坑同判）；② 收紧 CLI 书写约定禁止锚后粘注解——书写契约已由 binding-anchor-fidelity 落定且 CLI 侧已有单源剥锚，重定契约属设计反转，不采纳。
