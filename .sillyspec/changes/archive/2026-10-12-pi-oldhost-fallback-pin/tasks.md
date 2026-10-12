---
author: flow-machine-draft
created_at: 2026-10-12T01:09:42.270Z
---
# 任务注册表（Tasks）— 2026-10-12-pi-oldhost-fallback-pin

- [x] task-01: 测试钉子：pi(mcp=true) mission_worker 成功轮立即零代报（防双写语义不变），+90s 探测 artifacts 仍空且 mission 活跃 → 兜底代报恰一次（旧版 pi 宿主收敛面），载体对齐既有 claude 延迟兜底用例
- [x] task-02: daemon.ts 立即代报门注释与测试文件头注补披露：旧版 pi 宿主（运行时门控跳过注入）经 +90s 延迟探测兜底收敛，静态 caps 表不感知宿主版本属有意设计
- [x] task-03: 生产代码零逻辑改动（注释与测试面变更）
- [x] task-04: 仅跑本改动相关测试（规则 0）：sillyhub-daemon/tests/daemon-mission-worker-artifact.test.ts 全文件
