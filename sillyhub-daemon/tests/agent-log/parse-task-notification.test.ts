/**
 * 2026-10-28-bg-task-status-report task-02：task-notification 终态载荷提取单测。
 *
 * fixture 形态取自本会话 rollout 实录（ba591937 会话 jsonl，50 处实录样本）：
 * user 消息 content 为 <task-notification> 开头文本块，四标签 task-id /
 * tool-use-id / output-file / status；status 三值 completed/failed/stopped。
 */
import { describe, expect, it } from "vitest";

import { extractTaskNotifications, parseTaskNotification } from "../../src/agent-log/parse-claude-code-jsonl.js";

const SAMPLE = [
  "<task-notification>",
  "<task-id>bl0wkgj01</task-id>",
  "<tool-use-id>call_3830d816b07e44b8a8f848c2</tool-use-id>",
  "<output-file>C:\\temp\\tasks\\bl0wkgj01.output</output-file>",
  "<status>completed</status>",
  "</task-notification>",
  "",
  "For task-id: bl0wkgj01",
].join("\n");

describe("parseTaskNotification（task-02 / FR-01）", () => {
  it("实录形态四字段全提取（completed）", () => {
    expect(parseTaskNotification(SAMPLE)).toEqual({
      taskId: "bl0wkgj01",
      toolUseId: "call_3830d816b07e44b8a8f848c2",
      status: "completed",
      outputFile: "C:\\temp\\tasks\\bl0wkgj01.output",
    });
  });

  it("failed / stopped 两态同样通过（三值封闭枚举）", () => {
    const failed = SAMPLE.replace("<status>completed</status>", "<status>failed</status>");
    expect(parseTaskNotification(failed)?.status).toBe("failed");
    const stopped = SAMPLE.replace("<status>completed</status>", "<status>stopped</status>");
    expect(parseTaskNotification(stopped)?.status).toBe("stopped");
  });

  it("output-file 标签缺失时 outputFile 为 null（可选字段容错）", () => {
    const noFile = SAMPLE.replace(
      /<output-file>[^<]*<\/output-file>\n/,
      "",
    );
    expect(parseTaskNotification(noFile)?.outputFile).toBeNull();
  });

  it("非 task-notification 前缀文本返回 null（普通用户输入/其他注入零误伤）", () => {
    expect(parseTaskNotification("用户普通输入")).toBeNull();
    expect(
      parseTaskNotification("<system-reminder>其他系统注入</system-reminder>"),
    ).toBeNull();
  });

  it("task-id / tool-use-id 缺失或 status 未知值返回 null（格式漂移 fail-safe）", () => {
    const noTaskId = SAMPLE.replace(/<task-id>[^<]*<\/task-id>\n/, "");
    expect(parseTaskNotification(noTaskId)).toBeNull();
    const badStatus = SAMPLE.replace(
      "<status>completed</status>",
      "<status>weird</status>",
    );
    expect(parseTaskNotification(badStatus)).toBeNull();
  });
});

describe("extractTaskNotifications（task-03 扫描环消费 / 多块提取）", () => {
  it("日志末段多个 task-notification 块全部提取（含前后杂散文本不干扰）", () => {
    const text =
      "user 普通输入文本" + SAMPLE + "中间杂散输出行" + SAMPLE
        .replace("bl0wkgj01", "second01")
        .replace("completed", "failed");
    const all = extractTaskNotifications(text);
    expect(all).toHaveLength(2);
    expect(all[0]).toMatchObject({ taskId: "bl0wkgj01", status: "completed" });
    expect(all[1]).toMatchObject({ taskId: "second01", status: "failed" });
  });

  it("零块/全失配块返回空数组（不抛错）", () => {
    expect(extractTaskNotifications("")).toEqual([]);
    expect(extractTaskNotifications("<task-notification>残缺无闭合")).toEqual([]);
  });
});
