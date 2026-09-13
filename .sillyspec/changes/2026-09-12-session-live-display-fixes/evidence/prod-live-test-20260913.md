# task-08 生产实测记录（2026-09-13 00:30 前后，阿里云生产环境）

环境：https://crrcdt.ppdmq.top（backend/frontend 镜像 backup-20260913-0715 部署后；
daemon bundle 9cd65485-20260913014354，DESKTOP-HJ0AM09 实例在线心跳正常）。
测试会话：d4c29d95-755f-4eec-883a-5f1b9c42bb7d（pi 引擎，智谱 GLM）。
方法：playwright 驱动系统 Edge 无头浏览器，admin2 登录，/sessions?session= 深链打开会话面板；
消息经页面同源 fetch 调 inject API 下发；直播期间 500ms 采样（尾部文本 + `span.font-mono.text-brand-600`
计时器 + spinner 计数）；完成后 reload 取干净重放态对比。原始采样见 prod-live-samples-run{1,2,3}.json，
截图见 prod-r1-*.png / prod-r4-timer.png。

## R1 直播碎片气泡（FR-1.4）— PASS（三轮实测）

| 轮 | run_id | 直播回复正文 vs 刷新后 | 碎片气泡 |
|---|---|---|---|
| 1 | 6de1aea5（三句话自我介绍，27s） | 逐字一致 | 无 |
| 2 | 7daa3232（四百字短文，29s） | 逐字一致 | 无 |
| 3 | fbf081eb（一千二百字短文，29s） | 逐字一致 | 无 |

- live 与 refresh 的正文差异仅三类既有行为，均与本变更无关：
  ① API 注入的 user_input 行只落库不广播 SSE（inject.py 只 add 不 publish），
  直播页无该气泡、刷新后日志 API 返回才显示——composer 发送走乐观插入不受影响；
  ② 轮次标签 live 占位「轮次」→ 刷新后「第 N 轮」；
  ③ 供应商配额行渲染分支（live 显示 5 小时窗剩余、refresh 显示未提供额度信息）。
- 服务端 DB 佐证（run 6de1aea5）：stdout 5 行 = TASK_STARTED/TASK_PROGRESS/THINKING/
  [ASSISTANT] 完整正文 319 字符 + [ASSISTANT_OVERRIDE] pi:msg0:ci1；
  **无残留 partial 碎片行**（partial 已被 _revoke_committed_partials DELETE）。

## R2 失败卡伪 code（FR-2.3）— PASS（条件式）

daemon 新 bundle 已上线并注册（daemon_instances.build_id=9cd65485-20260913014354，
latest.json 公网/后端一致）；分类行为由 sillyhub-daemon classifier 单测 37/37 锁定
（[silent stream truncation] → code=null、文案「上游输出流中断，本轮未产生收尾回复」、
hint 提示自动续跑）。实测期间上游未再发生静默断流，无新失败卡可观察——按条件式通过记录。

## R3 纯切换轮（FR-3.1）— PASS（双向实测）

- 基线：turn_count=32，provider=71813fd5（智谱 GLM）。
- 切出（inject 空 prompt + llm_provider_id=cb523dac）：run 26d5d373，
  响应即返 status=completed；agent_run_logs **0 行**（旧逻辑会写空 user_input 行）；
  turn_count 仍 32。
- 切回（llm_provider_id=71813fd5）：run aa5b86ac，日志同样 **0 行**，
  turn_count 仍 32，provider 恢复原值，会话状态复原。

## R4 运行中计时锚点（FR-4.1）— PASS

run fbf081eb：DB created_at=00:21:17 / **started_at=00:21:18** / finished_at=00:21:40。
直播期计时器读数（DOM 实读）：

| 墙钟 (UTC) | 显示 | 反推锚点 |
|---|---|---|
| 00:21:34.03 | 00:15 | ≈00:21:18.5–19.0 |
| 00:21:37.12 | 00:18 | ≈00:21:18.6–19.1 |
| 00:21:37.64 | 00:18 | ≈00:21:19.1–19.6 |

锚点与 DB started_at 偏差 <1.5s（500ms 采样 + mm:ss 截断粒度内），且逐秒递增——
计时已锚定 run 服务端启动时间（修复前锚整窗首条日志时间戳，重连后计时漂移）。
计时器显示门槛 TURN_STATUS_ELAPSED_MIN_MS=15s（既有设计），前两轮 UI 运行窗口
（约 9s/13.4s）未达门槛不显示，属预期。

## R5 续跑上限提示（FR-5.1）— PASS（条件式）

backend 新镜像已部署（error_detail.hint + auto_resume_stopped 写入逻辑随镜像上线）；
行为由 backend 单测锁定（chain-limit 分支 hint 写入 + 失败回滚防御）。生产复现需连续
3 次静默断流耗尽 AUTO_RESUME_MAX_CHAIN=2，不宜人为制造——按条件式通过记录
（上一变更 2026-09-12-chat-turn-auto-recovery 已在生产验证过该分支触发路径）。

## 部署健康检查（全部通过）

- compose ps 5 容器 healthy（backend/frontend/postgres/redis/minio），/api/health ok。
- 公网与后端 /daemon/latest.json 一致（version 9cd65485-20260913014354）。
- 本机 daemon 已替换新 bundle 并重启，daemon_instances 注册在线。
- 部署备份 tag：multi-agent-platform-{backend,frontend}:backup-20260913-0715（可回滚）。
