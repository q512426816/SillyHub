---
id: task-04
title: 'PiRpcDriver.compact()（_sendCommand+回执+10s 超时）+ 测试'
title_zh: 'PiRpcDriver.compact()（_sendCommand+回执+10s 超时）+ 测试'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-14 11:03:19
priority: P0
depends_on: ['task-03']
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-003@v3]
allowed_paths:
  - sillyhub-daemon/src/interactive/pi-rpc-driver.ts
  - sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts
target_files:
  - sillyhub-daemon/src/interactive/pi-rpc-driver.ts
  - sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts
provides:
  - contract: PiRpcDriver.compact
    fields: [回执字段名实证结论]
expects_from:
  task-03:
    - contract: InteractiveDriver.compact
      needs: [CompactResult]
goal: >
  PiRpcDriver 实现可选契约 compact()：复用现成 _sendCommand 命令-响应通道（:1732-1769）发
  {"type":"compact"} 并等 response，把 pi 结构化回执（tokensBefore/estimatedTokensAfter）
  映射进 CompactResult，10s 超时降级为 error 结果不上抛（FR-04，回执经 task-03 RPC 链回传
  backend）。
implementation:
  - 'pi-rpc-driver.ts 实现 compact(handle)——this._sendCommand(h, { type: "compact" }, 10_000) 等 response（stdin 独立写行 + id→h.pending 关联现成；空闲态 consume 停在 inputIt.next()（:1444）时命令 response 照常 resolve，interrupt()/get_state 即同款先例——Grill X-b 实核可行）'
  - '回执映射——response.data（pi docs/rpc.md:374-411 结构化回执）取 tokensBefore/estimatedTokensAfter（number 才挂键）→ { ok: true, tokensBefore, estimatedTokensAfter }；引擎侧错误响应 → { ok: false, error: 原文 }（如 "Nothing to compact" 原样透传给前端通知）'
  - '超时与通道异常——_sendCommand 10s timer reject（response timeout）与 write failed/stdin unavailable → 捕获映射 { ok: false, error: 超时/通道错误文案 }，promise 不上抛（RPC handler 拿到 error 结果而非异常）'
  - 'pi-rpc-driver.test.ts 断言——① 命令形态：stdin 写入 JSON 含 type="compact" 与自增 id（pi_N 形态）② 回执映射：模拟 response.data 数字 → CompactResult 数字键正确、无数字回执不挂键、错误回执原文进 error ③ 超时：fake timers 推进 10s → { ok: false, error } 非 reject'
acceptance:
  - 'compact() 命令形态断言绿（写入 stdin 的 JSON 为 { type: "compact", id: "pi_N" } 形态）'
  - 回执数字透传 CompactResult.tokensBefore/estimatedTokensAfter；无数字回执不挂键；错误回执原文进 error
  - '10s 超时返回 {ok:false,error} 而非 reject；既有 pi-rpc-driver 套件零回归 + typecheck 绿'
verify:
  - pnpm -C sillyhub-daemon exec vitest run tests/interactive/pi-rpc-driver.test.ts
  - pnpm -C sillyhub-daemon exec tsc --noEmit
constraints:
  - 不改 _sendCommand 本体与 h.pending 机制（只做调用方）；只等命令 response 不等 compaction_end 事件（R-02 时序降级）
  - pi-events.ts compaction_* 事件维持现状吸收不透传（NG-04）；customInstructions 通道预留不传（NG-06）
  - 回执字段名以 spike-01 真机实证为准（task-07），不符则只改 response.data 字段读取处、机制不变
  - daemon ESM 相对 import 带 .js 后缀；Windows / Linux / macOS 兼容
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
