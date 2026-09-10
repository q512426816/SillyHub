---
id: task-05
title: 'bump-types-node-run-regressions-and-real-db-smoke'
title_zh: '@types/node bump + 相关套件回归 + 本机真实库冒烟'
author: 'qinyi'
created_at: 2026-09-10 11:50:52
priority: P0
depends_on: [task-02, task-03, task-04]
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-006@v1]
allowed_paths:
  - sillyhub-daemon/package.json
target_files:
  - sillyhub-daemon/package.json
  - sillyhub-daemon/pnpm-lock.yaml
goal: >
  devDep @types/node 由 20.14.0 bump 至 ≥22.13（仅类型层，engines 不动，D-006@v1），让 task-02 读取器的
  node:sqlite 类型声明可用；随后按 CLAUDE.md 规则 0 跑相关套件回归，并对本机真实 db.sqlite 只读冒烟落 integration-critical 验证证据。
implementation:
  - sillyhub-daemon/package.json devDependencies 中 @types/node 单行 bump 20.14.0 → ^22.13（≥22.13 即可）；engines.node 与其余依赖一字不动（D-006@v1：旧 Node 运行时自动降级文件回落）
  - pnpm install 后 pnpm typecheck 必须绿（read-zcode-sqlite.ts 的 DatabaseSync 等类型全通过，无缺声明报错）
  - 相关套件回归（禁止全量，CLAUDE.md 规则 0）：sillyhub-daemon tests/agent-log/ 全套（既有 parse-zcode-model-io 等 + task-02/03 新增）+ backend platform_sync 套件（含 task-04 用例）
  - 真实库冒烟（integration-critical 证据）：一次性脚本（node --input-type=module 或临时 vitest 用例，跑完删除或放 temp，不入 target_files）只读 mode=ro 打开本机 C:\Users\qinyi\.zcode\cli\db\db.sqlite，抽 ≥3 会话——必含 1 个 rollout 文件已清理的死会话 + 1 个文件仍在的活跃会话——跑 read-zcode-sqlite 读取器
  - 量化核对（对齐 plan 全局验收 3）：文件仍在会话读取器与 parse-zcode-model-io 文件解析总段数一致（±10%）；hidden 零泄漏（user_input 段全部来自非隐藏消息，违例计数 0）；tool use/result 两段配对抽验（completed 与 error 各一）；beforeSeq 翻页正常；冒烟输出（段数对照/泄漏计数/配对抽样）贴 execute 记录
acceptance:
  - pnpm install 后 cd sillyhub-daemon && pnpm typecheck 绿（node:sqlite 类型声明解析成功）
  - daemon tests/agent-log/ 套件与 backend platform_sync 套件（pytest -q --no-cov）全绿，既有零回归
  - 真实库冒烟达标：≥3 会话（含 1 个文件已清理死会话完整回看 + 1 个文件仍在活跃会话）；段数对照偏差 ≤10%；hidden 泄漏计数 0；completed/error tool 配对各一抽验通过；beforeSeq 翻页正常；输出已贴 execute 记录
  - diff 范围仅 sillyhub-daemon/package.json 一行 devDep bump；engines 零变化；冒烟脚本未入库（已删或在 temp）
verify:
  - cd sillyhub-daemon && pnpm install && pnpm typecheck
  - cd sillyhub-daemon && pnpm vitest run tests/agent-log/ && cd ../backend && uv run pytest app/modules/platform_sync/tests/ -q --no-cov
  - manual——一次性冒烟脚本输出（段数对照/hidden 泄漏计数/tool 配对抽样/beforeSeq 翻页）贴 execute 记录备查
constraints:
  - 不 bump engines.node（保持 >=20.0.0；旧 Node 自动降级文件回落，D-006@v1）
  - 禁止全量测试（CLAUDE.md 规则 0），仅跑 daemon tests/agent-log/ 与 backend platform_sync 套件
  - 不新增持久文件：冒烟脚本一次性（放 temp 或跑完即删），不入 git 与 target_files
  - frontend / 上报协议 / sillyspec CLI / liveness 零触碰；真实库严格只读（mode=ro URI，绝不写库）
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
