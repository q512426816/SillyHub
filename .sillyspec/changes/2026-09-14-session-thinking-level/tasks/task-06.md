---
id: task-06
title: '前端（两 API+创建下拉静态镜像+会话切换控件+caps/空闲门控）+vitest'
title_zh: '前端（两 API+创建下拉静态镜像+会话切换控件+caps/空闲门控）+vitest'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-15 00:48:35
priority: P0
depends_on: ['task-01', 'task-05']
blocks: []
requirement_ids: [FR-06]
decision_ids: [D-001@v1, D-002@v1]
allowed_paths:
  - frontend/src/lib/daemon/sessions.ts
  - frontend/src/components/sessions/session-config-bar.tsx
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
  - frontend/src/components/sessions/__tests__/session-config-bar.test.tsx
  - frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx
target_files:
  - frontend/src/lib/daemon/sessions.ts
  - frontend/src/components/sessions/session-config-bar.tsx
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
  - frontend/src/components/sessions/__tests__/session-config-bar.test.tsx
  - frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx
expects_from:
  task-01:
    - contract: ProviderCaps
      needs: [thinking_level]
  task-05:
    - contract: thinking-level 两端点+DTO
      needs: [SessionThinkingLevelsResponse, SessionThinkingLevelRequest, SessionThinkingLevelResponse, api-types 产物]
goal: >
  前端双控件闭环（FR-06，照 compact task-06 门控模式）：sessions.ts 两 API 客户端+
  session-config-bar 档位下拉（预会话静态七档镜像 THINKING_LEVELS 前端 mirror，off 显示
  「默认」+跨引擎语义差异 tooltip，P2-11）+session-panel-page preThinkingLevel 暂存随首句
  上送+会话态切换控件（GET 动态档位+current 现值+running 禁用+切换成功通知+react-query
  invalidate，R-04）+vitest（测试落点按 P1-3 既有测试归属）。
implementation:
  - 'sessions.ts 加两 API——getSessionThinkingLevels(sessionId): Promise<SessionThinkingLevelsResponse>（GET /api/daemon/sessions/{sessionId}/thinking-levels）与 setSessionThinkingLevel(sessionId, level): Promise<SessionThinkingLevelResponse>（POST /api/daemon/sessions/{sessionId}/thinking-level，body SessionThinkingLevelRequest），类型一律用 task-05 gen:types 产物，照同文件既有会话 API 客户端形态'
  - 'session-config-bar.tsx 档位下拉（模型下拉邻位）——getProviderCaps(provider).thinking_level 门控渲染；预会话态用静态七档镜像（THINKING_LEVELS 前端 mirror 常量，Grill P0-2 定案：无会话 id 可查动态档，非 per-model；引擎不支持的档由 daemon 降级规则兜底）；off 选项显示「默认」+tooltip 说明跨引擎语义差异（claude=不设=引擎默认思考通常开/pi=真关，P2-11，口径同 task-02 注释）；模型变更联动档位重置（清空选择）；选中值经 onThinkingLevelChange 回调上抛（照既有 onModelChange 形态）'
  - 'session-panel-page.tsx——① preThinkingLevel 暂存 state（preModelId 同款模式），createSession body 上送（:2117 ...(preModelId ? { model: preModelId } : {}) 邻位加 ...(preThinkingLevel ? { thinking_level: preThinkingLevel } : {})）② 会话态配置条档位切换控件（SessionConfigSwitchField 邻位或独立 Select——照模型切换控件形态）：caps 门控+react-query 拉 getSessionThinkingLevels 动态档位与 current 现值显示+turn running 禁用+切换调 setSessionThinkingLevel：成功通知（「思考级别已切换为 {label}」）+invalidate 档位查询 refetch（R-04 查询刷新）；失败 notify error 带响应 error 原文（如「daemon 未支持思考级别，请升级 daemon」）'
  - '测试落点（P1-3 既有测试归属）——session-config-bar.test.tsx：档位下拉 caps=false 不渲染/七档静态镜像渲染/off 显示「默认」/模型变重置/onThinkingLevelChange 回调上抛；会话态控件测试落 ctx-usage-bar.test.tsx 或独立文件（照 compact task-06 测试先例定夺）：GET 数据渲染档位/current 现值/running 禁用/切换调用+成功通知+invalidate'
acceptance:
  - caps.thinking_level=false（cursor/unknown）创建下拉与会话控件均不渲染；预会话下拉为静态七档镜像、off 显示「默认」带语义差异 tooltip
  - 创建链：选档后 createSession body 带 thinking_level；模型变更后档位选择重置
  - 会话态：动态档位列表+current 现值显示、turn running 禁用、切换成功通知+react-query invalidate 刷新现值、失败通知带 error 原文
  - api-types 只用 gen:types 产物不手写；vitest（两测试文件）+tsc+eslint 绿
verify:
  - pnpm -C frontend exec vitest run src/components/sessions/__tests__/session-config-bar.test.tsx
  - pnpm -C frontend exec vitest run src/components/sessions/__tests__/ctx-usage-bar.test.tsx
  - pnpm -C frontend exec tsc --noEmit
  - pnpm -C frontend exec eslint src/lib/daemon/sessions.ts src/components/sessions/session-config-bar.tsx src/components/daemon/session-panel/session-panel-page.tsx
constraints:
  - 类型只用 task-05 gen:types 产物禁手写 api-types；预会话静态七档镜像常量注释与 daemon THINKING_LEVELS 同源互指（改档位两侧同步）
  - off tooltip 文案与 design P2-11/task-02 注释口径一致（claude=不设=引擎默认思考通常开/pi=真关）；antd 组件色经 ConfigProvider token 不手写（多主题铁律，brand-* 语义阶）；文案中文
  - 不动既有模型/provider 级联链行为（档位重置仅清自身选择）；pi thinking_level_change 事件不透传不消费（档位现值经查询刷新，design 生命周期契约）
  - Windows / Linux / macOS 兼容
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
