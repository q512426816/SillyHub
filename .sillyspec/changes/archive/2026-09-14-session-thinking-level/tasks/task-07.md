---
id: task-07
title: 'onboarding 指引+真机三引擎验证（spike-01/02+pi 双命令）'
title_zh: 'onboarding 指引+真机三引擎验证（spike-01/02+pi 双命令）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-15 00:48:35
priority: P0
depends_on: ['task-04', 'task-05', 'task-06']
blocks: []
requirement_ids: [FR-07]
decision_ids: [D-001@v1]
allowed_paths:
  - docs/agent-provider-onboarding.md
target_files:
  - docs/agent-provider-onboarding.md
expects_from:
  task-04:
    - contract: 三 driver 实现
      needs: [codex turn/start spike 形状结论, 降级分支落点]
  task-05:
    - contract: thinking-level 两端点+DTO
      needs: [GET/POST 端点, 七档镜像校验]
  task-06:
    - contract: 前端双控件
      needs: [创建下拉+会话切换控件]
goal: >
  收尾双件（FR-07）：onboarding 文档补 thinking_level 接入指引（caps 第 13 键+可选 driver
  方法+三引擎分路+统一词表与降级矩阵），真机三引擎各创建选档+查询+切档验证全链——spike-02
  claude applyFlagSettings+supportedModels 直调（R-03）/pi 双命令实证/codex
  thread/settings/update 实证（补 task-04 turn/start spike），结论记 QUICKLOG；codex 切换
  形状不成立则确认 task-04 降级分支（报不支持）如实生效。
implementation:
  - 'docs/agent-provider-onboarding.md 补 thinking_level 接入指引段——① ProviderCaps 第 13 键 thinking_level 语义与声明处（gen 八步样板引用）② 可选 driver 方法 getThinkingLevels?(handle, model?)/setThinkingLevel?(handle, level)（不实现即不支持，cursor 形态）③ 三引擎分路形态：pi=get_available_thinking_levels+get_state.thinkingLevel/set_thinking_level/握手后启动命令；claude=supportedModels().find(m.value) 过滤+applyFlagSettings({effortLevel})+Options.effort；codex=静态五档+thread/settings/update{reasoningEffort}+turn/start params ④ 统一七档词表与 mapPlatformLevelToEngine 降级矩阵（新引擎接入照此扩展）⑤ daemon 需注册两 RPC handler（旧 daemon RemoteError→「请升级 daemon」）'
  - '真机 claude（spike-02，R-03 兜底）——SDK 直调 applyFlagSettings({effortLevel})+supportedModels() 验可用性与档位数组形状（streaming input mode 场景）：不可用则按 R-03 降级（init 响应缓存/静态五档）回写 task-04 对应分支；平台控件切档实证：切换成功通知+档位生效行为'
  - '真机 pi（双命令实证）——get_available_thinking_levels 回执形状（按模型动态；无推理模型回 ["off"]）+set_thinking_level 切换后 get_state.thinkingLevel 现值变化；平台 GET 端点回传与引擎侧一致'
  - '真机 codex（thread/settings/update 实证，补 task-04 turn/start spike）——切换请求回执形状+thread/settings/updated 通知吸收情况+切换后档位生效证据；形状不成立 → 确认 task-04 降级分支（切换报不支持）真机如实报错而非静默失败'
  - '真机三验点回执——三引擎各：创建时选档（首句生效证据）→GET 档位列表+现值→空闲态切档→再查现值变化；结论（spike-02/双命令/codex 形状+降级判定）记 QUICKLOG（ql-ID 条目追加，.sillyspec/quicklog/）'
acceptance:
  - onboarding 文档含 caps 键/可选 driver 方法/三引擎分路/词表降级矩阵/RPC handler 要求五要点
  - 真机三引擎各一轮：创建选档生效+GET 回 {levels,current}+切换后现值变化或降级报错如实
  - spike-02（claude applyFlagSettings+supportedModels 直调）与 codex thread/settings/update 实证结论已记 QUICKLOG；codex 不支持分支（若触发）已在真机确认报错形态
verify:
  - grep -n "thinking_level" docs/agent-provider-onboarding.md
  - 真机三引擎操作按 implementation 第 2-4 条逐项人工确认，证据 = QUICKLOG 回执条目（无可自动化命令）
constraints:
  - 文档中文（UI/文档默认中文，必要专业术语除外）；真机阶段不动代码——实证字段/形状不符才回写对应 driver（task-04 已预留落点且须在该卡 allowed_paths 内）
  - 本卡 allowed_paths 仅文档：需改代码的降级回写先回主代理扩卡再动（不越权改 allowed_paths 外文件）
  - 真机结论如实记录不美化（失败即记录失败与降级动作）；轮中切档不测（NG-02 仅空闲约束沿用 D-002）
  - QUICKLOG 按 ql-ID 条目追加不清零既有条目（CLAUDE.md 19 隔离规则）
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
