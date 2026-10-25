/**
 * 配置切换说明行单测（2026-10-25-session-config-deferred-switch / FR-06 / D-001）。
 *
 * 依据：
 *   - components/daemon/session-panel/page-helpers.tsx buildConfigChangeLine（纯函数）
 *   - components/daemon/session-panel/page-helpers.tsx enrichDisplayTurns（历史路：
 *     显示序相邻轮快照对比 → configChangeLine；whoLine.modelName = 档案快照 model）
 *   - components/daemon/turn-timeline.tsx SessionTurnView.configChangeLine（渲染契约：
 *     非空才渲染，零回归）
 *
 * 覆盖面：文案生成（单维/多维/null 口径/缺快照）+ enrich 相邻对比（变化轮标注、
 * 无变化不标、预置值优先保留、孤儿轮参与对比）。
 */
import { describe, it, expect } from "vitest";

import {
  buildConfigChangeLine,
  enrichDisplayTurns,
  type ConfigChangeWho,
} from "../page-helpers";
import type { SessionTurnView } from "@/components/daemon/turn-timeline";
import type { SessionRunRead } from "@/lib/daemon";
import type { LlmProviderRead } from "@/lib/api/llm-providers";

const WHO = (over: Partial<ConfigChangeWho> = {}): ConfigChangeWho => ({
  profileName: null,
  providerName: null,
  modelName: null,
  ...over,
});

describe("buildConfigChangeLine 文案生成", () => {
  it("prev 缺失（首轮/无快照）→ null 不编造", () => {
    expect(buildConfigChangeLine(null, WHO())).toBeNull();
    expect(buildConfigChangeLine(WHO(), null)).toBeNull();
    expect(buildConfigChangeLine(undefined, WHO())).toBeNull();
  });

  it("全等 → null（无变化不渲染）", () => {
    const who = WHO({
      profileName: "知识经理",
      providerName: "GLM 平台",
      modelName: "glm-5.3",
    });
    expect(buildConfigChangeLine(who, { ...who })).toBeNull();
  });

  it("单维模型变化 → 「模型已切换 A → B」（用户示例口径）", () => {
    expect(
      buildConfigChangeLine(
        WHO({ providerName: "GLM 个人套餐", modelName: "GLM-5.3" }),
        WHO({ providerName: "GLM 个人套餐", modelName: "GLM-5.3-FlashX" }),
      ),
    ).toBe("模型已切换 GLM-5.3 → GLM-5.3-FlashX");
  });

  it("单维供应商变化 → 「供应商已切换 A → B」；null → 本机默认", () => {
    expect(
      buildConfigChangeLine(
        WHO({ providerName: "Kimi 中转" }),
        WHO({ providerName: null }),
      ),
    ).toBe("供应商已切换 Kimi 中转 → 本机默认");
    expect(
      buildConfigChangeLine(
        WHO({ providerName: null }),
        WHO({ providerName: "Kimi 中转" }),
      ),
    ).toBe("供应商已切换 本机默认 → Kimi 中转");
  });

  it("档案变化 → 「档案已切换 A → B」；null → 未指定、模型 null → 默认", () => {
    expect(
      buildConfigChangeLine(
        WHO({ profileName: "知识经理", modelName: "glm-5.3" }),
        WHO({ profileName: null, modelName: null }),
      ),
    ).toBe("模型已切换 glm-5.3 → 默认 · 档案已切换 知识经理 → 未指定");
  });

  it("多维同时变化 → 「 · 」连接（供应商 · 模型 · 档案固定顺序）", () => {
    expect(
      buildConfigChangeLine(
        WHO({ profileName: "A", providerName: "X", modelName: "m1" }),
        WHO({ profileName: "B", providerName: "Y", modelName: "m2" }),
      ),
    ).toBe(
      "供应商已切换 X → Y · 模型已切换 m1 → m2 · 档案已切换 A → B",
    );
  });

  it("undefined 与 null 同视（modelName 缺省不误报变化）", () => {
    expect(
      buildConfigChangeLine(
        WHO({ modelName: undefined }),
        WHO({ modelName: null }),
      ),
    ).toBeNull();
  });
});

// ── enrichDisplayTurns 历史路相邻对比 ────────────────────────────────────────

