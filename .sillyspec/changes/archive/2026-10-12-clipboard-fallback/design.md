---
author: flow-machine-draft
created_at: 2026-10-12T00:42:29.656Z
---
# 设计记录（Design Record）— 2026-10-12-clipboard-fallback

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

`navigator.clipboard` 仅存在于安全上下文（HTTPS/localhost），而本仓明示以纯 HTTP 局域网形态部署（lib/api.ts 注释自证）——apikey-mcp-copy-delete 交付的三页凭据复制在该主部署形态下调用即抛 TypeError（被 catch 成错误横幅，功能不可用）。修法：新增 `frontend/src/lib/clipboard.ts` 单一 helper——安全上下文委托 Async Clipboard API；缺失时降级隐藏 textarea + `document.execCommand('copy')`（legacy API，非安全上下文唯一程序化写入通道；readonly 防移动端键盘、fixed+透明防布局闪动、finally 清节点并恢复既有选区），失败抛错由调用方既有 catch 承接。三页 5 处调用点全部改走 helper，页面 catch/状态机零变化。仓内其它复制点（daemon/copy-button 等）仍为旧实现，触碰时再迁移（头注已披露）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- 新增 lib 导出 `copyTextToClipboard(text: string): Promise<void>`；三页行为变化一处：非安全上下文下复制从「抛错横幅」变为「实际复制成功」（缺陷修复，无消费方依赖旧行为）；安全上下文行为零变化。无 schema/端点变化，`pnpm gen:types` 不需跑。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   不适用：无状态单次调用；并发点击由页面既有 copyingId/copied 状态机互斥（零变化），helper 本身幂等。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   降级路径的临时 textarea 为调用瞬间局部节点（append→select→copy→remove 同步完成），并发调用各建各的节点互不干扰；选区保存/恢复以调用时点快照为准，最坏恢复到并发方的选区，与剪贴板语义无关（可接受，纯展示层细节）。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   finally 保证临时节点移除与选区恢复，中途异常不残留 DOM；无状态迁移面。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   不适用：纯客户端单值写入，无跨作用域数据流；明文仅进剪贴板与临时节点（即取即删），不进日志/存储（与既有安全语义一致）。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- 风险：execCommand 已被 WHATWG 废弃，未来浏览器可能移除——届时降级路径失效回到报错横幅（与修复前同等），Async Clipboard 主路径不受影响；非安全上下文下无其它程序化通道（Service Worker 剪贴板方案依赖 HTTPS），移除前该方案是唯一解。
- 放弃方案 A：改部署形态强制 HTTPS/localhost——部署约束变更不归前端代码管，且局域网自签证书有额外运维成本；代码侧降级是即时空运的解。
- 放弃方案 B：navigator.clipboard 缺失时直接报「请在 HTTPS 下使用」引导文案——不解决功能不可用本身，execCommand 降级在目标浏览器（Chrome/Edge/Firefox 全支持）下即可用。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 增 | frontend/src/lib/clipboard.ts | copyTextToClipboard helper（安全委托 + execCommand 降级） |
| 增 | frontend/src/lib/__tests__/clipboard.test.ts | 3 用例（委托/降级/降级失败） |
| 改 | frontend/src/app/(dashboard)/settings/api-keys/page.tsx | 调用点改走 helper |
| 改 | frontend/src/app/(dashboard)/workspaces/[id]/mcp-tokens/page.tsx | 调用点改走 helper |
| 改 | frontend/src/app/(dashboard)/runtimes/page.tsx | 3 处调用点改走 helper |
| 改 | frontend/src/app/(dashboard)/settings/api-keys/__tests__/page.test.tsx | 非安全上下文集成用例 |
