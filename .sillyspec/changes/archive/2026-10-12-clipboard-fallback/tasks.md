---
author: flow-machine-draft
created_at: 2026-10-12T01:47:39.065Z
---
# 任务注册表（Tasks）— 2026-10-12-clipboard-fallback

- [x] task-01: 新增 frontend/src/lib/clipboard.ts copyTextToClipboard：有 navigator.clipboard.writeText 走 Async Clipboard API；缺失时降级隐藏 textarea + document.execCommand('copy')（恢复既有选区、清理节点、失败抛错由调用方既有 catch 走 errMessage 横幅）
- [x] task-02: 三页 5 处调用点全部改走 helper，页面自身 catch/状态机零变化；既有页面测试（secure 路径 stub clipboard）全绿证明委托无损
- [x] task-03: 新增 lib 单测先红后绿：secure 路径委托、非安全路径降级（execCommand 被调、无节点残留）、降级失败抛错；api-keys 页补非安全上下文集成用例（clipboard undefined + execCommand stub → 复制成功回显）
- [x] task-04: 仅跑本改动相关测试（规则 0）：新增 lib 测试 + 三页既有测试文件
