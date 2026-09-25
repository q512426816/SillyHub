---
author: flow-machine-draft
created_at: 2026-09-25T08:59:04.044Z
---
# 决策记录（Decisions）— 2026-09-25-change-detail-assets-usability

## D-001@v1: 风险与死路（design 槽4 收割）
- 决策：风险一：`change.patch` 与 `change-patch.json` 由 CLI 产出，体量不可控——切片后设 200k 字符上限并置 truncated，清单设 500 条上限并在 UI 标注截断（不静默截断）。
  风险二：知识库 URL 参数是新的外部入口，前缀归一规则写死会让旧链接失效——归一函数覆盖四种写法并用例钉住，未知形态回落文件级。
  风险三：切片按 `diff --git` 块解析属 git 自有格式，CLI 侧有同款 `slicePatchForFile`（双端实现）——本层只做只读展示切片、不参与审计判据，且只解析块头不做语义推断，漂移面可控。
  死路一：复用范围对账「点行看单文件 diff」弹窗（daemon RPC `sillyspec_file_diff`）看归档留档 —— 该 RPC 的冻结 patch 分支只认 `scope-audit.patch`，本类变更无此件，会退化成实时窗口 diff（正是本次要治的失真），放弃。
  死路二：前端拉 change.patch 自行切片 —— D-001@v1 已判前端解析属双端漂移面（且 N+1），放弃。
  死路三：降级时整卡隐藏或只留命令兜底 —— 会连「当前工作区未提交窗口」这一有效信息一起丢掉，放弃；改为显式降级说明 + 归档变更口径提示。
  死路四：改 CLI 让冻结 patch 分支兼容 change.patch —— 跨仓改动、需 CLI 发版 + daemon 升级才生效，远超本次展示层修复范围，放弃（可作为后续工具侧改进项）。
