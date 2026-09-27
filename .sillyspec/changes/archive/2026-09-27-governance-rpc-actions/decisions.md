---
author: flow-machine-draft
created_at: 2026-09-27T12:36:13.840Z
---
# 决策记录（Decisions）— 2026-09-27-governance-rpc-actions

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：spawn shell:true 命令串注入——kind 白名单硬编码 + 域名 [a-z0-9-]+ + root_path 元字符黑名单三层，且 root 只进 cwd 不拼命令串。次风险：RPC 优先路径的 backend 测试只验回退（happy path 由 daemon 侧 handler 测试 + 真实链路 E2E 留部署后——ws_hub mock 成本高，披露）；digest 超时 60s 偏宽（CLI 大仓绑定扫描秒级实测，留观察）。放弃方案：平台直接 spawn CLI（无 daemon 链路）——平台容器不可达成员仓工作树（2026-09-11 skills-central-library 同款结论）。
