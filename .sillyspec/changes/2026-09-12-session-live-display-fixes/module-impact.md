---
author: qinyi
created_at: 2026-09-13T00:40:00
---

# 模块影响分析（骨架由 plan --done CLI（design 声明清单 × module-map 前缀匹配） 生成）

> 文件×模块归属由 CLI 按 _module-map.yaml paths 前缀匹配预填；
> **影响类型**（逻辑变更/数据结构变更/接口变更/调用关系变更/配置变更/新增）与 review 标记是语义判断，
> 逐行把 <!--TODO--> 替换为真实结论——以 git diff 为准（真实 > 声明）。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|

## 未匹配文件

以下变更文件未命中 _module-map.yaml 任何模块 paths——确认是模块索引过期（该跑 `sillyspec modules rebuild`）还是真的游离文件：

- `frontend/src/components/daemon/session-log-assembler.ts` → 归属 frontend 模块（map paths 粒度未覆盖该子路径，非游离文件）
- `frontend/src/components/daemon/session-panel/page-helpers.tsx` → 归属 frontend 模块（同上）
- `sillyhub-daemon/src/model-error/classifier.ts` → 归属 sillyhub-daemon 模块（map paths 粒度未覆盖 model-error 子路径）
- `backend/app/modules/daemon/session/service/inject.py` → 归属 daemon 模块（map paths 粒度未覆盖 session/service 子路径）
- `backend/app/modules/daemon/session/service/auto_resume.py` → 归属 daemon 模块（同上）

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `_module-map.yaml` | skipped：5 个未匹配文件均归属已映射模块（frontend/sillyhub-daemon/daemon），系 map paths 子路径粒度未覆盖，非索引过期；本变更不新增模块/子模块，无需 rebuild（粒度缺口属工具改进项，可另行记录） | done |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。
