---
author: flow-machine-draft
created_at: 2026-10-12T01:09:42.269Z
---
# 提案书（Proposal）— 2026-10-12-pi-oldhost-fallback-pin

## 动机

任务原话转写：动机：24h 风险审查 P2-2 复核修正——pi.caps.mcp 静态表翻 true（7bd743230）后 daemon.ts:4197 立即代报门对 pi 不再放行，而 pi-rpc-driver.ts:930 运行时探测 pi<1.0 会跳过 MCP 注入（会话无 worker_done 工具），旧版 pi 宿主两头都不立即报；但 daemon.ts:4236 的 +90s 延迟兜底探测对一切 mission_worker 成功轮生效（无 provider 门），旧版 pi 宿主实际经延迟探测收敛（90s 延迟，非产出丢失）——该覆盖面无测试钉住、代码注释亦未披露，防未来改动误伤。
成功标准：
- 测试钉子：pi(mcp=true) mission_worker 成功轮立即零代报（防双写语义不变），+90s 探测 artifacts 仍空且 mission 活跃 → 兜底代报恰一次（旧版 pi 宿主收敛面），载体对齐既有 claude 延迟兜底用例
- daemon.ts 立即代报门注释与测试文件头注补披露：旧版 pi 宿主（运行时门控跳过注入）经 +90s 延迟探测兜底收敛，静态 caps 表不感知宿主版本属有意设计
- 生产代码零逻辑改动（注释与测试面变更）
- 仅跑本改动相关测试（规则 0）：sillyhub-daemon/tests/daemon-mission-worker-artifact.test.ts 全文件

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. 测试钉子：pi(mcp=true) mission_worker 成功轮立即零代报（防双写语义不变），+90s 探测 artifacts 仍空且 mission 活跃 → 兜底代报恰一次（旧版 pi 宿主收敛面），载体对齐既有 claude 延迟兜底用例
2. daemon.ts 立即代报门注释与测试文件头注补披露：旧版 pi 宿主（运行时门控跳过注入）经 +90s 延迟探测兜底收敛，静态 caps 表不感知宿主版本属有意设计
3. 生产代码零逻辑改动（注释与测试面变更）
4. 仅跑本改动相关测试（规则 0）：sillyhub-daemon/tests/daemon-mission-worker-artifact.test.ts 全文件

## 成功标准（可验证）

1. 测试钉子：pi(mcp=true) mission_worker 成功轮立即零代报（防双写语义不变），+90s 探测 artifacts 仍空且 mission 活跃 → 兜底代报恰一次（旧版 pi 宿主收敛面），载体对齐既有 claude 延迟兜底用例
2. daemon.ts 立即代报门注释与测试文件头注补披露：旧版 pi 宿主（运行时门控跳过注入）经 +90s 延迟探测兜底收敛，静态 caps 表不感知宿主版本属有意设计
3. 生产代码零逻辑改动（注释与测试面变更）
4. 仅跑本改动相关测试（规则 0）：sillyhub-daemon/tests/daemon-mission-worker-artifact.test.ts 全文件
