"use client";

/**
 * McpServerFormModal — 新建/编辑/复制 MCP Server 弹窗（变更
 * 2026-09-10-mcp-central-registry / task-11，照原型 prototype-mcp-central-registry.html
 * ⑤ 上半「新建 MCP Server（stdio）」段；ql-20260911-003-355a 密钥类型改造）。
 *
 * 字段（原型 .frow）：名称 / 保存到（我的库（私有）|平台共享库[admin]，edit 态
 * 锁定不可改——后端 McpServerUpdate 无 scope）/ command / args（每行一个，可空）/
 * env 键值表 + 「加密」列（**用户逐键指定**的密钥类型开关——新增行按键名子串
 * token/key/secret/password 给缺省建议勾选，用户可任意改；不再自动判定）/
 * 标签。
 *
 * 编辑态密钥行值固定为 `<set>` 占位——保留占位提交 = 后端保留既有密文不改
 * （service 占位语义，P0-2 修复）；改值即轮换该密钥。copy 态密钥行值置空
 * （密文不可读，复制需重填）。创建/复制提交占位符会被本地校验拦下（后端同拒）。
 *
 * 组件只负责表单与校验，提交回调上抛（页面层持有 create/update mutation）。
 * 名称 pattern 与后端 schema.py `_NAME_PATTERN` 一致（^[a-z0-9][a-z0-9-]{1,99}$）。
 *
 * 样式：antd Modal/Form（FRONTEND_PAGE_STYLE.md §6 语义——点遮罩不关 + 关闭即销毁
 * + layout="vertical" + 中文 rules message；antd v6 API：mask.closable=false +
 * destroyOnHidden）。
 */
import { Button, Form, Input, Modal, Select, Switch } from "antd";
import { useEffect } from "react";

import {
  isSecretEnvKey,
  MCP_SECRET_ENV_PLACEHOLDER,
  readStdioEntry,
  type McpServerRead,
} from "@/lib/api/mcp-registry";

/** env 键值行（表单中间形态；secret 三态：true/false=用户显式指定，undefined=按键名建议）。 */
export interface McpEnvRow {
  key: string;
  value: string;
  secret?: boolean;
}

/** 表单提交载荷（页面层据此组 POST/PATCH body）。 */
export interface McpServerFormSubmitPayload {
  name: string;
  /** 仅 create/copy 生效（edit 态后端不支持改 scope）。 */
  scope: "platform" | "mine";
  /** stdio server_config（编辑态密钥行值保留 `<set>` 占位=不改该密钥）。 */
  serverConfig: {
    type: "stdio";
    command: string;
    args: string[];
    env: Record<string, string>;
  };
  /** 用户指定的密钥键名清单（serverConfig.env 中对应键以密文落库）。 */
  secretEnvKeys: string[];
  tags: string[];
}

export interface McpServerFormModalProps {
  open: boolean;
  /** create=新建 / copy=复制新建（name 预填 `${name}-copy`）/ edit=编辑（scope 锁定）。 */
  mode: "create" | "copy" | "edit";
  /** edit/copy 的源 server（create 态忽略）。 */
  server: McpServerRead | null;
  /**
   * create 态的模板预填（task-12「从模板新建」）：name/command/args/env 预填，
   * secretEnvKeys 预勾加密行（模板只记键名不记值——值由用户补）。
   */
  template?: {
    name: string;
    command: string;
    args: string[];
    env: Record<string, string>;
    secretEnvKeys?: string[];
  } | null;
  /** 新建缺省保存位置（随当前 tab）。 */
  defaultScope: "platform" | "mine";
  /** 平台管理员判定（非 admin「保存到」无平台共享库选项）。 */
  isAdmin: boolean;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (payload: McpServerFormSubmitPayload) => void;
}

/** 名称校验（后端 _NAME_PATTERN 逐字一致）。 */
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,99}$/;

interface FormShape {
  name: string;
  scope: "platform" | "mine";
  command: string;
  args: string;
  env: McpEnvRow[];
  tags: string[];
}

