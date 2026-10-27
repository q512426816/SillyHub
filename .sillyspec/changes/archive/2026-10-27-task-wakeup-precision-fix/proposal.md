---
author: flow-machine-draft
created_at: 2026-10-27T00:39:56.644Z
---
# 提案书（Proposal）— 2026-10-27-task-wakeup-precision-fix

## 动机

任务原话转写：修复任务唤醒判据与通知四处缺陷

动机与背景：2026-10-26 23:45 本机会话实证：前台 Bash（pnpm install --force，真实用时 70s）完成触发冗余唤醒汇报轮，通知显示「用时 00:00」与真实不符（SDK 终态帧缺 elapsed_ms 时，判定用的注册表兜底时长未回传显示层），唤醒链零日志难归因，「后台子代理任务」文案对前台命令失实；静默阈值 60s 作为唤醒主判据错位——真判据是主代理是否已拿到结果（tool_use 的 run_in_background），时长只配当标记缺失时的兜底防噪阀。

成功标准：
- 通知行「用时」与唤醒判定同源：elapsed_ms 缺失时用注册表 startedAt 兜底时长显示 MM:SS，不再出现误导性 00:00
- 前台命令免唤醒：tool_use 元数据登记 run_in_background 标记（Task/Agent/Bash 三类工具），判定为前台的任务终态不注入唤醒；终态 emit 与 [TASK_NOTIFICATION] 落行行为不变
- 后台标记缺失（task_started 丢失且无回执兜底）时保留旧时长阈值兜底唤醒并打 WARN；SILLYHUB_TASK_WAKEUP_QUIET_MS env 与缺省 60000 不变，语义改为兜底场景防噪阀
- 唤醒判定补结构化日志：task_id/task_name/status/时长/时长来源（sdk-frame|registry|unknown）/后台判定结果，前台跳过与兜底放行均可观测
- 文案修正：daemon prompt「后台子代理任务」改「后台任务」、「（列表中的每一个都已终止，没有仍在运行的任务）」改「（本批次均已终止）」，backend helpers.py 合并正则与拼接模板同步改，前端识别锚 [后台任务通知] 前缀不变零改动
- daemon/backend/frontend 三侧仅跑与本改动相关的测试并通过

## 变更范围

按成功标准机械推导，共 6 条验收面：
1. 通知行「用时」与唤醒判定同源：elapsed_ms 缺失时用注册表 startedAt 兜底时长显示 MM:SS，不再出现误导性 00:00
2. 前台命令免唤醒：tool_use 元数据登记 run_in_background 标记（Task/Agent/Bash 三类工具），判定为前台的任务终态不注入唤醒；终态 emit 与 [TASK_NOTIFICATION] 落行行为不变
3. 后台标记缺失（task_started 丢失且无回执兜底）时保留旧时长阈值兜底唤醒并打 WARN；SILLYHUB_TASK_WAKEUP_QUIET_MS env 与缺省 60000 不变，语义改为兜底场景防噪阀
4. 唤醒判定补结构化日志：task_id/task_name/status/时长/时长来源（sdk-frame|registry|unknown）/后台判定结果，前台跳过与兜底放行均可观测
5. 文案修正：daemon prompt「后台子代理任务」改「后台任务」、「（列表中的每一个都已终止，没有仍在运行的任务）」改「（本批次均已终止）」，backend helpers.py 合并正则与拼接模板同步改，前端识别锚 [后台任务通知] 前缀不变零改动
6. daemon/backend/frontend 三侧仅跑与本改动相关的测试并通过

## 成功标准（可验证）

1. 通知行「用时」与唤醒判定同源：elapsed_ms 缺失时用注册表 startedAt 兜底时长显示 MM:SS，不再出现误导性 00:00
2. 前台命令免唤醒：tool_use 元数据登记 run_in_background 标记（Task/Agent/Bash 三类工具），判定为前台的任务终态不注入唤醒；终态 emit 与 [TASK_NOTIFICATION] 落行行为不变
3. 后台标记缺失（task_started 丢失且无回执兜底）时保留旧时长阈值兜底唤醒并打 WARN；SILLYHUB_TASK_WAKEUP_QUIET_MS env 与缺省 60000 不变，语义改为兜底场景防噪阀
4. 唤醒判定补结构化日志：task_id/task_name/status/时长/时长来源（sdk-frame|registry|unknown）/后台判定结果，前台跳过与兜底放行均可观测
5. 文案修正：daemon prompt「后台子代理任务」改「后台任务」、「（列表中的每一个都已终止，没有仍在运行的任务）」改「（本批次均已终止）」，backend helpers.py 合并正则与拼接模板同步改，前端识别锚 [后台任务通知] 前缀不变零改动
6. daemon/backend/frontend 三侧仅跑与本改动相关的测试并通过
