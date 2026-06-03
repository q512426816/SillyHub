---
author: qinyi
created_at: 2026-06-03T20:35:00+08:00
---

# CONCERNS.md — 已知问题、技术债、风险点

## 当前风险

### 高优先级

| 风险 | 影响 | 状态 | 缓解措施 |
|------|------|------|----------|
| Claude Code 版本锁定风险 | 2.1.158 版本可能过期或功能变更 | 活跃 | deploy/.env 中 CLAUDE_CODE_VERSION 可调整，Docker 构建时注入 |
| 智谱 API 稳定性 | Agent 执行可能超时或限流 | 活跃 | API_TIMEOUT_MS=3000000（50 分钟）+ 重试策略 |
| 宿主机路径映射差异 | 不同环境（Windows/Linux/macOS）部署困难 | 活跃 | HOST_PATH_PREFIX / CONTAINER_PATH_PREFIX 环境变量配置，默认 Windows 路径 |
| 单点部署无 HA | 服务器宕机全站不可用 | 已知 | 初期可接受（单机 Docker Compose），后续可迁移 K8s |
| branch protection 未强制 | 直接 push main 未被 GitHub 层面阻止 | 待修复 | 需在 GitHub Settings 中配置 branch protection rules |

### 中优先级

| 风险 | 影响                                          | 状态 | 缓解措施 |
|------|---------------------------------------------|------|----------|
| 测试覆盖率偏低（60%） | 回归风险较高                                      | 改进中 | 逐步提升阈值，目标 80% |
| E2E 测试缺失 | 全链路回归依赖人工                                   | 待建设 | Playwright 集成预留 |
| Claude Code 单 Agent 限制 | 仅支持 Claude Code，无法使用其他 LLM                  | 已知 | Adapter 抽象层已预留扩展点 |
| 凭据安全 | PAT 内存使用后是否彻底清除                             | 已缓解 | libsodium 加密存储 + 代码审查 + 日志脱敏 |
| 多身份场景未完善 | 同用户多 Git 身份的切换和管理行为                         | 待增强 | git_identity 模块待完善 |
| SillySpec CLI 版本 | Docker 构建使用 3.14.1，但 .env.example 写 3.14.1 | 注意 | 版本不一致需统一 |

### 低优先级

| 风险 | 影响 | 状态 | 缓解措施 |
|------|------|------|----------|
| Windows 兼容性 | asyncpg 安装和路径问题 | 已知 | 文档说明 + Docker fallback |
| OpenTelemetry 未启用 | 无法观测生产性能 | 预留 | OTEL_ENDPOINT 配置就绪，SDK 已集成 |
| frp 隧道单点 | 公网暴露依赖 frp 稳定性 | 已知 | 足够初期使用 |
| ruff vs mypy 冲突 | UP037 规则在 ruff 和 mypy 间有 forward-ref 冲突 | 已处理 | 全局忽略 UP037 |

## 技术债务

### 已知债务

- **Agent 仅 Claude Code**：Adapter 层已抽象，但仅实现 Claude Code 适配器。GPT/Cursor 等待扩展。
- **变更工作流 FSM 待完善**：10 阶段状态机已实现基础转换，但阶段间的自动推进逻辑（Agent 触发条件）仍在迭代。
- **前端页面骨架**：大量路由页面（workspace/changes/agent/knowledge 等 20+ 页面）已创建，但内容填充和交互完善仍在进行。
- **SillySpec CLI 版本依赖**：扫描和变更管理依赖 `sillyspec` CLI，版本锁定在 Dockerfile 和 .env 中。
- **测试金字塔倒挂**：单元测试覆盖不足，过多依赖集成测试。
- **模块测试覆盖不均衡**：23 个后端模块中仅 4 个有独立测试目录（agent, change, change_writer, workspace）。
- **前端测试薄弱**：仅 3 个 lib 层测试文件，组件和页面测试缺失。

### 架构债务

- **无消息队列**：Agent 任务调度直接 subprocess，缺乏队列和重试机制。Redis 可作为后续消息层。
- **无 WebSocket**：实时日志当前通过 SSE，长连接场景可能不足。
- **无水平扩展设计**：单实例部署，session 和状态未考虑多实例。
- **数据库迁移前置**：容器启动时 `alembic upgrade head`，无回滚机制。
- **API 文档待完善**：FastAPI 自动生成的 OpenAPI 文档可用，但缺乏业务语义描述。
- **无 rate limiting**：API 未实现请求限流。

## 安全关注

### 凭据管理

