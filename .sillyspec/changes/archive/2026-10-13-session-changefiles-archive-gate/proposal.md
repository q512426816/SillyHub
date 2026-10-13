---
author: flow-machine-draft
created_at: 2026-10-13T07:59:35.300Z
---
# 提案书（Proposal）— 2026-10-13-session-changefiles-archive-gate

## 动机

任务原话转写：会话页悬浮变更面板的归档判定口径与变更中心不一致：面板只认 location==='archive' 单信号，而平台既有终态口径是 status==='archived' || location==='archive' 双条件（changes/page.tsx isTerminalChange 注释同源）——归档信号只到 status 侧（progress 上行落库/投影）而 location 未收敛时面板误报「进行中」，用户实测反馈 fire-unitadd 变更归档后仍显示进行中
成功标准：
- splitByArchive 与 stageLabel 的归档判定对齐平台双条件口径（status==='archived' 或 location==='archive' 任一命中即归已归档/显示已归档）
- 新增用例：status=archived 且 location=active 的变更归入已归档组、不计数进行中徽标、阶段标签显示「已归档」
- 既有 8 用例保持全绿 + tsc 0 错

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. splitByArchive 与 stageLabel 的归档判定对齐平台双条件口径（status==='archived' 或 location==='archive' 任一命中即归已归档/显示已归档）
2. 新增用例：status=archived 且 location=active 的变更归入已归档组、不计数进行中徽标、阶段标签显示「已归档」
3. 既有 8 用例保持全绿 + tsc 0 错

## 成功标准（可验证）

1. splitByArchive 与 stageLabel 的归档判定对齐平台双条件口径（status==='archived' 或 location==='archive' 任一命中即归已归档/显示已归档）
2. 新增用例：status=archived 且 location=active 的变更归入已归档组、不计数进行中徽标、阶段标签显示「已归档」
3. 既有 8 用例保持全绿 + tsc 0 错
