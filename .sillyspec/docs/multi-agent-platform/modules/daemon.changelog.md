## 2026-10-13-daemon-log-config-view — daemon 诊断只读 RPC

- 新增 src/diag-rpc.ts（readLogTail 尾部分块读：行 5000/字节 262144B 双上限先到先截 + truncated；getMaskedConfig 脱敏：SENSITIVE_CONFIG_FIELDS=['token','api_key']，len<16 全掩，D-001@v2）与 tests/diag-rpc.test.ts（12 用例）。
- daemon.ts 新增 _registerDiagRpcHandler 注册 daemon_log_tail / daemon_config_get（日志路径 DEFAULT_CONFIG_DIR+'daemon.log' 与写入方 getLogFile 同源；不 import cli.ts——其顶层 void main() 无入口守卫）。
