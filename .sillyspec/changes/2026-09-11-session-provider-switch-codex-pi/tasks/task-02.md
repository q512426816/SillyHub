---
id: task-02
title: 'Add applyProviderFileSettingsForReload variant (failure-fallback return-value matrix) + codex host-auth mirror mirrorCodexHostAuth / thread migration migrateCodexThreadFromHost helpers'
title_zh: 'ForReload 变体（失败兜底内聚返回值矩阵）+ codex 宿主凭证镜像 mirrorCodexHostAuth / thread 迁移 migrateCodexThreadFromHost 两 helper'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-11 18:57:27
priority: P0
depends_on: ['task-01']
blocks: []
requirement_ids: [FR-01, FR-02, FR-05]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/provider-file-settings.ts
  - sillyhub-daemon/src/codex-settings.ts
target_files:
  - NEW:sillyhub-daemon/src/provider-file-settings.ts
  - sillyhub-daemon/src/codex-settings.ts
provides:
  - contract: reload 文件层分派与 codex thread 迁移 helper
    fields: [applyProviderFileSettingsForReload, ProviderFileSettingsReloadInput, migrateCodexThreadFromHost]
  - contract: reload 文件层分派与 codex 宿主镜像 helper
    fields: [applyProviderFileSettingsForReload, ProviderFileSettingsReloadInput, mirrorCodexHostAuth]
expects_from:
  - task-01——sillyhub-daemon/src/provider-file-settings.ts 的 applyProviderFileSettings / isCodexFormSufficient / isPiFormSufficient / nonEmptyStr / ProviderFileSettingsInput（ForReload 复用分派与门槛判定；per-session 目录派生口径 join(daemonStateDir(), codex|pi, sessionKey) 与 spawn 版一致）
goal: >
  在共享模块新增 reload 专用变体 applyProviderFileSettingsForReload（失败兜底语义完全内聚在返回值矩阵——IO 失败/门槛缺回退 prior 文件层键、null 切换镜像保 CODEX_HOME、restore 无 prior 降级空对象，R-05 落地点）与 codex-settings 的宿主凭证镜像 mirrorCodexHostAuth / thread 迁移 migrateCodexThreadFromHost 两 helper，为 task-03 reload 内核接线与 task-04 restore 自愈提供确定性供应商切换原语（FR-01/FR-02/FR-05、D-001@v1）。
implementation:
  - provider-file-settings.ts 新增 ProviderFileSettingsReloadInput（extends ProviderFileSettingsInput + priorEnv——Record<string,string> 或 undefined，restore 路径传 undefined）与 applyProviderFileSettingsForReload；分派复用 task-01 平移来的 isCodexFormSufficient / isPiFormSufficient / nonEmptyStr 与 writeCodexHome / writePiDir，目录派生口径与 spawn 版一致
  - ForReload 分支一（非 null 成功）——与 spawn 版同分派同产物：codex 门槛足→写盘并返回仅含 CODEX_HOME 的单键；pi 自定义端点且门槛足→返回仅含 PI_CODING_AGENT_DIR 的单键；pi 官方端点（base_url 空）→空对象；claude / 缺省 / 未知 kind→空对象
  - ForReload 分支二（非 null 且 mkdir/写盘 IO 失败）——返回 priorEnv 的对应文件层键（codex 回 CODEX_HOME、pi 回 PI_CODING_AGENT_DIR，目录里旧供应商产物未动=行为等同未切，error 日志可归因）；priorEnv 为 undefined（restore 路径）取不到 prior 键时返回空对象（降级=按宿主现状运行，与 create 失败语义对齐，Grill 复审 P2-2）
  - ForReload 分支三（非 null 且 codex 门槛缺）——warn 跳过写盘但返回 priorEnv 的 CODEX_HOME 键（若有，无则空对象）——异常配置场景等同未切而非丢文件层 env（Grill 复审 P2-1）
  - ForReload 分支四（null 切换且 priorEnv 带 CODEX_HOME）——调 mirrorCodexHostAuth，无论镜像成败都返回仅含 CODEX_HOME 的单键（值=priorEnv 旧目录）——镜像失败则目录里旧供应商凭证仍在=等同未切，env 保住=codex thread 历史保住
  - ForReload 分支五（null 切换且无 prior CODEX_HOME，或 pi kind）——返回空对象（env 不带文件层键=回宿主 ~/.pi 或宿主起步 ~/.codex）
  - codex-settings.ts 新增 mirrorCodexHostAuth(codexHome)——宿主 join(homedir(), .codex) 下 auth.json / config.toml（复用模块内 AUTH_FILENAME / CONFIG_FILENAME 常量，需补 homedir import）存在则拷入 codexHome 覆盖平台供应商产物，不存在则删除 codexHome 下同名两文件（如实反映宿主未登录）；IO 失败 console.error 不抛（由 ForReload 兜底为返回 prior 键）
  - codex-settings.ts 新增 migrateCodexThreadFromHost(threadId, codexHome)——递归扫描宿主 ~/.codex/sessions 下 .jsonl rollout，仅读首行解析会话 id（payload.session_id 优先、兼容 session_meta.id，以实际 rollout 首行为准，fixture 锚 archive/2026-08-23-agent-log-conversation-view:153-158），命中 threadId 的文件按 sessions/ 下相对路径拷入 codexHome/sessions/，返回是否迁到至少 1 个文件；宿主目录不存在或无命中 warn 返回 false（reload 不阻断，resume 失败由 codex 真实报错收敛，对齐 claude 迁移失败降级 R-01 语义）
  - 分派矩阵 / mirror / 迁移的测试实现归 task-06（建议新测试文件 tests/provider-file-settings-reload.test.ts）——本卡只交付实现与导出符号，不写测试
