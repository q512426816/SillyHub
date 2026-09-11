---
id: task-04
title: 'caps 生成脚本 gen-provider-caps.mjs（零依赖解析+响亮失败+幂等）+ frontend gen:types 挂钩 + 三端产物落地 + 对齐测试 9→10 键'
title_zh: 'caps 生成脚本 gen-provider-caps.mjs（零依赖解析+响亮失败+幂等）+ frontend gen:types 挂钩 + 三端产物落地 + 对齐测试 9→10 键'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-12 00:00:07
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-002@v1]
allowed_paths:
  - NEW:sillyhub-daemon/scripts/gen-provider-caps.mjs
  - frontend/package.json
  - backend/app/modules/agent/provider_caps.py
  - backend/app/modules/agent/tests/test_provider_caps_alignment.py
target_files: []  # 可选：本 task 计划改动的文件（对账用精确路径清单，格式见下方注释；不填保留 []）
goal: >
  新建 caps 单源生成脚本 gen-provider-caps.mjs（零依赖静态解析 + 响亮失败守卫 + 幂等），
  从 daemon providers.ts 的 PROVIDER_CAPS 产出 frontend ts 与 backend py 双 @generated 产物并挂进
  frontend gen:types 链尾，对齐测试键集合 9→10——三端手抄镜像退役（FR-04 前半 / D-002@v1）。
implementation:
  - 新建 sillyhub-daemon/scripts/gen-provider-caps.mjs（先例为同目录 gen-api-types.mjs / gen-build-id.mjs）——零依赖静态解析 sillyhub-daemon/src/interactive/providers.ts 的 PROVIDER_CAPS 字面量（括号匹配提取表体 + 键值对还原，同款先例为 backend 对齐测试 _extract_ts_const_object_body 花括号配平 :74-89 与 _TS_BOOL_PAIR_RE 键值正则 :63-65）
  - 响亮失败守卫——解析必须找齐四引擎键（claude/codex/cursor/pi）且每键恰 10 个 caps 键（含 provider_switch），任一不符即 stderr 打印差异并 exit 1 不写任何产物（R-02）
  - 生成 backend 产物——backend/app/modules/agent/provider_caps.py 改为生成物（文件头 @generated 勿手改，源=daemon providers.ts，重跑 gen-provider-caps；同值 dict 固定键序 + _CAPS_KEYS + get_provider_caps 默认拒绝 fallback，provider_switch 未知回退 False）
  - 生成 frontend 产物——ts 模板一步到位终形经脚本写盘落地 frontend/src/lib/provider-caps.ts（@generated 头 + ProviderCaps 接口含 provider_switch 第 10 键 + PROVIDER_CAPS + getProviderCaps 未知回退默认拒绝 + PROVIDER_SWITCH_ENGINES 从 PROVIDER_CAPS 按 provider_switch 为 true 派生导出），不留缺导出中间态破坏前端编译；该文件仅经脚本写盘产出、本卡不手改，消费语义锁定归 task-05
  - frontend/package.json:14 gen:types 链尾追加 && node ../sillyhub-daemon/scripts/gen-provider-caps.mjs（追加式短路不破坏原命令；gen:types:check:15 的 diff 守护仍只查 api-types.ts——caps 产物漂移由对齐测试守护）
  - 对齐测试 test_provider_caps_alignment.py——EXPECTED_CAPS_KEYS（:38-50）加 provider_switch；两处 len 断言 9→10（:145 len(EXPECTED_CAPS_KEYS)、:192 len(caps)）；同步 docstring 与 test_unknown_provider_returns_default_deny_with_9_keys 函数名中的「9 键/8 个 boolean」表述；解析器核对结论——provider_switch 为裸 true/false 布尔，_TS_BOOL_PAIR_RE 现形态已覆盖（string 枚举三值支持是 dialog 键既有能力），无需扩展解析器
  - 首跑脚本落地双产物并验证幂等（连跑两遍产物 diff 为空——固定键序与格式）
acceptance:
  - 脚本连跑两遍，frontend/src/lib/provider-caps.ts 与 backend/app/modules/agent/provider_caps.py 双产物 diff 为空（幂等、逐字节稳定）
  - backend 对齐测试绿（uv run pytest 该文件，10 键三端一致，provider_switch 三端同值）
  - frontend gen:types 全流程回归通过（OpenAPI 产物不受影响，链尾 caps 生成正常执行）
  - 守卫自证——临时删 providers.ts 一引擎键或一 caps 键后脚本 exit 1 且产物零变更（本地验证后还原，不提交）
verify:
  - node sillyhub-daemon/scripts/gen-provider-caps.mjs（连跑两遍）+ git diff --stat 双产物为空
  - cd backend && uv run pytest app/modules/agent/tests/test_provider_caps_alignment.py
  - cd frontend && pnpm gen:types
constraints:
  - 零新依赖——不加任何 npm/pip 包（daemon 无 tsx 且 dist 依赖构建，采源解析路线，design Wave 3 步 1 / Grill P2）
  - caps 取值零漂移——首落地 diff 仅允许 @generated 头、镜像注释统一、provider_switch 新键、白名单派生段（出现取值差异即派生逻辑错，回退修脚本；design 兼容策略按值不按注释文本）
  - frontend/src/lib/provider-caps.ts 仅经脚本写盘产出、不手改（终形核验与消费语义锁定归 task-05）
  - 不改 gen:types:check 的 diff 守护范围；不动 backend inject_gates 422 语义与 agent_kind 词表（非目标）
  - Windows/Linux/macOS 兼容——路径经 node:path join、无 shell 特性依赖
expects_from:
  - task-01: caps 第 10 键 provider_switch 已入 daemon 单源 PROVIDER_CAPS（providers.ts）
provides:
  - contract: gen-provider-caps.mjs 生成脚本
    fields: [node 直跑执行方式, 双产物路径, 幂等重跑稳定]
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
