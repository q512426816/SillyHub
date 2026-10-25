---
author: qinyi
created_at: 2026-10-25 20:24:10
generated_by: hand (gate 报缺兜底——CLI 自动生成降级失败时按提示手写；execute/verify 按实际 diff 回填)
change: 2026-10-25-explorer-git-status
---

# 模块影响分析（Module Impact）

## 模块影响矩阵

| 模块 | 触达文件 | 影响类型 | 说明 |
|---|---|---|---|
| backend | backend/app/modules/git_log/schema.py, backend/app/modules/git_log/service.py, backend/app/modules/git_log/router.py, backend/openapi.json | 新增能力 | git_log 模块新增 dirty-files/worktree-diff 两只读端点与 4 DTO；既有四端点零改动 |
| frontend | frontend/src/lib/git-log.ts, frontend/src/lib/api-types.ts, frontend/src/components/git-log/file-tree.tsx, frontend/src/components/git-log/worktree-changes-card.tsx, frontend/src/components/git-log/worktree-diff-modal.tsx, frontend/src/app/(dashboard)/workspaces/[id]/git-log/page.tsx, frontend/src/components/explorer/file-explorer.tsx, frontend/src/components/git-log/__tests__/*, frontend/src/components/explorer/__tests__/* | 新增能力 + 局部修改 | Git 日志页新增更改卡与弹窗；explorer 树着色；lib 取数层扩展；file-tree 仅导出扩展 |
| sillyhub-daemon | sillyhub-daemon/src/host-fs-handler.ts, sillyhub-daemon/src/daemon.ts, sillyhub-daemon/src/api-types.ts, sillyhub-daemon/tests/host-fs-handler-git-dirty-files.test.ts | 新增能力 | 新增 git_dirty_files/git_worktree_diff 两只读平名 RPC；既有五 git 方法零改动 |
| prototype | frontend/src/components/prototype/explorer-git-status-view.tsx, frontend/scripts/prototype-build.mjs, frontend/prototype-dist/explorer-git-status.html | 原型登记 | brainstorm 阶段已落盘；task-07 重编译冻结 |

## 未匹配文件

（无——全部触达文件已按 _module-map.yaml 前缀归属 backend/frontend/sillyhub-daemon/prototype 四模块）

## 更新结果

| 文档 | 状态 | 备注 |
|---|---|---|
| modules/backend.md | pending | execute/verify 后回填 |
| modules/frontend.md | pending | execute/verify 后回填 |
| modules/sillyhub-daemon.md | pending | execute/verify 后回填（若存在） |
| _module-map.yaml | pending | execute/verify 后回填 |

## Wave 1 实况回填（execute 主控，2026-10-25）

| 模块 | 实际 diff（commit） | 与首版差异 |
|---|---|---|
| sillyhub-daemon | 4d510fe0：host-fs-handler.ts +472（两方法+类型+解析辅助）、daemon.ts +13（两平名注册）、NEW tests/host-fs-handler-git-dirty-files.test.ts 27 用例、tests/host-fs-handler-git-log.test.ts ±4（GL30 方法集 5→7，执行期裁决 D-013） | 首版矩阵漏列 GL30 既有测试触达，已补 |
| backend | 509f7a6a：schema.py +4 DTO、service.py +2 方法+2 超时常量+2 私有结果模型、router.py +2 端点、NEW backend/tests/modules/git_log/（__init__.py + 18 用例） | 与首版一致；openapi.json 属 task-03 再生成（W2） |

执行期裁决 2 条：D-012（porcelain v2 path 分隔双形态解析）、D-013（GL30 5→7），详见 decisions.md。

## Wave 2-5 实况回填（execute 主控，2026-10-25）

| Wave | 实际 diff（commit） | 与首版差异 |
|---|---|---|
| W2 task-03 | e0b90f0a：backend/openapi.json +287、frontend/src/lib/api-types.ts、sillyhub-daemon/src/api-types.ts 三份同批 | 一致；gen 链顺带再生的 provider-caps 两文件内容 diff 为空已还原（范围外） |
| W3 task-04 | f6a366da：lib/git-log.ts 扩展 + worktree-changes-card.tsx + 卡片测试（13 用例） | buildFileTree 现源已导出，file-tree.tsx 本卡零改动 |
| W4 task-05 | 24a1281e：file-tree.tsx（DiffBody export）+ worktree-diff-modal.tsx + 弹窗测试 | 一致 |
| W4 task-07 | ca545af3：file-explorer.tsx 着色 + 两个测试文件（新增 7 用例 + 既有 24 用例补 QueryClient 包装） | 既有 explorer 测试因组件内新增 useQuery 需 Provider 包装（plan 未预见，卡 related_tests 已含该文件属合规适配） |
| W5 task-06 | 2e582403：git-log/page.tsx 挂载接线 + git-log-page.test.tsx（+3 用例）+ 集成期修正（卡 data==null 守卫、弹窗 destroyOnClose） | 卡/弹窗文件改动越 task-06 allowed_paths（属 task-04/05 卡），为集成期必要修正，已在 commit message 注明 |

原型三件（explorer-git-status-view.tsx / prototype-build.mjs / prototype-dist/explorer-git-status.html）：brainstorm 基线已提交且重编译同源冻结（diff 空），无需新提交。
