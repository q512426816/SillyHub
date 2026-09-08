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
- ql-20260908-004-2b59 | backend-ci mypy 93 错修复（arch-large-file-split 合并遗留）——router/__init__ 的 `router` 加显式 `: APIRouter` 注解（子模块反向导入成环，mypy 环内推不出隐式类型 → 12 个 router 子文件 76 处 @router.* has-type）；submit_steps.py 16 处 `st.xxx: T = 值` 删冗余注解（mypy 仅允许 self 属性声明类型，_SubmitState dataclass 已声明全部字段）；_background_tasks.py `task` 补 `: asyncio.Task` 注解（coro: object 传入 create_task 推不出 Task[T]）。mypy 896 文件 0 错，ruff/format 绿，daemon 相关 181 测试绿
- ql-20260908-006-4ff6 | 只读审查风险修复批 R3/R4/R5（scheduled_send）——R3 终态写回改条件 UPDATE（WHERE status='pending'）：inject 内部 commit 已释放开头的行锁，条目仍 pending 窗口内并发 cancel 落库返回 204 后，旧盲 ORM 赋值会把 cancelled 覆写成 dispatched；0 行命中即尊重取消语义（消息可能已发出属 R-02 at-least-once 固有代价）。R4 DaemonRuntimeOffline 不再一次性 failed(inject_failed)（关机/掉线即永久丢消息）——每次失败 dispatch_at 延后 5min 有界重试（至多 6 次 ≈30min，进程内计数重启清零），超限置 failed(daemon_offline)。R5 毒丸收口——due 扫描加 ORDER BY dispatch_at,id（无排序截断 50 同批毒丸饿死其余到期条目）+ 单条连续崩溃 5 轮置 failed(sweep_crash_retry_exhausted) 不再无限重试。sweeper 14 用例 + CRUD/pin-rename 回归 22 用例全绿
