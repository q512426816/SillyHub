# 视觉证据 — 2026-10-15-server-logs-panel

## 结论

本变更为页面改造（删业务统计卡 + 新增服务器日志卡），有 brainstorm 定稿原型
（prototype-server-logs.html，含删卡后布局与日志卡全要素），实现按原型逐项落地，
零样式漂移：

| 原型要素 | 实现映射 | 一致性 |
|---|---|---|
| 副标题「服务器性能、依赖状态与运行日志，每 5 秒自动刷新」 | page.tsx PageHeader subtitle 逐字一致 | ✅ |
| 业务统计卡删除（性能卡左/依赖卡右均分） | StatCell 组件与业务统计 SectionCard 移除；依赖卡去 lg:col-span-2，与性能卡各占半宽（原原型同布局） | ✅ |
| 日志卡满宽置底（lg:col-span-2） | ServerLogPanel 组件根 SectionCard className="lg:col-span-2"，置于依赖卡之后 | ✅ |
| 工具条：行数分段 100/200/500/1000 | antd Segmented size=small，默认 200，切换即拉取（选中小态走品牌紫 token） | ✅ |
| 文件下拉 + 下载按钮 | antd Select（数据源 available_files）+ Button DownloadOutlined；下载走 fetch Blob 鉴权链路 | ✅ |
| 日志流：时间/级别徽标/事件+详情，级别语义着色（INFO 青/WARN 琥珀/ERROR 红/DEBUG 灰） | LogRow grid 三列；级别色阶 sky-50/amber-50/red-50/zinc-100 语义浅底（对齐 agent-log-viewer.semanticLineClass 既有惯例）；非 JSON 行 RAW 徽标+原文 | ✅ |
| 点行展开原始 JSON | 行 click/键盘 toggle → `<pre>` 展开（解析行重组 JSON，parse_error 行显示 raw） | ✅ |
| 安全提示「⚠ 日志含运行路径与账号信息，请勿外传」 | 卡内固定 amber 文案逐字一致（D-005@v1） | ✅ |
| 页脚「显示最近 N 行（文件共 M 行）·每 5 秒自动刷新」 | 页脚左侧逐字；刷新文案在卡头 extra（「backend.log · 每 5 秒自动刷新」）；右侧补「点日志行可展开原始内容」引导 | ✅（等效） |

## 基线保障方式

1. 骨架组件复用：日志卡外层走 `@/components/layout` 的 SectionCard（与页面其它卡同族）；
   行数切换/下拉用 antd 组件（ConfigProvider token 自动换肤）。
2. 多主题保障：级别色阶为状态语义浅底（非品牌色，blue-* 零使用），安全提示 amber 语义；
   断言 pin 中文文案与结构，不 pin 颜色类（避免样式微调碎测试）。
3. 行为验证：组件测试 7 用例（结构化渲染/RAW 降级/行数切换/展开收起/真实下载链路 401-刷新-objectURL-revoke/轮询与卸载清理/失败不清数据）+ 页面测试 4 用例（删卡断言×2 + 日志卡在场 + 失败保留）。
4. 删卡面：StatCell 全仓零残留（grep 证实），业务统计标题与四值断言全清（页面测试显式 queryByText 反向断言）。

无「视觉降级需用户裁决」情形。
