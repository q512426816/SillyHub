# 符号影响面报告

> tasks.md 内容指纹（生成时）: 3f4c9b7a734bda0e——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。
> 逐行把 `<!--TODO-->` 替换为真实结论：涉及签名级变更（构造函数参数/接口/DTO/方法签名增删改）
> 写变更类型 + 受影响调用点 + 是否在任务范围内；无签名级变更也要显式写「无签名级变更」。
> **gate 拒绝仍含 <!--TODO--> 的行**——骨架不能直接过门。

- task-01: 无签名级变更——新建 frontend/src/components/knowledge/card-markdown.tsx（新增导出 CardMarkdown / CardMarkdownProps），属新增符号无既有调用点；被 task-02 作为新消费者 import（契约已在 TaskCard provides/expects_from 对齐：CardMarkdownProps[content, className]）。
- task-02: 无对外签名级变更——frontend/src/components/knowledge/entry-card-list.tsx 的 EntryCardList 对外 props 协议不变（两页调用方 frontend/src/app/(dashboard)/workspaces/[id]/scan-docs/page.tsx 与 knowledge/page.tsx 零改动，rg "EntryCardList" 仅此两处消费）；stripFrontmatter 函数签名保持不动（新增独立 parseFrontmatterMeta 辅助函数，属新增内部符号无既有调用点）；slugifyAnchor / parseEntrySections / parseDecisionEntries / parseIndexRoutes / detectEntryCardForm 等纯函数导出零改动（既有测试与双端契约依赖）。改造面全部在组件内部 JSX 渲染层，调用点均在 task-02 allowed_paths 范围内。
