---
id: task-10
title: 'F4 policy path resolution — shell-paths flag token filtering (PS/CMD included) + path-utils anchor threading through three layers (path-utils -> filesystem-policy -> write-guard four branches) + deny dual-spelling message + vitest'
title_zh: 'F4 策略路径解析——shell-paths flag 过滤（含 PS/CMD）+ path-utils anchor 三层贯通（path-utils→filesystem-policy→write-guard 四分支）+ deny 双拼写文案 + vitest'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-12 21:01:59
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-05]
decision_ids: [D-007@v1]
allowed_paths:
  - sillyhub-daemon/src/policy/shell-paths.ts
  - sillyhub-daemon/src/policy/path-utils.ts
  - sillyhub-daemon/src/policy/filesystem-policy.ts
  - sillyhub-daemon/src/interactive/session-manager/write-guard.ts
  - sillyhub-daemon/tests/policy/shell-paths.test.ts
  - sillyhub-daemon/tests/policy/path-utils.test.ts
  - sillyhub-daemon/tests/policy/filesystem-policy.test.ts
target_files:
  - sillyhub-daemon/src/policy/shell-paths.ts
  - sillyhub-daemon/src/policy/path-utils.ts
  - sillyhub-daemon/src/policy/filesystem-policy.ts
  - sillyhub-daemon/src/interactive/session-manager/write-guard.ts
  - sillyhub-daemon/tests/policy/shell-paths.test.ts
  - sillyhub-daemon/tests/policy/path-utils.test.ts
  - sillyhub-daemon/tests/policy/filesystem-policy.test.ts
goal: >
  修复生产会话 47e2ff1a 实证的策略写守卫三类路径误拒（flag token 被当目标 / 相对路径锚定 daemon cwd / deny 文案无解析提示），使会话开场写入不再被误拒。
implementation:
  - 'sillyhub-daemon/src/policy/shell-paths.ts：tee/mkdir/touch 捕获组（:125、:131）与重定向目标过滤 `-` 前缀 token（捕获即弃，不产出目标）；按 D-007「全部捕获目标」口径，PowerShell 提取器 extractPowerShellWritePaths（:148 起，Set-Content/Out-File/New-Item/Copy-Item/Remove-Item 位置参数捕获）与 CMD 提取器位置参数捕获同轮过滤'
  - 'sillyhub-daemon/src/policy/path-utils.ts：normalizePath（:41）/resolveRealPath（:80）/isPathUnderAnyRoot（:164）增加 anchor 参数（相对路径解析基点，target 与 roots 双解析均生效，默认 process.cwd() 行为不变）'
  - 'sillyhub-daemon/src/policy/filesystem-policy.ts：canWrite（:105）/canCreate（:115）/canDelete（:125）/canRename（:141）签名透传 anchor，judgeWrite（:176）内部 resolveRealPath 与 isPathUnderAnyRoot（:201）调用点透传'
  - 'sillyhub-daemon/src/interactive/session-manager/write-guard.ts：四分支传会话工作区根（SessionState rootPath）——policyEngine 主路径 engine.canWrite（:250）、fallback isPathUnderAnyRoot（:129）、borrow（:215）、overlay（:238）'
  - 'sillyhub-daemon/src/policy/filesystem-policy.ts buildDenyReason（:46）：normalizedPath 与原始路径拼写不一致时附「原始路径 X 解析为 Y」可操作提示'
  - '测试（规则 0 就地改，全部既有文件）：sillyhub-daemon/tests/policy/shell-paths.test.ts（-p 过滤含 PS/CMD）、sillyhub-daemon/tests/policy/path-utils.test.ts（anchor 双解析）、sillyhub-daemon/tests/policy/filesystem-policy.test.ts（anchor 透传 + deny 双拼写）、sillyhub-daemon/tests/interactive/session-manager-write-guard.test.ts（四分支会话根锚定）'
acceptance:
  - 对 `mkdir -p foo` 与 `unzip -p x.zip a > b.txt` 执行提取，结果不含 `-p`（PowerShell/CMD 位置参数捕获同口径过滤）
  - 会话工作区根内相对写（如 `echo hi > out.txt`）解析为 `<会话根>/out.txt` 且放行，不再锚定 daemon cwd；anchor 不传时既有行为逐字节不变（其他调用点零变化）
  - deny 且 normalizedPath 与原始拼写不一致时，文案同时含原始路径与解析后路径两个拼写（断言双拼写）
  - sillyhub-daemon tests/policy 既有测试零回归
verify:
  - cd sillyhub-daemon && pnpm test -- tests/policy tests/interactive/session-manager-write-guard.test.ts
  - cd sillyhub-daemon && pnpm typecheck
constraints:
  - anchor 默认值必须保持 process.cwd() 现行为；仅 write-guard 四条裁决分支显式传会话根，其他调用点零变化（design 兼容策略 §4 / 风险 R-06）
  - canWrite/canCreate/canDelete/canRename 仅加可选 anchor 参数，既有调用不传时语义不变；测试规则 0 仅跑相关测试
<!-- 执行期对账修正（verify 收口，与该 task review 结论一致）：target_files 移除 sillyhub-daemon/tests/interactive/session-manager-write-guard.test.ts —— session-manager-write-guard.test.ts 既有断言零回归未改动（anchor 语义由 policy 面三测试文件覆盖） -->

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
     implementation/acceptance 里的源码位置同样写仓根相对全路径+行号（src/foo.js:123）——
                    裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词
                    窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
