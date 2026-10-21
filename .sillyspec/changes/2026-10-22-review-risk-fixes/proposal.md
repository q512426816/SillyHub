---
author: flow-machine-draft
created_at: 2026-10-21T23:14:12.277Z
---
# 提案书（Proposal）— 2026-10-22-review-risk-fixes

## 动机

任务原话转写：审查修复：原型路由防线与监听泄漏

昨夜只读审查（61 提交）确认四处缺口：/proto/session-redesign 生产无鉴权且缺 force-dynamic，Next14 构建会把工作树 .proto-staging/ 3.3MB 真实会话导出烘进静态预渲染产物，而 frontend/.dockerignore 未排除该目录（gitignore≠dockerignore）；event-loop-watch defaultSleep 正常到期路径不摘 abort 监听器，daemon 长生命周期 signal 上每 60s 滞留一个闭包（静默慢性泄漏，Node24 实测无告警）；decodeGitCQuote 字面字符按 charCodeAt 入字节数组，charCode>0xFF 在 Buffer.from 截断为低字节，「字面引号+中文」混合路径解码成乱码。

成功标准：
- /proto/session-redesign/page.tsx 显式 export const dynamic = 'force-dynamic'（对齐 session-trajectory/page.tsx:24 同款），消除构建期静态预渲染读盘
- frontend/.dockerignore 追加 /.proto-staging/，工作树 docker build 不再拷入真实会话导出
- event-loop-watch 正常窗口走完后 AbortSignal 的 abort 监听器计数不随窗口数增长（新增测试以真实 defaultSleep 断言）
- decodeGitCQuote 对含字面引号与非 ASCII 混合路径（如 中文"x.md）完整还原原文（新增单测，UTF-8 多字节按原字节组装）
- daemon 目标测试+既有 event-loop-watch/quotepath 套件回归全绿，frontend tsc --noEmit 零错

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. /proto/session-redesign/page.tsx 显式 export const dynamic = 'force-dynamic'（对齐 session-trajectory/page.tsx:24 同款），消除构建期静态预渲染读盘
2. frontend/.dockerignore 追加 /.proto-staging/，工作树 docker build 不再拷入真实会话导出
3. event-loop-watch 正常窗口走完后 AbortSignal 的 abort 监听器计数不随窗口数增长（新增测试以真实 defaultSleep 断言）
4. decodeGitCQuote 对含字面引号与非 ASCII 混合路径（如 中文"x.md）完整还原原文（新增单测，UTF-8 多字节按原字节组装）
5. daemon 目标测试+既有 event-loop-watch/quotepath 套件回归全绿，frontend tsc --noEmit 零错

## 成功标准（可验证）

1. /proto/session-redesign/page.tsx 显式 export const dynamic = 'force-dynamic'（对齐 session-trajectory/page.tsx:24 同款），消除构建期静态预渲染读盘
2. frontend/.dockerignore 追加 /.proto-staging/，工作树 docker build 不再拷入真实会话导出
3. event-loop-watch 正常窗口走完后 AbortSignal 的 abort 监听器计数不随窗口数增长（新增测试以真实 defaultSleep 断言）
4. decodeGitCQuote 对含字面引号与非 ASCII 混合路径（如 中文"x.md）完整还原原文（新增单测，UTF-8 多字节按原字节组装）
5. daemon 目标测试+既有 event-loop-watch/quotepath 套件回归全绿，frontend tsc --noEmit 零错
