---
author: qinyi
created_at: 2026-08-23 21:25:00
---

# 任务清单（Tasks）

- [ ] task-01: backend build_scan_bundle strategy 三分支模板 + 工具提示中性化 + 三策略单测
- [ ] task-02: CLI isSelfReferentialSpecRoot + isPlatformMode helper + shared.js 四处判定收敛 + 单测
- [ ] task-03: CLI 指针生命周期免疫（恢复忽略/写入拦截/声明降级/doctor 画像）+ 回归测试 (depends_on: task-02)
- [ ] task-04: 工具仓发版 3.27.3 + 全局重装 + 自指场景冒烟 (depends_on: task-02, task-03)
- [ ] task-05: 现场端到端验证——指针再中毒复查 + 本地变更上行平台 + junction 回灌回归 (depends_on: task-01, task-04)
