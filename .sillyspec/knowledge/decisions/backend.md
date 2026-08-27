# 决策知识 — backend

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-001@v1 : plan 模式采用强确认交互
状态：implemented
锚点：`frontend/src/components/daemon/plan-approval-card.tsx`
最近确认：04bb45fe
理由：强确认，类似 askuser 弹窗。

## D-002@v1 : 采用方案 A 复用现有 SSE 事件通道
状态：implemented
锚点：`backend/app/modules/daemon/run_sync/service.py`
最近确认：04bb45fe
理由：方案 A，复用现有 Redis `agent_session:{id}` 频道，新增 `plan_mode_entered` / `bash_status` / `bash_chunk` 事件类型。

## D-preview-001@v1 : Office 预览文件供给走一次性令牌端点（非 presigned）
状态：implemented（休眠）
锚点：`backend/app/modules/preview_office/service.py`
最近确认：3b1624fb
理由：DS 拉文件无法带 JWT——代理端点 /api/preview/file/{token} 与存储后端解耦（storage 无 presign 抽象），HS256+5min TTL+redis jti 一次性；preview-pdf/ 前缀键返回 application/pdf（ql-20260826-012 octet-stream 触发下载的教训）。

## D-preview-002@v1 : OnlyOffice/LO 高保真预览管线退役，代码休眠保留
状态：implemented（休眠）
锚点：`backend/app/modules/preview_office/router.py`
最近确认：3b1624fb
理由：OnlyOffice 引擎不支持中文 docGrid 行网格（sdk-all.js 源码零命中，公文目录漂移不可修）；LibreOffice 支持但页数偏差（46v42）用户不接受——Excel 走下载引导（ql-20260826-013）、Word 回本地渲染（ql-20260827-003）；env 开关一行可重启。
