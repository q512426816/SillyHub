# 验证报告（2026-08-25-session-attachment-preview）

> 探针结果由 `sillyspec verify-probes --init` 机械预填；语义部分由 QA 填写。

## 结论：PASS（全部验收项满足；2 条非阻断遗留：1 条 lint unused-import 警告、Docker build 可复现性待部署时实测——均不影响功能正确性）

## 任务完成度

11/11 全部完成（tasks.md 11/11 勾选，execute Task Review Gate 通过）：

| Task | 状态 | 核验证据 |
|---|---|---|
| task-01 依赖引入 | ✅ | package.json:31（docx-preview ^0.4.0）、:42（xlsx 官方源 0.20.3 tarball）；主仓 pnpm install 13s 成功复现；tsc 无新依赖报错 |
| task-02 useObjectUrl | ✅ | use-object-url.ts（含 retry 泄漏修复 cleanupRef）；5 测试绿（idle/ok/error/retry/卸载 revoke/竞态丢弃） |
| task-03 preview-registry | ✅ | preview-registry.ts blob.type>mime>扩展名；20 测试绿（六 key+边界+优先级） |
| task-04 fetchAttachmentBlob | ✅ | session-attachments.ts:75 导出；401 ensureFreshAccessToken 对齐 fetchFileBlob；既有 fetchAttachmentObjectUrl 未动 |
| task-05 image/pdf/fallback | ✅ | 三渲染器 + previewers/index.ts 统一 PreviewerProps；5 测试绿；PDF 零新依赖 |
| task-06 docx/xlsx | ✅ | docx-preview 动态 import + 异常降级；SheetJS 多 sheet + 2000 行截断提示；测试绿 |
| task-07 markdown | ✅ | 复用 ui/markdown-text.tsx（rehype-sanitize）；grep 确认无 @uiw 直 import（D-006）；2 测试绿 |
| task-08 FilePreviewModal | ✅ | antd Modal 五要素标题栏 + loading/error 重试态 + 六渲染器静态分发 + files/index.ts 导出；6 测试绿 |
| task-09 attachment-chips 接入 | ✅ | 图片/文件 chip 全部可点击弹预览，新窗 `<a>` 路径移除；3 测试绿；拉取失败降级容错保留 |
| task-10 file-message-card + file-viewer 接入 | ✅ | 卡片主体可点击（下载 stopPropagation、图片形态不动）；file-viewer 非图片项加预览；既有测试回归绿 |
| task-11 三主题 + 回归 | ✅ | brand-* token 无硬编码 hex（grep 零命中）；typecheck 0 错、全量 vitest 2169 绿、lint 除 1 条记录项外 0 警告 |

## 设计一致性

与 design.md 一致，两处实现期补充（均已回写 design.md）：
1. 新增 `previewers/index.ts`（PreviewerProps 类型 + 六渲染器统一导出）——design §6 清单已补录；
2. matchRenderer 匹配输入实现为 `blob.type ?? meta.mime`（FR-03 优先级），与 design §7 签名一致。

## 探针结果（CLI 机械预填 + 语义判定）

#### 探针 1：未实现标记扫描
- ⚠️ `frontend/pnpm-lock.yaml:3803` integrity 哈希——**误报**：sha512 字符串中的 `XXX` 字符被当未实现标记，lock 文件正常。
- glob `files/__tests__/*.test.tsx` 已手动展开：6 个测试文件全部存在。

#### 探针 2：设计关键词覆盖（QA 执行）
9/9 全命中（实现目录 grep）：FilePreviewModal(7 文件)、matchRenderer(4)、useObjectUrl(5)、fetchAttachmentBlob(2)、renderAsync(2)、sheet_to_html(2)、MarkdownText(2)、revokeObjectURL(6)、stopPropagation(1)。

#### 探针 3：验收标准测试覆盖
- CLI 预填 11 任务全 ✅；files/__tests__/ 6 测试文件覆盖 task-02~08/11。
- 集成盲区标注（QA）：Modal↔六渲染器组装、三入口↔Modal 组装均由 file-preview-modal.test.tsx（分发断言）与 attachment-chips/file-message-card/file-viewer 交互测试覆盖；docx/xlsx 真实渲染（docx-preview renderAsync 真文档、SheetJS 真解析）在 jsdom 中 mock，浏览器真实路径未自动化——属已知边界（jsdom 限制），建议后续 e2e 补充。

