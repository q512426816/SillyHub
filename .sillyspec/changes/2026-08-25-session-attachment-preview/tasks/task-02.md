---
id: task-02
title: 'add-use-object-url-hook'
title_zh: 'use-object-url hook（blob 拉取/loading/error/retry、竞态防护、卸载自动 revoke）+ 单测'
author: 'WhaleFall'
created_at: 2026-08-25 01:29:35
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-06]
decision_ids: []
provides: [{contract: useObjectUrl, fields: [blob, url, status, retry]}]
allowed_paths:
  - frontend/src/components/files/use-object-url.ts
  - frontend/src/components/files/__tests__/use-object-url.test.ts
goal: >
  新建 useObjectUrl hook 统一管理 blob 鉴权拉取与 objectURL 生命周期（loading、ok、error、retry、竞态防护、卸载与切换自动 revoke），供 FilePreviewModal 消费并杜绝 objectURL 泄漏（R-04）。
implementation:
  - 新建 frontend/src/components/files/use-object-url.ts，按 design §7 签名实现 useObjectUrl(fetcher)，返回 blob、url、status、retry 四字段，fetcher 为 null 时保持 idle 不发请求
  - 竞态与清理语义参照 file-image.tsx 既有模式（cancelled 标志丢弃 stale 结果、cleanup 中 revoke 已创建 URL），并扩展 error 态与 retry 重新拉取
  - 新建 __tests__/use-object-url.test.ts，用 vitest 与 testing-library 覆盖成功、失败后 retry、卸载 revoke、切换 fetcher 时旧 URL revoke 且 stale 结果丢弃
acceptance:
  - 拉取成功时 status 为 ok 且 blob 与 url 可用，fetcher 为 null 时为 idle
  - 卸载或切换 fetcher 时已创建的 objectURL 被 revoke，stale 异步结果被丢弃不落地 state
  - 拉取拒绝时 status 为 error，retry 可重新发起并恢复到 ok
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test -- use-object-url
constraints:
  - 只新增 hook 与其测试两个文件，不实现渲染器或 Modal（后续 Wave 任务）
  - 不引入轮询或缓存层（YAGNI），不修改 file-image.tsx 等既有组件
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
