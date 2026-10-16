---
author: flow-machine-draft
created_at: 2026-10-16T02:43:26.709Z
---
# 任务注册表（Tasks）— 2026-10-16-knowledge-module-card

- [x] task-01: 填规格工件——requirements 三条 FR 行为句/场景/测试绑定 + design 四节作答 + 文件变更清单；验证：无空槽、无「待撰写/待填」残留
- [x] task-02: 登记模块卡——_module-map.yaml 新增 sillyspec 模块（paths=.sillyspec/knowledge/**）+ 新建 modules/sillyspec.md 文档卡；验证：yaml 语法过（python -c yaml.safe_load 或等价）、条目字段与既有模块同构
- [x] task-03: 迁移伪域——sillyspec tests --redomain 先干跑确认输出，再 --write；验证：knowledge/fr/sillyspec.md 含 FR-auto-sillyspec-083~085 原 ID、伪域文件清空/移除、git status 仅模块图/模块文档/知识 fr/INDEX 文件变动
