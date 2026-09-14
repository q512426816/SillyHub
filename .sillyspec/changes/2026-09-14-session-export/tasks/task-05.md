---
id: task-05
title: 'frontend-export-download-channel'
title_zh: '前端下载通道——lib/daemon/session-export.ts（POST + Bearer + 401 刷新重试 + Content-Disposition 解析 + blob 下载）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-14 14:06:52
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - NEW:frontend/src/lib/daemon/session-export.ts
target_files:
  - NEW:frontend/src/lib/daemon/session-export.ts
goal: >
  新建会话导出认证下载通道 lib/daemon/session-export.ts：exportSessions(ids, tier)
  走裸 fetch POST /api/daemon/sessions/export（apiFetch 强制 JSON 解析，不适配 md/zip
  二进制流响应），Bearer + 401 单飞刷新重试 + RFC5987 文件名解析 + blob 触发浏览器
  下载（FR-01 / D-001@v1 前端认证下载链路，骨架照 lib/ppm/export.ts downloadExcel）。
implementation:
  - 导出 SessionExportTier = "chat" | "full"（本地类型起步，形状与后端 SessionExportRequest 一致；task-08 gen:types 后如切生成类型允许回触本文件）
  - exportSessions(sessionIds, tier)：new URL("/api/daemon/sessions/export", getApiBaseUrl())，POST + headers 携带 accept（octet-stream）与 Bearer useSession.getState().accessToken + body JSON.stringify({ session_ids, tier })
  - 401 → ensureFreshAccessToken()（@/lib/token-refresh 单飞，与 apiFetch 共享 inflight）重试一次；二次 401 → useSession.clear() + 跳 /login + throw（逐段对齐 downloadExcel :77-93）
  - resp.ok 为 false → throw Error（含 HTTP status）；不在 lib 内弹 toast，反馈归组件层
  - 复刻 parseFilenameFromContentDisposition（filename*=UTF-8'' 优先、filename=" 回退、解码失败 null）；blob + a[download] + click + revokeObjectURL，解析失败回退「会话导出_{对话|完整}.zip」
acceptance:
  - exportSessions 签名为 (sessionIds，tier) => Promise<void>（string[] + SessionExportTier），成功触发一次下载且文件名取自 Content-Disposition
  - 401 单飞刷新后仅重试一次；二次 401 清 session 跳 /login 并 throw，与 downloadExcel 行为一致
  - 非成功状态码抛含 status 的 Error，由调用方 message.error
verify:
  - cd frontend && pnpm typecheck
  - cd frontend && pnpm exec eslint src/lib/daemon/session-export.ts
constraints:
  - 不修改 lib/ppm/export.ts（模式照抄不搬动，防 ppm 回归）；不接入 @/lib/daemon/index 再导出（portal 直接 import 本文件）
  - 不写单测（导出入口交互用例归 task-07）；本卡不做任何 UI
provides:
  - 'exportSessions(sessionIds: string[], tier: SessionExportTier): Promise<void>——@/lib/daemon/session-export 命名导出；SessionExportTier = "chat" | "full"'
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
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
