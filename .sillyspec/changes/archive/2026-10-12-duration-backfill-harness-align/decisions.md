---
author: flow-machine-draft
created_at: 2026-10-12T00:36:11.662Z
---
# 决策记录（Decisions）— 2026-10-12-duration-backfill-harness-align

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：答：最大风险——旧 daemon（未部署实时计时）+ 新 backend 下，close 回填的值仍 可能是会话累计垃圾（daemon 差分修复 27695397c 未部署时），过渡期老轮显示仍 失真。缓解：部署时 backend 与 daemon 同批换镜像（deploy-to-server 单包交付）， 过渡窗口仅存在于分步部署场景。放弃方案：①保留墙钟守卫（拒真实并行子代理值， 用户正确否决）；②close 完全不写 duration_api_ms（无实时计时的引擎/旧 daemon 彻底没速度，回填好于空白——值语义在 daemon 差分部署后为正确增量）。
