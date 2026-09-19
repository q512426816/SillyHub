import { describe, expect, it } from "vitest";

import { buildReplayTurns, type AgentLogMessageItem } from "../agent-log-turns";

/**
 * 2026-09-19-tool-report-session-replay task-09：buildReplayTurns 单测——
 * 覆盖任务卡 acceptance 全场景（真人切轮与 sender 缺省 / system_event 不切轮
 * 进 processItems / turn_id 变化切轮 / is_error→deny / 孤儿 tool_result raw
 * 空串 / usage 去重聚合与 ctxTokens 末次口径 / 无 usage 全 null / 常量字段
 * 断言 / 段映射与配对规则 / 纯函数不改入参）。
 */

let nextSeq = 1;

/** 消息工厂：seq 自增，其余字段按需覆盖（schema 可选字段全可省）。 */
function msg(
  fields: { kind: AgentLogMessageItem["kind"] } & Partial<AgentLogMessageItem>,
): AgentLogMessageItem {
  return { seq: nextSeq++, ...fields };
}

/** usage 工厂（api-types snake_case 五项；total 凑合可辨值即可）。 */
function usage(input: number, output: number) {
  return {
    input_tokens: input,
    output_tokens: output,
    total_tokens: input + output,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
  };
}

describe("buildReplayTurns", () => {
  it("真人 user_input 开新轮且 prompt 取原文；sender 缺省视为 human", () => {
    const turns = buildReplayTurns([
      msg({ kind: "user_input", text: "第一个问题" }), // sender 缺省 → human
      msg({ kind: "reply", text: "答一" }),
      msg({ kind: "user_input", text: "第二个问题", sender: "human" }),
      msg({ kind: "reply", text: "答二" }),
    ]);

    expect(turns).toHaveLength(2);
    expect(turns[0]!.prompt).toBe("第一个问题");
    expect(turns[0]!.output).toBe("答一");
    expect(turns[1]!.prompt).toBe("第二个问题");
    expect(turns[1]!.output).toBe("答二");
  });

  it("sender=system_event 的 user_input 不切轮、不进 prompt，进 processItems 的 system_event 项", () => {
    const turns = buildReplayTurns([
      msg({ kind: "user_input", text: "真人提问" }),
      msg({
        kind: "user_input",
        text: "<task-notification>后台任务完成</task-notification>",
        sender: "system_event",
      }),
      msg({ kind: "thinking", text: "想想" }),
      msg({ kind: "reply", text: "答复" }),
    ]);

    expect(turns).toHaveLength(1);
    expect(turns[0]!.prompt).toBe("真人提问");
    const sys = turns[0]!.processItems!.find((p) => p.kind === "system_event");
    expect(sys).toMatchObject({
      kind: "system_event",
      text: "<task-notification>后台任务完成</task-notification>",
    });
    // system_event 文本不得混入 prompt / output。
    expect(turns[0]!.prompt).not.toContain("task-notification");
    expect(turns[0]!.output).not.toContain("task-notification");
  });

  it("turn_id 变化独立切轮（D-005）；非真人起点轮 prompt 留空串", () => {
    const turns = buildReplayTurns([
      msg({ kind: "thinking", text: "t1 思考", turn_id: "turn-1" }),
      msg({ kind: "reply", text: "t1 答复", turn_id: "turn-1" }),
      msg({ kind: "thinking", text: "t2 思考", turn_id: "turn-2" }),
      msg({ kind: "reply", text: "t2 答复", turn_id: "turn-2" }),
    ]);

    expect(turns).toHaveLength(2);
    // 无真人文本的轮起点：prompt 空串（不伪造命令文本），processItems 照常归轮。
    expect(turns[0]!.prompt).toBe("");
    expect(turns[0]!.output).toBe("t1 答复");
    expect(turns[1]!.prompt).toBe("");
    expect(turns[1]!.output).toBe("t2 答复");
    expect(turns[0]!.processItems).toEqual([{ kind: "thinking", text: "t1 思考" }]);
  });

  it("turn_id 缺省（null）不触发切轮——无信息不是边界信号", () => {
    const turns = buildReplayTurns([
      msg({ kind: "user_input", text: "老数据问题" }),
      msg({ kind: "thinking", text: "思考", turn_id: null }),
      msg({ kind: "reply", text: "答复", turn_id: null }),
    ]);

    expect(turns).toHaveLength(1);
    expect(turns[0]!.output).toBe("答复");
  });

  it("thinking → processItems thinking 项；reply 多段按序拼接 output", () => {
    const turns = buildReplayTurns([
      msg({ kind: "user_input", text: "问" }),
      msg({ kind: "thinking", text: "第一段思考" }),
      msg({ kind: "reply", text: "答复前半" }),
      msg({ kind: "thinking", text: "第二段思考" }),
      msg({ kind: "reply", text: "答复后半" }),
    ]);

    expect(turns[0]!.output).toBe("答复前半答复后半");
    expect(turns[0]!.processItems).toEqual([
      { kind: "thinking", text: "第一段思考" },
      { kind: "thinking", text: "第二段思考" },
    ]);
  });

  it("tool_use 按 tool_use_id 配对 tool_result（ok）；is_error → deny", () => {
    const turns = buildReplayTurns([
      msg({ kind: "user_input", text: "跑个工具" }),
      msg({
        kind: "tool_use",
        tool_name: "Bash",
        tool_use_id: "use-1",
        tool_input: '{"command":"ls"}',
      }),
      msg({ kind: "tool_result", tool_use_id: "use-1", tool_result: "file-a\nfile-b" }),
      msg({
        kind: "tool_use",
        tool_name: "Read",
        tool_use_id: "use-2",
        tool_input: '{"path":"x"}',
      }),
      msg({
        kind: "tool_result",
        tool_use_id: "use-2",
        tool_result: "boom",
        is_error: true,
      }),
    ]);

    const tools = turns[0]!.processItems!.filter((p) => p.kind === "tool");
    expect(tools).toEqual([
      {
        kind: "tool",
        raw: '{"command":"ls"}',
        result: "file-a\nfile-b",
        status: "ok",
      },
      { kind: "tool", raw: '{"path":"x"}', result: "boom", status: "deny" },
    ]);
  });

  it("孤儿 tool_result（无配对 tool_use）→ raw 空串 tool 项", () => {
    const turns = buildReplayTurns([
      msg({ kind: "user_input", text: "问" }),
      msg({ kind: "tool_result", tool_use_id: "ghost", tool_result: "无主结果" }),
      msg({ kind: "reply", text: "答" }),
    ]);

    expect(turns[0]!.processItems).toEqual([
      { kind: "tool", raw: "", result: "无主结果", status: "ok" },
    ]);
  });

  it("未配对 tool_use → result 缺省、status='running'（无结果记录的规范编码）", () => {
    const turns = buildReplayTurns([
      msg({ kind: "user_input", text: "问" }),
      msg({ kind: "tool_use", tool_use_id: "use-x", tool_input: "..." }),
    ]);

    expect(turns[0]!.processItems).toEqual([
      { kind: "tool", raw: "...", status: "running" },
    ]);
  });

  it("配对跨轮不丢：tool_use 与 tool_result 被切轮拆开仍按 id 回填", () => {
    const turns = buildReplayTurns([
      msg({ kind: "tool_use", tool_use_id: "use-c", tool_input: "in", turn_id: "t1" }),
      msg({ kind: "tool_result", tool_use_id: "use-c", tool_result: "out", turn_id: "t2" }),
    ]);

    expect(turns).toHaveLength(2);
    expect(turns[0]!.processItems).toEqual([
      { kind: "tool", raw: "in", result: "out", status: "ok" },
    ]);
    expect(turns[1]!.processItems).toEqual([]);
  });

  it("usage 轮内按调用去重后求和；ctxTokens 取该轮末次调用 inputTokens", () => {
    const turns = buildReplayTurns([
      // 一次调用产出的多段共享同一 usage（值相同、对象各异——JSON 反序列化形态）。
      msg({ kind: "user_input", text: "问", usage: usage(10, 5) }),
      msg({ kind: "thinking", text: "想", usage: usage(10, 5) }),
      msg({
        kind: "tool_use",
        tool_use_id: "u",
        tool_input: "i",
        usage: usage(20, 8),
      }),
      msg({ kind: "tool_result", tool_use_id: "u", tool_result: "r", usage: usage(20, 8) }),
      msg({ kind: "reply", text: "答", usage: usage(30, 2) }),
    ]);

    // 去重后三次调用：10+20+30 / 5+8+2；末次 input=30。
    expect(turns[0]!.inputTokens).toBe(60);
    expect(turns[0]!.outputTokens).toBe(15);
    expect(turns[0]!.ctxTokens).toBe(30);
  });

  it("轮内无 usage → inputTokens / outputTokens / ctxTokens 三值 null（不显 0 不伪造）", () => {
    const turns = buildReplayTurns([
      msg({ kind: "user_input", text: "问" }),
      msg({ kind: "thinking", text: "想" }),
      msg({ kind: "reply", text: "答" }),
    ]);

    expect(turns[0]!.inputTokens).toBeNull();
    expect(turns[0]!.outputTokens).toBeNull();
    expect(turns[0]!.ctxTokens).toBeNull();
  });

  it("usage 聚合按轮隔离：前轮 usage 不计入后轮", () => {
    const turns = buildReplayTurns([
      msg({ kind: "user_input", text: "问一", usage: usage(10, 5) }),
      msg({ kind: "reply", text: "答一", usage: usage(10, 5) }),
      msg({ kind: "user_input", text: "问二" }),
      msg({ kind: "reply", text: "答二" }),
    ]);

    expect(turns[0]!.inputTokens).toBe(10);
    expect(turns[1]!.inputTokens).toBeNull();
    expect(turns[1]!.ctxTokens).toBeNull();
  });

  it("视图常量：status='completed'、seenLogIds 空 Set、runId=__replay_N__、turn 从 1 起轮序", () => {
    const turns = buildReplayTurns([
      msg({ kind: "user_input", text: "a" }),
      msg({ kind: "reply", text: "ra" }),
      msg({ kind: "user_input", text: "b" }),
      msg({ kind: "reply", text: "rb" }),
    ]);

    expect(turns.map((t) => t.status)).toEqual(["completed", "completed"]);
    expect(turns.map((t) => t.runId)).toEqual(["__replay_1__", "__replay_2__"]);
    expect(turns.map((t) => t.turn)).toEqual([1, 2]);
    for (const t of turns) {
      expect(t.seenLogIds).toBeInstanceOf(Set);
      expect(t.seenLogIds.size).toBe(0);
      expect(typeof t.prompt).toBe("string");
      expect(typeof t.output).toBe("string");
    }
  });

  it("空消息数组 → 空轮次数组", () => {
    expect(buildReplayTurns([])).toEqual([]);
  });

  it("纯函数零副作用：不改入参（含嵌套 usage 对象）", () => {
    const messages: AgentLogMessageItem[] = [
      msg({ kind: "user_input", text: "问", usage: usage(1, 2) }),
      msg({ kind: "tool_use", tool_use_id: "u", tool_input: "i", usage: usage(1, 2) }),
      msg({
        kind: "tool_result",
        tool_use_id: "u",
        tool_result: "r",
        is_error: true,
        usage: usage(1, 2),
      }),
    ];
    const snapshot = JSON.parse(JSON.stringify(messages)) as AgentLogMessageItem[];

    buildReplayTurns(messages);

    expect(messages).toEqual(snapshot);
  });
});
