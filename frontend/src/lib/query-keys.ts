/**
 * 集中 react-query key 工厂（D-004@v1）。
 *
 * hook 的 useQuery 与后续 mutation 的 invalidate/setQueryData 共用同一组 key，
 * 避免「key 拼错 → 静默去重到不存在的缓存」的坑，也留出唯一演进 key 结构的入口。
 *
 * 规则：凡影响查询结果的变量都进 key。daemon runtimes 的完整过滤/分页 params
 * 进 key，params 变化即产生新查询（react-query 自动停旧启新，最新胜出）。
 */
import type {
  DaemonMachineListParams,
  DaemonRuntimeListParams,
} from "@/lib/daemon";

export const queryKeys = {
  agentRuns: {
    all: ["agentRuns"] as const,
    list: (workspaceId: string) => ["agentRuns", "list", workspaceId] as const,
  },
  daemonRuntimes: {
    all: ["daemonRuntimes"] as const,
    list: (params: DaemonRuntimeListParams) =>
      ["daemonRuntimes", "list", params] as const,
  },
  // 2026-07-07-daemon-machine-runtime-hierarchy task-05：machine 级列表缓存 key。
  // 与 daemonRuntimes 同构（params 进 key，过滤/分页变化即新查询）。
  daemonMachines: {
    all: ["daemonMachines"] as const,
    list: (params: DaemonMachineListParams) =>
      ["daemonMachines", "list", params] as const,
  },
  // 2026-07-04-daemon-version-management task-09：daemon 分发元数据
  //（最新版本号 + build_id），runtimes 页用于卡片版本徽标比对。
  daemonVersion: {
    all: ["daemonVersion"] as const,
  },
  // 2026-07-07-skills-mcp-management-ui task-10：workspace 详情只读 skills / .mcp.json 视图。
  // 两个独立查询（不同端点、不同失效节奏），按 workspaceId 分桶。
  workspaceSkillsView: {
    all: ["workspaceSkillsView"] as const,
    detail: (workspaceId: string) =>
      ["workspaceSkillsView", "detail", workspaceId] as const,
  },
  // 2026-08-26-workspace-skill-edit task-05：skill 单文件内容（编辑器查询缓存键）。
  workspaceSkillFile: {
    detail: (workspaceId: string, skill: string, path: string) =>
      ["workspaceSkillFile", "detail", workspaceId, skill, path] as const,
  },
  workspaceMcpConfig: {
    all: ["workspaceMcpConfig"] as const,
    detail: (workspaceId: string) =>
      ["workspaceMcpConfig", "detail", workspaceId] as const,
  },
  // 2026-07-07-skills-mcp-management-ui task-08：自定义 skills CRUD + 平台
  // skills manifest（只读）。customSkills.all = 列表缓存；manifest = 平台
  // sillyspec skills 分发清单（version + files）。mutation 双 invalidate
  // 因为 DB 自定义 skill 内容会进 manifest version hash（design §5.1）。
  customSkills: {
    all: ["customSkills"] as const,
    manifest: ["customSkills", "manifest"] as const,
    // 2026-08-05-skill-content-viewer task-05：单个平台 skill 的 SKILL.md 内容缓存。
    // 参数化（按 skill_name 区分），避免不同 skill 缓存串。
    content: (name: string) => ["customSkills", "content", name] as const,
  },
  // 2026-07-07-skills-mcp-management-ui task-09：MCP 平台默认配置（admin GET
    // 遮蔽 env secret）+ 白名单（server 名列表）。两个独立端点，独立缓存。
  mcpSettings: {
    config: ["mcpSettings", "config"] as const,
    whitelist: ["mcpSettings", "whitelist"] as const,
  },
  // 2026-08-23-platform-agent-log-ingest task-04：本地 agent 日志列表缓存 key
  //（components/daemon/agent-log-card.tsx 轮询消费）。sessionId 进 key
  //（影响查询结果的全部变量，本文件头规则）；2026-08-23-agent-activity-sessions
  // task-07 会话化：入参从 workspaceId 改 sessionId（D-004：workspace 级旧
  // 挂载移除，列表只按会话关联拉取）。undefined/null 归一 null，避免可选参数
  // 产生两个分叉键。刷新按钮 invalidate all。
  agentLogs: {
    all: ["agentLogs"] as const,
    list: (sessionId?: string) => ["agentLogs", "list", sessionId ?? null] as const,
  },
  // 2026-08-26-session-input-mention task-04：会话输入联想 @ 数据源缓存键。
  // 变更（location=active）与快速修复两路独立查询按 workspaceId 分桶；
  // wid 归一 null（workspaceId 为空时查询禁用但 key 稳定，不产生分叉键）。
  // / 技能源复用 customSkills.manifest 既有键，不在此重复登记。
  mentionSources: {
    all: ["mentionSources"] as const,
    changes: (wid: string | null) => ["mentionSources", "changes", wid] as const,
    quicklogs: (wid: string | null) => ["mentionSources", "quicklogs", wid] as const,
  },
} as const;
