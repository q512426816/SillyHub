# UI 视觉证据（2026-10-13-daemon-log-config-view）

## UI 变更面

1. **机器卡操作区新增两按钮**（frontend/src/components/daemon/machine-card.tsx:552-573）：「日志」（FileText 图标）与「配置」（Settings 图标），btn-outline btn-tiny 样式与既有「别名/升级 daemon/清理」一致；机器离线 disabled + tooltip（「离线，无法查看日志/配置」）。
2. **诊断弹窗**（frontend/src/components/daemon/daemon-diagnostic-dialog.tsx，新组件）：antd Modal 880px 双 Tab——
   - 日志 Tab：行数 Select（100/500/2000）+ 刷新 + 「下载日志片段」+ 元信息行（路径/大小/最后修改/展示行数，mono 字体）+ 等宽深色滚动区（打开自动滚底）+ truncated 提示条。
   - 配置 Tab：「显示明文/隐藏明文」切换 + 「下载配置（始终脱敏）」+ 只读 Tag + 已隐藏字段提示 + mono JSON 区（掩码字段行 warning 高亮）。

## 原型对照（prototype-daemon-log-config-view.html）

弹窗布局/按钮组/五类边界态提示条（422 升级/exists:false 前台运行/truncated/离线/通用错误）与原型一致；掩码高亮与「下载内容始终脱敏」文案按 D-007 裁定落地（原型「下载日志片段/下载配置（脱敏）」按钮名对齐为「下载配置（始终脱敏）」）。主题 token（brand-*/antd ConfigProvider）走既有 AI-Native 双主题系统，未引入新样式面。

## 渲染证据与人工验收步骤（移交 manual-acceptance）

组件级渲染行为由 vitest 8 用例锁定（daemon-diagnostic-dialog.test.tsx：双 Tab/掩码/明文切换/下载 Blob 内容/边界态文案）；真机渲染截图待三服务在线时按以下步骤补：

1. 起 backend + frontend，/runtimes 找一台在线机器 → 点「日志」→ 核行数切换/刷新/元信息/自动滚底 → 点「下载日志片段」验文件内容。
2. 点「配置」→ 核掩码高亮与「已隐藏字段：token / api_key」→ 点「显示明文」→ 核明文与警示文案 → 下载验产物仍脱敏（D-007）。
3. 边界态：停 daemon（按钮禁用）/老版本 daemon（422 提示条）/前台 TTY daemon（exists:false 提示条）。
