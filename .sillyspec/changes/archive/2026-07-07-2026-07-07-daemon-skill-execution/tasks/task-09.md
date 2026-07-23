---
author: qinyi
created_at: 2026-07-07 13:35:00
goal: 废弃 stage prompt 模板并同步 backend/sillyhub-daemon 模块文档记录本变更注意事项
implementation: 归档/删除 backend 中 verify.md 等废弃 stage prompt 模板（task-01 已移除引用点，此处清理物理文件）；同步 docs 下 backend.md 与 sillyhub-daemon.md 模块文档，记录 stage 投递改 skill 调用 + skill 同步 + MCP 注入的注意事项（对齐 sillyspec scan 重生模块文档格式：定位/契约/逻辑/注意事项/人工备注，融入注意事项而非加变更索引）
acceptance: 废弃 stage 模板文件已归档/删除且无残留引用；backend.md/sillyhub-daemon.md 含本变更 skill 投递/skill 同步/MCP 注入的注意事项
verify: 手动 grep 确认无 verify.md 等模板残留引用；docs 模块文档肉眼核对含本变更条目；backend uv run pytest + sillyhub-daemon pnpm test 零回归
constraints: 模块文档按 scan 重生格式融入"注意事项"section（不加变更索引 section，scan 会删——见 memory scan-regenerates-module-docs）；本变更未上线，允许直接删模板文件不需 brownfield 兼容（design §11）；不改 skill 内部实现
depends_on: [task-01, task-02]
covers: []
---

# task-09: 废弃 stage prompt 模板 + 模块文档同步

## 验收标准

A. backend 中 verify.md 等废弃 stage prompt 模板文件已归档（移到 archive）或删除，全仓库 grep 确认无代码/配置引用这些模板（task-01 已移除 service.py 引用点，此处补齐其他潜在引用）。
B. docs 下 backend.md 与 sillyhub-daemon.md 模块文档的"注意事项"section 新增本变更条目：stage 投递改为 skill 调用（prompt+STAGE_META 双通道）、daemon skill-manager 同步机制、MCP 配置合并注入、CLAUDE.md 不再覆盖——按 scan 重生格式融入（不加变更索引 section）。
C. backend `uv run pytest -q` 与 sillyhub-daemon `pnpm test` 全绿（文档+模板清理不引测试回归），模板删除不触发 import 错误。