#### 探针 4：决策追踪覆盖（QA 执行）
| 决策 | FR | Task | 证据 | 状态 |
|---|---|---|---|---|
| D-001 纯前端渲染 | FR-02 | 05/06/07 | 无后端改动（git diff 仅 frontend/）；pptx 走 fallback | ✅ |
| D-002 全入口统一 | FR-01/04/05 | 08/09/10 | 三入口均 import FilePreviewModal | ✅ |
| D-003 PDF iframe | FR-02 | 05 | pdf-previewer.tsx iframe+objectURL 零依赖 | ✅ |
| D-004 antd Modal | FR-01 | 08 | file-preview-modal.tsx 用 antd Modal 非 Drawer | ✅ |
| D-005 SheetJS 官方源 | FR-02 | 01 | package.json:42 tarball URL；两环境 install 复现成功 | ✅（Docker 待实测） |
| D-006 md 防 XSS | FR-02 | 07 | markdown-previewer.tsx:16 仅 import MarkdownText；grep 无 @uiw 直 import | ✅ |

#### 探针 5：API Contract Parity
- CLI 报 145 条 missing + 110 条 unused（scope: full-repo）。**QA 判定：全部为探针对全仓既有代码的扫描噪音，与本次变更无关**——本变更零后端端点改动（design §9），仅消费 2 个既有只读端点（GET /api/daemon/session-attachments/{id}/content、GET /api/file/{file_id}），二者在主分支已长期工作（PPM 已上线模块每日使用）。145 条 missing 涉及的 admin/auth/ppm/daemon 等 lib 文件均为平台旧文件，本变更未触碰。不构成本变更 FAIL 项；建议工具侧修复 endpoints.json 收录范围（已记 docs/sillyspec 待办意向）。

#### 探针 6：代码删除对账
- ✅ 无整文件删除。

## 测试结果

| 命令 | 结果 |
|---|---|
| `tsc --noEmit`（主仓 frontend） | 0 错误 |
| `vitest run`（全量） | **195 文件 / 2169 测试全部通过**（含其他模块无回归） |
| `next lint --dir src/components/files` | 0 警告 0 错误 |
| `next lint --file 三入口文件` | 1 警告：file-message-card.tsx:27 unused import `FilePreviewTarget`（见技术债务） |

## 决策追踪矩阵

见探针 4 表（D-001~D-006 全闭环，无 unresolved）。

## 技术债务

1. **lint 警告 1 条**：`file-message-card.tsx:27` 导入的 `FilePreviewTarget` 类型未使用（实现时遗留，verify 护栏禁改源码未当场修）——零功能影响，建议一行 quick 修复；
2. **Docker build 可复现性未实测**（R-02）：本机两处 pnpm install（worktree + 主仓）均成功，但 frontend/Dockerfile 全新 deps 层场景未跑——部署时首次构建验证，失败按 R-02 三级退路（vendor tarball / 代理 / 换 exceljs）；
3. **docx/xlsx 浏览器真实渲染无自动化**：jsdom 下 mock（已知限制），建议后续 e2e（Playwright）补真实文档渲染冒烟。

## 变更风险等级

**unit-sufficient**（前端组件变更，2169 单测全绿覆盖；不涉及 API 契约/部署结构变更）。design.md frontmatter 未显式声明 risk_level。

## Runtime Evidence

- commit：`29d6f5f7`（Wave 1-5 全量实现，main）+ `07c04883`（任务勾选对齐）
- 测试证据：全量 vitest 2169/2169 通过（2026-08-25 13:14，主仓 frontend，node_modules 已同步新依赖）
- 不涉及：后端启动/端点部署/daemon 进程（纯前端变更，未触碰运行时组件）
- 失败模式排除：附件已删除场景 → useObjectUrl error 态"文件已失效或被清理"+重试/关闭（R-07 已实现）；xlsx 大表 → 2000 行截断提示（R-03）；docx 损坏 → 错误态+下载引导（R-01）

## 代码审查

- execute 阶段独立 QA 子代理 acceptance review：specVerdict=pass / qualityVerdict=pass（FR/决策逐项核验、跨 task 契约一致、组装行为绿）
- 审查发现并已修复：use-object-url retry 路径 objectURL 泄漏（cleanupRef 统一管理，commit af4ad03e → 合入 29d6f5f7）
- 遗留 1 条 unused-import（见技术债务 1），无其他问题
