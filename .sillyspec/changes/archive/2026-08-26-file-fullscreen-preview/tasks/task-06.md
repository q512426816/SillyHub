---
id: task-06
title: 'Upgrade explorer preview to antd Image and fullscreen modal'
title_zh: 'explorer 接入全屏预览（antd Image + 全屏按钮 + 测试）'
author: 'qinyi'
created_at: 2026-08-26 20:13:49
priority: P0
depends_on: ['task-04']
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-002@v1, D-007@v1]
allowed_paths:
  - frontend/src/components/explorer/file-preview.tsx
  - frontend/src/components/explorer/__tests__/file-preview.test.tsx
expects_from:
  task-04:
    - contract: FilePreviewModalProps
      needs: [defaultFullscreen, target]
goal: >
  explorer 文件浏览器接入统一预览（design §5 Phase 4 / FR-05）：ImagePreview 原生 img 改 antd Image 可缩放（数据流不变），
  头部新增「全屏预览」按钮（含二进制分支元信息卡场景）以 defaultFullscreen 打开 FilePreviewModal，target 不携带 officeSource（D-007）。
implementation:
  - ImagePreview（现 L175-230）原生 img 改 antd Image；fetchDownload → objectURL 数据流与切换/卸载 revoke 生命周期不变，failed 提示与 Spin loading 态保留
  - 头部按钮区（下载按钮旁）新增「全屏预览」按钮 → 组件挂 FilePreviewModal state 以 defaultFullscreen 打开；target.fetch=fetchDownload(workspaceId, filePath)，meta.mime=null（下载端点 blob.type 多为 octet-stream，靠扩展名经 matchRenderer 分发，R-05）、meta.size=data.size，不携带 officeSource（D-007）
  - 二进制分支（BinaryMetaCard 场景）同样经头部按钮全屏预览（docx/xlsx/pdf 窄区看不全时全屏可看）
  - 更新 file-preview.test.tsx：antd Image 渲染断言（img 角色与 objectURL src 语义保留）、全屏按钮用例（点击打开弹窗且 defaultFullscreen）、target 无 officeSource 断言
acceptance:
  - 图片文件渲染 antd Image（src 仍为 fetchDownload 鉴权 objectURL），既有切换/卸载 revoke 用例不变全绿
  - 头部「全屏预览」按钮全类型可用（含二进制分支），点击以 defaultFullscreen 打开 FilePreviewModal，target 不携带 officeSource 且 meta.mime 为 null
  - 既有分发矩阵/源码切换/截断/下载用例零回归全绿
verify:
  - cd frontend && pnpm test -- --run src/components/explorer/__tests__/file-preview.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不动 git-log 相关组件（D-002 边界，git diff 对账无 git-log 文件）
  - 不改 fetchDownload 本体与 FilePreviewModal（task-04 交付物），仅按契约消费
  - 不改 NativePreviewFrame/BinaryMetaCard/MarkdownText/代码高亮既有行为（仅头部加按钮挂载点）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
