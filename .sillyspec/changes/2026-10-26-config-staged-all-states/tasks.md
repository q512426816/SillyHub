---
author: flow-machine-draft
created_at: 2026-10-26T05:16:17.246Z
---
# 任务注册表（Tasks）— 2026-10-26-config-staged-all-states

- [x] task-01: 组件 stagedMode 分支去 !running + 档位控件 running 禁用解除(stagedMode 下)+ onThinkingMenuClick 同步;验证=测试「running 点选供应商/模型/档案/档位 → 仅暂存上抛不 inject 不 POST」绿
- [x] task-02: displayProviderId(暂存优先)派生 selectedProvider/modelCandidates,模型下拉显示与候选跟随暂存供应商;验证=测试「暂存供应商后模型下拉显示且候选为新供应商模型;取消暂存回退」绿
- [x] task-03: 发送链路复核(排队路径上一变更已并入,本任务验接口不断);验证=variant 测试「发送并入暂存」既有用例绿
- [x] task-04: 既有 running/ended/兼容锚用例更新与回归;验证=session-config-bar.test.tsx 全量绿
- [x] task-05: 相关测试全量跑 + lint;验证=vitest 触达文件通过、eslint 无新告警
