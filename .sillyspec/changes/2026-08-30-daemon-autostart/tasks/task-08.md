---
id: task-08
title: '前端 AutostartDaemonBlock 折叠块组件（frontend/src/app/(dashboard)/runtimes/page.tsx）+ 组件测试（渲染/复制/命令拼接，沿用 install-daemon-os.test.tsx 模式）'
title_zh: '前端 AutostartDaemonBlock 折叠块组件（frontend/src/app/(dashboard)/runtimes/page.tsx）+ 组件测试（渲染/复制/命令拼接，沿用 install-daemon-os.test.tsx 模式）'
author: 'qinyi'
created_at: 2026-08-30 23:01:28
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-07]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/runtimes/page.tsx
  - frontend/src/app/(dashboard)/runtimes/__tests__/install-daemon-os.test.tsx
  - frontend/src/app/(dashboard)/runtimes/__tests__/autostart-block.test.tsx
goal: >
  在 /runtimes 页启动入口卡片 InstallDaemonBlock 下方新增「开机自启动（可选）」折叠块
  AutostartDaemonBlock，给出三平台通用的一条 autostart enable 可复制命令 + 凭据/管理提示，
  与 CopyDaemonCommand 指引形成"一键"体验闭环（design §4.1 / FR-07 / D-001@v1）。
implementation:
  - 'page.tsx 新增并导出 `export function AutostartDaemonBlock()`（定义置于 InstallDaemonBlock 之后 L288 附近）；渲染位置插在 header 启动入口卡片 `<InstallDaemonBlock />`（L1026）与 `<CopyDaemonCommand compact />` 之间，同视觉层级'
  - '复用 InstallDaemonBlock 折叠骨架：rounded-md + border border-dashed border-border/70 + bg-muted/30 容器、标题行按钮（Terminal 图标 + 「开机自启动（可选）」+ 收起/展开）、useState open 默认收起、展开体 flex-col gap-2 border-t'
  - 'serverUrl 沿用 InstallDaemonBlock 模式：useState(null) + useEffect 内 setServerUrl(window.location.origin)（防 SSR/hydration 不一致）；serverUrl 未就绪时命令行显示占位'
  - '命令拼接（核心）：`sillyhub-daemon autostart enable --server ${serverUrl} --api-key <粘贴你的 API Key>`——三平台同一命令，不做 detectOs、不加 OS 切换按钮（与 InstallDaemonBlock 的关键差异，原型 prototype-autostart-block.html 已注明）；命令行用既有 code + truncate 样式'
  - '复制按钮复用 CopyDaemonCommand/handleCopy 模式：navigator.clipboard.writeText(cmd) + setCopied(true) + setTimeout 2000ms 复位；已复制态显示 Check 图标 + 「已复制」，title 用「复制自启命令」便于测试精确定位'
  - '琥珀提示（text-[10px] text-amber-600，对齐 page.tsx L155-163 既有写法）：自启动场景建议用 API Key（长效），登录 Token 会过期失效；附获取路径链接 /settings/api-keys（签发 API Key）'
  - '管理命令提示行（text-[10px] text-muted-foreground）：`sillyhub-daemon autostart status` 查看注册状态 · `sillyhub-daemon autostart disable` 取消自启（不会停止正在运行的 daemon）'
  - '说明文案行：安装完成并至少成功启动过一次后执行（design §4.1 原文语义）'
  - '测试落点（二选一，本卡选定第一种）：扩展现有 frontend/src/app/(dashboard)/runtimes/__tests__/install-daemon-os.test.tsx，新增 describe("AutostartDaemonBlock")——① 默认收起/点标题展开；② 命令逐字断言含 `autostart enable --server <window.location.origin>` 与 `--api-key <粘贴你的 API Key>`；③ 断言无 OS 切换（queryByText("Windows") / queryByText("macOS / Linux") 均为空）；④ getByTitle("复制自启命令") 点击后 clipboard.writeText 收到完整命令；⑤ 琥珀提示含 API Key 与 /settings/api-keys。沿用该文件既有 navigator.userAgent/clipboard mock 基建与 afterEach 还原模式；autostart-block.test.tsx 列入 allowed_paths 仅作 execute 时判断现有文件过长再拆分的备选'
acceptance:
  - '/runtimes 页「首次安装 daemon（新机器）」折叠块下方渲染「开机自启动（可选）」折叠块，默认收起、dashed border 同视觉层级（原型一致）'
  - '展开后命令行含 `sillyhub-daemon autostart enable --server <window.location.origin> --api-key <粘贴你的 API Key>`，且块内不出现 OS 切换按钮'
  - '点复制按钮：完整命令写入 navigator.clipboard，按钮 2s 内显示「已复制」后自动复位'
  - '琥珀提示含 API Key 建议与 /settings/api-keys 获取路径；管理命令行同时含 autostart status 与 autostart disable'
  - '新增组件测试全绿，且 install-daemon-os.test.tsx 既有 detectOs/InstallDaemonBlock 用例零修改通过'
verify:
  - cd frontend && pnpm test -- runtimes
constraints:
  - '不加 OS 切换按钮、不依赖 detectOs（命令三平台相同，FR-07 明确）'
  - '不修改 InstallDaemonBlock / CopyDaemonCommand / detectOs 既有代码；page.tsx 只做纯新增，测试文件只增用例不改旧断言'
  - '纯静态指引块：不发网络请求、不读后端 daemon 状态、不内嵌真实凭据（占位符固定为 <粘贴你的 API Key>）'
  - '命令文案与 design §4.1 / FR-07 逐字一致，不自行改写参数顺序或措辞'
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
