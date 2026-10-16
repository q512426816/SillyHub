---
author: flow-machine-draft
created_at: 2026-10-16T23:01:17.452Z
---
# 提案书（Proposal）— 2026-10-17-audit-risk-followup

## 动机

任务原话转写：24h 审计六连修收口：dsh/zcode 会话恢复白名单漏登记（daemon 重启静默丢记录）、run 完成角标活跃期误报、登出清理注册表漏键、防复活抑制面现算时机过早误杀下载窗口内重建文件、zcode consume finally 未按 codex 清理、抑制删除无路径包含性校验
成功标准：
- daemon 重启载入时 dsh/zcode 会话记录通过 VALID_PROVIDERS 校验不再静默丢弃，守护测试断言白名单与驱动注册表键一致
- run 仍活跃（current_run_status 非 null）时不再误标「已执行完成」角标，活跃转 null 仍正确标记，测试覆盖 running 持续不标与 running 转 null 标记两态
- 登出清理注册表收录 sillyhub:session-completed-unread: 前缀，测试断言该前缀键被清理
- 防复活抑制面改为 pre_swap 之后现算：下载窗口内重建的同名文件不再被本地删除、陈旧 manifest 条目不再并回，测试覆盖窗口内重建场景
- zcode consume finally 对齐 codex：清 _finishTurnOnClose 槽位并 await close，幂等不双重关闭
- applyResurrectSuppress 对越界（路径穿越）manifest 键跳过并告警，测试覆盖越界键不触发删除'

## 变更范围

按成功标准机械推导，共 6 条验收面：
1. daemon 重启载入时 dsh/zcode 会话记录通过 VALID_PROVIDERS 校验不再静默丢弃，守护测试断言白名单与驱动注册表键一致
2. run 仍活跃（current_run_status 非 null）时不再误标「已执行完成」角标，活跃转 null 仍正确标记，测试覆盖 running 持续不标与 running 转 null 标记两态
3. 登出清理注册表收录 sillyhub:session-completed-unread: 前缀，测试断言该前缀键被清理
4. 防复活抑制面改为 pre_swap 之后现算：下载窗口内重建的同名文件不再被本地删除、陈旧 manifest 条目不再并回，测试覆盖窗口内重建场景
5. zcode consume finally 对齐 codex：清 _finishTurnOnClose 槽位并 await close，幂等不双重关闭
6. applyResurrectSuppress 对越界（路径穿越）manifest 键跳过并告警，测试覆盖越界键不触发删除'

## 成功标准（可验证）

1. daemon 重启载入时 dsh/zcode 会话记录通过 VALID_PROVIDERS 校验不再静默丢弃，守护测试断言白名单与驱动注册表键一致
2. run 仍活跃（current_run_status 非 null）时不再误标「已执行完成」角标，活跃转 null 仍正确标记，测试覆盖 running 持续不标与 running 转 null 标记两态
3. 登出清理注册表收录 sillyhub:session-completed-unread: 前缀，测试断言该前缀键被清理
4. 防复活抑制面改为 pre_swap 之后现算：下载窗口内重建的同名文件不再被本地删除、陈旧 manifest 条目不再并回，测试覆盖窗口内重建场景
5. zcode consume finally 对齐 codex：清 _finishTurnOnClose 槽位并 await close，幂等不双重关闭
6. applyResurrectSuppress 对越界（路径穿越）manifest 键跳过并告警，测试覆盖越界键不触发删除'
