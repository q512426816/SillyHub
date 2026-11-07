---
author: flow-machine-draft
created_at: 2026-11-07T13:34:32.067Z
---
# 提案书（Proposal）— 2026-11-07-orphan-pending-dialog-cure

## 动机

任务原话转写：生产实证（会话 e07c1209 等全库 11 条孤儿记录）：AskUserQuestion 挂起等待用户回答期间，daemon 30min 轮活动看门狗判死上报 failed，该收尾路径不清理挂起提问行；会话列表 pending_dialog_kind 注入也不看 run 活性——造成「列表显示问号、详情页却无待答卡」的矛盾显示。治本三修：终态收尾联动清理 + 列表注入口径对齐 + 看门狗对等待用户回答豁免。

成功标准：
- backend 收 daemon run 终态上报收尾路径（failed/killed/completed 等任一终态）联动将挂起 pending SessionDialogRequest 置 cancelled（复用既有 cancel_pending_dialogs_for_run，不新造语义）
- 会话列表 pending_dialog_kind 注入与详情读侧口径对齐：仅统计 run 处于活跃态（pending/running/pending_approval）的 pending 行，run 终态的孤儿行不再点亮问号
- daemon 轮活动看门狗对挂起 dialog 等待用户回答豁免：fire 时发现该会话有未 settle 的 dialog 请求则不判死改为续防重新布防，dialog settle 后下一活动点恢复常规看门狗语义
- 三点各配回归测试并通过；既有相关测试（dialog/watchdog/sessions list 域）零回归

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. backend 收 daemon run 终态上报收尾路径（failed/killed/completed 等任一终态）联动将挂起 pending SessionDialogRequest 置 cancelled（复用既有 cancel_pending_dialogs_for_run，不新造语义）
2. 会话列表 pending_dialog_kind 注入与详情读侧口径对齐：仅统计 run 处于活跃态（pending/running/pending_approval）的 pending 行，run 终态的孤儿行不再点亮问号
3. daemon 轮活动看门狗对挂起 dialog 等待用户回答豁免：fire 时发现该会话有未 settle 的 dialog 请求则不判死改为续防重新布防，dialog settle 后下一活动点恢复常规看门狗语义
4. 三点各配回归测试并通过；既有相关测试（dialog/watchdog/sessions list 域）零回归

## 成功标准（可验证）

1. backend 收 daemon run 终态上报收尾路径（failed/killed/completed 等任一终态）联动将挂起 pending SessionDialogRequest 置 cancelled（复用既有 cancel_pending_dialogs_for_run，不新造语义）
2. 会话列表 pending_dialog_kind 注入与详情读侧口径对齐：仅统计 run 处于活跃态（pending/running/pending_approval）的 pending 行，run 终态的孤儿行不再点亮问号
3. daemon 轮活动看门狗对挂起 dialog 等待用户回答豁免：fire 时发现该会话有未 settle 的 dialog 请求则不判死改为续防重新布防，dialog settle 后下一活动点恢复常规看门狗语义
4. 三点各配回归测试并通过；既有相关测试（dialog/watchdog/sessions list 域）零回归
