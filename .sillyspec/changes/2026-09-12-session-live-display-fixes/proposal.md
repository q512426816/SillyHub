---
author: qinyi
created_at: 2026-09-12T23:55:00
---

# 提案 — 2026-09-12-session-live-display-fixes

## 问题

平台会话（生产环境实测会话 `d4c29d95-755f-4eec-883a-5f1b9c42bb7d`）存在五类展示/体验缺陷：

1. **直播碎片气泡**（用户主诉）：pi 引擎直播时每条回复开头几个字成独立小气泡 + 完整气泡双显，刷新恢复。前端撤回链两道防线（令箭撤回路由、前缀收编）在 pi 的 segmentId 形态与消息到达序下全部失效。
2. **失败卡伪 code**：daemon 错误码提取的裸三位数字兜底把 `api_calls=116` 误当 HTTP 码展示，误导用户以为是供应商错误码。
3. **纯切换轮虚增轮次**：切换供应商产生空 user_input 行 + turn_count 虚高（30 轮中 12 轮为空），与代码注释声明语义矛盾。
4. **运行中轮计时漂移**：elapsed 计时锚点取自日志窗口首行而非 run 快照，重连/窗口滑动后锚点漂移（实测 11 分钟只走 46 秒）。
5. **自动续跑停止无感知**：续跑链到上限（防循环守卫 G7）停跑时用户只看到「供应商异常」失败卡，不知道为什么不再自动续、需要手动继续。

## 方案

方案 A（用户已批，D-001）：**零协议变更**，把前端实现补齐到 backend 已声明的协议语义（按 segmentId 任意位置撤回），三端各自独立小修：
- 前端：revokePartialSegments 全树扫描 + dropPrefixPartialReply 全桶前缀收编（附 F7 增量投影失效硬约束）；运行中轮计时锚点优先 run 快照。
- daemon：extractCode 裸数字分支改原因短语锚定；静默断流签名专属中文文案。
- backend：纯切换轮复用 silent_config_switch 跳过 user_input/turn_count；chain-limit 停跑补 error_detail.hint + auto_resume_stopped 标记。

## 影响

frontend（session-log-assembler / page-helpers）、sillyhub-daemon（model-error classifier）、backend（daemon session inject / auto_resume）三端独立可发布；存量数据不迁移；错误分类学与 auto-recovery 判定序零变更。

## Non-Goals

- 不改 daemon segmentId 协议格式（D-001 否决方案 B）。
- 不动错误分类学（type 枚举、TRANSIENT_ERROR_TYPES、auto-recovery 判定序）。
- 不迁移存量空 user_input 行 / 不回填存量 turn_count。
- 不做 dialog 模式切换轮 whoLine 注入。
- 不修「任务统计不闭合」「会话 ended_at 残留」两个次要观察。
