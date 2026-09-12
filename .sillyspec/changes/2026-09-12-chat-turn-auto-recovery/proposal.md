# 提案（Proposal）— 聊天轮上游故障自动恢复

## 问题

生产实证（阿里云会话 d4c29d95，2026-09-11，pi 引擎 + 智谱 GLM-wp/glm-5.3）：
聊天轮因上游模型服务故障中断后，会话停在原地等用户手动发「继续」，一天内被打断
7 次以上，其中深夜两次静默中断挂了 7+ 小时无人恢复。三类中断形态：

1. **断流/超时**（`Stream ended without finish_reason` ×8、pi rpc 30s 超时 ×1）：
   daemon 归类器只认 claude（D-001 旧决策），pi 全落 `unknown/retryable=false`，
   无任何自动恢复。三次全是「干净轮」（无工具活动），重放安全。
2. **额度耗尽**（GLM 429 code 1308「已达到 5 小时的使用上限…将于 XX:XX 重置」）：
   错误文本里有重置时间但没人解析，用户只能人肉掐点回来发「继续」。
3. **静默中断**（22:36 / 23:52 两轮）：模型流中途断掉无任何报错，pi 照常
   agent_settled，run 收敛 **completed**——后端从状态上完全看不到故障，轮尾
   无收尾消息、工作干一半。

既有基建已覆盖相邻场景但都不触发本场景：2026-09-10-auto-resume-interrupted-turn
只管 daemon 重启（error_code=daemon_restarted）；ql-20260903-011 只管 claude CLI
合成鉴权错误。模型层瞬时故障、限额、静默中断三个面全空白。

## 方案（用户确认：三类全修；方案 A——backend 主导恢复 + daemon 补信号）

- daemon 补两个信号：①归类器泛化（pi/codex/cursor 同规则）+ ModelError 新增
  `resetAt`（从 429 文本解析重置时间）；②pi driver 静默中断检测（settle 后轮尾
  无收尾 assistant 全文 → 合成可重试 error result，后端从此可见）。
- backend close 钩子泛化 `_maybe_auto_recover_failed_turn` 三分支：瞬时+干净轮 →
  原 prompt 立即排队重放；瞬时+有工具活动 → 续跑 nudge（上下文在 CLI 进程内
  完整，不重放原任务防副作用）；quota+resetAt → 定时消息到点自动续跑（可取消）。
- 复用 9-10 已合入基建：`origin='auto_resume:<rid>'` 链上限、G10 派发时守卫、
  `session.config.auto_resume_interrupted` 开关。
- frontend：错误卡三分支提示（自动重发中 / 将于 XX:XX 自动继续可取消 / 输出流
  中断已自动续跑）+ 定时消息列表「自动续跑」徽标。

## 收益

- 三类中断全部自动恢复，长任务挂机不再需要人肉「继续」。
- 限额场景给出确定性恢复时间并自动续跑，同时保留取消入口（用户可关）。
- pi/codex/cursor 错误归类与 claude 对齐，错误卡提示不再「unknown」。

## Non-Goals

- codex/cursor 的静默中断检测（driver 收敛语义不同，后续变更）。
- 群聊影子会话、worker 分身（范围=普通单聊主会话，与 9-10 变更一致）。
- 空 user_input 轮（历史空输入形态）的自动处理。
- pi CLI 内部重试策略调整（daemon 不改 pi 进程内行为）。

## 风险（详见 design §风险登记）

副作用重复执行（nudge 提示词防重复 + 干净轮守卫）、自动恢复风暴（双层链上限）、
静默检测误报（链上限兜底 + nudge 后 agent 自答完成）、新旧 daemon/backend 混布
（协议 soft-add 双向兼容）。
