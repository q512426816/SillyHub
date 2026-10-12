---
author: flow-machine-draft
created_at: 2026-10-12T03:20:10.192Z
---
# 设计记录（Design Record）— 2026-10-12-ws-ref-hover-tip-portal

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

hover-tip-flip 修复上线后浏览器实测浮层仍不可见。决定性证据：元素 style.top=824px 而 getBoundingClientRect().top=965——偏移 141px，说明浮层的某页面祖先（布局/动画容器）带 transform 创建了 containing block，position:fixed 相对该祖先而非视口定位，按视口坐标计算的 clamp/翻转数学全部错位（此前偶尔可见是布局巧合）。修复：浮层 div 经 createPortal 挂 document.body——body 下无该祖先，fixed 恢复相对视口，坐标系归位。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

InputRefOverlay 的 hoverTip 渲染改 createPortal(…, document.body)；props 签名零变化；DOM 层面浮层从组件树内移到 body 尾部（选择器 data-ws-ref-hover-tip 不变）。后端 0 端点。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

portal 渲染与状态更新同批次，无乱序面。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

纯渲染位置变更，无共享可变状态。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

portal 子树随宿主组件卸载同步卸载（React portal 生命周期契约），无残留 DOM；「use client」组件 portal 仅客户端执行，SSR 安全。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

浮层单例（hoverTip 状态唯一），portal 至 body 不与其他 z 层冲突（z-50）。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

风险：body 直挂元素的测试断言路径变化——已同步改 document.querySelector 并隔离用例（unmount 后断言）。放弃的方案：向上排查移除页面祖先的 transform（根在布局容器/动画库，影响面大且布局再变会复发）；portal 是标准免疫方案。
