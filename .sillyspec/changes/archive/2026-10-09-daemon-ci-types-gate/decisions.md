---
author: flow-machine-draft
created_at: 2026-10-08T23:43:33.423Z
---
# 决策记录（Decisions）— 2026-10-09-daemon-ci-types-gate

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：drift check 在 CI 上重生成时 openapi-typescript 版本与本地不一致会导致输出形态差误红——已由 frozen-lockfile（Install --frozen-lockfile）钉住同版本消解；本地实测同命令绿态通过。次风险：路径增补后 backend 独改也会触发 daemon-ci 全量测试，CI 时长略增（分钟级，可接受）。试过放弃：(a) 单独开一个轻量 drift workflow——放弃，daemon-ci 已有 Node/pnpm 环境，复用零成本；(b) 在 frontend-ci 里顺带守 daemon 类型——放弃，职责域错位（daemon 生成物归 daemon-ci）。
