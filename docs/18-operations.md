# 18. 运维：启动、备份、恢复、审计导出

- 状态：2026-11-17 v1 脚本已落地并做过非破坏性验证。
- 关联：[13 MVP 架构](13-mvp-architecture.md) · [16 长期驻守](16-long-running-and-intake.md) · [记录 23](records/2026-11-17-23-ops.md)

## 1. 一键启动

`scripts/start-agent-im.ps1`：

```powershell
cd D:\Git\learn\agent-im
powershell -ExecutionPolicy Bypass -File scripts\start-agent-im.ps1
```

行为：

- 检查 `127.0.0.1:8008`，未运行则在 WSL `agentim` 里 `nohup tuwunel`；
- 检查 `127.0.0.1:8790/api/health`，未运行则后台启动 `node server.mjs`；
- 日志：`app/data/server.log`、`app/data/server.err.log`；
- 参数：`-Distro agentim`、`-Port 8790`、`-NoTuwunel`。

Windows 开机自启可以放一个快捷方式到 `shell:startup`，或建任务计划程序：触发器“登录时”，操作运行上面的 PowerShell 命令；不要以高权限运行，避免端口/凭据问题。

## 2. 备份

`scripts/backup-data.ps1`：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\backup-data.ps1
```

- 默认输出到 `agent-im/backups/agent-im-data-<timestamp>.zip`；
- 包含：`state.json`、`tasks.json`、`gateway-state.json`、`audit.jsonl`、`agents/`、`media/`；
- 不包含 `bench/` 实验 workspace（可由 fixture 复现，且可能很大）；
- **zip 含 Matrix token/密码**，必须放在受控位置，不要提交/外发。

建议任务计划每天备份；保留策略自己定。

## 3. 恢复

先停止 app（8790 不能还在监听）。

先干跑（只解压到 `app/data-restored-<stamp>/` 检查，不覆盖）：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\restore-data.ps1 -Zip D:\path\to\backup.zip
```

确认后应用（会先自动备份当前数据，再替换 `state/tasks/gateway-state/audit/agents/media`）：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\restore-data.ps1 -Zip D:\path\to\backup.zip -Apply
```

需要手动输入 `RESTORE`。恢复后重新启动 app。

## 4. 审计导出

- 活动页右上角「导出 JSONL」；或 `GET /api/audit/export`。
- 返回 `application/x-ndjson`，文件名带时间戳；内容为 `audit.jsonl` 原始行。
- 含工具命令/文件路径等本地敏感信息，导出后注意存放。

## 5. 健康与排障

- `GET /api/health`：app/gateway/房间列表；
- `GET /api/events`：SSE 实时活动；
- `GET /api/audit`：最近约 5000 行；
- Tuwunel：`http://127.0.0.1:8008/_matrix/client/versions`；
- 端口：只绑 loopback（8008/8790），不要做 portproxy/公网暴露。

## 6. 边界

- 不是 Windows 服务/守护进程：node 崩溃不会自动重启（任务计划可以周期性拉起）；
- 备份不是热备一致性快照：备份时可能正在写 audit/tasks；建议低活动时备份；
- 恢复不会自动停 node；脚本检测 8790 监听但不会杀进程；
- 没有异地备份/加密/保留策略；
- 审计导出是全量文件，没有按时间范围裁剪。
