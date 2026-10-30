---
id: task-02
title: '面板 sessionStorage 持久化——stagedConfig+labels 写/恢复/清（key sh:config-staged:<sessionId>；SSR 守卫；坏 JSON 静默丢弃；档位失败残留态照写；askuser 链路零改动核对）+ 测试先行'
title_zh: '面板 sessionStorage 持久化——stagedConfig+labels 写/恢复/清（key sh:config-staged:<sessionId>；SSR 守卫；坏 JSON 静默丢弃；档位失败残留态照写；askuser 链路零改动核对）+ 测试先行'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-30 12:05:15
priority: P0
blocks: []
requirement_ids: [FR-02, FR-03, FR-04, FR-05]
decision_ids: ['D-002@v1', 'D-004@v1', 'D-005@v1', 'D-006@v1', 'D-008@v1']
allowed_paths:
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
  - frontend/src/components/daemon/__tests__/session-panel-staged-list-refresh.test.tsx
target_files:
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
  - frontend/src/components/daemon/__tests__/session-panel-staged-list-refresh.test.tsx
depends_on: ['task-01']
goal: >
  面板 stagedConfig+labels 持久化到 sessionStorage（按会话隔离，刷新恢复、发送/切会话清除、
  坏数据静默丢弃），解决暂存刷新即丢（FR-03）；发送成功清空收敛同步清存储（FR-02）；
  核对 askuser 答复链路零改动（FR-04/D-008）。
implementation:
  - 测试先行：frontend/src/components/daemon/__tests__/session-panel-staged-list-refresh.test.tsx 增用例——①暂存变更（onStagedSwitch 路径）后 sessionStorage[sh:config-staged:<sessionId>] 为 {config,labels} JSON 且随覆盖合并更新；②挂载/切会话按当前 sessionId 读条目恢复 stagedConfig+stagedLabelRef（切到会话 B 不读 A 条目、切回 A 恢复）；③settleStagedAfterSend(true) 清空时移除条目、思考档位失败保留(thinkingApplied=false)时条目写残留态 {config:{thinking_level},labels}；④坏 JSON/结构异常（config 非对象）静默丢弃且清坏条目（不抛错）；⑤SSR 场景（typeof window 守卫）不访问 sessionStorage（jsdom 下正常，代码含守卫断言）
  - 实现面板改动（frontend/src/components/daemon/session-panel/session-panel-page.tsx）：新增模块内持久化纯函数（key 生成/读/写/删，typeof window 守卫+try-catch 静默）；stagedConfig 变更 effect 写入（含 stagedLabelRef.current 快照）；现有 sessionId 切换 effect（1110-1113 行区间）改「清内存态→读当前会话条目恢复」；settleStagedAfterSend（1179-1191 行区间）按 thinkingApplied 全清/残留同步存储
  - askuser 链路零改动核对（FR-04/D-008，纯读代码）：确认 respondSessionPermission 调用点未携带配置、PendingDialogDock/AskUserDialogCard 提交路径未触及 stagedConfig、daemon 侧无改动——核对结论写进任务完成记录
  - git 提交本任务文件
acceptance:
  - session-panel-staged-list-refresh.test.tsx 新增用例全绿（写/恢复/不串台/坏数据丢弃/残留态照写）
  - 发送成功后 sessionStorage 条目移除+高亮全部消失（FR-02）；档位失败保留时条目=残留态
  - 刷新（重挂载）恢复暂存与高亮，切换会话不串台（FR-03）
  - askuser 答复链路（frontend/src/components/ask-user-dialog-card.tsx 提交、frontend/src/lib/daemon/sessions.ts:98 respondSessionPermission、sillyhub-daemon/src/interactive/session-manager/permission.ts 同轮回喂）零改动（git diff 核对，FR-04/D-008）
  - 既有用例零回归（FR-05）
verify:
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__/session-panel-staged-list-refresh.test.tsx src/components/sessions/__tests__/session-config-bar.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - sessionStorage per-tab per-session（key sh:config-staged:<sessionId>），禁止 localStorage（D-004）
  - 恢复不校验暂存值有效性（D-006，沿用发送失败重试语义）
  - 禁止动 askuser 答复链路与生效语义「随下一条消息」（D-002/D-008）
  - 坏数据静默处理禁弹错（D-005）；SSR 守卫必须有（Next 预渲染无 window）
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
