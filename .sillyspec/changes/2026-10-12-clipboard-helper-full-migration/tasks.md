---
author: flow-machine-draft
created_at: 2026-10-12T02:05:09.209Z
---
# 任务注册表（Tasks）— 2026-10-12-clipboard-helper-full-migration

- [ ] task-01: frontend/src 内除 lib/clipboard.ts 与测试桩外零 navigator.clipboard 直调残留（grep 复核验收）；全部调用点改走 copyTextToClipboard
- [ ] task-02: 三类特殊形态正确迁移：①阻塞守卫「if (!navigator.clipboard) return」移除（守卫会挡住降级路径，非安全上下文从静默 no-op 升级为实际复制）；②copy-button 的显式抛错分支由 helper 失败抛错承接（done/failed 状态机语义不变）；③fire-and-forget 链（void ...?.writeText().then().catch()）改为 void copyTextToClipboard().then().catch()，成功/失败回调语义逐字不变
- [ ] task-03: 触碰组件既有测试全绿（stub clipboard 的用例证明委托无损），tsc --noEmit 零错、触碰文件 eslint 零错
- [ ] task-04: 仅跑本改动相关测试（规则 0）：触碰组件的测试文件 + tsc/eslint 门