function buildInitialValues(
  mode: McpServerFormModalProps["mode"],
  server: McpServerRead | null,
  defaultScope: "platform" | "mine",
  template: McpServerFormModalProps["template"],
): FormShape {
  if ((mode === "edit" || mode === "copy") && server) {
    const { command, args, env } = readStdioEntry(server.server_config);
    const secretKeys = new Set(server.secret_env_keys ?? []);
    // 明文行（secret=false）+ 密钥行（edit 态值=占位符保留语义 / copy 态置空待重填）
    const rows: McpEnvRow[] = [
      ...Object.entries(env).map(([key, value]) => ({ key, value, secret: false })),
      ...[...secretKeys].map((key) => ({
        key,
        value: mode === "edit" ? MCP_SECRET_ENV_PLACEHOLDER : "",
        secret: true,
      })),
    ];
    return {
      name: mode === "copy" ? `${server.name}-copy` : server.name,
      scope: server.owner_user_id === null ? "platform" : "mine",
      command,
      args: args.join("\n"),
      env: rows,
      tags: [...server.tags],
    };
  }
  if (mode === "create" && template) {
    const templateSecrets = new Set(template.secretEnvKeys ?? []);
    return {
      name: template.name,
      scope: defaultScope,
      command: template.command,
      args: template.args.join("\n"),
      env: [
        ...Object.entries(template.env).map(([key, value]) => ({
          key,
          value,
          secret: undefined,
        })),
        ...[...templateSecrets].map((key) => ({ key, value: "", secret: true })),
      ],
      tags: [],
    };
  }
  return { name: "", scope: defaultScope, command: "", args: "", env: [], tags: [] };
}

/** 行的生效密钥指定：显式开关优先，未触碰过的行按键名建议（用户可随时改）。 */
function resolveSecret(row: McpEnvRow | undefined): boolean {
  if (!row?.key) return false;
  return row.secret ?? isSecretEnvKey(row.key);
}

