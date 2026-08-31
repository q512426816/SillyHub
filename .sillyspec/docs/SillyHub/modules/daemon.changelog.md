---
author: WhaleFall
created_at: 2026-08-27 14:32:24
---

# daemon 模块变更索引

- ql-20260827-010-e472 | 会话附件 daemon 落盘改内容寻址命名 attachments/{sha256}.{白名单ext}（同内容复用、废弃同名 (n) 序号），注入清单注原文件名并明确无需浏览比对其他文件
- ql-20260827-014-d438 | reopen 会话级供应商凭证链补全——backend 建 lease 补写 session_llm_provider_id + SESSION_RESUME 携解密 provider_config；daemon resume 路由透传 record.providerConfig（修 reopen 后 SDK 无凭证 "Not logged in" 秒退、会话约 2s 回 ended 死亡循环）
- ql-20260827-015 | 排队消息「后台任务通知」同会话 pending 合并为一条（任务行追加+头/尾计数改写，`_merge_task_wakeup_prompt`）——修长轮期间通知排队只增不减、派发后逐条烧模型汇报的 treadmill
- ql-20260829-006 | 机器信息删除功能——`DELETE /api/daemon/machines/{id}`（RuntimeService.delete_machine）物理删 daemon_instance 级联清该机 runtimes/会话/任务记录；守卫链：心跳 45s 内 409（daemon 心跳 404 不重注册，删在跑机器=僵尸心跳）、工作区绑定/共享授权/借用审计红线（三张 RESTRICT 表前置检查）、in-flight lease+change_write 均 409（DaemonMachineInUse）；前端 MachineCard 机器头删除按钮（仅离线可点）+ modal.confirm 二次确认 + machines cache 就地移除 + 会话过滤 + 悬浮锁清理
- ql-20260830-006 | 删除 runtime/machine 前置收敛孤儿 lease——interactive lease 恒 NULL 过期时间，会话终态后 daemon 死亡则 lease 永久停在 claimed（生产 26 行 23 天孤儿把删除永久 409）；删前把「会话已 ended/failed 的 interactive」与「claimed 已过期」两类可证死行置 cancelled 再数在途，真在途仍 409（runtime/machine 两删除路径共用 _converge_dead_leases_before_delete）
- ql-20260831-006-6d67 | sweep 第三档 `session_auto_recover_sweep_once`——suspended 主会话其 runtime 重新在线（online+600s 心跳宽限镜像判定）且挂起满 60s → 翻 reconnecting（重置 180s 窗口）+ best-effort 发 SESSION_RESUME 控制指令（payload/会话级供应商凭证解析逐字对齐 reopen），daemon restoreAndReconnect→confirmReconnected 翻 active；修 backend 重启场景 daemon WS 断开 10s 降级 offline → offline sweep 误挂起 active 主会话后无人恢复（既有恢复链只在 daemon 自身重启时触发，实测挂起 15 分钟直到人工干预/24h GC）
