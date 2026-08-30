# 三入口浏览器实证（portal-smoke.mjs → 3001 部署版）

## 断言
✅ 01-global-sessions 门户渲染（会话列表在）
✅ 01-global-sessions 标题范围后缀 — 智能体会话
✅ 全局：筛选控件在（scope 隐藏不适用） — count=1
✅ 02-workspace-sessions 门户渲染（会话列表在）
✅ 02-workspace-sessions 标题范围后缀 — 智能体会话 · 工作区
✅ 工作区：服务端筛选控件隐藏
✅ 工作区：选中会话前输入区/发送按钮（若选中）或新建表单 — send=false
✅ 03-change-sessions 门户渲染（会话列表在）
✅ 03-change-sessions 标题范围后缀 — 智能体会话 · 变更
✅ 变更：服务端筛选控件隐藏
❌ 工作区列表有条目可点 — 列表空

## 步骤
[2026-08-22T10:38:31.594Z] S1-global {"statusFilterVisible":1,"sendBtn":false}
[2026-08-22T10:38:33.847Z] S2-workspace {"statusFilterVisible":0,"sendBtn":false}
[2026-08-22T10:38:35.887Z] S3-change {"statusFilterVisible":0,"sendBtn":false}
[2026-08-22T10:38:36.058Z] SUMMARY 断言 11 失败 1；console/HTTP≥400：0

## console/HTTP≥400
（零）