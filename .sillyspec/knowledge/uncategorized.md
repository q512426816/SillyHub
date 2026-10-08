# 未分类知识

> 项目特定的架构经验、历史记录、尚未提炼成通用 pattern 的知识。
> 已分类的迁移到：`sillyspec-gotchas.md`（工具坑）/ `testing-gotchas.md`（测试坑）/ `patterns.md`（架构）/ `known-issues.md`（项目坑）/ `conventions.md`（约定）。
> 已修复项保留并标注状态，便于回溯。INDEX.md 不索引本文件——条目成熟后请迁出到分类文件并加 INDEX 索引。

（2026-09-28 清账：本文件原有 41 条（40 个 `##` 条目 + 1 条丢标题的 SSE 路由条目）已全部迁出到五个分类文件并在 INDEX.md 补索引，见变更 2026-09-28-knowledge-inbox-clear。当前收件箱为空，新踩坑从下方追加。）

## wt-commit 的 -- 路径分隔符被 PowerShell 5.1 吞掉——用 --pathspec-from-file

Windows PowerShell 5.1 向原生命令传参时裸 `--` 会被剥掉，`sillyspec wt-commit --change X -m "..." -- path1 path2` 报「缺少提交路径」且加引号无效。规避：路径写入临时文件后 `sillyspec wt-commit --change X -m "..." --pathspec-from-file <file>`（每行一个路径，UTF-8）。Git Bash / PowerShell 7 无此问题。（来源：2026-09-23-md-card-render task-01）

## antd v6 App.useApp() 无 <AntdApp> provider 时 message 为 undefined——组件测试须包 AntdApp

组件内 `const { message } = App.useApp()` 在无 `<App>` provider 的测试环境（testing-library 裸 render）返回的 message 是 **undefined**（antd v6 无静态 fallback），点击路径调 message.success 抛 `TypeError: message.success is not a function`。生产有全局 AntdProviders 兜住；测试 render helper 统一包 `<AntdApp>` 对齐生产。另：测试里 mock navigator.clipboard 勿用裸 `Object.defineProperty`（默认 writable:false 会把属性锁死，污染后续用例的 Object.assign 赋值——configurable+writable 都给 true）。（来源：2026-09-23-md-card-render task-02）
