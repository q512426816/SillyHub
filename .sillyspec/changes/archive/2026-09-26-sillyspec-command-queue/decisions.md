---
author: flow-machine-draft
created_at: 2026-09-26T14:05:28.721Z
---
# 决策记录（Decisions）— 2026-09-26-sillyspec-command-queue

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：排在长升级链（npm 安装分钟级）后的命令可能撞前端 150s 回显恢复窗（ECHO_TIMEOUT_MS）——前端恢复按钮可重试，重复排队条目执行幂等裁决（重复 resolve 同一 change 无害，冲突已消解则 no-op），且冲突计数 ≤75s 采集刷新自愈；不设队列深度上限（单管理员洪水不存在，设上限反而重新发明忙拒）。试过放弃的方案：①保留忙拒+前端自动重试——复杂度推给两端且用户仍见失败红字，与本次反馈直接冲突；②升级完成事件化（await 一次性 promise）——升级链状态机（_update running/deferred→终态+10min 展示窗）无单点完成信号，deferred 复查本身已是 1s 轮询实现，事件化需动 manager 状态机超出薄改范围；出队时 1s 轮询与其等价且零侵入。
