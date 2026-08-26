# 符号影响面报告

> tasks.md 内容指纹（生成时）: f10daa38b2857d88——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 方法签名级（新增）——ChangeService 新增 `read_file_raw`，私有重构提取 `_resolve_change_file`（read_file 内部路径解析/穿越守卫挪出，签名与返回值不变）。`read_file` 既有调用点仅 router.get_change_file_content（backend/app/modules/change/router.py，task-01 allowed_paths 内）；新方法无既有调用点。均在任务范围内。
- task-02: 纯新增符号——lib/change-files.ts 新增 `fetchChangeFileRaw(workspaceId, changeId, path): Promise<Blob>`，无既有调用点（消费方 task-05 在 W3 接入）；api-types.ts/openapi.json 为生成产物非手写签名。无签名级变更（对外）。
- task-03: 接口定义变更——PreviewerProps 增可选字段 `fill?: boolean`；RendererKey 联合类型增 `"html"`。消费方：六渲染器组件（task-03 allowed_paths 内）+ file-preview-modal.tsx 的 RENDERER_MAP/渲染器调用（task-04 allowed_paths 内，task-04 需同步给 RENDERER_MAP 补 html: HtmlPreviewer 条目并透传 fill）。可选字段/类型增宽，既有传参零破坏；调用点全部在任务范围内。
- task-04: 接口定义变更——FilePreviewModalProps 增可选字段 `defaultFullscreen?: boolean`。既有消费方四处：components/file-viewer.tsx、components/daemon/file-message-card.tsx、components/daemon/attachment-chips.tsx、components/changes/detail/run-file-artifacts.tsx（经 FileMessageCard 间接），均不传新 prop——可选字段缺省 false，零改动零破坏，不在任何 task allowed_paths 属预期（不改原因：新参数可选，缺省行为与现状一致）。RENDERER_MAP 补 html 条目在 file-preview-modal.tsx（task-04 范围内）。
- task-05: 无签名级变更——change-file-tree.tsx 导出 Props（workspaceId/changeId/lastSyncedAt/daemonOnline）不变，纯内部 UI 状态与渲染分支改造；消费方 changes/[cid]/page.tsx 与 changes/detail/change-files-card.tsx 零影响。
- task-06: 无签名级变更——explorer/file-preview.tsx 导出 Props 不变；ImagePreview 为模块内私有组件（非导出符号），原生 img 改 antd Image 不影响外部。
