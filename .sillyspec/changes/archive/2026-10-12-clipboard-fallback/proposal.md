---
author: flow-machine-draft
created_at: 2026-10-12T01:47:39.065Z
---
# 提案书（Proposal）— 2026-10-12-clipboard-fallback

## 动机

任务原话转写：动机：24h 风险审查 P2-5——navigator.clipboard 仅在安全上下文（HTTPS/localhost）存在，而本仓明示以纯 HTTP 局域网形态部署（frontend/src/lib/api.ts:69 注释自证、部署技能面向局域网 IP），2026-10-11-apikey-mcp-copy-delete 交付的三页凭据复制（api-keys/mcp-tokens/runtimes 共 5 处调用点）在该主部署形态下调用即抛 TypeError，核心交付不可用（与仓内既有 copy-button 同局限，平台级既有问题）。
成功标准：
- 新增 frontend/src/lib/clipboard.ts copyTextToClipboard：有 navigator.clipboard.writeText 走 Async Clipboard API；缺失时降级隐藏 textarea + document.execCommand('copy')（恢复既有选区、清理节点、失败抛错由调用方既有 catch 走 errMessage 横幅）
- 三页 5 处调用点全部改走 helper，页面自身 catch/状态机零变化；既有页面测试（secure 路径 stub clipboard）全绿证明委托无损
- 新增 lib 单测先红后绿：secure 路径委托、非安全路径降级（execCommand 被调、无节点残留）、降级失败抛错；api-keys 页补非安全上下文集成用例（clipboard undefined + execCommand stub → 复制成功回显）
- 仅跑本改动相关测试（规则 0）：新增 lib 测试 + 三页既有测试文件

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. 新增 frontend/src/lib/clipboard.ts copyTextToClipboard：有 navigator.clipboard.writeText 走 Async Clipboard API；缺失时降级隐藏 textarea + document.execCommand('copy')（恢复既有选区、清理节点、失败抛错由调用方既有 catch 走 errMessage 横幅）
2. 三页 5 处调用点全部改走 helper，页面自身 catch/状态机零变化；既有页面测试（secure 路径 stub clipboard）全绿证明委托无损
3. 新增 lib 单测先红后绿：secure 路径委托、非安全路径降级（execCommand 被调、无节点残留）、降级失败抛错；api-keys 页补非安全上下文集成用例（clipboard undefined + execCommand stub → 复制成功回显）
4. 仅跑本改动相关测试（规则 0）：新增 lib 测试 + 三页既有测试文件

## 成功标准（可验证）

1. 新增 frontend/src/lib/clipboard.ts copyTextToClipboard：有 navigator.clipboard.writeText 走 Async Clipboard API；缺失时降级隐藏 textarea + document.execCommand('copy')（恢复既有选区、清理节点、失败抛错由调用方既有 catch 走 errMessage 横幅）
2. 三页 5 处调用点全部改走 helper，页面自身 catch/状态机零变化；既有页面测试（secure 路径 stub clipboard）全绿证明委托无损
3. 新增 lib 单测先红后绿：secure 路径委托、非安全路径降级（execCommand 被调、无节点残留）、降级失败抛错；api-keys 页补非安全上下文集成用例（clipboard undefined + execCommand stub → 复制成功回显）
4. 仅跑本改动相关测试（规则 0）：新增 lib 测试 + 三页既有测试文件
