---
author: flow-machine-draft
created_at: 2026-10-27T21:21:59.453Z
---
# 决策记录（Decisions）— 2026-10-28-knowledge-hits-cli-direct

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：**shpsync_ 令牌的写面扩大**——此前 shpsync_ 只开放 spec 同步族端点，本变更新增一个遥测接收端点。缓解：端点只写不读（不返回任何既有数据，回执仅计数）、复用 ingest 宽容语义（坏行跳过不炸）、且遥测数据本就来自令牌持有方自己的仓库执行期——伪造收益仅污染自己 workspace 的遥测统计。次风险：CLI 侧（另仓变更）直报失败的静默面——由 best-effort 语义 + 本地文件必写 + daemon 兜底三层覆盖（前序变更 D-001）。 试过但放弃的方案： - **扩展现有 hits/batch 端点兼容 shpsync_**（require_permission 加分轨分支）：破坏四轨分轨铁律（patterns.md#四轨鉴权——shpsync_ 与用户轨混开鉴权分支正是分轨设计要防的形态），且该端点 query 显式 workspace_id 与令牌派生两来源冲突； - **CLI 走用户 JWT**（platform.token 换用户令牌）：platform connect 发的就是 shpsync_ 同步令牌（绑定 workspace 的长寿命令牌），CLI 无用户登录态可持有，改造成本远超新增端点； - **daemon 代转**（CLI 不直报、等 daemon 周期上行）：即维持现状断流形态，已被用户拍板否决（要实时性主通道）。
