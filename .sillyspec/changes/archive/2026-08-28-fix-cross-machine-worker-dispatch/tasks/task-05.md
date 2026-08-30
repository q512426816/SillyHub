---
id: task-05
title: 'Add interactive cwd guard pure function with vitest'
title_zh: 'daemon 守卫纯函数 interactive-cwd-guard.ts + vitest 三形态×双 OS'
author: 'WhaleFall'
created_at: 2026-08-28 15:48:26
priority: P0
depends_on: []
blocks: [task-06]
requirement_ids: [FR-05, NFR-01]
decision_ids: [D-004@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive-cwd-guard.ts
  - sillyhub-daemon/tests/interactive-cwd-guard.test.ts
provides:
  - contract: checkWorkspaceBoundCwd
    note: 纯函数守卫，入参（cwd, exists, roots）、出参 CwdGuardVerdict；task-06 在 daemon.ts 认领段（firstRunId 非空守卫后）接线调用，失败形态的 message 映射 notifyRunResult result_summary
  - contract: CwdGuardVerdict
    note: 判定结果联合类型（ok=true 通过形态；ok=false + code 取 cwd_forbidden 或 cwd_not_found + 中文 message），task-06 消费映射错误码与文案
goal: >
  新增 daemon 纯函数守卫模块 interactive-cwd-guard.ts（无 IO、无状态，规避 daemon.ts
  god file 内联扩散），供 task-06 在 daemon.ts 认领段接线——workspace 绑定会话
  （rawRootPath 为非空字符串且非借用沙箱 marker）的 cwd 做**白名单终检先行**+存在性
  检查，任一失败返回 {ok:false, code:'cwd_forbidden'|'cwd_not_found',
  message:中文含 cwd 与原因}；白名单判定复用 file-rpc.ts assertWithinAllowedRoots
  同一 containment 口径（该函数已导出，guard 内直接调用），不重写第二套口径。
implementation:
  - 新建 src/interactive-cwd-guard.ts，导出 CwdGuardVerdict 联合类型（ok=true 通过形态；ok=false + code 与 message 拒绝形态，code 取 cwd_forbidden 或 cwd_not_found），签名对齐 design.md 接口定义
  - 导出 checkWorkspaceBoundCwd(cwd, exists, roots) 纯函数——判定顺序为先白名单后存在性；白名单段调用 file-rpc.ts 已导出的 assertWithinAllowedRoots(cwd, roots)（try/catch 捕获其抛出的 code 为 forbidden 的 RpcError 即越界），保证与 host_fs 通道同一 containment 口径（pathResolve 折叠、边界敏感前缀比较、Windows 盘符大小写归一）
  - 白名单通过后再判 exists——false 返回 cwd_not_found 拒绝形态；两道检查全过返回 ok=true；双违反（越界且不存在）时 forbidden 优先（白名单先查，plan 审查统一口径）
  - message 中文模板且必须含 cwd 原文与原因——cwd_forbidden 文案说明路径超出本机 allowed_roots 白名单，可能是错机派发或机器配置变更；cwd_not_found 文案说明目录不存在，可能是错机派发或工作区绑定机器路径错配，并明示拒绝自动创建目录
  - ESM import 遵循 src 内相对导入带 .js 后缀的既有约定（从 file-rpc.js 引 assertWithinAllowedRoots、从 ws-client.js 引 RpcError）；测试文件按 tests 目录现状无后缀引入 src 模块（对齐 file-rpc.test.ts 风格）
  - 新建 tests/interactive-cwd-guard.test.ts——vitest 纯函数直测，不依赖真实 lease/daemon 实例；风格对齐 file-rpc.test.ts（describe/it 中文标题、IS_WIN 按运行平台构造对应路径形态）
acceptance:
  - 三形态用例全过——cwd 在白名单内且存在时返回 ok=true；越界时返回 ok=false 且 code 为 cwd_forbidden；不存在（白名单内）时返回 ok=false 且 code 为 cwd_not_found
  - Windows 形态（盘符、反斜杠、大小写不敏感——如大写盘符路径命中小写白名单根）与 Linux 形态（POSIX 绝对路径）双形态下三形态用例均覆盖（按运行平台条件构造，参照 file-rpc.test.ts 的 IS_WIN 分支）
  - 双违反（越界且不存在）→ 返回 forbidden 而非 not_found（白名单终检先行，与 task-06 daemon.ts 接线口径一致）
  - 拒绝形态 message 断言——中文、含 cwd 原文、含对应原因关键词（超出白名单 / 目录不存在）
verify:
  - cd sillyhub-daemon && pnpm typecheck
  - cd sillyhub-daemon && pnpm test -- tests/interactive-cwd-guard.test.ts
constraints:
  - 不改 daemon.ts（认领段接线归 task-06）；不动 file-rpc.ts 既有实现（assertWithinAllowedRoots 已导出，仅导入复用）
  - 守卫自身无 IO、无状态——exists 由调用方（task-06 侧 stat）传入，函数内不做任何 fs 存在性判定、不 mkdir
  - 不引入新依赖（vitest 为既有 devDependency）；不新增对外 RPC/协议字段（错误码与文案仅供 daemon 内部与 notifyRunResult result_summary 消费）
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
