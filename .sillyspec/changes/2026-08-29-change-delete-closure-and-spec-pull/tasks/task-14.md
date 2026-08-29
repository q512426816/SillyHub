---
id: task-14
title: '【跨仓 sillyspec】X2 pullSpecBundle + 顶层 pull 命令注册'
title_zh: '【跨仓 sillyspec】X2 pullSpecBundle + 顶层 pull 命令注册'
author: 'qinyi'
created_at: 2026-08-29 12:57:58
priority: P1
depends_on: ['task-08']
blocks: []
repo: sillyspec
requirement_ids: [FR-07, FR-08]
decision_ids: [D-004@v1]
expects_from:
  - 'task-08：GET /api/changes/-/spec-bundle 端点（_write_auth 仅 shpsync token，流式 tar，X-Spec-Version 响应头）'
allowed_paths:
  - 'src/sync.js'
  - 'src/index.js'
  - 'test/pull-spec-bundle.test.mjs'
goal: >
  补 CLI 真缺口——spec 文件至今只推不拉（现有 SyncManager.pull :986 仅拉进度六表）；
  新增 pullSpecBundle()（流式下载 tar 解压到 specDir）+ 顶层命令注册，
  快照语义帮助文案明示（design §7.1 / §7.4）。
implementation:
  - 'src/sync.js SyncManager 新增 pullSpecBundle()：GET {platform.url}/api/changes/-/spec-bundle，Authorization: Bearer <shpsync token>（_getPlatform 既有凭据通道），流式下载 tar 并解压到 specDir（.sillyspec 内容根）——走新增方法，不改既有 pull()（:986）/pullList()（:952）函数体（与 task-13/W4 分波，改动点不冲突）'
  - '覆盖语义对齐 daemon pullSpecBundle：specDir 为空目录直接解压；非空且无 --force 拒绝并明确提示；--force 整树覆盖（rm + 解包）'
  - 'src/index.js 注册顶层命令（参考形态 sillyspec pull --spec，命名执行时定）——注意与既有 platform pull 子命令（:2283，进度六表下行）语义可区分，防误用；未连接平台时明确提示不崩（对齐 platform pull 先例）'
  - '帮助文案明示快照语义：主动拉取服务器当前快照，无自动同步、无会话中刷新（design §7.4 时机口径：机器拉维持 daemon lease 判定现状，不动 daemon）'
  - '解包容忍 tar 顶层 PLATFORM-BUNDLE.json（task-08 产物；daemon 兼容同款，多一个文件不影响）'
  - '新增测试 test/pull-spec-bundle.test.mjs（node:test）：空目录解压 / 非空无 --force 拒绝 / --force rm+整树覆盖 / 未连接平台提示不崩 / 鉴权头携带 shpsync token'
acceptance:
  - 'pullSpecBundle 以 shpsync token 拉流式 tar 并解压到 specDir（请求头/端点正确）'
  - '空目录直接解压；非空无 --force 拒绝并提示；--force 整树覆盖（rm+解包，对齐 daemon 语义）'
  - '顶层命令可执行且帮助文案含快照语义说明（明示无自动同步）'
  - '既有 SyncManager.pull（进度六表）与 platform pull 行为零回归；未连接平台明确提示不崩'
verify:
  - 'cd C:/Users/qinyi/IdeaProjects/sillyspec && node test/check-syntax.mjs'
  - 'cd C:/Users/qinyi/IdeaProjects/sillyspec && node --test test/pull-spec-bundle.test.mjs'
constraints:
  - '跨仓任务：全部改动相对 sillyspec 仓根（C:/Users/qinyi/IdeaProjects/sillyspec），禁止修改主仓任何文件（平台端点归 task-08 已交付）；SillySpec CLI 一律在主仓根目录跑（CLAUDE.md 规则 22）'
  - '不动既有 pull()/pullList() 函数体（只新增方法）；不动 daemon、不新增自动同步/会话中刷新（§7.4 口径）'
  - '命令命名执行时定，但不得与既有 platform pull（进度同步）混淆语义'
  - '只跑本任务相关测试（node --test 指定文件），该仓全量 npm test 留 CI'
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
