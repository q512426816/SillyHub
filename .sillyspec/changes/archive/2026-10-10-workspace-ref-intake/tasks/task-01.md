---
id: task-01
title: 'extend-attachment-refs-ws-ref-functions'
title_zh: '纯函数库扩展——attachment-refs 增工作区引用类型与五函数'
author: 'WhaleFall'
generated_by: sillyspec-taskcard
created_at: 2026-10-10 13:48:40
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-02, FR-06, FR-07]
decision_ids: [D-003, D-004, D-005, D-009]
allowed_paths:
  - frontend/src/lib/attachment-refs.ts
  - frontend/src/components/daemon/__tests__/attachment-refs.test.ts
target_files: []  # 可选：本 task 计划改动的文件（对账用精确路径清单，格式见下方注释；不填保留 []）
provides:
  - contract: WsRefDesc
    fields: [kind, workspaceId, path, name, lines]
  - contract: WsRefTokenMap
    fields: [desc, token]
  - contract: buildWsRefToken
    fields: [name, lines, seq]
  - contract: allocateWsRefToken
    fields: [base, poolTokens]
  - contract: stripWsRefTokens
    fields: [value, tokens]
  - contract: substituteWsRefsForSend
    fields: [value, map]
  - contract: parseInlineRefs
    fields: [text, InlineRefPart]
goal: 扩展附件引用纯函数库，落地工作区三类引用（文件/目录/代码块）的 token 构建、并集唯一化分配、剥离、发送置换与统一历史解析，为 Wave 2/3 各消费方提供数据面契约。
implementation:
  - 新增 WsRefKind/WsRefDesc/WsRefTokenEntry/WsRefTokenMap 类型——目录引用根 path 为空串 name 为工作区根，code 类 lines 1 起始含端点，map key 约定 path（代码引用为 path 加行号段）
  - 新增 buildWsRefToken 与 allocateWsRefToken——基名为名称加行号段，poolTokens 并集内按完整显示基名取最小可用序号且不随删除重排（池口径对齐附件 inText 并集先例 frontend/src/components/daemon/session-input-bar.tsx:292-296）
  - 新增 stripWsRefTokens（逐 token 全量替换移除）与 substituteWsRefsForSend——命中置换为文件/目录/代码三类正式标记（代码引用含 L起-L止 行号段），孤儿 token 原样保留，空 map 原样返回
  - 新增 parseInlineRefs 统一解析附件与三类标记拆 text/ref 段，parseInlineAttRefs 保留为兼容薄封装；正则显式覆盖目录空 path 尾段并声明路径含竖线或右括号时的匹配边界
  - 扩展 frontend/src/components/daemon/__tests__/attachment-refs.test.ts——并集分配（同名 ·2/异基名免序号）、三类置换、三类解析、孤儿降级用例
acceptance:
  - 撞池同名加 ·2 且异基名或异行号段免序号，三类置换标记逐字正确且孤儿 token 与既有附件 token 互不误伤，parseInlineRefs 对纯文本产出单 text 段，既有附件五函数（frontend/src/lib/attachment-refs.ts:25-106）签名行为零变动且原用例全绿
verify:
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__/attachment-refs.test.ts
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 后端零改动（0 端点 0 schema 0 存储），引用为正文文本协议随消息透传（D-004）
  - 指向语义——置换产物只含路径与行号，不嵌选中文本快照（D-003）
  - 扩展既有库而非新建独立库（D-009），既有附件函数签名不动；token 纯文本无 emoji
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
