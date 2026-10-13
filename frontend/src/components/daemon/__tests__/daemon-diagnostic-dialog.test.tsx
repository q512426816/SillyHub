// task-03（2026-10-13-daemon-log-config-view / FR-01~FR-08 / D-001@v2 /
// D-002@v1 / D-003@v1 / D-007@v1）：DaemonDiagnosticDialog（daemon 诊断
// 只读双 Tab 弹窗）单测。
//
// 覆盖：
//   1. 日志 Tab 正常态：尾部行渲染 + 路径/大小元信息 + 下载触发；
//   2. truncated 提示（字节上限截断）；
//   3. exists:false 提示（前台运行不落盘）；
//   4. 422 老 daemon → 「daemon 版本过旧」升级提示条；
//   5. 通用错误条（504 离线）；
//   6. 配置 Tab：掩码数据渲染 + masked_fields 提示 + 只读标注；
//   7. 「显示明文」→ fetchMachineConfig(id, true) 二次拉取；
//   8. D-007 下载恒脱敏：明文态点下载，产物仍是 reveal=false 掩码 JSON。
//
// 测试纪律：FIRST / AAA / 仅 mock 网络层（@/lib/daemon/machines 两函数）；
// 断言用 aria-label / 文本，避开样式细节。

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { DaemonDiagnosticDialog } from "../daemon-diagnostic-dialog";
import type { DaemonMachineRead } from "@/lib/daemon/machines";
import { ApiError } from "@/lib/api";

/* ----- mock 网络层 ----- */

const machinesApi = vi.hoisted(() => ({
  fetchMachineLogTail: vi.fn(),
  fetchMachineConfig: vi.fn(),
}));

vi.mock("@/lib/daemon/machines", () => ({
  fetchMachineLogTail: machinesApi.fetchMachineLogTail,
  fetchMachineConfig: machinesApi.fetchMachineConfig,
}));

/* ----- fixture ----- */

function makeMachine(overrides: Partial<DaemonMachineRead> = {}): DaemonMachineRead {
  return {
    id: "inst-1",
    hostname: "qinyi-DESKTOP",
    display_alias: null,
    os: "windows",
    arch: "x64",
    status: "online",
    last_heartbeat_at: "2026-10-13T10:00:00Z",
    version: "1.42.0",
    build_id: "b1",
    started_at: null,
    created_at: "2026-10-01T00:00:00Z",
    runtime_count: 2,
    online_runtime_count: 2,
    runtimes: [],
    ...overrides,
  } as DaemonMachineRead;
}

const LOG_OK = {
  path: "C:/Users/u/.sillyhub/daemon/daemon.log",
  size: 2345,
  mtime: "2026-10-13T10:00:00Z",
  exists: true,
  lines: ["[daemon.heartbeat] ok=1", "[daemon.ws] event=connected"],
  line_count: 2,
  truncated: false,
};

const CONFIG_MASKED = {
  path: "C:/Users/u/.sillyhub/daemon/config-3fa9c2e1.json",
  config: { token: "sk-l***efgh", poll_interval: 30 },
  masked_fields: ["token"],
};

const CONFIG_PLAIN = {
  ...CONFIG_MASKED,
  config: { token: "sk-live-abcdefgh", poll_interval: 30 },
  masked_fields: [],
};

function apiError(status: number, code: string, message: string): ApiError {
  return new ApiError(status, { message, code, request_id: null, details: null });
}

let createObjectUrlSpy: ReturnType<typeof vi.fn>;

