---
author: flow-machine-draft
created_at: 2026-10-13T02:34:28.398Z
---
# 任务注册表（Tasks）— 2026-10-13-session-scroll-layout-storm

- [x] task-01: session-panel-page.tsx 钉回重申 rAF 合帧——新增 anchorPinRafRef，onScroll 程序性滚动分支由同步 `anchorPinRef.current?.()` 改为句柄判重排 rAF（同帧多次 scroll 只排一个），回调内读 anchorPinRef 现值（锚失效自然 no-op）——验证：tsc 无新错
- [x] task-02: rAF 句柄三处清理——isTrusted 弃锚分支同步取消挂起句柄；滚动监听 effect cleanup 与 activeTurnRaf 同点取消；锚失效路径回调读 null no-op——验证：代码审查对照 design FR-03
- [x] task-03: session-history-scroll.test.tsx 新增合帧用例（实施中演化：全局 rAF spy 被锚 effect 双层 rAF 多消费者污染，改 scrollTop setter 观测直击语义——事件内零同步写入、下一帧才执行；isTrusted/卸载清理用例因 jsdom 无法构造 isTrusted 事件与句柄归属不可辨，由代码审查覆盖，requirements 绑定行已同步）——验证：vitest 新用例绿
- [x] task-04: 跑 session-history-scroll.test.tsx 全文件回归（触顶翻页/游标推进/锚定期 interval 配对/回到会话开头零失败）——验证：全文件绿（270/270，含相关依赖面 19 文件）
- [x] task-05: 范围排除声明——useDaemonMachines 轮询合并另立变更，本变更 diff 不触碰轮询（改动面审查：仅 session-panel-page.tsx 滚动段 + 测试文件）——验证：git diff 改动面核对（提交 f3f323d45 仅 2 文件）
