---
author: qinyi
created_at: 2026-08-23 22:10:00
---

# 模块影响分析（Module Impact）— 修复 repo-native 工作区 spec 回灌断链

> 首版生成于 plan 阶段（输入=design.md 文件变更清单 + plan.md 任务列表）；execute/verify 阶段回填更新结果，archive 阶段终审。

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| agent | 修改 | context_builder.py：build_scan_bundle 增 SpecWorkspace.strategy 读取与三分支模板（repo-native 本地模板：零平台参数/无 init）；render_bundle_to_claude_md 工具提示去 --spec-root 硬编码；tests/test_context_builder.py 增三策略断言（task-01） |

## 未匹配文件

| 文件 | 处置说明 |
|---|---|
| /Users/qinyi/Desktop/sillyspec/src/run/shared.js | 跨仓（sillyspec 工具仓），主仓 module-map 不覆盖；task-02 改（新增 isSelfReferentialSpecRoot/isPlatformMode + 四处判定收敛），随工具仓独立提交 |
| /Users/qinyi/Desktop/sillyspec/src/run/command.js | 跨仓，task-03 改（指针恢复自指忽略/写入门禁/接管声明降级） |
| /Users/qinyi/Desktop/sillyspec/src/init.js | 跨仓，task-03 改（writeInitPlatformPointer isExternalSpec 补 realpath） |
| /Users/qinyi/Desktop/sillyspec/src/doctor-diagnostics.js | 跨仓，task-03 改（repo-native 断链画像告警） |
| /Users/qinyi/Desktop/sillyspec/test/ | 跨仓，task-02/03 新增测试 |
| /Users/qinyi/Desktop/sillyspec/package.json | 跨仓，task-04 发版 3.27.3 |

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/agent.md` | 更新 agent 模块卡（build_scan_bundle strategy 三分支门禁，repo-native 本地模板） | pending |
| `docs/sillyspec/`（主仓工具缺陷记录） | 2026-08-23 回灌断链坑从活跃迁 finished（修复落地后） | pending |
