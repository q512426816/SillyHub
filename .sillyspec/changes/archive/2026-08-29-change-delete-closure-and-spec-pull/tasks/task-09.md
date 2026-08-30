---
id: task-09
title: '前端「下载文档包」按钮（blob 范式 + 快照文案）'
title_zh: '前端「下载文档包」按钮（blob 范式 + 快照文案）'
author: 'qinyi'
created_at: 2026-08-29 12:57:58
priority: P1
depends_on: ['task-08']
blocks: []
requirement_ids: [FR-06, FR-08]
decision_ids: []
allowed_paths:
  - frontend/src/components/workspace-config-card.tsx
  - frontend/src/components/workspace-config-card.test.tsx
  - frontend/src/lib/spec-workspaces.ts
expects_from:
  - 'task-08：bundle 端点响应头 X-Spec-Version（版本号进 toast）与 Content-Disposition（下载文件名）'
goal: >
  浏览器用户获得下载服务端 spec 文档包的入口：workspace 配置卡「同步到服务器」旁成对加
  「下载文档包」按钮，鉴权 blob 范式直连既有 bundle 端点，toast 一次性展示快照版本号并
  明示快照语义（design §7.2/§7.3/§7.4，FR-06/FR-08）。
implementation:
  - 'lib/spec-workspaces.ts 新增 downloadSpecBundle(workspaceId)：裸 fetch GET /api/workspaces/${workspaceId}/spec-workspace/bundle，带 Authorization Bearer，401 时单飞刷新 token 重试一次（逐行照 explorer.ts fetchDownload :68-94 / file/api.ts fetchFileBlob :176-199 范式）；非 2xx 抛 ApiError；返回 Blob + 从响应 Content-Disposition 解析文件名 + X-Spec-Version 头值'
  - 'blob 转 objectURL → <a download> click → revoke（照 explorer.ts downloadExplorerFile :97-116；对齐知识库 D-009 blob 生命周期托管——finally revoke 防泄漏）；文件名缺省回退 spec-bundle-${workspaceId}.tar'
  - 'workspace-config-card.tsx：headActions「同步到服务器」按钮（:451-469）旁成对加「下载文档包」按钮（Tooltip + Button，独立 downloading 状态）；不复用 syncManual/syncStatus 状态机（:231/:456）——下载是即时 HTTP 拉流，不建 DaemonChangeWrite 任务、不轮询'
  - '反馈：下载成功 toast「文档包已下载（快照版本 vN）」——版本号读 X-Spec-Version 头，仅此处一次性展示（R-07 不推翻）；失败 toast 错误信息不静默'
  - '快照语义文案（按钮 Tooltip）：下载为当前时刻快照、非实时同步；daemon 在任务开始/会话开始按版本变化自动取新（design §7.4 时机口径）'
  - 'workspace-config-card.test.tsx 扩展：mock fetch（返回 blob + X-Spec-Version/Content-Disposition 头）断言按钮触发下载链路（URL.createObjectURL/click mock）、文件名取 Content-Disposition、非 2xx 错误反馈、快照文案渲染'
acceptance:
  - 'specWs 就绪时「下载文档包」按钮与「同步到服务器」成对出现（推送/拉取语义成对）；点击触发浏览器 tar 下载'
  - '文件名取响应 Content-Disposition，缺失回退 spec-bundle-{workspaceId}.tar；objectURL 下载后 revoke（无泄漏）'
  - '请求带 Authorization Bearer；401 刷新后重试一次，仍失败给出错误反馈不静默'
  - '成功 toast 含 X-Spec-Version 版本号'
  - '按钮 Tooltip/文案明示快照语义（非实时同步、daemon 任务/会话开始自动取新）'
  - '配置卡信息区不新增 spec_version 常驻展示（R-07 维持）；不新增 Next.js route handler'
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec vitest run src/components/workspace-config-card.test.tsx
constraints:
  - '不新增 Next.js route handler / 不改 rewrite 代理配置（既有 /api 代理 + proxyTimeout 5 分钟已覆盖，design §7.2）'
  - '不推翻 R-07：配置卡不常态展示 spec_version，版本号仅下载 toast 一次性展示'
  - '不动 syncManual/syncStatus 状态机与「同步到服务器」既有行为（:231/:456）；下载不建 DaemonChangeWrite 任务、不轮询 pending'
  - '不动 daemon pull/push 时机（人拉=主动快照语义，无自动同步/无会话中刷新，design §7.4）'
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
