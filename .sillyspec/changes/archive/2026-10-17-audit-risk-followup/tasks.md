---
author: flow-machine-draft
created_at: 2026-10-16T23:01:17.452Z
---
# 任务注册表（Tasks）— 2026-10-17-audit-risk-followup

- [x] task-01: daemon 重启载入时 dsh/zcode 会话记录通过 VALID_PROVIDERS 校验不再静默丢弃，守护测试断言白名单与驱动注册表键一致
- [x] task-02: run 仍活跃（current_run_status 非 null）时不再误标「已执行完成」角标，活跃转 null 仍正确标记，测试覆盖 running 持续不标与 running 转 null 标记两态
- [x] task-03: 登出清理注册表收录 sillyhub:session-completed-unread: 前缀，测试断言该前缀键被清理
- [x] task-04: 防复活抑制面改为 pre_swap 之后现算：下载窗口内重建的同名文件不再被本地删除、陈旧 manifest 条目不再并回，测试覆盖窗口内重建场景
- [x] task-05: zcode consume finally 对齐 codex：清 _finishTurnOnClose 槽位并 await close，幂等不双重关闭
- [x] task-06: applyResurrectSuppress 对越界（路径穿越）manifest 键跳过并告警，测试覆盖越界键不触发删除'
