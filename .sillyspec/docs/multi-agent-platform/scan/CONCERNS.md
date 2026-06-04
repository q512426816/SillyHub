---
author: qinyi
created_at: 2026-06-04T08:54+08:00
---

# 项目技术债务与风险关注点

## 🔴 高危关注点

### 代码质量 - 已弃用组件仍在使用
- **workflow/fsm.py**: ChangeFSM 标记为 deprecated，但仍被引用用于向后兼容
  - 影响: 状态迁移逻辑已迁移至 `app.modules.change.model.StageEnum + TRANSITIONS`
  - 风险: 混用新旧状态机可能导致不一致
  - 建议: 设定弃用时间表，强制迁移到新状态机

### 代码质量 - 未实现的关键功能
- **spec_profile/provider.py**: 多处 TODO 标记未实现功能
  - Line 76: actual discovery
  - Line 86: actual loading
  - Line 96: stage conflict detection
  - Line 97: document conflict detection
- **agent/coordinator.py**: start_sillyspec_run 和 run_until_complete 方法已标记 deprecated
  - 影响: 核心协调器功能不完整，可能导致规范执行失败

### 依赖风险 - 核心依赖锁定不足
- **Claude Code CLI**: 外部进程依赖，版本未锁定在 pyproject.toml
  - 风险: CLI 行为变化可能破坏 Agent 适配器兼容性
- **libgit2 绑定**: Python Git 生态依赖（pygit2 等）版本兼容性复杂
  - Windows 上 `asyncpg` 安装问题需要文档明确 fallback 方案

## 🟡 中等关注点

### 代码质量 - 前端测试覆盖率低
- 前端仅有 `api.test.ts` 一个测试文件，组件测试几乎为空
- shadcn/ui 组件未在项目中建立测试约定
- 建议: 优先覆盖核心业务组件（workspace 列表、change 详情、task 状态）

### 代码质量 - 异常处理一致性
- Ruff 配置中 BLE001（捕获裸 Exception）被忽略
- 代码中大量 `except Exception` 可能隐藏具体错误类型
- 建议: 定义领域特定异常类（已有 AppError 基类），规范异常捕获

### 依赖风险 - 类型检查配置过于宽松
- MyPy 配置中禁用了大量错误码（attr-defined, union-arg, assignment 等）
- 降低了类型安全收益，可能埋下运行时错误
- 建议: 逐步收紧禁用列表，从新模块开始启用严格模式

## 🟢 低优关注点

### 代码质量 - 国际化与本地化
- 项目大量使用中文注释和字符串，但 RUF001/002/003 被忽略
- 未来如需支持英文界面，需要文案层重构

### 依赖风险 - 前端包管理器锁定
- package.json 指定 pnpm@9.6.0，但未在 CI 中强制执行
- 可能导致 npm/yarn 用户安装依赖失败

### 代码质量 - 文档同步
- README.md 和 .sillyspec 变更包存在内容重复
- 两处维护成本高，容易不同步
- 建议: README 仅保留快速启动，详细设计指向 sillyspec 文档

## 依赖风险汇总

| 依赖 | 风险等级 | 缓解措施 |
|------|----------|----------|
| Claude Code CLI | 高 | 锁定版本，接口适配层隔离 |
| asyncpg (Windows) | 中 | 文档明确 psycopg[binary] fallback |
| Pydantic v2 | 低 | 已锁定 >=2.8，API 稳定 |
| Next.js 14 | 低 | App Router 已稳定，锁定 14.2.5 |
| TanStack Query v5 | 低 | API 稳定，锁定 5.51.0 |
