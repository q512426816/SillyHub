---
author: hermes
created_at: 2026-06-04T15:45:00
wave: 2
depends_on: [task-02]
files:
  - scripts/migrate_scan_docs.py
---

# Task-03: 迁移已有 scan 文档到 spec_root

## 目标
将 `.sillyspec/docs/{component_key}/` 下的 scan 文档复制到各 workspace 的 spec_root 目录。

## 操作步骤
1. 创建 `scripts/migrate_scan_docs.py`
2. 脚本逻辑：
   - 连接数据库，读取 spec_workspaces + workspaces 联表
   - 对每行：
     - source_dir = `{workspace.root_path}/.sillyspec/docs/{workspace.component_key}/scan/`
     - target_dir = `{spec_root}/.sillyspec/docs/{workspace.component_key}/scan/`
     - 如果 source_dir 存在：
       - `shutil.copytree(source_dir, target_dir, dirs_exist_ok=True)`
       - 打印统计：复制了 N 个文件
     - 否则：打印跳过
3. 最终打印汇总

## 关键约束
- 幂等：`dirs_exist_ok=True` 跳过已存在文件
- 只复制 scan/ 目录（modules/、flows/ 等暂不管）
- component_key 为 None 的 workspace 跳过

## 当前 workspace 数据
```
SillyHub   → component_key=SillyHub, root_path=/Users/qinyi/sillyhub
backend    → component_key=backend, root_path=/Users/qinyi/sillyhub
frontend   → component_key=frontend, root_path=/Users/qinyi/sillyhub
```
注意：SillyHub/backend/frontend 三个 workspace 的 root_path 都指向同一个仓库，scan 文档都在 `.sillyspec/docs/` 下。

## 验证
- 脚本运行无报错
- spec_root 下有 .sillyspec/docs/{component_key}/scan/ 目录
- 文件数量与源目录一致
