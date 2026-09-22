# 符号影响面报告

> tasks.md 内容指纹（生成时）: c4ccf702ffdfb8a9——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。

- task-01: 新增导出符号（PortalFileTreePanel/PortalFilePreviewPanel 组件 + PortalFileTreePanelProps/PortalFilePreviewPanelProps 接口 + 8 个宽度常量），全部为全新文件内的新符号，无既有调用点受影响；不修改任何既有签名。
- task-02: SessionListPanelProps 新增可选属性 headerExtra?: ReactNode——可选 prop 追加，TypeScript 结构化类型下所有既有调用点（不传该 prop）零破坏；WorkspaceTreeList 内部参数表同步解构 + props 展开透传链自动携带，无签名级破坏。
- task-03: sessions-portal.tsx 内部新增 4 个 useState 与派生 useMemo（leftMode/filesModeWorkspaceId/filePreview/selectedWorkspaceId/fileWorkspaceId）——组件内部状态，非导出签名；对 SessionListPanel 新传可选 headerExtra（task-02 契约）；SessionsPortalProps 对外签名不变。
- task-04: 无签名级变更（只读验收：tsc/eslint/vitest/浏览器实拍/平台路径模块文档）。
