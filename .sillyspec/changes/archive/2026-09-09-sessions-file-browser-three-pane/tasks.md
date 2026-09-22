---
author: qinyi
created_at: 2026-09-09T00:56:00
---

# 任务清单（Tasks）— 会话页三分屏：会话 ⇄ 工作区文件浏览器

> 任务与 plan.md Wave 对应（Wave 1：task-01/02 并行 → Wave 2：task-03 → Wave 3：task-04）。

- [x] task-01: 新建 frontend/src/components/sessions/portal-file-panels.tsx（PortalFileTreePanel：← 返回会话头部 + FileExplorer 直通；PortalFilePreviewPanel：✕ 关闭头部 + FilePreview 直通；导出 SESSIONS_LEFT_PANEL_WIDTH_LS_KEY 默认 320/240–560 与 SESSIONS_FILE_PREVIEW_WIDTH_LS_KEY 默认 480/320–860）+ NEW:__tests__/portal-file-panels.test.tsx（mock @/lib/explorer：两组件渲染、onBack/onClose/onSelectFile 直通、常量断言）
- [x] task-02: session-list-panel.tsx 加 headerExtra?: ReactNode 可选 prop（头部「共 N 个」右侧 shrink-0 插槽；未传不渲染，其它消费点零变化）
- [x] task-03: sessions-portal.tsx 接线——leftMode/filesModeWorkspaceId(进模式快照)/filePreview({workspaceId,path})/selectedWorkspaceId（六写入点：onSelect/onSelectGroup/handleGroupCreated/深链 getAgentSession/enterPreSession/清选中）状态；fileWorkspaceId=scope 恒 scope.workspaceId 否则 selectedWorkspaceId，null 置灰+title；grid→flex 三栏 + PanelResizer 两把；headerExtra 注入「📁」（data-testid=sessions-left-files-toggle）；点文件 setFilePreview、✕ 清空（data-testid=sessions-file-preview-close）；sessions-portal.test.tsx 新增 describe（mock @/components/explorer/*：切换/返回、置灰+title、选中会话与群可切、深链恢复翻转、开列/关列、切回会话预览保留）
- [x] task-04: 回归与验收——pnpm exec tsc --noEmit（我方 0 新增）、eslint 4 改动文件 0 告警、vitest sessions-portal+portal-file-panels+session-list-panel+explorer 页零回归，外加 SessionListPanel 直接消费方测试（floating-session-host / agent-log-card，plan 审查 gap 补）、浏览器实拍对照 prototype-sessions-file-browser.html 场景①-④（含切回会话预览保留）、frontend.changelog.md 补条目
- [x] ql-20260909-007-836e 三分屏右列（文件预览）拖宽方向反了——PanelResizer 增 side 属性（left=默认右移增宽，right=镜像：拖右收窄/拖左增宽+方向键对调），预览列把手传 side=right
