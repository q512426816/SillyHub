---
id: task-02
title: implement-pi-dir-writer-for-custom-endpoints
title_zh: 'pi-settings.ts——per-session PI_CODING_AGENT_DIR 三文件写盘器'
author: 'qinyi'
created_at: 2026-09-10 23:27:51
priority: P0
depends_on: ['task-01']
blocks: ['task-03']
requirement_ids: [FR-02]
decision_ids: [D-004, D-005, D-008, D-011]
allowed_paths:
  - sillyhub-daemon/src/pi-settings.ts
  - sillyhub-daemon/tests/pi-settings.test.ts
target_files:
  - NEW:sillyhub-daemon/src/pi-settings.ts
  - NEW:sillyhub-daemon/tests/pi-settings.test.ts
provides:
  - contract: pi-settings.writePiDir
    fields: [writePiDir, PiDirWriteInput]
expects_from:
  task-01:
    - contract: settings-writer-failure-convention
      needs: [failure_convention]
goal: >
  新增 pi-settings.ts 写盘器，仅自定义端点形态（provider.base_url 非空）时向 per-session PI_CODING_AGENT_DIR 写三文件（auth.json/models.json/settings.json，golden=spike b1 系证据），补齐并行变更 punt 的 pi 自定义端点注入缺口（FR-02 / D-004 / D-008 分层 / D-011）。
implementation:
  - 新建 sillyhub-daemon/src/pi-settings.ts，导出 PiDirWriteInput（piDir/provider 两字段）与 writePiDir 返回 Promise<void>（Plan 约束 1——三文件先读后写与 writeCodexHome 对称）；门控=provider.base_url 非空才写，官方端点形态三文件全不写（env 层负责，D-008 分层），pi × openai_chat 因 base_url 缺省天然不触发（禁配校验归 task-05/06）；写 IO 失败记 error 后抛出交调用方处置（调用方跳过 PI_CODING_AGENT_DIR env 注入仍 spawn，design Plan 约束 3 双覆盖），不静默吞错
  - auth.json 按 pi 0.81.1 官方形状写 sillyhub 条目（type=api_key、key=provider.api_key，golden=spike b1b-auth.json；b1 的 apiKey 形状实测被拒不采用），JSON 先读后写保留未知兄弟键
  - models.json 写 providers.sillyhub（api 固定值 openai-completions——golden=b1-models.json、baseUrl=provider.base_url、models 数组含 id=裸 model id 条目）；settings.json 写 defaultProvider=sillyhub 与 defaultModel=裸 model id（default_fallback_model 缺省回退 model）；两文件 preserve unknown 顶层与兄弟键
  - 新建 sillyhub-daemon/tests/pi-settings.test.ts 覆盖三文件 golden 形状、preserve unknown、base_url 门控正反例、写失败抛出、env 层共存（auth.json 值压制 env 同键值，spike Pi-3 实证，R-04）
acceptance:
  - base_url 非空时写出的三文件与 spike b1 系 golden 逐字段一致（auth 条目官方形状 type=api_key、api=openai-completions、defaultProvider=sillyhub），已有内容未知键重写后原样保留
  - base_url 为空（官方端点形态）时三文件全不写且不抛错，对既有 env 层注入零干扰；共存用例验证 auth.json 值压制 env 同键值（R-04）
  - 写 IO 失败（mock EACCES）记 error 并 reject 供调用方连带跳过 PI env 注入
verify:
  - cd sillyhub-daemon && pnpm vitest run tests/pi-settings.test.ts && pnpm typecheck
constraints:
  - 不做 spawn 接线/热切换/目录生命周期（归 task-03/04）；不改 PiCredentialInjector 与 env 层（并行变更产物，D-008 分层）；不实现 pi × openai_chat 禁配校验（后端 422 与前端禁选归 task-05/06）；provider 键名固定 sillyhub 与 api 值固定 openai-completions 以 golden 为准（D-010）；key 不入日志；不新增 package.json 依赖；不改 ProviderConfig 形状
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
