# 决策知识 — frontend

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-001@v1 : plan 模式采用强确认交互
状态：implemented
锚点：`frontend/src/components/daemon/plan-approval-card.tsx`
最近确认：04bb45fe
理由：强确认，类似 askuser 弹窗。

## D-005@v1 : 预览弹窗用 antd Modal
状态：implemented
锚点：`frontend/src/components/files/file-preview-modal.tsx`
最近确认：3b1624fb
理由：FRONTEND_PAGE_STYLE 约定弹窗不用 Drawer；标题栏含元信息+下载，body 按注册表分发（D-004）。

## D-007@v1 : PDF 渲染用 pdf.js 画布（iframe+原生查看器不可依赖）
状态：implemented
锚点：`frontend/src/components/files/previewers/pdf-previewer.tsx`
最近确认：3b1624fb
理由：ql-20260827-001——Chrome 原生查看器对内嵌 blob PDF 报"未能加载"、嵌入式 Chromium 无 PDF 组件；pdf.js 逐页画布零插件依赖，worker 静态放 public/，>50 页截断提示下载。

## D-008@v1 : Excel 不做在线渲染（xls/xlsx → fallback 下载引导）
状态：implemented
锚点：`frontend/src/components/files/preview-registry.ts`
最近确认：3b1624fb
理由：ql-20260826-013 用户决策——SheetJS 表格还原度差、OnlyOffice/LibreOffice 管线先后退役（字体/网格排版/页数偏差），Excel 预览弹窗直接给下载引导。

## D-009@v1 : md 附件渲染器统一 useObjectUrl 托管 blob 生命周期
状态：implemented
锚点：`frontend/src/components/files/use-object-url.ts`
最近确认：3b1624fb
理由：鉴权拉 blob → createObjectURL → 卸载/切换自动 revoke 三件套统一 hook，消灭三入口手写拉取泄漏风险（R-04）。

## D-010@v1 : OnlyOffice 渲染器免 npm 包（动态 script + DocsAPI）
状态：implemented（休眠）
锚点：`frontend/src/components/files/previewers/onlyoffice-previewer.tsx`
最近确认：3b1624fb
理由：不引 @onlyoffice/documenteditor-react——DocsAPI 全局 + 自写最小类型；api.js 单飞加载；DS 9 替换式挂载（holder 被 iframe 替换）→ 兜底超时以父容器出现 iframe/holder 消失为成功信号（ql-20260826-002 误降级教训）。

## D-007@v1 : 进行中可见性三层方案（投影+徽标 / CLI 上报增强 / 心跳不做）
状态：implemented
变更：2026-08-29-change-delete-closure-and-spec-pull
锚点：`frontend/src/components/changes/change-activity-badge.tsx`
最近确认：0ec935c9
理由：Layer 1 ChangeSummary.last_pushed_at 投影（progress 行既有列，零 migration）+ 活动徽标三态（active≤30min「进行中」/active>30min「停滞」/waiting|null 空闲）；ACTIVITY_STALE_MS=30min 阈值与 ISO_LIKE_RE 正则白名单防御解析（畸形串回退原文不炸组件）均为前端展示层关注点不进后端 DTO，复用既有 30s 轮询零新增请求；Layer 2 CLI X3 步骤开始/X4 任务边界补推为跨仓渐进增强（后端零改动）；Layer 3 心跳 Non-Goal 协议预留。徽标文案只陈述事实（「最后信号 x 分钟前」）不断言挂死（R-12）；current_step_status 不区分 pending/in-progress 是 Layer 1 启发式固有边界（态 1/态 2 仅由阈值区分），强判定需心跳留将来。
