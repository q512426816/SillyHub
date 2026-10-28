---
author: flow-machine-draft
created_at: 2026-10-28T03:22:59.644Z
---
# 决策记录（Decisions）— 2026-10-28-release-record-generator

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：答：最大风险是脚本生成的 frontmatter 与平台解析器实际口径仍有隐性偏差（YAML 方言、字段类型）——对策：生成后自检 + 沙箱产物对照平台口径逐字段核对（task-03），并以 seq48（claude-code 手写、平台判 valid）作对照样本。 放弃方案： - A（脚本内自算 seq）：next-release-seq.sh 是 2026-10-18 固化的单一取号源，双实现必漂移——放弃，改为调用。 - B（走 API 取锚点）：生产 token 不可用（bootstrap 密码失配 401），且 skill 明文「不可达则看本地记录」——放弃 API 路径，本地文件推导为准。 - C（生成器直接 scp 同步服务器）：同步属部署收尾动作、依赖 ssh key 与时机，塞进生成器会让「写记录」与「部署收尾」耦合（本地流程也会被迫碰 ssh）——放弃，生成器只打印指引，同步仍由 deploy-to-server 流程执行。
