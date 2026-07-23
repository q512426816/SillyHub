---
id: task-01
title: Remove mode selection and hardcode team mode
title_zh: 删除模式选择，固定团队模式
author: qinyi
created_at: 2026-07-14 10:34:25
priority: P0
depends_on: []
blocks: [task-02, task-04]
requirement_ids: [FR-2, FR-5]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/components/mission-console.tsx
goal: |
  删除 mission-console.tsx 中的 single/team 模式选择（ModeCard / mode state / if (mode === "team") 分支），前端固定 team 模式，onCreate 无条件传 mode="team" + main_agent_config（默认值）+ worker_preset（默认空数组），启动按钮文案统一为「启动」。
implementation:
  - 删除 ModeCard 组件定义（mission-console.tsx:334-393）及相关导入。
  - 删除 MissionConsole 中的 mode state（mission-console.tsx:601 `const [mode, setMode] = useState<"single" | "team">("single");`）。
  - 删除创建表单中的「模式选择」整块（mission-console.tsx:750-773 的 ModeCard grid 容器与 label）。
  - onCreate 中无条件构造 payload：mode 固定 "team"，始终带 main_agent_config（默认 DEFAULT_MAIN_AGENT_CONFIG）+ worker_preset（默认 []）；删除 `if (mode === "team")` 分支（mission-console.tsx:663-666）。
  - onCreate 成功后删除 `setMode("single")` 重置（mission-console.tsx:673），workers 重置改为空数组 []（配合 task-04）。
  - 启动按钮文案（mission-console.tsx:807）从 `mode === "team" ? "👥 启动团队" : "启动团队"` 改为固定「启动」。
  - 保留 setMainAgentConfig / setWorkers state 本身（task-04 继续用）。
acceptance:
  - mission-console.tsx 中不存在 ModeCard 组件、mode state、setMode 调用。
  - grep 搜索 `mode === "team"` / `ModeCard` / `setMode` 在 mission-console.tsx 中零命中。
  - onCreate 构造的 payload 始终含 mode: "team" + main_agent_config + worker_preset，与是否展开高级配置无关。
  - 启动按钮文案为「启动」（busy 态为「规划中…」）。
  - 后端 createMission 链路无改动，mode="team" 走现有 OrchestratorService。
verify:
  - cd frontend && pnpm typecheck
  - cd frontend && pnpm test
constraints:
  - 后端零改动（mode single 分支保留为零回归兜底，仅前端不暴露）。
  - 不破坏现有 mission 创建链路（createMission 调用契约、字段名、类型不变）。
  - 文案统一中文，按钮文案不出现 "team"/"团队"/"single" 露出。
  - DEFAULT_MAIN_AGENT_CONFIG（claude_code + claude + claude-sonnet-4-6）保留作为默认值。
  - 类型 CreateMissionInput / MainAgentConfig / WorkerPresetItem 不变。
---