acceptance:
  - 分支一：非 null 成功分派与 spawn 版同产物——codex 门槛足返回 CODEX_HOME 单键且 per-session 目录两文件已写、pi 自定义端点返回 PI_CODING_AGENT_DIR 单键、pi 官方端点与 claude/未知 kind 返回空对象
  - 分支二：IO 失败返回 priorEnv 对应文件层键（codex 回 CODEX_HOME、pi 回 PI_CODING_AGENT_DIR）；priorEnv=undefined 时返回空对象
  - 分支三：codex 门槛缺 warn 跳过写盘并返回 priorEnv 的 CODEX_HOME 键（若有），无 prior 键返回空对象
  - 分支四：null+prior CODEX_HOME 调 mirrorCodexHostAuth 且镜像成功/失败均返回 CODEX_HOME=prior 旧目录
  - 分支五：null+无 prior CODEX_HOME（宿主起步）或 pi kind 返回空对象
  - 全矩阵任何分支均不抛（IO 异常一律捕获转返回值），reload/restore 主路径永不阻断
  - mirrorCodexHostAuth 三态——宿主两文件存在→拷入覆盖；不存在→删 codexHome 同名两文件；IO 失败 error 不抛
  - migrateCodexThreadFromHost——首行会话 id（payload.session_id，兼容 session_meta.id）命中 threadId 的 rollout 按 sessions/ 相对路径拷入返回 true；宿主缺目录/无命中 warn 返 false
  - 四符号全部导出（applyProviderFileSettingsForReload / ProviderFileSettingsReloadInput / mirrorCodexHostAuth / migrateCodexThreadFromHost），task-03/04 可直接 import
verify:
  - cd sillyhub-daemon && pnpm typecheck
  - cd sillyhub-daemon && pnpm exec vitest run tests/daemon-provider-file-dispatch.test.ts tests/provider-injection-smoke.integ.test.ts（实现后既有相关测试不红；ForReload / mirror / 迁移矩阵单测归 task-06 的 tests/provider-file-settings-reload.test.ts，本卡不写）
constraints:
  - ForReload / mirrorCodexHostAuth / migrateCodexThreadFromHost 绝不抛——失败兜底全部内聚在返回值与日志，reload/restore 主路径不阻断
  - 日志铁律——warn/error 载荷永不含 api_key / daemonApiKey 明文（只含 sessionKey / 路径 / 字段名 / 错误 message）
  - 宿主文件只读不删——mirrorCodexHostAuth 与 migrateCodexThreadFromHost 对宿主 ~/.codex 只读拷贝，删除/写入动作只发生在平台 per-session 目录内
  - spawn 版 applyProviderFileSettings 签名与行为零改动——ForReload 为新增并行导出，不触碰 spawn 语义
  - 迁移只读 rollout 首行（不全文件解析），控制宿主大目录扫描成本（R-01）
  - 本卡不动 task-runner.ts / daemon.ts / session-manager 等接线（归 task-03/04），不新增测试文件（归 task-06）
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
