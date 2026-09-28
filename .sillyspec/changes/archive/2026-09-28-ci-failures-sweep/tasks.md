---
author: flow-machine-draft
created_at: 2026-09-28T04:20:18.434Z
---
# 任务注册表（Tasks）— 2026-09-28-ci-failures-sweep

> 机器预填草稿（成功标准逐条镜像）——任务面归 agent：按实际实现路径覆写本文件（保持 checkbox 行形态），验收锚在 requirements；
> 默认 thin：无任务卡文件，收口=flow done 唯一裁决。
> ✅ 边干边勾（2026-09-26-tick-loop-nudge，OS Guardrails 同款纪律）：完成一条 = 实现到位 + 相关测试跑绿 → 立即勾 `[x]`，勿攒到收口一把勾（勾选是进度锚与哨兵证据面）。本文件收口前随交付显式 pathspec 提交。

- [ ] task-01: frontend-ci 4 用例稳定失败（分身会话浮层找不到关闭按钮 ×2 / getProviderCaps 14vs13 键 / ChangesOvervi…
- [ ] task-02: daemon-ci 12 用例 60s 超时（batch runLease spawn 集成）+ runtime-handler 注册器多了 knowledge…
- [ ] task-03: e2e N2/N3 侧边栏导航 toBeVisible 元素找不到（含重试均失败）
- [ ] task-04: turn-control-attachment-atomic mtimeMs 0.001ms 浮点差异为 flaky（09-27 过 09-28 挂）
- [ ] task-05: 上列 backend/frontend/daemon/e2e 失败用例根因定位并修复，本地仅跑相关测试通过
- [ ] task-06: 修复不违背「非测试逻辑本身有误时禁止改测试通过」原则：实现 bug 修实现，测试过时
- [ ] task-07: 平台差异修测试断言并注明依据
- [ ] task-08: flaky 用例（mtime 精度）改为精度容差断言，注明文件系统精度依据
- [ ] task-09: 推送后四 workflow CI 转绿（或仅剩与本次无关的新失败并说明）
