---
author: flow-machine-draft
created_at: 2026-10-12T02:05:09.209Z
---
# 提案书（Proposal）— 2026-10-12-clipboard-helper-full-migration

## 动机

任务原话转写：动机：clipboard-fallback 变更只接入了三页凭据复制，全仓仍有 15 个文件约 20 处 navigator.clipboard 直调（change 名/命令卡/日志行/工具输出/群聊 ID/复制按钮原语等）在纯 HTTP 局域网主部署形态下同样不可用或静默失败——平台级复制体验不一致，helper 已存在却只覆盖三页。
成功标准：
- frontend/src 内除 lib/clipboard.ts 与测试桩外零 navigator.clipboard 直调残留（grep 复核验收）；全部调用点改走 copyTextToClipboard
- 三类特殊形态正确迁移：①阻塞守卫「if (!navigator.clipboard) return」移除（守卫会挡住降级路径，非安全上下文从静默 no-op 升级为实际复制）；②copy-button 的显式抛错分支由 helper 失败抛错承接（done/failed 状态机语义不变）；③fire-and-forget 链（void ...?.writeText().then().catch()）改为 void copyTextToClipboard().then().catch()，成功/失败回调语义逐字不变
- 触碰组件既有测试全绿（stub clipboard 的用例证明委托无损），tsc --noEmit 零错、触碰文件 eslint 零错
- 仅跑本改动相关测试（规则 0）：触碰组件的测试文件 + tsc/eslint 门

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. frontend/src 内除 lib/clipboard.ts 与测试桩外零 navigator.clipboard 直调残留（grep 复核验收）；全部调用点改走 copyTextToClipboard
2. 三类特殊形态正确迁移：①阻塞守卫「if (!navigator.clipboard) return」移除（守卫会挡住降级路径，非安全上下文从静默 no-op 升级为实际复制）；②copy-button 的显式抛错分支由 helper 失败抛错承接（done/failed 状态机语义不变）；③fire-and-forget 链（void ...?.writeText().then().catch()）改为 void copyTextToClipboard().then().catch()，成功/失败回调语义逐字不变
3. 触碰组件既有测试全绿（stub clipboard 的用例证明委托无损），tsc --noEmit 零错、触碰文件 eslint 零错
4. 仅跑本改动相关测试（规则 0）：触碰组件的测试文件 + tsc/eslint 门

## 成功标准（可验证）

1. frontend/src 内除 lib/clipboard.ts 与测试桩外零 navigator.clipboard 直调残留（grep 复核验收）；全部调用点改走 copyTextToClipboard
2. 三类特殊形态正确迁移：①阻塞守卫「if (!navigator.clipboard) return」移除（守卫会挡住降级路径，非安全上下文从静默 no-op 升级为实际复制）；②copy-button 的显式抛错分支由 helper 失败抛错承接（done/failed 状态机语义不变）；③fire-and-forget 链（void ...?.writeText().then().catch()）改为 void copyTextToClipboard().then().catch()，成功/失败回调语义逐字不变
3. 触碰组件既有测试全绿（stub clipboard 的用例证明委托无损），tsc --noEmit 零错、触碰文件 eslint 零错
4. 仅跑本改动相关测试（规则 0）：触碰组件的测试文件 + tsc/eslint 门
