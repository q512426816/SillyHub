# QUICKLOG qinyi 2026-08-27

## ql-20260827-001-3784 | 2026-08-27 08:55:00 | PDF 预览改 pdf.js 画布渲染——浏览器原生 PDF 查看器不可依赖（IAB 无插件 / 个别文档原生查看器报未能加载）
状态：已完成
关联变更：2026-08-25-session-attachment-preview
文件：
- frontend/src/components/files/previewers/pdf-previewer.tsx（iframe+原生查看器 → pdf.js 画布：双 effect 解耦解析与绘制、DPR≤2 适宽渲染、>50 页截断提示、错误引导态）
- frontend/public/pdf.worker.min.mjs（pdfjs-dist 4.10.38 worker 静态拷贝——webpack 对 node_modules 内 worker 的 URL 资源化不可靠；升级须同步重拷）
- frontend/src/components/files/__tests__/previewers-basic.test.tsx（iframe 断言 → mock pdfjs 的画布断言 + 解析失败用例）
- frontend/package.json / pnpm-lock.yaml（pdfjs-dist@4.10.38）
需求：用户反馈 CRRCDT-STD0402员工补贴和福利标准.pdf 预览报「未能加载 PDF 文档」
根因：逐层排查——文件本体双引擎验证健康（pypdf 全解析 + pdf.js 全渲染链通过、xref 偏移精确、无加密）、后端与 Next 代理字节一致（cmp 全等）、前端 blob URL 正常生成；直接导航 PDF URL 在内嵌浏览器报 ERR_FAILED 证明其无 PDF 组件，原生查看器对 blob PDF 的加载在部分环境不可用（Chrome 查看器报「未能加载 PDF 文档」即其错误文案）。结论：iframe+原生查看器方案不可依赖
方案：pdf.js（pdfjs-dist 4.10.38）画布渲染，纯 JS 解析绘制零插件依赖；修复过程中顺带消灭两个真 bug——①容器零宽时 clientWidth-16 为负真值导致画布负宽（Math.max 下限 320）；②解析 then 内 containerRef 为 null（setStatus 异步提交期容器未挂载）页渲染被静默跳过（双 effect 解耦）
结果：previewers-basic 6/6、files 全套 50/50 绿、tsc 0 错；已部署；无 PDF 插件的内嵌浏览器实测 5 页全部画布渲染成功（canvas 数=5 硬证据）

## ql-20260827-002-3784e | 2026-08-27 09:40:00 | Word 预览恢复 LibreOffice→PDF 管线——本地 docxjs 无分页模型目录必漂移，且与 OnlyOffice 开关解耦
状态：已完成
关联变更：2026-08-26-onlyoffice-preview
文件：
- deploy/docker-compose.yml（gotenberg 服务块恢复 + ./onlyoffice-fonts 字体挂载）
- deploy/.env（GOTENBERG_URL=http://gotenberg:3000 恢复；ONLYOFFICE_ENABLED 维持 false）
- backend/app/modules/preview_office/service.py（build_preview LO 分支解除 onlyoffice_enabled 依赖——DS 退役后 Word 排版保真由 Gotenberg 独立承担）
- backend/app/modules/preview_office/tests/test_service.py（新增：DS 禁用+Gotenberg 配置 → Word 仍走 pdf；DS 禁用+非 Word → 503）
- frontend/src/components/files/file-preview-modal.tsx（mode=pdf 渲染从 iframe 换 PdfPreviewer（pdf.js 画布）——原生查看器对内嵌 blob PDF 不可依赖（ql-20260827-001），补 pdfBlob state）
- frontend/src/components/files/__tests__/file-preview-modal.test.tsx（mode=pdf 断言 iframe → pdf-previewer）
需求：用户反馈 docx 本地预览目录又到第一页（会话 3fe801bd，0-6教师温暖行为指南.docx）——期望与本地 Word 一致：封面独立一页、目录第二页
根因：ql-20260826-013 退役 OnlyOffice 时 Word 一并回落本地 docxjs 渲染器，其无 Word 行网格分页模型（封面空段落撑不满一页，目录被拉上第一页）——昨日已论证该边界不可修（docxjs 渲染连续 HTML 无分页概念）
方案：恢复 Word→Gotenberg(LibreOffice)→PDF 管线（昨日已验证该文档 LO 输出与 Word 一致：封面 p1/目录 p2/使用说明 p3）且与 OnlyOffice 开关解耦（DS 保持退役，Excel 保持下载引导不变）；前端 mode=pdf 从 iframe 换 pdf.js 画布（Chrome 原生查看器对内嵌 blob PDF 报"未能加载"的教训）
结果：backend 16/16 + mypy/ruff 0 错；frontend files 70/70 + tsc 0 错；已部署；端到端实测（无 PDF 插件浏览器）46 页画布全渲染、docxjs 容器零出现；缓存命中场景秒开

## ql-20260827-003-e5a1 | 2026-08-27 10:05:00 | 按用户决策回退 Word→PDF 管线——LO 输出 46 页 vs Word 实际 42 页不可接受，回归本地 docxjs 渲染
状态：已完成
关联变更：2026-08-26-onlyoffice-preview
文件：
- deploy/docker-compose.yml（移除 gotenberg 服务块）/ deploy/.env（GOTENBERG_URL 删除）
需求：用户实测 Word→LibreOffice→PDF 渲染 46 页 vs 本机 Word 42 页，页数偏差不可接受，决定停止折腾回归本地渲染
根因：LibreOffice 与 Word 的正文行距解释存在固有差异（结构性分页对但页数漂移 4 页），用户不接受
方案：配置级回退——GOTENBERG_URL 清空后 build_preview 直接走 DS 分支 → DS 未启用 503 → 前端自动降级本地 docxjs 渲染器（代码路径保留，未来一行 env 可再启用）；gotenberg 容器移除；Word 预览接受目录位置与 Word 有偏差的已知边界（docxjs 无分页模型），精确排版走下载
结果：已部署验证 office-config 503；Word 本地渲染 / Excel 下载引导 / PDF pdf.js 渲染均维持现状
