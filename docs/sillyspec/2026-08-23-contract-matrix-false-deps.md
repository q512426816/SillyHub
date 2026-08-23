# contract-matrix.js 数字误读为假任务依赖（plan 任务总表）

- 日期：2026-08-23（plan 阶段独立审查发现）
- 状态：**活跃坑**——工具缺陷待修，当前免于实害（假 id 无 task 文件被跳过）
- 发现来源：变更 `2026-08-23-agent-log-conversation-view` plan 审查子代理实测

## 现象

- plan.md 任务总表「Wave」「优先级」「说明」列里出现的**数字**（如 W 列的 1/3/4/5、
  说明里的「409」「task-1/3/4/5/21」式引用、HTTP 状态码）会被 contract-matrix.js 的
  依赖正则误读为对 task-XX 的**假依赖**。
- tasks.md 里 task-06 的全量写法 `depends_on: task-01, task-02, task-03, task-04, task-05`
  只被解析出 task-01（逗号分隔列表截断），依赖图不完整。

## 实害评估

当前免于实害：假 id（如 task-409）没有对应 task 文件，工具跳过不报错；execute 分组
以 plan.md Wave 段纯 ID 行为准（该路径解析正常）。但：

1. 依赖图数据不完整/含噪，任何**依赖 Wave 重排/可行性校验**步骤如果消费这张图，
   可能得出错误的并行度或假警告；
2. 静默跳过掩盖解析缺陷，未来合法数字任务名（task-10+）出现时行为不可预期。

## 处理建议（工具侧）

- 依赖解析应只认「task-NN」完整 token 且限制出现位置（明确的 depends_on 标注列/
  行内标注），不该在自由文本列上全文正则；
- tasks.md depends_on 支持逗号+空格分隔列表的完整解析。

## 绕过（当前变更的临时做法）

plan.md 表格说明列避免裸写 `task-N`（用「task-0N」补零或中文描述代替）；
depends_on 逐任务单值书写（已影响本变更 task-06 的依赖表达）。