export function McpServerFormModal({
  open,
  mode,
  server,
  template,
  defaultScope,
  isAdmin,
  submitting,
  onClose,
  onSubmit,
}: McpServerFormModalProps) {
  const [form] = Form.useForm<FormShape>();
  const envRows = (Form.useWatch("env", form) ?? []) as McpEnvRow[];
  const watchedScope = Form.useWatch("scope", form);

  // 打开时按 mode 重置表单（destroyOnHidden 下 Form 实例复用，需显式 reset）。
  useEffect(() => {
    if (open) {
      form.resetFields();
      form.setFieldsValue(buildInitialValues(mode, server, defaultScope, template));
    }
  }, [open, mode, server, template, defaultScope, form]);

  const handleOk = async () => {
    const values = await form.validateFields();
    const env: Record<string, string> = {};
    const secretEnvKeys: string[] = [];
    for (const row of values.env ?? []) {
      const key = row?.key?.trim();
      if (!key) continue; // 空键行丢弃
      const secret = resolveSecret(row);
      if (secret) secretEnvKeys.push(key);
      env[key] = row?.value ?? "";
    }
    onSubmit({
      name: values.name.trim(),
      scope: values.scope,
      serverConfig: {
        type: "stdio",
        command: values.command.trim(),
        args: values.args
          .split("\n")
          .map((a) => a.trim())
          .filter((a) => a.length > 0),
        env,
      },
      secretEnvKeys,
      tags: (values.tags ?? []).map((t) => t.trim()).filter(Boolean),
    });
  };

  const scopeOptions: { value: "platform" | "mine"; label: string }[] = [
    { value: "mine", label: "我的库（私有）" },
    ...(isAdmin ? [{ value: "platform" as const, label: "平台共享库（全员可见）" }] : []),
  ];

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={
        mode === "edit"
          ? `编辑 MCP Server：${server?.name ?? ""}`
          : mode === "copy"
            ? `复制新建 MCP Server：${server?.name ?? ""}`
            : "新建 MCP Server（stdio）"
      }
      width={600}
      mask={{ closable: false }}
      destroyOnHidden
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={submitting} onClick={() => void handleOk()}>
            保存
          </Button>
        </div>
      }
    >
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item
          name="name"
          label="名称"
          rules={[
            { required: true, message: "名称不能为空" },
            {
              pattern: NAME_PATTERN,
              message: "小写字母/数字/连字符，2-100 字符，以小写字母或数字开头",
            },
          ]}
        >
          <Input className="font-mono" placeholder="如 mysql-dev" />
        </Form.Item>

        <Form.Item
          name="scope"
          label="保存到"
          rules={[{ required: true, message: "请选择保存位置" }]}
          extra={
            mode === "edit" ? "编辑时不可更改归属（后端不支持改 scope）" : undefined
          }
        >
          <Select
            options={scopeOptions}
            disabled={mode === "edit"}
          />
        </Form.Item>

        <Form.Item
          name="command"
          label="command"
          rules={[{ required: true, message: "command 不能为空" }]}
        >
          <Input className="font-mono" placeholder="如 npx -y @modelcontextprotocol/server-filesystem" />
        </Form.Item>

        <Form.Item name="args" label="args（每行一个，可空）">
          <Input.TextArea
            className="font-mono"
            rows={2}
            placeholder={"如 --readonly\n--verbose"}
          />
        </Form.Item>

        <Form.Item label="env 键值" className="mb-2">
          <Form.List
            name="env"
            rules={[
              {
                validator: (_rule, rows: McpEnvRow[] | undefined) => {
                  for (const row of rows ?? []) {
                    const key = row?.key?.trim();
                    if (!key) continue;
                    const isSecret = resolveSecret(row);
                    const value = row?.value ?? "";
                    if (value === MCP_SECRET_ENV_PLACEHOLDER) {
                      if (mode !== "edit" || !isSecret) {
                        return Promise.reject(
                          new Error(
                            isSecret
                              ? `密钥 ${key} 的值不能保留 ${MCP_SECRET_ENV_PLACEHOLDER}——新建/复制请输入真实值`
                              : `明文键 ${key} 的值不能是 ${MCP_SECRET_ENV_PLACEHOLDER} 占位符`,
                          ),
                        );
                      }
                    }
                  }
                  return Promise.resolve();
                },
              },
            ]}
          >
            {(fields, { add, remove }) => (
              <div className="flex flex-col gap-2" data-testid="mcp-form-env-rows">
                <div className="grid grid-cols-[1fr_1.4fr_76px_auto] items-center gap-2 text-[11px] font-medium text-muted-foreground">
                  <span>键</span>
                  <span>值</span>
                  <span>加密</span>
                  <span />
                </div>
                {fields.map((field) => {
                  const row = envRows[field.name];
                  const secret = resolveSecret(row);
                  return (
                    <div
                      key={field.key}
                      className="grid grid-cols-[1fr_1.4fr_76px_auto] items-center gap-2"
                    >
                      <Form.Item
                        name={[field.name, "key"]}
                        noStyle
                        rules={[{ required: true, message: "键不能为空" }]}
                      >
                        <Input className="font-mono" placeholder="MYSQL_HOST" />
                      </Form.Item>
                      <Form.Item name={[field.name, "value"]} noStyle>
                        <Input
                          className="font-mono"
                          placeholder={
                            secret
                              ? `值（编辑保留 ${MCP_SECRET_ENV_PLACEHOLDER} = 不改）`
                              : "值"
                          }
                        />
                      </Form.Item>
                      <span className="flex justify-center">
                        <Switch
                          size="small"
                          checked={secret}
                          onChange={(checked) =>
                            form.setFieldValue(["env", field.name, "secret"], checked)
                          }
                          checkedChildren="🔒"
                          unCheckedChildren="明"
                          aria-label={`加密开关 ${row?.key ?? ""}`}
                        />
                      </span>
                      <Button
                        type="text"
                        size="small"
                        danger
                        onClick={() => remove(field.name)}
                        aria-label="删除该 env 行"
                      >
                        删除
                      </Button>
                    </div>
                  );
                })}
                <Button type="dashed" size="small" onClick={() => add({ key: "", value: "" })}>
                  + 添加 env 键值
                </Button>
              </div>
            )}
          </Form.List>
        </Form.Item>

        <p className="mt-0 mb-4 text-[11px] text-muted-foreground">
          🔒 加密开关由你逐键指定：开启的键将以密文落库（任何管理界面只见{" "}
          <code className="rounded bg-muted px-1">{MCP_SECRET_ENV_PLACEHOLDER}</code>
          ，仅 daemon 注入链解密）；新增行按键名预判勾选，可手动改。编辑时保留{" "}
          <code className="rounded bg-muted px-1">{MCP_SECRET_ENV_PLACEHOLDER}</code>{" "}
          提交即不修改该密钥。
        </p>

        <Form.Item
          name="tags"
          label="标签"
          extra={
            watchedScope === "platform"
              ? "平台库标签供全员筛选复用"
              : "标签仅在库内筛选用"
          }
        >
          <Select
            mode="tags"
            open={false}
            suffixIcon={null}
            tokenSeparators={[" ", ","]}
            placeholder="输入后回车添加，如 数据库"
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
