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
