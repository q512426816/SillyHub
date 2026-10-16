---
author: flow-machine-draft
created_at: 2026-10-16T07:53:02.539Z
---
# 决策记录（Decisions）— 2026-10-16-deploy-convergence-guard

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：闸门挡不住「两个会话都从 main 打包、先后部署」的时序互覆（后部署者覆盖先部署者——若两者都是 main 且后者更旧则仍回退）。兜底：§0 的部署后 commit_sha 核对能立即发现；彻底解（部署互斥/登记表）留待需要更多实证后做。放弃的方案：a) 只改 skill 文档不加脚本闸——事故证明纯约定无效（并行会话各行其是），机械闸必须；b) 部署登记文件 .last-deploy 比对——需要 load-and-up.sh 也改+跨会话写同一文件，复杂度高于本次 thin 边界，列为后续。
