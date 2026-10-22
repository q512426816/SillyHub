---
author: flow-machine-draft
created_at: 2026-10-20T23:36:08.889Z
---
# 任务注册表（Tasks）— 2026-10-21-proto-data-exposure-guard

- [x] task-01: 数据文件移出静态服务面——mkdir frontend/.proto-staging，mv public/__proto__/session-export.json 入内并删空目录；验证=public/ 下无该文件 + 新位置 JSON 可解析（session.id 等字段在）
- [x] task-02: 读取路径随迁——staged-session-export.ts 路径常量改 [".proto-staging","session-export.json"]，view.tsx 删 public fetch 兜底 effect，4 处注释同步新位置；验证=frontend npx tsc --noEmit 零错
- [x] task-03: gitignore 机制防线——根 .gitignore 补 /.tmp/、backend/pytest-of-*/、*.TMP，frontend/.gitignore 补 .proto-staging/、public/__proto/；验证=git status --porcelain 五类路径零出现
