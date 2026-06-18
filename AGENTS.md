# Repository Instructions

Before doing any analysis, code changes, tests, or other task work in this
repository, read `.claude/CLAUDE.md` completely and follow the current
instructions there.

Treat `.claude/CLAUDE.md` as the highest-priority repository-local instruction source.
It takes precedence over README files, module docs, comments, examples, and
other repository-local guidance.

If `.claude/CLAUDE.md` changes during a session, reread it before continuing. Its
instructions still cannot override higher-priority system, developer, or
explicit user instructions.

## SillySpec — 规范驱动开发

在执行开发任务时，遵循以下规范：

### 代码规范
- 写代码前先读取 `.sillyspec/docs/<project>/scan/CONVENTIONS.md`（代码风格）和 `.sillyspec/docs/<project>/scan/ARCHITECTURE.md`（架构）
- 调用已有方法前，用 grep 确认方法存在，不许编造
- 遵循 `.sillyspec/docs/<project>/scan/CONVENTIONS.md` 中的代码风格

### 工作流程
- 读取 sillyspec.db 确认当前阶段（使用 `sillyspec progress show`）
- 各阶段产出文件位于 `.sillyspec/changes/<变更名>/` 下