- SECRET_KEY、SILLYSPEC_MASTER_KEY、ANTHROPIC_AUTH_TOKEN 为核心敏感配置
- 通过 `.env` 文件管理，不提交代码（.gitignore 覆盖）
- Git Identity PAT 使用 libsodium secretbox 加密存储
- 解密后 token 仅在内存中使用，日志脱敏
- Auth 引导程序：PLATFORM_BOOTSTRAP_ADMIN_* 环境变量创建初始管理员

### Git 操作安全

- 白名单操作，拒绝危险命令（--force、--hard、clean）
- Shell 注入防护（扫描管道、命令替换、链式执行）
- 受保护分支 push 拒绝（main/master）
- 全量审计日志（GitOperationLog 表）
- 输出脱敏（PAT/Bearer token 自动遮蔽）

### 认证安全

- JWT token 认证（python-jose + passlib bcrypt）
- RBAC 角色体系（admin/member/viewer）
- CORS 白名单限制
- x-request-id 请求追踪

## 路线图

### V1（当前阶段 — 功能完善）

- [x] V0 Spikes 验证通过（3/3 PASS）
- [x] 核心模块实现（23 个模块）
- [x] 基础前端 UI（20+ 路由页面）
- [x] CI/CD 流水线（backend-ci + frontend-ci）
- [x] Docker Compose 全栈部署
- [x] 认证和 RBAC
- [x] Git 操作审计网关
- [x] Agent SSE 流式日志
- [ ] Agent 调度深度集成（stage-driven dispatch）
- [ ] 变更工作流完善（FSM 自动推进）
- [ ] 前端交互完善
- [ ] 测试覆盖率提升

### V2（稳定性提升）

- Playwright E2E 测试集成
- 测试覆盖率 >= 80%
- 消息队列引入（Agent 任务队列化）
- WebSocket 实时通信
- 多 Agent 支持（GPT Adapter）
- 性能优化和监控启用（OpenTelemetry -> Grafana）
- API rate limiting
- branch protection 强制

### V3（规模化）

- 多实例部署支持
- K8s 编排
- 多租户隔离增强
- 工作空间配额和资源限制
- 审计日志持久化和检索

### 长期愿景

- Agent 市场化（可插拔 Agent 适配器）
- SillySpec 规范生态扩展
- 插件系统
- 多语言 SDK

## 变更历史概览

项目已完成的 SillySpec 变更包（`.sillyspec/changes/archive/`）：

| 日期 | 变更 | 要点 |
|------|------|------|
| 2026-05-25 | multi-agent-platform-bootstrap-v2 | 项目引导（16 个参考文档 + 16 个任务） |
| 2026-05-27 | platform-native-sillyspec | SillySpec 原生支持 |
| 2026-05-28 | component-as-workspace | 组件即工作空间 |
| 2026-05-28 | agent-log-streaming | Agent 日志实时流 |
| 2026-05-29 | workspace-intake-spec-bootstrap | 工作空间接入规范 |
| 2026-05-29 | knowledge-lifecycle | 知识库生命周期 |
| 2026-05-29 | harness-control-plane | Agent 控制面 |
| 2026-05-29 | server-sandbox-runner | 服务端沙箱执行器 |
| 2026-05-29 | local-runner-execution-loop | 本地执行循环 |
| 2026-05-30 | workflow-state-machine | 工作流状态机 |
| 2026-05-30 | change-writer | 变更文档生成器 |
| 2026-05-30 | tool-gateway | 工具网关 |
| 2026-05-30 | agent-adapter | Agent 适配器 |
| 2026-05-30 | execution-coordinator | 执行协调器 |

活跃变更（`.sillyspec/changes/` 非 archive）：
- stage-driven-agent-dispatch
- change-workflow-engine
- change-center-redesign
- spec-bootstrap-agent-stream-interaction
- sse-reliable-stream

## 关键决策记录

| 决策 | 背景 | 结论 |
|------|------|------|
| monorepo vs 多仓库 | 子项目紧密耦合 | monorepo，共享 Git 和 SillySpec |
| Claude Code 首发适配 | Agent 生态初期 | 仅 Claude Code，Adapter 层预留扩展 |
| subprocess vs SDK | Claude Code 集成方式 | subprocess，更贴近 CLI 模式 |
| Docker Compose vs K8s | 部署复杂度 | Compose 单机起步，后续可迁移 |
| 文件系统 + DB 双写 | SillySpec 文档管理 | 文件系统为主，DB 为查询加速 |
| 白名单 Git 操作 | 安全模型 | 安全默认，最小权限 |
| 智谱 API 代理 | LLM 服务 | 使用 Anthropic 兼容接口，降低迁移成本 |
| Next.js standalone | 前端部署 | 最小化 Docker 镜像，无需 node_modules |
