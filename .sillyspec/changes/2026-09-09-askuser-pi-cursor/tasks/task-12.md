---
id: task-12
title: 'caps-dialog-key-three-ends-string-enum'
title_zh: 'caps 三端 dialog 键 + 对齐测试解析器扩展 string 枚举 + pi permission_dialog 翻真'
author: 'qinyi'
created_at: 2026-09-09 23:09:59
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-06]
decision_ids: [D-005@v1]
provides: 'caps dialog 能力位三端镜像——dialog string 枚举（claude/codex/pi=native、cursor=marker）+ pi permission_dialog=true + 未知 provider 回退 none → task-08 按 caps=marker 分派 prompt 注入、前端按 dialog 键分派渲染消费'
allowed_paths:
  - sillyhub-daemon/src/interactive/providers.ts
  - backend/app/modules/agent/provider_caps.py
  - frontend/src/lib/provider-caps.ts
  - backend/app/modules/agent/tests/test_provider_caps_alignment.py
  - frontend/src/components/daemon/__tests__/session-panel-provider-caps.test.tsx
target_files:
  - sillyhub-daemon/src/interactive/providers.ts
  - backend/app/modules/agent/provider_caps.py
  - frontend/src/lib/provider-caps.ts
  - backend/app/modules/agent/tests/test_provider_caps_alignment.py
  - frontend/src/components/daemon/__tests__/session-panel-provider-caps.test.tsx
goal: >
  PROVIDER_CAPS 三端新增 dialog string 枚举键（native/marker/none，打破「8 键全 boolean」旧约定），pi permission_dialog 随本变更 Wave A 桥接翻 true，对齐守护测试解析器 _TS_BOOL_PAIR_RE（L57）同步扩展 string 值支持并断言 dialog 键，未知 provider 三端回退 none（R-09）。
implementation:
  - daemon 单源 providers.ts——ProviderCaps 接口加 dialog 字段（native/marker/none 字面量联合），四 provider 补值（claude/codex/pi=native、cursor=marker），getProviderCaps 未知回退对象补 dialog 取 none，文件头「8 键全 boolean」注释改 9 键含 string 枚举、pi 段 permission_dialog 取值依据锚点更新（false→true 随 Wave A 桥接）
  - backend provider_caps.py 与 frontend provider-caps.ts 手工镜像同步——表值、get_provider_caps/getProviderCaps 未知回退 dialog 取 none、文件头注释，改值顺序先 daemon 单源再两端镜像
  - test_provider_caps_alignment.py——_TS_BOOL_PAIR_RE 扩展匹配带引号 string 枚举值（true|false 加 'native'/'marker'/'none'），解析表值类型放宽 bool 或 str，EXPECTED_CAPS_KEYS 增 dialog（键数断言 8→9），补 dialog 键三端一致与未知回退 none 断言
  - session-panel-provider-caps.test.tsx——ProviderCaps 表值前置事实断言补 dialog 键两态对照（pi=native / cursor=marker）
acceptance:
  - 三端 dialog 键取值一致——claude/codex/pi=native、cursor=marker，对齐守护测试四项全绿
  - 三端 pi permission_dialog=true；未知 provider 查询返回 dialog 取 none 且不抛错
  - 对齐测试解析器不再静默丢弃 string 枚举键（缺 dialog 键或三端值漂移即测试失败）
verify:
  - cd backend && python -m pytest app/modules/agent/tests/test_provider_caps_alignment.py -q
  - cd sillyhub-daemon && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec tsc --noEmit && pnpm exec vitest run src/components/daemon/__tests__/session-panel-provider-caps.test.tsx
constraints:
  - 只加 dialog 键与翻 pi.permission_dialog，不动其余 7 键取值
  - cursor dialog 初值 marker——若 task-05 spike no-go，随 task-08 取消把三端 cursor 的 dialog 同步改 none（一行镜像联动）
  - 对齐测试保持源文件读取式守护（不复制值断言），解析器扩展与 caps 键同任务交付（R-09 应对）
related_tests:
  - frontend/src/components/daemon/__tests__/session-panel-provider-caps.test.tsx
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
