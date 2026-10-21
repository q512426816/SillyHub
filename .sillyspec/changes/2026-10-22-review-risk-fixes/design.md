---
author: flow-machine-draft
created_at: 2026-10-21T23:14:12.277Z
---
# 设计记录（Design Record）— 2026-10-22-review-risk-fixes

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

修复 2026-10-22 只读审查确认的四处缺口，方案均为最小修：

1. **原型路由防线（FR-01/FR-02）**：`/proto/session-redesign/page.tsx` 补 `export const dynamic = "force-dynamic"`（同目录 `session-trajectory/page.tsx:24` 同款先例）——Next 14.2.5 App Router 下无动态 API 的 Server Component 页默认构建期静态预渲染，会在 `next build` 时执行 `loadStagedSessionExport()`（readFileSync `.proto-staging/session-export.json`，3.3MB 真实会话导出）并把内容烘进预渲染产物；改声明后读盘只在请求时发生（该文件头注自述口径本就是 force-dynamic，代码补齐声明）。纵深第二层：`frontend/.dockerignore` 追加 `/.proto-staging/` 与 `/public/__proto*/`（与 frontend/.gitignore 防线对齐）——现状 dockerignore 未排除该目录而 Dockerfile builder `COPY . .`，从工作树构建镜像即把真实数据带进构建上下文；**gitignore ≠ dockerignore**，两层独立生效（声明层挡预渲染、上下文层挡拷入，任一在位即无数据外泄）。
2. **监听器慢性泄漏（FR-03）**：`event-loop-watch.ts` 的 `defaultSleep` 在 setTimeout 正常到期回调里 `signal.removeEventListener('abort', onAbort)`——现状 `{once:true}` 只在 abort 触发后自摘，正常路径每 60s 窗口在 daemon 生命周期 signal 上滞留一个监听器+闭包（Node AbortSignal 为 EventTarget，无 MaxListeners 告警，静默累积；本机 Node 24 实证无告警）。
3. **解码截断（FR-04）**：`decodeGitCQuote` 字面字符分支由 `bytes.push(inner.charCodeAt(i))` 改为按 codePoint 取 UTF-8 原字节入列（`String.fromCodePoint(cp)` → `Buffer` 展开，代理对一次消费两个 code unit）——现状 charCode>0xFF 经 `Buffer.from(bytes)` 截断为低字节，`quotepath=false` 下 git 只对含字面 `"`/`\`/控制符的路径强制 C 引号、其余非 ASCII 原样输出，「引号+中文」混合路径解码成乱码。纯八进制转义/非引号/畸形形态路径不动。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `frontend/src/app/proto/session-redesign/page.tsx`：新增路由段导出 `export const dynamic = "force-dynamic"`。无 props/组件签名变化；对外可见行为差异仅构建期（不做静态预渲染），请求时 SSR 行为不变。
- `frontend/.dockerignore`：新增两行排除项（`/.proto-staging/`、`/public/__proto*/`）。不改变其余排除面。
- `sillyhub-daemon/src/event-loop-watch.ts`：`defaultSleep`（模块私有）行为变化——正常到期后监听器归零；`EventLoopWatchDeps.sleep` 注入面、`runEventLoopWatch` 循环语义、abort reject 形态均不变。
- `sillyhub-daemon/src/host-fs-handler.ts`：`decodeGitCQuote`（已导出）对字面非 ASCII/增补平面字符的解码正确性修复；ASCII-only 与转义序列输入输出逐字节不变。
- 无端点/命令/文件格式变化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   成立。decode 是纯函数无时序；defaultSleep 的 timer/abort 竞态只有两种到达序（timer 先→resolve 并摘监听器；abort 先→clearTimeout 并 reject，`once:true` + removeEventListener 双保险幂等）；force-dynamic 只影响构建期，请求序无变化。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   三处改动均无共享可变状态（decode 局部字节数组；defaultSleep 每次 sleep 独立闭包；声明/dockerignore 是静态文件）。多 daemon 实例/多构建进程互不串台。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   安全。defaultSleep 若在挂起中 signal abort → reject（循环 break 优雅退出，2026-10-21-spec-conflict-autoheal P3② 语义不变）；若 timer 已到期后 abort → 监听器已摘，abort 无副作用（promise 已 settle）。页面路由 force-dynamic 不改变 dev/生产请求生命周期。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   不会。decode 作用于单条路径字符串；dockerignore 作用域限 frontend 构建上下文；监听器作用域限单 daemon 进程内 signal——均无跨工作区/跨仓串台面。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：FR-04 用 codePoint 重组字面字符后，若输入字符串本身是坏 UTF-16（孤立代理项）产出坏字节——与修复前同样产生乱码但不会更差（防御性等价，且 git 输出不会给孤立代理）。放弃的方案：① 给 `/proto/**` 加 middleware 鉴权——D-010 故障面已登记为独立事项，本次不动鉴权语义（避免 proto 预览页依赖登录态改变 dev 评审工作流），以「数据不进产物/上下文」双层代替；② 把真实导出换成人造 fixture——违背 FR-frontend-018（dev 预览要真实会话观感），不做。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | frontend/src/app/proto/session-redesign/page.tsx | 补 `export const dynamic = "force-dynamic"`（FR-01） |
| 修改 | frontend/.dockerignore | 追加 `/.proto-staging/`、`/public/__proto*/` 排除（FR-02） |
| 修改 | sillyhub-daemon/src/event-loop-watch.ts | defaultSleep 正常到期摘 abort 监听器（FR-03） |
| 修改 | sillyhub-daemon/tests/event-loop-watch.test.ts | 新增真实 defaultSleep 监听器计数归零 + abort 路径回归测试（FR-03） |
| 修改 | sillyhub-daemon/src/host-fs-handler.ts | decodeGitCQuote 字面字符按 UTF-8 原字节组装（FR-04） |
| 修改 | sillyhub-daemon/tests/host-fs-handler-git-log.test.ts | 新增 GL49 混合路径/增补平面解码用例（FR-04） |
