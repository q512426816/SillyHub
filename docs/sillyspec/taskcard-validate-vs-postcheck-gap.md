# taskcard --validate 与 plan-postcheck 的 provides 格式口径不一致

**发现于**：2026-10-10-workspace-ref-intake（plan 阶段，2026-10-10）

## 现象
填卡子代理把 provides/expects_from 写成散文行（`- contract Foo fields [a, b]`），`sillyspec taskcard --validate` 通过（YAML 合法、占位符全替换）；但 plan `--done` 的 planPostcheck 跨任务契约校验按映射式结构（`- contract: Foo` + `fields: [a, b]`）解析，12 条契约全部报「provider 未声明」阻断。

## 根因
--validate 只做 frontmatter YAML 合法性 + 硬字段 + 占位符检查，不解析 provides/expects_from 结构；postcheck 的契约对账是另一套解析器，两者口径不同。

## 改进建议
taskcard --validate 增加 provides/expects_from 结构校验（或至少 warning：检测到 `contract <名> fields` 散文形态时提示映射式写法），让格式错误在填卡自检轮暴露而非 plan 收口轮。

## 绕过方案（已验证）
主代理统一钉死契约块的 YAML 映射式模板给填卡子代理逐字抄；发现散文式后用 Edit 批量改结构。
