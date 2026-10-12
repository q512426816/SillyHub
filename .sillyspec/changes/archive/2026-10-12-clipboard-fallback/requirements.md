---
author: flow-machine-draft
created_at: 2026-10-12T00:42:29.656Z
---
# 需求规格（Requirements）— 2026-10-12-clipboard-fallback

## 功能需求

### FR-01: 新增 frontend/src/lib/clipboard.ts copyTextToClipboard：有 navigator.clipboard.writeText 走 Async Clipboard API；缺失时降级隐藏 textarea + document.execCommand('copy')（恢复既有选区、清理节点、失败抛错由调用方既有 catch 走 errMessage 横幅）

- helper 必须在 `navigator.clipboard?.writeText` 可用时委托 Async Clipboard API；缺失时必须走隐藏 textarea 选区 + `execCommand('copy')` 降级（临时节点必须清理、既有选区恢复、readonly+fixed+透明防布局闪动）；降级失败（execCommand 返回 false）必须抛错，本函数不吞错。

#### 场景：安全上下文委托

- Given navigator.clipboard.writeText 存在
- When copyTextToClipboard
- Then writeText 被调且 execCommand 零调用

#### 场景：非安全上下文降级

- Given navigator.clipboard 缺失（HTTP 局域网主部署形态）
- When copyTextToClipboard
- Then execCommand('copy') 被调、body 无残留 textarea、选区恢复

### FR-02: 三页 5 处调用点全部改走 helper，页面自身 catch/状态机零变化；既有页面测试（secure 路径 stub clipboard）全绿证明委托无损

- api-keys（1 处）/mcp-tokens（1 处）/runtimes（3 处）的全部 `navigator.clipboard.writeText` 直接调用必须改走 helper；页面复制状态机（copiedId/copied 回显、setTimeout 复位、catch errMessage/notice）逐字不变；既有页面测试语义不变全绿。

#### 场景：委托无损

- When 运行三页既有测试（stub clipboard 的 secure 路径用例）
- Then 全绿不改语义

### FR-03: 新增 lib 单测先红后绿：secure 路径委托、非安全路径降级（execCommand 被调、无节点残留）、降级失败抛错；api-keys 页补非安全上下文集成用例（clipboard undefined + execCommand stub → 复制成功回显）

- lib 三个用例与 api-keys 集成用例必须在 helper 存在前为红（模块不存在无法通过）；jsdom 不实现 document.execCommand（原型链上也无），桩必须用 defineProperty 而非 vi.spyOn。

#### 场景：降级集成

- Given api-keys 页 + clipboard 缺失 + execCommand stub 返回 true
- When 点「复制密钥」
- Then execCommand 被调 'copy' 且「已复制」回显

### FR-04: 仅跑本改动相关测试（规则 0）：新增 lib 测试 + 三页既有测试文件

- 本变更只必须运行 4 个测试文件，禁止跑全量测试套件（规则 0，全量留给 CI）；lint/tsc 门跑改动文件。

#### 场景：相关面回归

- When 运行 4 文件 + eslint/tsc
- Then 全部通过

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/lib/__tests__/clipboard.test.ts「非安全上下文（clipboard 缺失）：textarea + execCommand 降级，节点清理、选区恢复」「降级失败（execCommand 返回 false）→ 抛错且节点仍被清理（finally 保证）」
FR-02: frontend/src/app/(dashboard)/settings/api-keys/__tests__/page.test.tsx「非安全上下文（clipboard 缺失，HTTP 局域网主部署形态）→ execCommand 降级复制成功回显（2026-10-12-clipboard-fallback）」
FR-03: frontend/src/lib/__tests__/clipboard.test.ts「安全上下文：委托 navigator.clipboard.writeText，不走 execCommand」
FR-04: frontend/src/lib/__tests__/clipboard.test.ts（+ 三页测试文件全文件回归）
