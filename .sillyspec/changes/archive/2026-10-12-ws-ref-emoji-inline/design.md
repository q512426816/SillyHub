---
author: flow-machine-draft
created_at: 2026-10-12T01:11:49.294Z
---
# 设计记录（Design Record）— 2026-10-12-ws-ref-emoji-inline

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

用户反馈（2026-10-12）：引用标签类型图标不要左上角悬浮，要一直回显在标签文字最前面。实现取 emoji 文本字符内嵌 token（`【📄 name】`，attachment-refs.ts 构造层统一落字：附件 📎 / 文件 📄 / 目录 📁 / 代码块 🧾）——这是唯一保住镜像高亮层「overlay 与 textarea 逐字符对齐」铁律的形态：emoji 是文本，占位文本与 textarea 天然同宽；lucide 等 inline 图标元素会撑宽背景块造成后续 token 累积漂移（2026-10-10 mx-px 教训），不可用。InputRefOverlay 删除左上类型角标渲染（KIND_ICON/data-ws-ref-kind-badge 退役）；悬停完整绑定提示改由宿主 hitTest 命中后经 hoverTip prop 渲染 fixed 气泡（overlay 层 pointer-events:none，原生 title 不可依赖）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `buildAttRefToken(name, seq)` 返回值变为 `【📎 name(·N)】`（签名不变，语义为 token 文本形态）。
- `buildWsRefToken(kind, name, lines, seq)` 与 `allocateWsRefToken(kind, base, pool)` 新增 kind 首参（构造对应 emoji 前缀）；两输入区调用点同步。
- `InputRefOverlay` props：tokenMetas 保留（tooltip 数据源，不再渲染角标）；新增可选 `hoverTip: {text,x,y}|null`（宿主命中驱动渲染 data-ws-ref-hover-tip 气泡）。
- × 角标 aria-label/title 改为剥图标前缀的纯名称（`slice(1,-1).replace(/^\S+\s/,"")`）。
- 发送置换/历史解析协议零变化（map 值=完整 token 全文匹配，token 含 emoji 自然成立）；后端 0 端点 0 schema。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   不涉及事件流；token 由构造层同步生成，无乱序面。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   单输入区受控状态（React 单线程渲染），无并发写面；两个输入区（单聊/群聊）各自持独立 map 互不共享。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   会话/群切换时草稿持久化回填的是纯文本 value（token 文本随之持久，重新挂载后 map 丢失→按孤儿降级纯文本，与既有口径一致）；hoverTip 随指针移出清空（onPointerLeave），无残留。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   同类型同名（emoji 相同）仍按 ·2 唯一化（emoji 参与占用文本整体比对）；跨类型同名（📎 vs 📄）图标自区分不加号，不构成显示歧义；手打【name】（无 emoji）与槽位插入形态不同，互不占位。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：emoji 宽度在不同平台字体下的渲染差异（Windows/macOS/Linux 不一致）——但占位文本与 textarea 用同一字符同一字体栈，两侧永远同宽（同源对齐），风险仅剩视觉观感，可接受。放弃的方案：lucide inline 图标内嵌（撑宽背景块→后续 token 漂移，否决）；图标 absolute 悬浮在文字前（遮挡前文字符且盖住【，观感差，否决）。
