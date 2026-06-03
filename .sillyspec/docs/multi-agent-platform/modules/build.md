---
author: qinyi
created_at: 2026-06-03T09:45:00
---

# build

## 定位
项目根级别的构建配置和通用配置文件。
不负责各子项目的构建配置。

## 契约摘要
- Makefile: 定义常用构建命令快捷方式
- .editorconfig: 统一编辑器格式规范
- .gitignore: Git 忽略规则

## 关键逻辑
```
Makefile 提供: make up / make down / make test 等快捷命令
.editorconfig 确保: 缩进、换行符等跨编辑器一致
.gitignore 排除: node_modules, .env, __pycache__, .next 等
```

## 注意事项
- 修改 Makefile 前确认目标命令在所有环境可用
- .gitignore 修改需注意不要忽略必要的配置文件

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
