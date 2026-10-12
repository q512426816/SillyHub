---
author: flow-machine-draft
created_at: 2026-10-12T01:51:16.320Z
---
# 设计记录（Design Record）— 2026-10-12-ws-ref-atomic-caret

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

用户反馈：引用标签应是一个整体——当前光标能点进标签内部改字、左右移动被当普通文字逐字符穿过。根因是 textarea 纯文本方案（D-001 架构）下 token 就是普通文本。本变更不动编辑器架构，新增公共 hook `use-atomic-ref-caret.ts` 以事件拦截补「整体感」：① 方向键跳块（无选区时 ←/→ 在标签区间边界一次跨过整块，shift 选区扩展不拦）；② 落位吸附（click/keyup/select 后光标无选区且在标签内部 → 吸附最近边界，兜底 Home/End/Ctrl+方向落入内部的情况）；③ 内部编辑拒绝（beforeinput 目标 range 与任一标签部分重叠且未完整覆盖 → preventDefault，覆盖打字/删字/IME 组字/粘贴；选区完整覆盖整块放行随选删除）。单聊与群聊两输入区同款接线；退格贴尾整删与 × 角标删除既有处理器不触碰。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- 新增 `frontend/src/components/daemon/use-atomic-ref-caret.ts`：`useAtomicRefCaret({ value, tokens, textareaRef })` 返回 `{ ranges, handleAtomicKeyDown, handleAtomicBeforeInput, snapCaret }`；`computeRefTokenRanges(value, tokens)` 导出（token 全部出现区间）。
- session-input-bar / group-chat-panel：textarea 新增 onBeforeInput/onClick/onKeyUp/onSelect 四 props；onKeyDown 首位接方向键跳块（mention 联想只管 ↑↓/Enter/Tab/Esc 无冲突；群聊接在 IME 组合期守卫之后）。
- 后端 0 端点 0 schema；发送置换/历史渲染协议零变化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   事件顺序由浏览器保证（keydown → beforeinput → input）；区间集每次 value/tokens 变化 useMemo 重算，拦截判定始终对当前值，无陈旧区间窗口。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   单输入区受控状态（React 单线程）；两输入区各自持 hook 实例（token 集独立），无共享可变状态。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   hook 无自持状态（纯派生 + ref 操作）；卸载零清理面。IME 组合期：beforeinput 的 insertComposition 部分重叠同样拒绝（组字不会进入标签内部）；群聊 keydown 跳块在 isComposing 守卫之后放行组合期。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   token 区间按当前输入区 value 计算，拦截只作用于本 textarea；孤儿 token（map 不命中）不在 tokens 集内不拦截（纯文本语义，与降级口径一致）。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：拦截面过宽误伤正常输入——部分重叠拒绝会让「拖选从标签中间开始的一段删除」被拒（用户需重选）；接受（行为可预期，完整覆盖整块的选区放行覆盖主路径）。放弃的方案：换 contenteditable 富文本（原子节点原生支持，但 2026-10-09 D-001 已否决——IME/退格/联想全链路回归风险大，本诉求未达「token 机制不可维护」的复潮条件）。
