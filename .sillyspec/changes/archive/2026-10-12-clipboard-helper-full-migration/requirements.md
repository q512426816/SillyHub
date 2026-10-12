---
author: flow-machine-draft
created_at: 2026-10-12T00:42:29.656Z
---
# 需求规格（Requirements）— 2026-10-12-clipboard-helper-full-migration

## 功能需求

### FR-01: frontend/src 内除 lib/clipboard.ts 与测试桩外零 navigator.clipboard 直调残留（grep 复核验收）；全部调用点改走 copyTextToClipboard

- 全部生产代码复制调用必须经 `copyTextToClipboard`（Async Clipboard 委托 + execCommand 降级单一实现）；迁移后 grep `navigator.clipboard` 在 src 下仅允许命中 lib/clipboard.ts 与 __tests__ 桩。

#### 场景：残留清零

- When 对 src 做 navigator.clipboard grep（排除 lib/clipboard.ts 与测试）
- Then 零命中

### FR-02: 三类特殊形态正确迁移：①阻塞守卫「if (!navigator.clipboard) return」移除（守卫会挡住降级路径，非安全上下文从静默 no-op 升级为实际复制）；②copy-button 的显式抛错分支由 helper 失败抛错承接（done/failed 状态机语义不变）；③fire-and-forget 链（void ...?.writeText().then().catch()）改为 void copyTextToClipboard().then().catch()，成功/失败回调语义逐字不变

- 阻塞守卫必须删除（保留则降级不可达）；copy-button 的 status done/failed/scheduleReset 状态机逐字不变（失败经 .catch(fail) 或 try/catch 进 failed）；fire-and-forget 链的 then/catch 回调体与注释逐字保留。

#### 场景：状态机不变

- When 对照 copy-button 迁移前后 diff
- Then setStatus/scheduleReset 调用点零变化，仅取值来源换 helper

### FR-03: 触碰组件既有测试全绿（stub clipboard 的用例证明委托无损），tsc --noEmit 零错、触碰文件 eslint 零错

- 全部触碰组件的既有测试文件必须全绿不改语义（stub navigator.clipboard 的用例走 helper 委托路径）；新增/调整的断言仅允许针对降级行为；tsc 与 eslint（触碰文件）零错。

#### 场景：回归绿

- When 运行触碰组件测试 + tsc + eslint
- Then 全部通过

### FR-04: 仅跑本改动相关测试（规则 0）：触碰组件的测试文件 + tsc/eslint 门

- 本变更只必须运行触碰组件的既有测试文件与 lint/typecheck 门，禁止跑全量测试套件（规则 0，全量留给 CI）。

#### 场景：相关面回归

- When 执行
- Then 全部通过

### FR-05: 回归复审驱动加固（F1/F4/F6/F9/F10）：iOS Safari 降级路径、runtimes 裸 await 失败可见性、「明文不进 DOM」过期注释同步、page 测试桩泄漏、选区断言强度

- helper 降级路径必须处理 iOS Safari 的 readonly+select() 已知缺陷（iOS 形态走 contentEditable + Range 选区 + setSelectionRange，对齐 clipboard.js 规避法），并在 design 披露排除面；runtimes 页两处裸 await 调用点（InstallDaemonBlock/AutostartDaemonBlock）必须补 try/catch 使失败经 setNotice 可见（helper JSDoc「失败由调用方既有 catch 承接」随之成立）；copy-daemon-command 测试的「明文绝不进 DOM」过期注释必须同步为双路径现实（安全上下文不进 DOM/降级路径即取即删临时节点）；api-keys 页测试 afterEach 必须清理 defineProperty 注入的 clipboard/execCommand 桩（防后续用例假绿）；lib 测试选区断言必须钉 select() 真被调（原型 spy）。

#### 场景：iOS 形态

- Given iOS UA 且 clipboard 缺失
- When copyTextToClipboard
- Then 走 contentEditable+Range 选区而非裸 select()

#### 场景：裸 await 失败可见

- Given 非安全上下文 execCommand 返回 false
- When InstallDaemonBlock 点复制
- Then setNotice 错误文案出现（无 unhandled rejection）

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/__tests__/copy-button.test.tsx（copy-button 迁移后委托断言；全仓残留由 grep 验收留痕 tasks 勾选证据）
FR-02: frontend/src/components/daemon/__tests__/copy-button.test.tsx（done/failed 状态机既有用例零改动全绿）
FR-03: frontend/src/components/daemon/__tests__/copy-button.test.tsx（+ 其余触碰组件既有测试文件）
FR-04: frontend/src/components/daemon/__tests__/copy-button.test.tsx（+ 触碰面测试与 tsc/eslint 门）
FR-05: frontend/src/lib/__tests__/clipboard.test.ts「非安全上下文（clipboard 缺失）：textarea + execCommand 降级，节点清理、选区恢复」「降级失败（execCommand 返回 false）→ 抛错且节点仍被清理（finally 保证）」
