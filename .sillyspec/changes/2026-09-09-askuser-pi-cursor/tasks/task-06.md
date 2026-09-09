---
id: task-06
title: 'frontend-askuser-marker-parser'
title_zh: '前端 askuser-marker 解析器（宽容边界清单）+ 单测'
author: 'qinyi'
created_at: 2026-09-09 23:09:21
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-003@v2]
allowed_paths:
  - frontend/src/lib/askuser-marker.ts
  - frontend/src/lib/__tests__/askuser-marker.test.ts
target_files:
  - NEW:frontend/src/lib/askuser-marker.ts
  - NEW:frontend/src/lib/__tests__/askuser-marker.test.ts
provides:
  - contract: parseAskUserMarker
    fields: [parseAskUserMarker, AskUserMarkerPayload]
goal: >
  新增纯前端 askuser 标记解析器：把消息尾部 ```askuser fenced JSON 块宽容解析为 marker 提问载荷，非法输入一律返回 null 降级为普通文本，为 cursor 提问卡（task-07/11）提供统一解析契约；标记即数据，原文不剥离。
implementation:
  - '新建 frontend/src/lib/askuser-marker.ts：导出 AskUserMarkerPayload（kind 取 select/confirm/input/editor；question 必填 string；options 为 label 对象数组可选；allowCustom/recommendResponders 可选）与 parseAskUserMarker(text) 返回 { payload, textBefore } 或 null（textBefore 为剥离标记块后的正文）'
  - '宽容边界清单（design §Wave B.2 全量落实）：仅扫描文本尾部 8KB 窗口，标记出现在文本中部不认；围栏语言标注仅认 ```askuser（```json 等其它标注不吞）；JSON 单行/多行均可；容忍尾随空白与换行；载荷超过 4KB 拒；非法 JSON 或必填 kind/question 缺失一律返回 null'
  - 防御性字段校验：options 条目 label 非空 string 否则丢弃该条；allowCustom/recommendResponders 类型不符时忽略该字段不整体拒收；任何输入不抛异常
  - '新建 frontend/src/lib/__tests__/askuser-marker.test.ts 正反例：合法（单行/多行 JSON、尾随空白、askuser 语言标注、textBefore 保留标记前正文）；非法（坏 JSON、缺 kind/question、超过 4KB、标记在中部、其它语言标注、裸 JSON 无围栏）'
acceptance:
  - 全部合法形态正确返回 payload 与 textBefore；全部非法形态返回 null 且无异常（降级为普通文本由渲染层兜底）
  - 纯函数、无 DOM/网络/后端依赖（spike 不达标时协议资产仍保留不删）
verify:
  - cd frontend && pnpm vitest run src/lib/__tests__/askuser-marker.test.ts
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 解析器只读不写（标记随文本原样持久化，哲学对齐 runtime-session-helpers.tsx parseAttachmentMarkers L532 先例）
  - 本任务不做任何 UI 渲染与时间线接入（归 task-07）；不依赖 api-types 与后端接口
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
