
## ql-20260826-015-3604 | 2026-08-26 21:15:22 | 会话闸只计真活跃会话——修恢复会话占满额度拒新分身
状态：已完成
关联变更：（无）
文件：sillyhub-daemon/src/interactive/session-manager.ts, sillyhub-daemon/tests/interactive/session-manager-worker-depth.test.ts
需求：会话闸只计真活跃会话——修恢复会话占满额度拒新分身
根因：恢复的19个历史idle会话在回收默认关闭下永不释放，闸恒满拒绝新分身派发
方案：计数口径收窄为真活跃（running turn 或 30 分钟窗口内活动）
结果：3 新回归用例与 interactive 全量 640 passed 与 typecheck 零错；已提交推送；本机 daemon 已换新并在线

## ql-20260827-001-223c | 2026-08-27 00:06:43 | 派团队体验优化让分身结论直接可见且主控更果断
状态：已完成
关联变更：（无）
文件：backend/app/modules/daemon/router.py, backend/app/modules/daemon/schema.py, backend/app/modules/agent/mission_context.py, frontend/src/components/daemon/team-task-block.tsx, frontend/src/lib/daemon.ts, backend/openapi.json, frontend/src/lib/api-types.ts
需求：派团队体验优化让分身结论直接可见且主控更果断。
根因：completed 分身结论需点浮层才能看到；主控分身全完成后仍问用户是否收敛。
方案：result_summary 字段展示 worker_done 上报摘要前120字符加简报行为准则让主控立即收敛。
结果：backend 全量 4785 passed 与前端 27 passed 与 E2E 真实验证 mission done 且 result_summary 可见且主控果断收敛已提交推送。

## ql-20260827-002-25d5 | 2026-08-27 07:12:53 | P0 修复：backend 重启后 running session 死锁——daemon 端 status=running 排队等永不结束的 turn，inject 需检测 turn 超时强制重置
状态：进行中
关联变更：（无）
文件：sillyhub-daemon/src/interactive/session-manager.ts, sillyhub-daemon/tests/interactive/session-manager-worker-depth.test.ts
