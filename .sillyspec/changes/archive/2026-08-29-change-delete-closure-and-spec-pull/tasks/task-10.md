---
id: task-10
title: 'daemon 兼容回归（bundle 新增元数据后 pullSpecBundle/spec_version 判定）'
title_zh: 'daemon 兼容回归（bundle 新增元数据后 pullSpecBundle/spec_version 判定）'
author: 'qinyi'
created_at: 2026-08-29 12:57:58
priority: P1
depends_on: ['task-08']
blocks: []
requirement_ids: [FR-08, NFR-03]
decision_ids: []
allowed_paths:
  - sillyhub-daemon/tests/test_bundle_metadata_compat.test.ts
expects_from:
  - 'task-08：build_bundle 产出的 tar 顶层含 PLATFORM-BUNDLE.json {spec_version, strategy, generated_at, server}'
goal: >
  证明 bundle 新增 PLATFORM-BUNDLE.json 元数据后 daemon 零改动兼容：以纯新增测试回归
  pullSpecBundle 解包、hasUnsyncedLocalChanges 误报、.runtime/spec-version.json 保鲜判定
  三条链路（design §7.3「daemon 侧不受影响」，FR-08/NFR-03）。
implementation:
  - '新建 sillyhub-daemon/tests/test_bundle_metadata_compat.test.ts：构造含顶层 PLATFORM-BUNDLE.json（真实四键 JSON）+ 常规 spec 文件（如 changes/x/design.md、docs/CONVENTIONS.md）的 bundle tar——照 tests/spec-transport-tar-sync/spec-sync.test.ts 的手工 ustar buildTarEntry + mkdtemp 范式'
  - 'mock HubClient（getSpecBundle 返回该 tar，duck-type 不依赖 hub-client 导出）跑 pullSpecBundle（只读引用 src/spec-sync.ts:92-199）：断言解包成功、spec 文件全部落地、PLATFORM-BUNDLE.json 作为顶层普通文件落地无害、返回 specDir 非 null'
  - '保鲜链路回归：pull 后 bumpLocalSpecVersion（:1314-1336）重建 .runtime/spec-version.json → readLocalSpecVersion 读回版本；shouldRefreshSpec（:1290-1297）四分支（lease 缺失→false / local null→true / 相等→false / 不等→true）不受顶层多余文件影响'
  - '回灌判定回归：pull+bump 完成后的 specDir（含 PLATFORM-BUNDLE.json）跑 hasUnsyncedLocalChanges（:240-266）断言不误报未回灌（PLATFORM-BUNDLE.json mtime=解包时刻，早于 bump 写入的 synced_at；newestMtime 仅跳 .runtime/）'
  - '前提核查：全程零修改 sillyhub-daemon/src；若测试暴露 pullSpecBundle/extractTar（:982-1019 仅收 regular file + directory，理论上直接兼容）必须改源码才能兼容，停下报告发现交主代理决策，不擅自改源码'
acceptance:
  - '含 PLATFORM-BUNDLE.json 的 bundle 经 pullSpecBundle（mock client）解包成功，spec 文件全部落地，返回 specDir 非 null'
  - '解包后目录顶层存在 PLATFORM-BUNDLE.json 不影响 shouldRefreshSpec 判定矩阵（四分支全绿）'
  - 'bumpLocalSpecVersion 在含元数据文件的目录上正常重建 .runtime/spec-version.json，readLocalSpecVersion 读回一致（pull rm+覆盖后重建语义回归）'
  - 'hasUnsyncedLocalChanges 对 pull+bump 后的目录（含 PLATFORM-BUNDLE.json）返回 false，不误报未回灌'
  - 'sillyhub-daemon/src 零修改（git -C sillyhub-daemon diff --stat src 输出为空）'
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/test_bundle_metadata_compat.test.ts
  - cd sillyhub-daemon && pnpm exec vitest run tests/test_spec_version_refresh.test.ts tests/spec-transport-tar-sync/spec-sync.test.ts
  - git -C sillyhub-daemon diff --stat src
constraints:
  - 'daemon 源码（sillyhub-daemon/src/**）零修改为前提：测试暴露必须改源码才能兼容时报告而非改（回报主代理，涉及 design §7.3 结论修订）；spec-sync.ts/hub-client.ts 仅只读引用，不进 allowed_paths'
  - '不动 daemon pull/push 时机（lease claim 按 latest_spec_version 判定维持现状，design §7.4 / Non-Goal）'
  - '只做兼容回归，不新增 daemon 功能；mock client 不要求真实 HubClient（照 spec-sync.test.ts duck-type 范式）'
  - '遵守 CLAUDE.md 规则 0：只跑上述指定测试文件，全量留 CI'
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
