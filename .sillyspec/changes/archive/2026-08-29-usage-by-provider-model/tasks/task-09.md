---
id: task-09
title: 'session-config-bar 四块→两块（删机器/智能体块与无用 hook，布局收缩）'
title_zh: 'session-config-bar 四块→两块（删机器/智能体块与无用 hook，布局收缩）'
author: 'qinyi'
created_at: 2026-08-29 02:52:55
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-03-1]
decision_ids: [D-004@v1]
allowed_paths:
  - frontend/src/components/sessions/session-config-bar.tsx
  - frontend/src/components/sessions/__tests__/session-config-bar.test.tsx
goal: >
  session-config-bar 四块→两块：删除机器/智能体 Ctrl 与机器相关 hook 依赖（useDaemonMachines 本组件调用若无他处引用移除），布局自然收缩。
implementation:
  - 删 SessionConfigCtrlKind 的 machine/agent 分支与渲染块
  - 清理仅服务已删块的 props/解析逻辑（machineHit/agentName 等）
  - 快照测试/组件测试同步修剪
acceptance:
  - 配置条只渲染供应商+档案两块
  - 既有供应商/档案切换用例零回归
  - pre-session-picker 不受影响
verify:
  - cd frontend && pnpm exec vitest run src/components/sessions/__tests__/session-config-bar
constraints:
  - 不动供应商/档案切换逻辑本体；共享 hook（useActiveSharedAgents 档案标识）保留
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
