---
id: task-08
title: 'Add cursor to frontend caps mirror, session engine whitelists and picker tests'
title_zh: 'frontend 镜像与白名单（provider-caps.ts + pre-session-picker.tsx + runtime-session-helpers.tsx）'
author: 'qinyi'
created_at: 2026-09-08 13:00:34
priority: P0
depends_on: ['task-05']
blocks: []
requirement_ids: [FR-01, FR-04]
decision_ids: [D-004@v1, D-002@v1]
allowed_paths:
  - frontend/src/lib/provider-caps.ts
  - frontend/src/components/sessions/pre-session-picker.tsx
  - frontend/src/components/daemon/runtime-session-helpers.tsx
  - frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx
target_files: []  # 可选：本 task 计划改动的文件（对账用精确路径清单，格式见下方注释；不填保留 []）
goal: >
  frontend 侧 cursor 镜像与白名单：provider-caps.ts 加 cursor 八键、门户与
  对话框两处引擎白名单加 cursor、仿 PI 先例补 picker 引擎可选用例（FR-01/FR-04）。
implementation:
  - provider-caps.ts：PROVIDER_CAPS 加 cursor 对象，八键与 daemon 单源逐键一致——resume/model_select=true，mcp/multimodal/thinking/subagent/permission_dialog/edit_patch=false；条目注释照 pi 段格式锚定 daemon 取值依据
  - pre-session-picker.tsx L47：SESSION_SUPPORTED_PROVIDERS 加 cursor；runtime-session-helpers.tsx L67：SUPPORTED_SESSION_PROVIDERS 加 cursor（门户主路径 + 对话框路径两处硬编码白名单）
  - pre-session-picker.test.tsx 仿 PI 第 6/7 节用例结构补 cursor 同款用例（计划审查建议 2，纳入本卡）：门户路径 cursor 机 fixture（在线 cursor + 白名单外 copilot + 离线 cursor 三条件一次覆盖）、cursor 可选/非默认高亮/仅 cursor 在线独立入口；对话框路径 SessionPanel 桩探针断言 data-providers 含 cursor；caps 门控查表前置事实（如 model_select=true、mcp=false）
acceptance:
  - getProviderCaps(cursor) 八键与 daemon 逐键一致；未知 provider 仍全 false 不抛错
  - 门户与对话框两路径均列出在线 Cursor 引擎（复用 PROVIDER_META.cursor，label=Cursor）；白名单外引擎仍滤除
  - pre-session-picker.test.tsx 既有用例零回归且新增 cursor 用例全绿；frontend typecheck 零错
verify:
  - pnpm -C frontend run typecheck
  - cd frontend && pnpm exec vitest run src/components/sessions/__tests__/pre-session-picker.test.tsx
constraints:
  - 不动 PROVIDER_META（runtimes.ts L179 已有 cursor）与 MIN_VERSIONS（PROVIDER_SPECS.cursor 无 minVersion）；normalizeProvider 零改动（adapter id 与 detector key 同名直通）
  - 不做任何 UI 布局改动（白名单+数据表条目级，R-06 跳过原型档）；空态引导文案等既有 UI 字符串不动
  - 八键取值只随 task-05 daemon 单源同步（Wave 0 验证 B 不通过时 resume 翻 false 同步翻）
  - InteractiveProviderLiteral 为请求侧校验，预期无需 pnpm gen:types（已核 api-types.ts 无该 Literal 引用）；若 execute 期发现引用则同 change 跑 pnpm gen:types 并提交 api-types.ts + backend/openapi.json 双产物（CLAUDE.md 规则 21）
expects_from:
  task-05:
    - contract: ProviderCapsCursorValues
      needs: [resume, mcp, multimodal, thinking, subagent, permission_dialog, edit_patch, model_select]
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
