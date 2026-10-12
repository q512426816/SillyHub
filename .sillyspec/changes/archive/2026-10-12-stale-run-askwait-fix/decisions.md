---
author: flow-machine-draft
created_at: 2026-10-12T11:08:58.004Z
---
# 决策记录（Decisions）— 2026-10-12-stale-run-askwait-fix

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：**豁免过宽导致 run 永卡 running**——若提问落库形态判定漏/多。控制：信号仅两种窄形态（pending_input 通道、tool_call+tool_kind=ask，均实证于生产数据），且 daemon 死亡面有 sweep 独立兜底，宽限跳过与判死兜底（延迟复扫）链路不变。 试过但放弃的方案： - **复用 `_run_daemon_alive` 给启动清理加活性门**——放弃：启动清理发生在后端重启瞬间，daemon 可能尚未重连续约，lease updated_at 必然陈旧 → 活性门恒 False，等于没加；且多一次 lease/runtime/instance 三级查询。日志 ask 信号是重启免疫的确定性判据。 - **SessionDialogRequest pending 行作豁免信号**——放弃：生产实证交互会话的 AskUserQuestion 不落该表（run e31ec8fc 在 dialog 表 0 行），信号覆盖率不足。 - **error_detail 直接补 type/message 键**（不动前端）——放弃：调度层错误不是模型错误，硬塞 type 会进 8 类模型错误映射语义；且存量已落库的 {reason, finished_by} 行仍显示 unknown，前端回落才是全量修复。
