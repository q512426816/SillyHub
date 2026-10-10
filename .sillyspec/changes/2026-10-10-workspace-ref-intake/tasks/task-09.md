---
id: task-09
title: 'render-history-ws-ref-tags'
title_zh: '历史渲染（InlineAttRefText 换 parseInlineRefs 三类标签 + fetchDownload 打开预览）'
author: 'WhaleFall'
generated_by: sillyspec-taskcard
created_at: 2026-10-10 13:48:40
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-07]
decision_ids: [D-004@v1]
allowed_paths:
  - frontend/src/components/daemon/attachment-ref-tag.tsx
  - frontend/src/components/daemon/turn-segment-views.tsx
  - frontend/src/components/daemon/__tests__/attachment-ref-tag.test.tsx
target_files:
  - frontend/src/components/daemon/attachment-ref-tag.tsx
  - frontend/src/components/daemon/__tests__/attachment-ref-tag.test.tsx
# turn-segment-views.tsx 声明移除：D-014 执行偏差——渲染内聚至 InlineAttRefTextWithPreview，
# 既有消费点自动获得三类标签，该文件零改动（verify target_files 对账 ②类修复，与 D-014 一致）。
expects_from:
  task-01:
    - contract: parseInlineRefs
      needs: [text, InlineRefPart]
related_tests:
  - frontend/src/components/daemon/__tests__/attachment-ref-tag.test.tsx
goal: >
  历史正文三类工作区标记与附件引用统一解析为可点击标签（lucide 图标+名称+行号），
  点击经 fetchDownload 打开 FilePreviewModal 在线预览；无标记正文渲染逐字不变（FR-07）。
implementation:
  - attachment-ref-tag.tsx:41 InlineAttRefText 内部换 parseInlineRefs 拆段（task-01 侧保留 parseInlineAttRefs 兼容薄封装供既有消费），text 段原样、ref 段按 kind 渲染
  - 三类工作区标记标签：lucide 图标（FileText/Folder/Braces）+名称+行号段（code 引用附 L起-L止），tone 沿用 brand/onPrimary 双色口径；新增 onOpenWsRef 回调 prop（缺省渲染为不可点击，与附件 onOpenRef 同语义）
  - InlineAttRefTextWithPreview（attachment-ref-tag.tsx:79）按 ref.kind 分流：附件走 fetchAttachmentBlob+officeSource 既有链路；工作区三类 target.fetch 用 fetchDownload(workspaceId, path)（frontend/src/lib/explorer.ts:68 签名）、meta.mime 传 null 靠扩展名分发、不加 officeSource（explorer 文件无平台 id 恒本地渲染，同 file-preview.tsx 全屏预览先例）
  - turn-segment-views.tsx 消费点（1099/1113/1123 三处 UserMsgSegmentView）经 InlineAttRefTextWithPreview 自动获得三类标签与预览，如需宿主级 onOpenWsRef 透传则在此接线
  - 用例：三类标记解析渲染标签（图标+行号）/点击开预览（fetch=fetchDownload 断言）/既有附件解析断言扩展三类标记无回归/解析失败片段原样文本/根目录引用 [目录引用:wid|] 用例
acceptance:
  - attachment-ref-tag.test.tsx 全绿，三类标记标签与 fetchDownload 预览用例通过
  - 本变更前历史消息（无三类标记）渲染逐字不变
verify:
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__/attachment-ref-tag.test.tsx
constraints:
  - parseInlineRefs 正则边界（审查 requiredEvidence X-5）：显式容忍 path 为空的 [目录引用:wid|] 空尾段；路径含竖线或右方括号字符时按解析失败降级为纯文本（与孤儿降级同口径），测试补根目录引用用例
  - 历史解析失败片段原样显示；本变更前历史消息渲染逐字不变；纯渲染层零后端改动（引用随正文透传）
  - 品牌色一律 brand-* 语义阶（onPrimary 白字胶囊沿用）；React.memo 段级缓存防长文重析；文案中文
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     target_files 格式（可选，对账用精确文件级意图声明，与 allowed_paths 语义不同）：
                    精确文件路径（仓根相对、正斜杠），当前不存在、将由本 task 新建的文件加
                    NEW: 前缀（如 NEW:src/foo.js）；禁 glob（src/**）、禁目录前缀（src/dir/）、
                    禁绝对路径；无明确文件级意图时保留 [] 占位行不动。
     implementation/acceptance 里的源码位置同样写仓根相对全路径+行号（src/foo.js:123）——
                    裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词
                    窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
