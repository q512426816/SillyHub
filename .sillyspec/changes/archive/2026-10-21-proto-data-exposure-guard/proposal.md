---
author: flow-machine-draft
created_at: 2026-10-20T23:36:08.889Z
---
# 提案书（Proposal）— 2026-10-21-proto-data-exposure-guard

## 动机

任务原话转写：预览真实会话数据移出静态目录并补 gitignore
动机：昨夜只读审查发现 frontend/public/__proto__/session-export.json 为 3.3MB 真实会话导出（含用户对话原文与会话 id），public/ 被 Next.js 免鉴权静态服务；且根 .tmp/、backend/pytest-of-qinyi/、daemon 目录 *.TMP 残留均无 .gitignore 覆盖——多 agent 共享仓下构成数据暴露与误提交双风险。

成功标准：
- frontend/public/ 下不再有会话导出数据（移至 frontend/.proto-staging/，该目录 gitignore 覆盖）
- proto 预览页 SSR 读取路径随迁，dev 预览渲染真实数据能力不回归
- .git immersion 覆盖 /.tmp/、backend/pytest-of-*/、frontend/.proto-staging/、frontend/public/__proto/、*.TMP，git status 不再列出上述任何路径

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. frontend/public/ 下不再有会话导出数据（移至 frontend/.proto-staging/，该目录 gitignore 覆盖）
2. proto 预览页 SSR 读取路径随迁，dev 预览渲染真实数据能力不回归
3. .git immersion 覆盖 /.tmp/、backend/pytest-of-*/、frontend/.proto-staging/、frontend/public/__proto/、*.TMP，git status 不再列出上述任何路径

## 成功标准（可验证）

1. frontend/public/ 下不再有会话导出数据（移至 frontend/.proto-staging/，该目录 gitignore 覆盖）
2. proto 预览页 SSR 读取路径随迁，dev 预览渲染真实数据能力不回归
3. .git immersion 覆盖 /.tmp/、backend/pytest-of-*/、frontend/.proto-staging/、frontend/public/__proto/、*.TMP，git status 不再列出上述任何路径
