---
author: qinyi
created_at: 2026-07-05 02:00:00
---

# 测试坑 (testing-gotchas)

> 后端 pytest + 前端 vitest/React Testing Library 踩过的坑。

## 后端：pytest patch 函数内局部导入的目标

被测函数内部用 `from app.core.db import get_session_factory`（函数级局部导入）时，`patch("app.modules.agent.service.get_session_factory")` 会报 `AttributeError: module does not have the attribute`，因为该名字从未绑定到 service 模块命名空间。

- 正确做法：patch 源头模块属性 `app.core.db.get_session_factory`。局部导入每次执行时从源模块取属性，patch 源头才能拦截。
- 同理适用于任何「函数内 import」的 mock。模块级 import 才 patch 使用方模块。

## 后端：无本地 venv 时在 Docker 后端容器跑 pytest

- 本机只有 Windows Store 的 python stub（exit 49 不执行），项目走 Docker 部署无 venv。
- 主机项目盘挂载在后端容器 `/host-projects`，git worktree 可经 `/host-projects/.../multi-agent-platform/.sillyspec/.runtime/worktrees/<change>` 访问。
- 生产镜像 venv 缺 pytest，但 `pip install pytest` 装到 `~/.local`(user-site)，venv python 默认不加载；运行时 `sys.path.insert(0, site.getusersitepackages())` 后 `pytest.main()` 即可。
- 用 `PYTHONPATH=<worktree>/backend` 让测试 import 命中 worktree 改动代码，不污染容器 /app（镜像层）。
- 验证回归：在 `/host-projects/.../backend`(main) 上跑同样测试对比，区分预存失败与本次引入的回归。

## 前端：MENU_PERMISSION_GROUPS 跨 menu 重复 permission.key 致 queryByLabelText 失败

当 MENU_PERMISSION_GROUPS 中同一个 permission.key 出现在多个 menu（如 `user:read` 在 `git-identities`/`users`/`settings` 三处），picker 三级渲染会为每个出现位置生成一个独立 checkbox，aria-label={p.key} 在 DOM 中重复。

- 后果：React Testing Library 的 `screen.queryByLabelText("user:read")` 抛 `getMultipleElementsFoundError`。
- 规避（不修改 picker 实现，仅调整测试）：
  - 全局计数断言：`screen.getAllByLabelText("user:read").length` 折叠某 menu 前后比较。
  - 容器内查询：`within(menuContainer).getByLabelText(p.key)`，先通过 menu label 文本定位容器。
  - 单 menu 单 key 校验：选 only-once 的 key 做断言（如 `organization:read` 只在 organizations menu 出现）。

## 前端：antd v5 DatePicker 周几/日历表头显示英文，仅 ConfigProvider locale 不够

- 现象：DatePicker 日历表头星期显示英文（Su/Mo/Tu…），即便已配 `ConfigProvider locale={zhCN}`。
- 根因：antd v5 DatePicker 内部用 dayjs 渲染日历表头，这些取自 **dayjs 全局 locale**，而非 antd ConfigProvider 的 locale。`ConfigProvider locale={zhCN}` 只影响 antd 自有文案（「今天」按钮、placeholder），管不到日历表头星期。
- 修复：补 `import 'dayjs/locale/zh-cn'; dayjs.locale('zh-cn');`，与 ConfigProvider locale 双保险。
- 通用坑：antd v5 全家桶（DatePicker / RangePicker / Calendar / TimePicker）的日历本地化 = `ConfigProvider locale`（antd 文案）+ `dayjs.locale`（日历表头/月份）**缺一不可**。

## 前端：antd v5 两字中文按钮 autoLetterSpacing 致 DOM 字间空格（getByRole 匹配失败）

- 现象：antd v5 `Modal.confirm({ okText: "移除", cancelText: "取消" })` 的两字中文按钮，DOM 渲染为 `<span>移 除</span>`（字间插空格，autoLetterSpacing 特性）。测试 `getByRole("button", { name: "移除" })` 严格匹配失败。
- 根因：antd v5 对 CJK 文本默认开启 `autoLetterSpacing`，渲染时在字符间插入空白节点，破坏 `aria-label`/name 严格匹配。
- 解法：测试用正则 `/移\s*除/` / `/取\s*消/` 兼容字间空白；或关 `autoLetterSpacing`（影响视觉一致性，不推荐）。前端测试断言中文按钮一律用 `\s*` 兼容。

## 前端：MarkdownText 用 next/dynamic ssr:false，jsdom 测试同步 render 得 null

- markdown-text.tsx 用 `next/dynamic` `ssr:false`，jsdom 测试同步 `render` 处于 loading（返回 null），assistant 文本不进 DOM 致 `getByText` 失败。
- 修法：测试文件顶部 `vi.mock` 成纯文本渲染（测父组件逻辑而非 markdown 库本身）。
- 影响组件：agent-log-viewer / interactive-session-panel / runtime-session-dialog。