function runMeta(over: Partial<SessionRunRead> = {}): SessionRunRead {
  return {
    id: "run-x",
    created_at: "2026-10-25T10:00:00Z",
    status: "completed",
    error_code: null,
    error_detail: null,
    started_at: "2026-10-25T10:00:00Z",
    finished_at: "2026-10-25T10:01:00Z",
    exit_code: 0,
    agent_profile_snapshot: null,
    llm_provider_id: null,
    input_tokens: null,
    output_tokens: null,
    failure_summary: null,
    user_id: null,
    sender_name: null,
    ...over,
  } as SessionRunRead;
}

function turn(over: Partial<SessionTurnView> = {}): SessionTurnView {
  return {
    runId: "run-x",
    turn: 1,
    prompt: "hi",
    output: "",
    status: "completed",
    seenLogIds: new Set<string>(),
    inputTokens: null,
    outputTokens: null,
    ctxTokens: null,
    apiDurationMs: null,
    errorDetail: null,
    processItems: [],
    ...over,
  } as SessionTurnView;
}

const PROVIDERS = [
  { id: "prov-glm", name: "GLM 平台" },
  { id: "prov-kimi", name: "Kimi 中转" },
] as unknown as LlmProviderRead[];

describe("enrichDisplayTurns 历史路切换说明", () => {
  it("相邻轮快照模型/供应商变化 → 后轮标注切换说明（前轮不标）", () => {
    const metaA = runMeta({
      id: "run-a",
      agent_profile_snapshot: { name: "知识经理", model: "glm-5.3" },
      llm_provider_id: "prov-glm",
    });
    const metaB = runMeta({
      id: "run-b",
      agent_profile_snapshot: { name: "知识经理", model: "glm-5.3-flashx" },
      llm_provider_id: "prov-glm",
    });
    const turns = [
      turn({ runId: "run-a", turn: 1 }),
      turn({ runId: "run-b", turn: 2 }),
    ];
    const runsMeta = new Map([
      ["run-a", metaA],
      ["run-b", metaB],
    ]);
    const enriched = enrichDisplayTurns(turns, runsMeta, PROVIDERS, "Claude Code", null);
    expect(enriched[0]?.configChangeLine ?? null).toBeNull();
    expect(enriched[1]?.configChangeLine).toBe(
      "模型已切换 glm-5.3 → glm-5.3-flashx",
    );
    // whoLine 扩展 modelName 生效（档案快照 model 直通）
    expect(enriched[1]?.whoLine?.modelName).toBe("glm-5.3-flashx");
  });

  it("配置无变化 / 首轮 → 不标注（零回归）", () => {
    const meta = runMeta({
      agent_profile_snapshot: { name: "知识经理", model: "m1" },
      llm_provider_id: "prov-glm",
    });
    const turns = [turn({ runId: "run-a", turn: 1 }), turn({ runId: "run-b", turn: 2 })];
    const runsMeta = new Map([
      ["run-a", meta],
      ["run-b", { ...meta, id: "run-b" } as SessionRunRead],
    ]);
    const enriched = enrichDisplayTurns(turns, runsMeta, PROVIDERS, "Claude Code", null);
    expect(enriched[0]?.configChangeLine ?? null).toBeNull();
    expect(enriched[1]?.configChangeLine ?? null).toBeNull();
  });

  it("实时路预置值优先保留（不覆盖——含会话级模型覆盖维度）", () => {
    const metaB = runMeta({
      id: "run-b",
      agent_profile_snapshot: { name: "知识经理", model: "glm-5.3" },
    });
    const turns = [
      turn({ runId: "run-a", turn: 1 }),
      turn({
        runId: "run-b",
        turn: 2,
        // 快照对比路会生成同文案；预置另一形态文本验证「预置优先不覆盖」
        configChangeLine: "模型已切换 GLM-5.3(个人套餐) → GLM-5.3-FlashX(个人套餐)",
      }),
    ];
    const runsMeta = new Map([["run-b", metaB]]);
    const enriched = enrichDisplayTurns(turns, runsMeta, PROVIDERS, "Claude Code", null);
    expect(enriched[1]?.configChangeLine).toBe(
      "模型已切换 GLM-5.3(个人套餐) → GLM-5.3-FlashX(个人套餐)",
    );
  });
});
