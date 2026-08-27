
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

## ql-20260827-004-c49b | 2026-08-27 09:51:21 | 修 daemon 网络切换后 WS 永久假连（git-log 502 守护进程离线）
状态：已完成
关联变更：（无）
文件：
- sillyhub-daemon/src/ws-client.ts（身份守卫+pong新鲜度+connectedAt）
- sillyhub-daemon/src/daemon.ts（WS_STALE_REAP_MS+_reapStaleWsClient看门狗）
- sillyhub-daemon/tests/ws-client.test.ts（迟到close回归+pong新鲜度2用例）
- sillyhub-daemon/tests/daemon-ws-stale-reap.test.ts（看门狗4用例新文件）
- .sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.md（坑条目+变更索引）
需求：修 daemon 网络切换后 WS 永久假连（git-log 502 守护进程离线）
根因：wp 机器切换网络后旧 socket 迟到 close 事件把新 socket 抹出 this._ws，keepalive 静默丢失，黑洞连接无检测、状态卡 Connected 永不重连；HTTP 心跳/会话兜底照常造成在线假象，唯独 WS RPC（git-log/explorer）持续 502
方案：ws-client 事件与超时定时器加 socket 身份守卫；pong 计入 lastMessageAt 新鲜度+新增 connectedAt 锚点；daemon._wsLoop 每秒假活看门狗 _reapStaleWsClient（陈旧≥120s 强制重建，双 null fail-open）
结果：tsc 0；vitest 相关 87 用例全绿（ws-client 42 含新 2、daemon-ws-stale-reap 新文件 4、multi-runtime+daemon.test 41）；bundle 已重打，待部署
