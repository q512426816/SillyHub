---
name: sillyspec:workspace
description: 工作区管理 — 初始化、管理多项目工作区，查看子项目状态
---

## 交互规范

**当需要用户从多个选项中做出选择时，必须使用 Claude Code 内置的 AskUserQuestion 工具，将选项以参数传入。** 不要用编号列表让用户手动输入数字。需要自由输入时在选项中加入"Other（自定义输入）"。

## CLI 命令（一切读写都走命令，勿手写 yaml / 勿 bash 解析）

```bash
sillyspec workspace add <名> <相对路径> [--role <角色>] [--repo <仓库地址>]   # 登记子项目（外科写入 yaml，已有字段保留；路径须存在）
sillyspec workspace remove <名>                                             # 删除登记（项目本体不动）
sillyspec workspace status                                                  # 三态探测表（未初始化/已初始化/已扫描+文档数）
```

无参运行任一子命令可见用法。`status` 的输出即成品状态表，直接转述给用户即可，勿再自行 for-loop 探测。

## 核心流程

1. **解析指令**：无参数 / `status` → 跑 `workspace status` 转述；`add` / `remove` → 交互收集参数后跑命令；`info <名>` → 读该子项目 `PROJECT.md` / `REQUIREMENTS.md` 摘要转述。
2. **初始化工作区**（`projects/` 尚无任何 yaml 且用户同意时）：用 AskUserQuestion 逐个收集子项目名称/相对路径/角色（可选 repo），每收集一个跑一次 `workspace add`；添加完询问是否继续或完成。共享规范目录 `.sillyspec/shared/` 需要时手动创建。
3. **收尾**：add/remove 后建议 git 提交（CLI 只写 yaml 不提交）；提示下一步对子项目跑 `/sillyspec:init` 或 `/sillyspec:scan`。

## 绝对规则

- 不修改子项目目录下的任何文件
- 子项目路径必须是相对于工作区根目录的相对路径，且真实存在（`workspace add` 会校验）
- yaml 读写一律交给 CLI——字段口径（name/path/status/role/repo）由命令维护，不手工拼

## 用户指令
$ARGUMENTS
