---
author: flow-machine-draft
created_at: 2026-10-09T07:21:15.089Z
---
# 设计记录（Design Record）— 2026-10-09-close-trace-single-set-platform

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

CLI 仓 2026-10-09-close-trace-single-set 把收口留痕四件套收敛为单套（只落 change.patch + change-patch.json，原 scope-audit.json 对账面并入 change-patch.json 的 scopeAudit 子对象）。平台侧配套三件小改：前端 structured-views.tsx 新增 ChangePatchView（清单摘要条 + 交付文件表 + scopeAudit 子对象复用既有 ScopeAuditView），knownJsonView 分发点新增 change-patch.json 分支（files 数组为特征，旧三分支零改动）；后端 schema.py 仅更新 ChangePatchMeta docstring 说明新契约（DTO 字段零变化）；跨仓契约文档追加演进注记。复用既有 MetaItem/DataTable/SectionTitle/ScopeAuditView 组件，与既有结构化视图同构，不动后端读取路径——顶级字段已含卡面所需全部数据，后端零改动是本方案的核心取舍。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- frontend knownJsonView(name, value)：新增 change-patch.json 命中（basename 判定 + files 数组特征）→ ChangePatchView；既有 scope-audit.json/apply-manifest.json/verify-facts.json 三分支零改动。
- backend ChangePatchMeta DTO：字段零变化（docstring-only）——无需 pnpm gen:types。
- assets.py 读取路径 / 端点：零改动。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

纯展示组件按值渲染，无时序假设；scopeAudit 子对象缺席/畸形走降级说明文案（文件预览不白屏）。CLI 与平台镜像同步的时序差（旧 CLI + 新前端或反之）无影响——两形态各自独立分支互不依赖。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

无共享可变状态（React 纯函数组件，props 驱动渲染）。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

纯渲染无副作用/无订阅，组件卸载即回收，无残留状态。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

按 basename 分发，同目录其他 json 不受影响；旧名分支保留兜存量归档（其他仓镜像仍为旧形态）。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：CLI 新形态落盘字段与前端特征判定脱节（如 files 非数组）——已知防御：特征判定失败回落 JsonView 折叠树（既有机制），不白屏。放弃方案：改后端 assets.py 读 scopeAudit 子对象做投影——顶级字段（files/totals/patchStatus/savedAt）已含卡面全部所需，子对象仅前端预览增值面，动后端是无效改动面。
