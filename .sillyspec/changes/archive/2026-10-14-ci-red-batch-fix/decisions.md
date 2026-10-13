---
author: flow-machine-draft
created_at: 2026-10-13T16:38:38.274Z
---
# 决策记录（Decisions）— 2026-10-14-ci-red-batch-fix

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：seed 把 change_id 落 session 后误伤同文件其他用例。已核对调用面——gate_failover 仅一处调用传 `change_id=uuid.uuid4()`（即本次修复对象），其余缺省 None；cross 文件新参默认 None，多轮用例（run.change_id=None）判定路径不变；修复后已跑全文件用例验证。 试过但放弃的方案： - 放宽 `_apply_session_terminal_status` 兼容 run 级锚——否决：会复活 2fe772561 修复的生产误关会话事故（聊天轮被打轮级归因锚后每轮 completed 即误置 ended），方向性错误。 - CI 侧给 frontend vitest 加重试——否决：掩盖时序缺陷而非修复，且 CI 改动属生产配置，违背本变更零生产改动约束。 - 守卫测试直接删除字段集断言——否决：钉子测试的价值就在逐字段显式清单，补列即可。
