---
author: flow-machine-draft
created_at: 2026-10-20T00:46:19.189Z
---
# 设计记录（Design Record）— 2026-10-20-pill-dock-left-align

## 做法概述

现状:`session-floating-pill-dock.tsx` 的停靠组 className 硬编码 `items-end`,吸附左/右缘时 pill 内容一律右对齐,贴左视觉上"没贴齐"。

方案:对齐方向跟随吸附侧,而吸附侧的判据 `snapPos` 里已有(组中心在边界左/右半边)——让吸附结果携带侧别标记,渲染时按侧切换对齐类。具体:`DockPos` 增加可选字段 `left?: boolean`(吸附侧标记),`snapPos` 吸附时与 x 同步写入 `left`;render 的 className 把硬编码 `items-end` 改为 `pos.left ? "items-start" : "items-end"`。所有产生吸附态的路径(settle 收敛 / ResizeObserver / window resize / 拖拽松手)都经 `snapPos`,标记自动一致;存档恢复路径从裸 `clampPos` 改走 `snapPos`(幂等,x/y 不变),使恢复首帧即有正确对齐,不依赖后续收敛补写。

存档格式保持 `{x, y}` 不变:`persist` 只写 x/y(对齐不入档,由吸附判据从坐标重推导),旧存档无缝兼容;`left` 仅内存态。

## 接口契约

- `DockPos` 类型:`{ x: number; y: number }` → `{ x: number; y: number; left?: boolean }`(组件内部类型,无外部消费方)。
- `snapPos` 返回值:增加 `left` 字段(纯函数内部,无外部调用方)。
- localStorage `sillyhub:session-pill-dock` 存档格式:**不变**(`{x, y}`,persist 只序列化 x/y)。
- 组件对外 props / DOM 结构 / data-testid:不变。唯一可见行为变化 = 贴左吸附时组内容 items-start 左对齐。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
   对齐标记与吸附位置由 `snapPos` 原子地同时产生(同一函数返回),不存在"位置来自左缘而对齐来自右缘"的错位;resize 事件迟到/重复触发时 snapPos 幂等,left 随 x 一致重算。假设成立。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
   localStorage 仅拖拽松手时写一次(既有行为不变),单 key 整写无部分写;多标签页同写同 key 后写覆盖先写,读回时 snapPos 从坐标重推导对齐,任意合法存档恢复都对齐自洽。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
   left 是纯内存派生态,不入档、不跨会话;中断/崩溃最坏情况 = 存档仍是合法 {x,y},重载后按坐标重吸附重推导,无脏态。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
   同一浏览器 origin 共用 key(既有口径不变,非本变更引入);left 不入档不参与序列化,无新增串台面。

## 风险与死路

最大风险:存档恢复首帧对齐闪动(恢复帧 items-end、下一帧切 items-start)。已消除——恢复路径改走 `snapPos`,首帧即携带正确 left。
试过但放弃的方案:① render 期读 `dockRef.getBoundingClientRect()` + bounds 现算对齐——render 读 DOM 不纯(ref 首帧为 null),且每次 render 强制布局;② 持久化存档带 left 字段——存档格式变化,既有 toEqual 断言与旧档兼容都要跟着动,left 可从坐标幂等重推导,入档属冗余状态。两案均弃,采用吸附判据单源派生。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | frontend/src/components/daemon/session-floating-pill-dock.tsx | DockPos 加 left 标记;snapPos 写入;恢复路径走 snapPos;settle 比较含 left;className 按侧切 items-start/items-end;头注释更新 |
| 修改 | frontend/src/components/daemon/__tests__/session-floating-pill-dock.test.tsx | 左/右吸附用例各加对齐断言;新增存档恢复两侧对齐用例 |
