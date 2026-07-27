---
id: task-10
title: "form 加「配置 JSON」折叠区：5 开关快捷编辑 + JSON 编辑器 + 应用预设（产出 settings_config）"
title_zh: 配置JSON折叠区（5开关+编辑器+预设）
priority: P0
created_at: 2026-07-27 09:47:54
author: qinyi
depends_on: [task-11]
blocks: [task-14]
requirement_ids: [FR-07, FR-08, FR-09]
decision_ids: [D-005, D-008]
allowed_paths:
  - frontend/src/components/llm-providers/llm-provider-form.tsx
  - frontend/src/components/ui/json-editor.tsx
expects_from:
  task-11:
    - contract: LlmProviderFormValues
      needs: [settings_config]
goal: >
  在 llm-provider-form.tsx 新增「配置 JSON」折叠区（对齐既有 `<details>` 高级选项风格），5 开关 checkbox + JsonEditor + 应用通用配置预设，产出 settings_config 写进 LlmProviderFormValues。
implementation: >
  新增第二个 `<details>`（复用 line 320 dashed-border 风格，summary「配置 JSON（高级 env 覆盖上方结构化字段）」）。
  ① 5 开关 checkbox（D-008，照 cc-switch CommonConfigEditor.tsx:72-157）：隐藏 AI 署名=attribution:{commit:"",pr:""}（settings_config 顶层）/ Teammates=env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS="1" /
  Tool Search=env.ENABLE_TOOL_SEARCH="true" / 最大强度思考=env.CLAUDE_CODE_EFFORT_LEVEL="max" / 禁用自动升级=env.DISABLE_AUTOUPDATER="1"；toggle 时 JSON.parse(settings_config)→增删对应键（env 空对象则 delete env）→stringify，
  parse 失败静默不动（照 cc-switch catch）。② 新建 components/ui/json-editor.tsx（spike-03：cc-switch JsonEditor 重依赖 CodeMirror，**改自研** textarea+行号 gutter+折叠+「格式化」按钮 JSON.stringify(JSON.parse,2)）。
  ③ 「应用通用配置」按钮：浅合并预设片段 {env:{API_TIMEOUT_MS,CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC,ENABLE_TOOL_SEARCH}, enabledPlugins:{frontend-design,playwright}} 进 settings_config。
  ④ state settingsConfigJson: string（init initial?.settings_config ? JSON.stringify : "{}"）；handleSubmit 写入 values.settings_config = JSON.parse（非法→null）。
acceptance: >
  5 开关 toggle 正确增删 settings_config 对应键（含 env 空则 delete env）；格式化按钮生效；应用通用配置浅合并预设；JSON 非法输入不崩（parse 失败提示而非抛错）；settings_config 写进 form values（非法→null）。
verify: >
  cd frontend && pnpm typecheck；cd frontend && pnpm test（配置 JSON 面板：5 开关 toggle 改 JSON / 格式化 / 应用预设 / JSON 非法不崩）。
constraints: >
  对齐 cc-switch 全套（D-005）/ JsonEditor 轻量自研无重依赖（spike-03：cc-switch 用 CodeMirror 判定重，改 textarea）/ JSON 非法容错不崩（parse catch 静默，提示用户）/ UI 提示「高级 env 覆盖上方结构化字段」(D-007) / 全中文 UI / 不碰入口文件。
