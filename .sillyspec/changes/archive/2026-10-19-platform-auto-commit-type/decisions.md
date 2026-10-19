---
author: flow-machine-draft
created_at: 2026-10-19T03:27:13.251Z
---
# 决策记录（Decisions）— 2026-10-19-platform-auto-commit-type

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：timeline 口径与 git 口径分歧（27%）造成「同类变更不同来源类型不同」的 观感。缓解：生产链路上每变更只有一种来源生效（有回填 → flow-state 优先；无回填 → timeline），不存在同一行两口径交替覆盖；分歧样本语义核验 timeline 不劣（git 口径 会被后补提交带偏）。watcher 盲窗导致锚缺失 → None 回落不猜。 试过放弃：A. 排除工件性 scope（docs(spec)/chore(archive)）提升一致率——实验发现 分歧主因是口径哲学非工件噪音，且 git 对照口径本身含噪，不值得为对齐一个含噪基准 加规则；B. daemon 控制命令通道（平台下发 git 提取命令）——覆盖面更全但异步回传 + 离线重试复杂度高一个量级，留作中期备选；C. 等 sillyspec CLI flow done 写类型—— 用户明确不改 CLI，平台侧自闭环。