/** jsdom Blob 无 text()——FileReader 异步读取替代。 */
function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error);
    fr.readAsText(blob);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  createObjectUrlSpy = vi.fn(() => "blob:mock");
  vi.spyOn(URL, "createObjectURL").mockImplementation(
    createObjectUrlSpy as unknown as (obj: Blob | MediaSource) => string,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ----- 用例 ----- */

describe("DaemonDiagnosticDialog — 日志 Tab", () => {
  it("正常态：渲染尾部行 + 元信息，下载触发 Blob（FR-01/02）", async () => {
    machinesApi.fetchMachineLogTail.mockResolvedValue(LOG_OK);
    render(
      <DaemonDiagnosticDialog
        machine={makeMachine()}
        initialTab="logs"
        onClose={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("[daemon.ws] event=connected")).toBeInTheDocument();
    });
    expect(screen.getByText(/daemon\.log/)).toBeInTheDocument();
    // 默认 tail=500 透传
    expect(machinesApi.fetchMachineLogTail).toHaveBeenCalledWith("inst-1", 500);

    fireEvent.click(screen.getByRole("button", { name: /下载日志片段/ }));
    expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);
    expect(await readBlob(createObjectUrlSpy.mock.calls[0]![0] as Blob)).toBe(
      LOG_OK.lines.join("\n"),
    );
  });

  it("truncated=true 时提示按字节上限截断（FR-01/D-002）", async () => {
    machinesApi.fetchMachineLogTail.mockResolvedValue({
      ...LOG_OK,
      truncated: true,
      line_count: 300,
    });
    render(
      <DaemonDiagnosticDialog
        machine={makeMachine()}
        initialTab="logs"
        onClose={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/仅展示末尾 256KB 内的 300 行/)).toBeInTheDocument();
    });
  });

  it("exists=false 时提示前台运行不落盘（FR-07）", async () => {
    machinesApi.fetchMachineLogTail.mockResolvedValue({
      ...LOG_OK,
      exists: false,
      size: 0,
      mtime: "",
      lines: [],
      line_count: 0,
    });
    render(
      <DaemonDiagnosticDialog
        machine={makeMachine()}
        initialTab="logs"
        onClose={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("daemon.log 不存在")).toBeInTheDocument();
    });
  });

  it("422 → daemon 版本过旧升级提示条（FR-06）", async () => {
    machinesApi.fetchMachineLogTail.mockRejectedValue(
      apiError(422, "HTTP_422_DAEMON_DIAG_UNSUPPORTED", "当前机器的守护进程版本过旧"),
    );
    render(
      <DaemonDiagnosticDialog
        machine={makeMachine()}
        initialTab="logs"
        onClose={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("daemon 版本过旧，暂不支持在线查看")).toBeInTheDocument();
    });
    // 升级指路文案在场
    expect(screen.getByText(/升级 daemon/)).toBeInTheDocument();
  });

  it("504 → 通用错误条展示中文信息（FR-08）", async () => {
    machinesApi.fetchMachineLogTail.mockRejectedValue(
      apiError(504, "HTTP_504_DAEMON_RUNTIME_OFFLINE", "守护进程当前离线"),
    );
    render(
      <DaemonDiagnosticDialog
        machine={makeMachine()}
        initialTab="logs"
        onClose={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("日志拉取失败")).toBeInTheDocument();
    });
    expect(screen.getByText("守护进程当前离线")).toBeInTheDocument();
  });
});

describe("DaemonDiagnosticDialog — 配置 Tab", () => {
  it("掩码态：渲染 JSON + 已隐藏字段提示 + 只读标注（FR-03/D-003）", async () => {
    machinesApi.fetchMachineConfig.mockResolvedValue(CONFIG_MASKED);
    render(
      <DaemonDiagnosticDialog
        machine={makeMachine()}
        initialTab="config"
        onClose={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/config-3fa9c2e1\.json/)).toBeInTheDocument();
    });
    // 默认不传明文（reveal=false，D-001@v2）
    expect(machinesApi.fetchMachineConfig).toHaveBeenCalledWith("inst-1", false);
    expect(screen.getByText(/sk-l\*\*\*efgh/)).toBeInTheDocument();
    expect(screen.getByText(/已隐藏字段：token/)).toBeInTheDocument();
    expect(screen.getByText("只读")).toBeInTheDocument();
  });

  it("「显示明文」触发 reveal=true 二次拉取并展示明文（FR-04）", async () => {
    machinesApi.fetchMachineConfig.mockResolvedValueOnce(CONFIG_MASKED);
    machinesApi.fetchMachineConfig.mockResolvedValueOnce(CONFIG_PLAIN);
    render(
      <DaemonDiagnosticDialog
        machine={makeMachine()}
        initialTab="config"
        onClose={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/已隐藏字段：token/)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /显示明文/ }));
    await waitFor(() => {
      expect(screen.getByText(/sk-live-abcdefgh/)).toBeInTheDocument();
    });
    expect(machinesApi.fetchMachineConfig).toHaveBeenLastCalledWith("inst-1", true);
  });

  it("D-007 下载恒脱敏：明文态点下载，产物仍是掩码 JSON", async () => {
    machinesApi.fetchMachineConfig.mockResolvedValueOnce(CONFIG_MASKED);
    machinesApi.fetchMachineConfig.mockResolvedValueOnce(CONFIG_PLAIN);
    render(
      <DaemonDiagnosticDialog
        machine={makeMachine()}
        initialTab="config"
        onClose={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/已隐藏字段：token/)).toBeInTheDocument();
    });
    // 切到明文态
    fireEvent.click(screen.getByRole("button", { name: /显示明文/ }));
    await waitFor(() => {
      expect(screen.getByText(/sk-live-abcdefgh/)).toBeInTheDocument();
    });
    // 下载——即使页面在明文态，产物也必须是掩码数据
    fireEvent.click(screen.getByRole("button", { name: /下载配置/ }));
    expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);
    const text = await readBlob(createObjectUrlSpy.mock.calls[0]![0] as Blob);
    expect(text).toContain("sk-l***efgh");
    expect(text).not.toContain("sk-live-abcdefgh");
  });
});
