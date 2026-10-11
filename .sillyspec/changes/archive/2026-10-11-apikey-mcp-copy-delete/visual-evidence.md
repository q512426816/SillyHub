# UI 视觉证据（visual-evidence）— 2026-10-11-apikey-mcp-copy-delete

## 视觉改动面盘点

本变更触及 4 个 UI 面，全部**沿用页面现有组件体系与设计 token，零新增样式类、零布局变更**：

| 页面/组件 | 视觉改动 | 样式来源 |
| --- | --- | --- |
| runtimes 页 CopyDaemonCommand | 凭据占位文案（prefix 打码→「复制时自动创建」）、成功/提示小字（text-[10px] text-muted-foreground，与既有警示文案同阶）、按钮 loading 文案（解析密钥…） | 既有类，无新类 |
| settings/api-keys 页操作列 | 活跃行加「复制密钥」ghost 按钮（lucide Copy 图标 h-3.5）、已吊销行加「删除」ghost destructive 按钮（Trash2 图标） | Button variant=ghost size=sm 既有变体，与「吊销」按钮同款 |
| workspaces/[id]/mcp-tokens 页操作列 | 活跃行加「复制令牌」、已吊销行加「删除」（同上款式） | 同上 |
| api-key-create-dialog | 明文展示区描述文案按 plaintext_recoverable 动态二选一 | 既有文案位，无结构变化 |

## 「降级」声明澄清（视觉证据门触发词）

requirements/design 中的「复制入口降级提示」「降级禁用」指**交互能力降级**——
`plaintext_recoverable=false` 的行复制按钮进入 HTML disabled 态并携带 title
tooltip 引导新建——**不是视觉样式降级**（没有为降级态新写任何颜色/尺寸/层级类）。
disabled 视觉由 Button 组件原生 disabled 样式承担（同款禁用态在项目内广泛存在）。

## DOM 级证据（vitest 断言，非自述）

- `settings/api-keys/__tests__/page.test.tsx`「存量不可恢复行 → 复制按钮禁用 + tooltip」：
  断言 `btn.disabled === true` 与 title 文案存在。
- 同文件「过期未吊销行不渲染复制按钮」：断言复制按钮 1 枚（仅活跃行）、吊销按钮 2 枚。
- 同文件「按钮矩阵」：吊销/复制/删除三按钮的行级分布。
- `workspaces/[id]/mcp-tokens/__tests__/page.test.tsx` 同款矩阵 + 禁用 + tooltip 用例。
- `runtimes/__tests__/copy-daemon-command.test.tsx`：明文不进 DOM
  （`document.body.textContent` 断言）+ 打码前缀渲染 + 提示文案渲染。

## 用户裁决

本变更无视觉样式降级项（全部为按钮增删与文案，沿用既有组件体系）；唯一的交互降级
（不可恢复行复制按钮禁用）在方案摘要阶段已向用户展示（「老数据兼容」节：
「复制按钮会显示为灰色禁用并提示“请新建”，不会报错」），用户回复「做完」授权
autopilot 全程执行——视为对该交互降级的裁决：认可。

autopilot 留痕：2026-10-11 flow start --autopilot（用户显式声明）。
