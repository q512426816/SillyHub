---
id: task-04
title: '三 driver 实现（pi 双命令+启动时序/claude m.value+applyFlagSettings/codex 双方法+turn params）+测试'
title_zh: '三 driver 实现（pi 双命令+启动时序/claude m.value+applyFlagSettings/codex 双方法+turn params）+测试'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-15 00:48:35
priority: P0
depends_on: ['task-03']
blocks: []
requirement_ids: [FR-03, FR-04, FR-05]
decision_ids: [D-002@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/pi-rpc-driver.ts
  - sillyhub-daemon/src/interactive/claude-sdk-driver.ts
  - sillyhub-daemon/src/interactive/codex-app-server-driver.ts
  - sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts
  - sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts
target_files:
  - sillyhub-daemon/src/interactive/pi-rpc-driver.ts
  - sillyhub-daemon/src/interactive/claude-sdk-driver.ts
  - sillyhub-daemon/src/interactive/codex-app-server-driver.ts
  - sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts
  - sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts
expects_from:
  task-03:
    - contract: InteractiveDriver 可选两方法+启动字段
      needs: [getThinkingLevels, setThinkingLevel, ThinkingLevels, ThinkingLevelResult, InteractiveDriverStartOptions.thinkingLevel]
  task-02:
    - contract: thinking-levels 单源
      needs: [mapPlatformLevelToEngine]
goal: >
  三 driver 实现可选契约（FR-03 启动设置/FR-04 档位查询/FR-05 会话中切换）：首步 codex
  spike 真机一发 turn/start 带 reasoningEffort 验形状（plan-review P1-6/R-02，失败回退=
  摘参+切换报不支持）；pi=双命令（get_available_thinking_levels+get_state.thinkingLevel
  /set_thinking_level）+握手返回后轮询前启动设置；claude=m.value 过滤 supportedModels+
  applyFlagSettings+Options.effort；codex=静态五档+thread/settings/update 经 pending 通道
  +ctx→turn/start params。
implementation:
  - '首步 spike（plan-review P1-6，R-02）——真机对 codex app-server 发一发 turn/start params 挂顶层 reasoningEffort 验形状（键名与位置）：成立 → 启动设置走 turn/start params；失败 → 摘参（启动不设置）+setThinkingLevel 返回报不支持（多会话场景不用 config.toml 机器级降级——同 daemon 所有 codex 会话互相污染，Grill P1-7 爆炸半径）；spike 结论记 QUICKLOG 并回写 driver 注释'
  - 'PiRpcDriver（FR-04/05/03）——① getThinkingLevels(handle)：_sendCommand(h, {type:"get_available_thinking_levels"}) 取档位数组（rpc.md:316-335 按当前模型动态）+ _sendCommand(h, {type:"get_state"}) 取 thinkingLevel 现值 → {levels, current} ② setThinkingLevel(handle, level)：mapPlatformLevelToEngine("pi", level)（七档直传）→ _sendCommand(h, {type:"set_thinking_level", level}) → {ok:true}；错误回执/超时/写失败 → {ok:false, error 原文} 不上抛 ③ 启动设置：opts.thinkingLevel 传入且映射非 undefined 时，在握手（get_state）返回后、inputIt 轮询前（:1455 插入点，Grill P1-9 时序修正）发 set_thinking_level；失败记日志不阻断会话启动'
  - 'ClaudeSdkDriver（FR-04/05/03）——① getThinkingLevels(handle, model?)：handle.query.supportedModels()（:2552）→ .find(m => m.value === model)?.supportedEffortLevels（Grill P1-5：ModelInfo 无 id 字段用 m.value，:1247-1286）?? 默认五档 ["low","medium","high","xhigh","max"]（R-03 兜底：model 未传/查不到均回退默认）；current=undefined（SDK 不暴露 per-query 现值）② setThinkingLevel(handle, level)：mapPlatformLevelToEngine("claude", level) → undefined（off 档）则不调 applyFlagSettings 直返 {ok:true}（语义=不设）；否则 handle.query.applyFlagSettings({effortLevel: 映射值})（:2505-2507，session-scoped）→ {ok:true}；异常捕获 → {ok:false, error 文案} ③ 启动设置：ClaudeStartOptions（:217-242）加 effort?: string；options 构造区（:409-411 opts.model 同款）if (opts.thinkingLevel !== undefined 且映射非 undefined) → options.effort = 映射值'
  - 'CodexAppServerDriver（FR-04/05/03）——① getThinkingLevels(handle)：静态五档 ["minimal","low","medium","high","xhigh"] + current：spike 可行则经 _sendJsonRpcRequest("thread/read") 读 reasoningEffort 现值，不可行 current=undefined（spike 定案）② setThinkingLevel(handle, level)：mapPlatformLevelToEngine("codex", level) → undefined（off）→ {ok:false, error:「codex 不支持关闭推理」}；否则经 pending 通道（compact task-05 已建）发 _sendJsonRpcRequest("thread/settings/update", {threadId: h.threadId, reasoningEffort: 映射值}) → 受理 {ok:true}；error response/超时 → {ok:false, error 原文} 不上抛 ③ 启动设置：start 时 opts.thinkingLevel 映射值存 handle._ctx → _writeTurnStart 组 params 挂 reasoningEffort（键名与位置以首步 spike 实证为准）'
  - 'pi-rpc-driver.test.ts 断言——get_available_thinking_levels+get_state 双命令形态与 {levels,current} 组装 / set_thinking_level 命令形态（level 直传+自增 id）/ 错误与超时 → {ok:false} 非 reject / 启动时序（握手后发 set_thinking_level、opts 未传不发、发失败不阻断启动）'
  - 'codex-app-server-driver.test.ts 断言——thread/settings/update JSON-RPC 形态（method/params.threadId/params.reasoningEffort/自增 id 经 pending 通道）/ 受理 → {ok:true} / error response → error 原文 / turn/start params 挂 reasoningEffort（按 spike 形状；失败分支=摘参断言）/ getThinkingLevels 静态五档返回'
acceptance:
  - 首步 spike 结论已记 QUICKLOG：turn/start reasoningEffort 形状两分支（成立走 params / 失败摘参+切换报不支持）均有对应实现与断言（R-02 降级，不用 config.toml）
  - pi 双命令+启动时序断言绿（握手后轮询前发命令、失败不阻断）；claude m.value 过滤+默认五档回退+applyFlagSettings/off 不设路径就位（typecheck+task-03 mock 分派覆盖）；codex pending 通道断言绿
  - 三 driver 既有全套件零回归 + daemon typecheck 绿
verify:
  - pnpm -C sillyhub-daemon exec vitest run tests/interactive/pi-rpc-driver.test.ts tests/interactive/codex-app-server-driver.test.ts
  - pnpm -C sillyhub-daemon exec vitest run tests/interactive/session-thinking-level.test.ts
  - pnpm -C sillyhub-daemon exec tsc --noEmit
constraints:
  - off/降级映射一律经 task-02 mapPlatformLevelToEngine（driver 不自写映射表；pi 直传也走同函数保单源）；undefined 映射语义=不设（claude off）/报不支持（codex off），按 design 口径区分
  - pi 启动 set_thinking_level 失败不阻断会话启动（记日志继续轮询）；三 driver 方法错误一律 {ok:false, error} 结果不上抛（RPC handler 拿 error 结果而非异常）
  - claude 不新增专属测试文件（design 文件清单口径）：覆盖经 task-03 mock 分派断言+本卡 typecheck+task-07 spike-02 真机实证；如需专属断言先回主代理扩卡再动
  - codex 键名/位置以首步 spike 实证为准，不符只改 params 组装处机制不变；daemon ESM 相对 import 带 .js 后缀；Windows / Linux / macOS 兼容
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
