---
author: flow-machine-draft
created_at: 2026-09-26T23:27:12.007Z
---
# 决策记录（Decisions）— 2026-09-27-daemon-queue-stop-gaps

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：预算 5 分钟是经验值——合法但极慢的升级链（网络差时 npm 拉包+校验）超 5 分钟会让本可成功的命令记 failed；代价有限（失败终态可重试、命令幂等、前端恢复按钮在），优于无界楔死。其次：超时后升级仍在跑，后续命令继续排队各等 5 分钟逐条 failed——「逐条显式失败」仍是活性态（链尾持续推进），非楔死。试过放弃的方案：①「排除 deferred 态出等待」——deferred 任意时刻可翻 running，会在 npm 半安装窗口并发 spawn CLI，违背安全动机，放弃；②「等待超时后照常 exec」——同半安装风险，放弃；③「给 deferred 复查本身加上限」——改 manager 状态机越界本变更范围（deferred 无限推迟对升级链自身是合理语义），放弃。
