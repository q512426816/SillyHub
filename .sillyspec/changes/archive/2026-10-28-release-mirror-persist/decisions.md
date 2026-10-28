---
author: flow-machine-draft
created_at: 2026-10-28T02:22:52.764Z
---
# 决策记录（Decisions）— 2026-10-28-release-mirror-persist

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：答：最大风险是 SQL 直改生产库绕过应用层校验（API 取 token 不可行——bootstrap 密码已与实际不符，401）。对策：单行 UPDATE、新旧值留痕、改后立即容器视角核验；不做任何凭据重置。 放弃方案： - A（compose 增设专用挂载 /srv/releases）：要动共享 compose 文件且本地语义无增益——放弃，改 env 换源零 compose 改动。 - B（走 API 建改工作区）：管理密码 401 取不到 token，重置凭据超出本变更范围且引入安全面动作——放弃，走 SQL 单行 UPDATE。 - C（/tmp 旧目录双写过渡）：双源并存违反单一数据源目标，/tmp 侥幸链正是本变更要消灭的对象——放弃，验证通过后一次性删除旧目录。
