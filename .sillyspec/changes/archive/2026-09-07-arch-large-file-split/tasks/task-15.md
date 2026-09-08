---
id: task-15
title: 'Wave3 拆分 lib/daemon.ts → lib/daemon/ 14 文件目录（12 再导出模块 + sse-internals + index）'
title_zh: 'Wave3 拆分 lib/daemon.ts → lib/daemon/ 14 文件目录（12 再导出模块 + sse-internals + index）'
author: 'qinyi'
created_at: 2026-09-07 08:48:02
priority: P0
depends_on: ['task-13']
blocks: []
requirement_ids: [FR-02, FR-04]
decision_ids: [D-004@v1, D-005@v3]
allowed_paths:
  - frontend/src/lib/daemon.ts
  - frontend/src/lib/daemon/index.ts
  - frontend/src/lib/daemon/runtimes.ts
  - frontend/src/lib/daemon/machines.ts
  - frontend/src/lib/daemon/shared-agents.ts
  - frontend/src/lib/daemon/dir.ts
  - frontend/src/lib/daemon/session-sse.ts
  - frontend/src/lib/daemon/session-stream.ts
  - frontend/src/lib/daemon/group-shadow-stream.ts
  - frontend/src/lib/daemon/sse-internals.ts
  - frontend/src/lib/daemon/sessions.ts
  - frontend/src/lib/daemon/session-lists.ts
  - frontend/src/lib/daemon/session-queue.ts
  - frontend/src/lib/daemon/group-chat.ts
  - frontend/src/lib/daemon/team-missions.ts
goal: >
  按 design §5 Wave 3 表把 4111 行 lib/daemon.ts 拆为 lib/daemon/ 目录 14 文件（12 个再导出模块 + sse-internals 模块私有共享件 + index），index.ts 全量再导出，
  141 条 import 与 56 处 vi.mock 零改动。
implementation:
  - 按资源域把函数与类型搬入再导出模块（runtimes、machines、shared-agents、dir、session-sse、session-stream、group-shadow-stream、sessions、session-lists、session-queue、group-chat、team-missions）
  - zod schema 与 parse 事件解析、重连常量随用它们的 session-sse 模块走，streamSession 490 行单体原样搬移不顺手重构
  - 执行期细化（见下方落地记录）：session-sse 拆为 session-sse（类型/解析核心）/session-stream（streamSession+subscribe）/group-shadow-stream（群/影子流）+ sse-internals（跨文件私有重连工具，不进 index 以保 188 导出面零变化）；sessions 拆出 session-lists（列表/历史只读查询族）
  - index.ts 全量再导出，对照 task-13 产出的导出面基线逐项核对无遗漏
  - 删除原 lib/daemon.ts 后跑定向测试，全绿再收尾
acceptance:
  - index.ts 再导出面与拆前完全一致（AST 级机械比对：188 导出 missing/extra 双 NONE，197 条顶层语句逐字节一致），141 条 import 与 56 处 vi.mock 零改动通过
  - 新拆出文件均 ≤800 行（D-005@v3；细化后最大 session-stream.ts = 750 行）
  - 请求路径、事件解析与重连行为零变化
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__ src/app --silent
constraints:
  - 只搬移不改逻辑，不改任何函数签名与导出名
  - 不改任何既有测试文件与 vi.mock 形状
  - 不触碰 session-panel.tsx 与 D-001 排除的在途文件
---

## 落地记录（2026-09-08 执行期细化，供人工复核）

设计 Wave 3 表把 streamSession（490 行单体）+ streamGroupChat + streamShadowSession
+ subscribeAgentSessionsEvents + 全部事件/信封类型划入单一 session-sse.ts，天然约
1800 行——该表是三端拆分表中唯一没有「预计行数」列的表，grill 复审（D-005@v2/v3）
只核查了 backend 与 session-panel，未核查 lib/daemon，导致 10 文件结构与 D-005@v3
「新拆出文件 ≤800」正面冲突（首版落地实测 session-sse.ts=1815、sessions.ts=937）。

处置：询问用户未获回复，按 D-005@v2「细化而非放宽」先例执行（豁免先例仅限
R-03 闭包回归风险的 session-panel 两文件；顶层文件边界拆分是纯搬移零风险）：
session-sse → session-sse/session-stream/group-shadow-stream + sse-internals（模块
私有共享件，刻意不进 index 再导出，否则污染 188 导出面）；sessions → sessions +
session-lists。细化后 14 文件全部 ≤800（最大 750），导出面经 AST 级机械比对
188 missing/extra 双 NONE、197 条顶层语句与原文件逐字节一致（唯一字面差异：
sse-internals 三条私有声明补 export 关键字供同目录消费）。

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
