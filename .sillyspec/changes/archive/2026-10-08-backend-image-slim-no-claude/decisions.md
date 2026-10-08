---
author: flow-machine-draft
created_at: 2026-10-08T03:23:29.227Z
---
# 决策记录（Decisions）— 2026-10-08-backend-image-slim-no-claude

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：证据面有盲区——若存在 grep 未覆盖的运行时 claude/node 依赖（如未来新代码 spawn），容器将直接 FileNotFoundError。缓解：唯二 exec 点已逐行核实为 git；diff_collector 的 FileNotFoundError 分支本就按零 diff 降级不炸；变更后本地重建全链路验证 + 服务器部署后复验。放弃方案：①保留 node 只删 claude——放弃理由：node+npm+node_modules 占大头（claude 二进制本身不大，大头是其 node_modules），半删收益减半且留「半个遗物」心智负担；②只注释不删除（防御性保留）——放弃理由：镜像层一旦保留就会被后人当成可用能力写代码，遗物越藏越深；③compose 保留 claude-data 挂载以防万一——放弃理由：卷挂载会遮盖 /app/.claude 目录语义，与「容器内无 claude」的新事实矛盾。
