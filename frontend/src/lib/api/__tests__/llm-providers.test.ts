/**
 * task-12：lib/api/llm-providers 单测。
 *
 * 覆盖：
 *   1. 四个 API 方法签名（method + path）与后端 router 一一对应
 *      （set/unset-default 已随 ql-20260820-006 移除）。
 *   2. formToCreate：表单值 → POST body 映射（角色映射嵌套 / extra_env 键值对）。
 *   3. formToUpdate：api_key 留空 → **不出现在 PATCH body**（铁律）；有值则携带。
 *   4. cleanRoleMappings：丢弃空行、one_m 仅随 model 携带。
 *   5. cleanExtraEnv：丢弃空键、保留空值。
 *   6. cleanSettingsConfig：env 空串占位剔除 + formToCreate/formToUpdate 接线
 *      （ql-20260823-007）。
 *
 * fetch harness 仿 lib/workspaces.test.ts（apiFetch 内部走 fetch）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cleanExtraEnv,
  cleanRoleMappings,
  cleanSettingsConfig,
  createProvider,
  deleteProvider,
  formToCreate,
  formToUpdate,
  listProviders,
  updateProvider,
  type LlmProviderFormValues,
} from "@/lib/api/llm-providers";

// ── fetch harness ────────────────────────────────────────────────────────

function mockFetch(resp: { status: number; body: unknown }) {
  const fetchMock = vi.fn();
  const bodyStr = JSON.stringify(resp.body);
  let lastUrl = "";
  let lastInit: RequestInit | undefined;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    lastUrl = url;
    lastInit = init;
    const headers = new Headers({ "content-type": "application/json" });
    return {
      ok: resp.status >= 200 && resp.status < 300,
      status: resp.status,
      statusText: resp.status === 200 ? "OK" : "Error",
      headers,
      text: async () => bodyStr,
      json: async () => resp.body,
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    fetchMock,
    lastUrl: () => lastUrl,
    lastMethod: (): string | undefined => lastInit?.method,
    lastBody: (): Record<string, unknown> | null => {
      if (!lastInit?.body) return null;
      try {
        return JSON.parse(lastInit.body as string) as Record<string, unknown>;
      } catch {
        return null;
      }
    },
  };
}

const READ = {
  id: "p-1",
  user_id: "u-1",
  name: "Kimi 中转",
  agent_kinds: ["claude"],
  base_url: "https://api.moonshot.cn/anthropic",
  models: [],
  notes: null,
  website_url: null,
  auth_field: "ANTHROPIC_AUTH_TOKEN",
  extra_env: null,
  is_default: false,
  api_key_masked: "sk-1...abcd",
  created_at: "2026-07-25T10:00:00Z",
  updated_at: "2026-07-25T10:00:00Z",
};

const FORM_VALUES: LlmProviderFormValues = {
  name: "Kimi 中转",
  agent_kinds: ["claude"],
  base_url: "https://api.moonshot.cn/anthropic",
  api_key: "sk-secret-1234",
  auth_field: "ANTHROPIC_AUTH_TOKEN",
  api_format: "anthropic",
  models: [{ name: "kimi-k2", multimodal: "auto", roles: ["sonnet"], one_m: false }],
  notes: "公司专用",
  website_url: "https://moonshot.cn",
  extra_env: {
    API_TIMEOUT_MS: "3000000",
    "": "should-drop", // 空键丢弃
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  },
};

describe("llm-providers API — method + path", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("listProviders → GET /api/llm-providers，返回 items 数组", async () => {
    const h = mockFetch({ status: 200, body: { items: [READ], total: 1 } });
    const items = await listProviders();
    // GET 请求 apiFetch 不显式设 method（fetch 默认 GET → init.method undefined）
    expect(h.lastMethod() ?? "GET").toBe("GET");
    expect(h.lastUrl()).toContain("/api/llm-providers");
    expect(h.lastUrl()).not.toContain("/api/llm-providers/");
    expect(items).toHaveLength(1);
    expect(items[0]!.id).toBe("p-1");
  });

  it("createProvider → POST /api/llm-providers + body", async () => {
    const h = mockFetch({ status: 201, body: READ });
    await createProvider({
      name: "Kimi 中转",
      agent_kinds: ["claude"],
      auth_field: "ANTHROPIC_AUTH_TOKEN",
    });
    expect(h.lastMethod()).toBe("POST");
    expect(h.lastUrl()).toContain("/api/llm-providers");
    expect(h.lastUrl()).not.toContain("/set-default");
    const body = h.lastBody();
    expect(body).not.toBeNull();
    expect(body!.name).toBe("Kimi 中转");
  });

  it("updateProvider → PATCH /api/llm-providers/{id} + body", async () => {
    const h = mockFetch({ status: 200, body: READ });
    await updateProvider("p-1", { name: "renamed" });
    expect(h.lastMethod()).toBe("PATCH");
    expect(h.lastUrl()).toContain("/api/llm-providers/p-1");
    const body = h.lastBody();
    expect(body!.name).toBe("renamed");
  });

  it("deleteProvider → DELETE /api/llm-providers/{id}", async () => {
    const h = mockFetch({ status: 204, body: null });
    await deleteProvider("p-1");
    expect(h.lastMethod()).toBe("DELETE");
    expect(h.lastUrl()).toContain("/api/llm-providers/p-1");
  });

  it("id 含特殊字符走 encodeURIComponent（不破坏路径）", async () => {
    const h = mockFetch({ status: 204, body: null });
    await deleteProvider("p 1/2");
    expect(h.lastUrl()).toContain("/api/llm-providers/p%201%2F2");
  });
});

describe("formToCreate — 表单值 → POST body 映射", () => {
  it("角色映射嵌套结构保留（清洗空行）、extra_env 键值对、api_key 透传", () => {
    const body = formToCreate(FORM_VALUES);
    expect(body.name).toBe("Kimi 中转");
    expect(body.agent_kinds).toEqual(["claude"]);
    expect(body.api_key).toBe("sk-secret-1234");
    expect(body.auth_field).toBe("ANTHROPIC_AUTH_TOKEN");
    // D-001：models 整表透传（条目级清洗归表单）
    expect(body.models!.length).toBeGreaterThan(0);
    expect(body.models![0]!.name).toBe("kimi-k2");
    // opus 有 model 且 one_m=true → one_m 随 model 携带

    // extra_env：空键丢弃，其余保留
    expect(body.extra_env).toEqual({
      API_TIMEOUT_MS: "3000000",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    });
  });

  it("全部高级项为空时 model_role_mappings/extra_env 落 null", () => {
    const body = formToCreate({
      ...FORM_VALUES,
      models: [],
      extra_env: {},
      api_key: "sk-x",
    });
    expect(body.models).toEqual([]);
    expect(body.extra_env).toBeNull();
    expect(body.models).toEqual([]);
    expect(body.api_key).toBe("sk-x");
  });
});

describe("formToUpdate — api_key 留空不出现在 PATCH body（铁律）", () => {
  it("api_key 留空（空串）→ body 不含 api_key 键", () => {
    const body = formToUpdate({ ...FORM_VALUES, api_key: "" });
    expect(body).not.toHaveProperty("api_key");
    // 其余字段仍正常透传
    expect(body.name).toBe("Kimi 中转");
    expect(body.auth_field).toBe("ANTHROPIC_AUTH_TOKEN");
  });

  it("api_key 全空白 → 同样不含 api_key 键", () => {
    const body = formToUpdate({ ...FORM_VALUES, api_key: "   " });
    expect(body).not.toHaveProperty("api_key");
  });

  it("api_key 有值 → 携带到 body（用于轮换密钥）", () => {
    const body = formToUpdate({ ...FORM_VALUES, api_key: "sk-new-4567" });
    expect(body.api_key).toBe("sk-new-4567");
  });

  it("extra_env 清洗（角色映射断言已随旧字段退役）", () => {
    const body = formToUpdate(FORM_VALUES);
    expect(body.extra_env).toEqual({
      API_TIMEOUT_MS: "3000000",
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    });
  });

  it("agent_kinds 透传到 PATCH body（编辑引擎集合真正提交，2026-10-07 followup）", () => {
    const body = formToUpdate({ ...FORM_VALUES, agent_kinds: ["claude", "codex"] });
    expect(body.agent_kinds).toEqual(["claude", "codex"]);
  });
});


describe("cleanExtraEnv — 边界", () => {
  it("null/undefined → null", () => {
    expect(cleanExtraEnv(null)).toBeNull();
    expect(cleanExtraEnv(undefined)).toBeNull();
  });

  it("空键丢弃、值保留（含空值）", () => {
    const out = cleanExtraEnv({
      KEY_EMPTY_VAL: "",
      "": "dropped",
      A: "1",
    });
    expect(out).toEqual({ KEY_EMPTY_VAL: "", A: "1" });
  });

  it("键前后空白被 trim", () => {
    const out = cleanExtraEnv({ "  SPACED  ": "v" });
    expect(out).toEqual({ SPACED: "v" });
  });
});

// ql-20260823-007：settings_config 清洗——env 空串占位（历史预设预填的
// ANTHROPIC_AUTH_TOKEN: ""）按「未配置」剔除，防止 daemon 注入链被空串覆盖真实 key。
describe("cleanSettingsConfig — env 空串占位剔除（ql-20260823-007）", () => {
  it("空串 AUTH_TOKEN 占位被剔除，其余键保留", () => {
    const out = cleanSettingsConfig({
      env: {
        ANTHROPIC_BASE_URL: "https://open.bigmodel.cn/api/anthropic",
        ANTHROPIC_AUTH_TOKEN: "",
        ANTHROPIC_MODEL: "glm-5.1",
      },
    });
    expect(out).toEqual({
      env: {
        ANTHROPIC_BASE_URL: "https://open.bigmodel.cn/api/anthropic",
        ANTHROPIC_MODEL: "glm-5.1",
      },
    });
  });

  it("env 剔空后为空对象 → 删 env；整体为空 → null", () => {
    expect(cleanSettingsConfig({ env: { ANTHROPIC_AUTH_TOKEN: "" } })).toBeNull();
    expect(cleanSettingsConfig({})).toBeNull();
    expect(cleanSettingsConfig(null)).toBeNull();
    expect(cleanSettingsConfig(undefined)).toBeNull();
  });

  it("非字符串值与顶层键原样保留（attribution / 数字值）", () => {
    const out = cleanSettingsConfig({
      attribution: { commit: "", pr: "" },
      env: { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: 1, KEEP: "v" },
    });
    expect(out).toEqual({
      attribution: { commit: "", pr: "" },
      env: { CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: 1, KEEP: "v" },
    });
  });

  it("formToCreate / formToUpdate 均走 cleanSettingsConfig", () => {
    const cfg = {
      env: { ANTHROPIC_AUTH_TOKEN: "", ANTHROPIC_MODEL: "glm-5.1" },
    };
    const created = formToCreate({ ...FORM_VALUES, settings_config: cfg });
    expect(created.settings_config).toEqual({
      env: { ANTHROPIC_MODEL: "glm-5.1" },
    });
    const updated = formToUpdate({ ...FORM_VALUES, settings_config: cfg });
    expect(updated.settings_config).toEqual({
      env: { ANTHROPIC_MODEL: "glm-5.1" },
    });
  });

  it("settings_config 缺省 → body 落 null（不误造空对象）", () => {
    const created = formToCreate(FORM_VALUES);
    expect(created.settings_config).toBeNull();
  });
});
