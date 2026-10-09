---
id: task-04
title: '前端创建弹窗两步状态机与自动初始化（initDispatch 串行 + 2s 轮询 + 三态 UI + 失败不回滚 + 卸载清理）+ 四用例（components/workspace-scan-dialog.tsx / components/__tests__/workspace-scan-dialog.test.tsx）'
title_zh: '前端创建弹窗两步状态机与自动初始化（initDispatch 串行 + 2s 轮询 + 三态 UI + 失败不回滚 + 卸载清理）+ 四用例（components/workspace-scan-dialog.tsx / components/__tests__/workspace-scan-dialog.test.tsx）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-09 10:21:23
priority: P0
depends_on: ['task-03']
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-003@v1, D-005@v1]
allowed_paths:
  - frontend/src/components/workspace-scan-dialog.tsx
  - frontend/src/components/__tests__/workspace-scan-dialog.test.tsx
target_files:
  - frontend/src/components/workspace-scan-dialog.tsx
  - frontend/src/components/__tests__/workspace-scan-dialog.test.tsx
goal: >
  创建工作区成功且绑定机器后自动串行初始化：弹窗状态机 idle→creating→initializing→
  done/init_failed，展示"创建✓→初始化中→完成"进度；初始化失败不回滚创建（工作区已
  落库），明示"已创建成功、可稍后在详情页重新初始化"双出口。
implementation:
  - frontend/src/components/workspace-scan-dialog.tsx:14 Phase 类型扩展为 "idle" | "creating" | "initializing" | "done" | "init_failed"；新增 initWsId state 供轮询
  - handleCreateDaemonClient（:74-103）改造：createWorkspace 成功后不立即 onCreated()，若提交带了 daemonId（表单必选，:76 校验已保证）→ 调 initDispatch(ws.id)（frontend/src/lib/spec-workspaces.ts:174 现有封装）→ setInterval 2s 轮询 fetchMyBinding(ws.id)（frontend/src/lib/workspace-binding.ts:20）直到 init_synced_at 非空 → setPhase("done")；initDispatch 抛错或 5 分钟超时 → setPhase("init_failed")。轮询参数与清理模式对齐 frontend/src/components/workspace-config-card.tsx:206-251 handleInit（含 unmount clearInterval，useEffect return 清理 + 组件卸载守卫）
  - UI 三态（对照原型 prototype-create-init-flow.html 场景①②③）：两步进度条（Steps 组件或自绘 div：创建✓→初始化中 spinner→完成✓/失败✕）；initializing 期间禁用取消与提交；done 态「打开工作区」按钮 → onCreated()；init_failed 态 Alert（error）明示"工作区已创建成功，但初始化失败（守护进程可能离线或版本过旧），可稍后在详情页重新初始化"+「打开工作区」/「稍后手动初始化」双出口（均调 onCreated()）
  - 未传 daemonId 防御分支：跳过初始化走现状完成路径（notify + onCreated）
  - 测试 frontend/src/components/__tests__/workspace-scan-dialog.test.tsx 补四用例（mock createWorkspace/initDispatch/fetchMyBinding）：①全链路成功（init_synced_at 非空 → done 态 + 打开按钮调 onCreated）②initDispatch 拒绝/轮询超时（fake timers 推进 5min）→ init_failed 态 + 文案含"已创建成功" + 出口按钮可点 ③未绑 daemon（mock 返回无 daemon_id 场景或直接测防御分支）→ 不调 initDispatch 直接完成 ④卸载清理（unmount 后轮询不再 setState，无 act 警告）
acceptance:
  - 创建+初始化全链路：弹窗依次经历 creating→initializing→done，完成态有「打开工作区」
  - 初始化失败/超时：弹窗 init_failed 态文案明示"工作区已创建成功"，onCreated 可达（不回滚）
  - 卸载后无轮询泄漏
verify:
  - cd frontend && pnpm vitest run src/components/__tests__/workspace-scan-dialog.test.tsx
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不改 createWorkspace/initDispatch/fetchMyBinding 的 lib 封装签名（全部复用现状）
  - 不改 onCreated/onCancel 组件契约（父组件 page.tsx 零改动）
  - 轮询节律 2s/超时 5min 与 config-card handleInit 保持一致（D-003@v1）
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
