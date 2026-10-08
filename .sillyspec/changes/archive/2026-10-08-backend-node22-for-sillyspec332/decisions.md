---
author: flow-machine-draft
created_at: 2026-10-08T02:25:46.547Z
---
# 决策记录（Decisions）— 2026-10-08-backend-node22-for-sillyspec332

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：node:22-slim 与既有层交互（如 npm 路径结构变化致 ln -sf 失效）——node 官方镜像 npm-cli.js 路径多年稳定，构建本身即验证（失败即暴露，本次实跑通过）。放弃方案：①回退 SILLYSPEC_VERSION pin 到 3.29.x（Node 20 可跑）——放弃理由：技能包已 3.32.0，CLI 落后会再次制造本次要修的「指引与技能不配套」，且 node:sqlite 是 DB 引擎长期依赖，绕不过；②容器内热修 npm install（不进镜像）——放弃理由：容器重建即丢，违反镜像即真相。
