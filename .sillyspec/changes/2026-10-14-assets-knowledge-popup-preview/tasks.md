---
author: flow-machine-draft
created_at: 2026-10-14T07:54:34.800Z
---
# 任务注册表（Tasks）— 2026-10-14-assets-knowledge-popup-preview

- [x] task-01: normalizeKnowledgeFileParam 迁至 lib/knowledge.ts（页面与页面测试 import 随迁，验证：knowledge-page.test.tsx vitest 全绿）
- [ ] task-02: change-assets-card.test.tsx 先行改写——FR/决策/触达三组断言从 href 深链改为点击弹窗 + 新增弹窗用例（定位/深链/失败文案）+ scrollIntoView/MarkdownText stub（验证：vitest 跑该文件新用例红）
- [ ] task-03: change-assets-card.tsx 实现——三组 Link 改 button + knowledgeTarget 状态 + KnowledgePreviewDialog/KnowledgePreviewBody（验证：task-02 用例转绿）
- [ ] task-04: 相关测试回归——change-assets-card.test.tsx 与 knowledge-page.test.tsx 两文件 vitest 全绿，FR-04 三既有弹窗用例不回退
