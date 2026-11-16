# 10 开发环境与复现（本机 / 办公机）

- 状态：2026-11-16。记录当前机器事实、spike 运行方式、Matrix 环境（已安装）和办公机复现清单。
- 关联：[00 合同](00-requirements-contract.md) · [09 协议](09-agent-protocol.md) · [spike](../spike/) · [过程记录](records/2026-11-15-04-answers-round3.md)

## 1. 当前机器事实（2026-11-16 验证）

- Windows 11 Home China；AMD Ryzen 7 5800H；16GB 内存；无独显。
- C 盘剩 ~25GB；D 盘剩 ~321GB。软件装在 `D:\Install`；Node 在 `D:\Install\nodejs`。
- Node v24.21.0；npm 11.19.0。
- **未安装 Docker Desktop**；**WSL 3.0.5 可用**，发行版 `agentim`（Ubuntu 24.04.4，VHDX 在 `D:\WSL\agentim`），Tuwunel 2.0.0 监听 `127.0.0.1:8008`。
- 已安装：Claude Code 2.1.296、OpenClaw；**未安装 Codex CLI / dsh / Hermes**。
- 办公机：Win11 Pro，常驻，有 OpenClaw + 飞书 + ACP 的 claude/codex；可作为第二节点。

## 2. 本地协议 spike（不需要 Docker）

```bash
cd d:/Git/learn/agent-im/spike
node --test              # 25 个测试
npm run demo             # 人类 + PM/dev/reviewer 的确定性演示
npm run gateway-demo     # 假总线端到端：@mention 链、DM、主动发言、pass、静默收敛、重启去重
```

- 纯 Node ESM，无第三方依赖；Node >= 22。
- 覆盖：投递/唤醒、mention 优先级、单写者 floor、pass、静默收敛、lazy consensus、升级链、幂等、canInvite、interrupt、turn timeout、角色查询；gateway 的群聊链、DM、volunteer、重启水合；Matrix transport 的 sync/send/thread/mention/txn 幂等；setup-matrix 的注册/建群/DM/幂等。

### 2.1 Claude adapter demo（真实 Claude Code）

```bash
cd d:/Git/learn/agent-im/spike
npm run claude-demo
```

- 三阶段：首轮 human @claude-dev → Claude 回复并 @reviewer；同进程连续对话；kill 进程后 `--resume` 继续。
- 2026-11-16 实测（当时 14 tests；现在全量 **25 tests**）：总 in=1843 / out=319 / **$0.043918**；resume 保持同一 session id；线程最终 quiescent。
- 精简参数：`--bare --disable-slash-commands --strict-mcp-config --system-prompt-file`；一句“收到” 942 tokens / $0.0048（完整环境 24,702 / $0.132）。
- 审计 JSONL：`spike/.tmp/audit.jsonl`（gitignore）。
- 限制：v0 不流式输出、无工具审批；真实 Matrix E2E 已通过（见 2.3）。

### 2.2 Gateway 端到端

```bash
cd d:/Git/learn/agent-im/spike
npm run gateway-demo          # 免费，mock runtime + script peer；假总线
npm run gateway-demo-claude   # 真实 Claude + script peer；约 $0.06，1–3 分钟
```

- `gateway-demo` 覆盖：群 @mention → 回复 @peer → peer 回复 → Claude PASS → quiescent；DM；volunteer；重启不重跑旧消息、停机期间消息只处理一次。
- `gateway-demo-claude` 2026-11-16 实测：in=1381 / out=648 / **$0.059228**；4 条消息后 quiescent。
- 状态/审计：`spike/.tmp/{fake,claude}-gateway-state.json`、`*.jsonl`、`agents/*/sessions/claude.json`；都在 gitignore 的 `.tmp` 下。

### 2.3 真实 Matrix（2026-11-16 已验证）

```bash
curl.exe -s http://127.0.0.1:8008/_matrix/client/versions   # 宿主要在跑
cd d:/Git/learn/agent-im/spike
npm run setup-matrix -- --registration-token "$(cat .tmp/matrix-registration-token.txt)"  # 幂等；写 .tmp/matrix-config.json
npm run matrix-gateway                                    # 常驻 gateway
npm run say -- --text "@claude-dev 你好"                  # 用人类身份发消息
```

- 实测：群 @claude-dev → Claude 回复 @script-peer → peer 回复 → Claude PASS → quiescent；DM 自动 direct；不 @ 不唤醒；停机重启只处理新消息。详见 [记录 04](records/2026-11-16-04-matrix-e2e.md)。
- 宿主安装见 [12 Matrix 宿主：WSL2 + Tuwunel](12-matrix-host-wsl.md)；Windows 重启后 Tuwunel 不会自启，需手动拉起。
- 一个 agent 一个 Matrix 账号/token；DM 用单独房间；gateway 只绑本机 loopback。
- 不提交 `.tmp/matrix-config.json` / `matrix-users.json`。

## 3. Linux 环境（不需要 WSL）

如果 Matrix 跑在 Linux（VPS、办公机 Linux、或 Linux VM）：

- 直接装 **Docker Engine + compose plugin**（官方 apt/dnf 仓库），不需要 WSL、不需要 Docker Desktop。
- `docker compose up -d` 即可；数据卷放 `/srv/agent-im/data`。
- 性能/内存开销比 Windows 的 Docker Desktop + WSL2 低；常驻服务优先放 Linux。
- Windows 才需要 Docker Desktop + WSL2；WSL 只是 Windows 上的 Linux 兼容层。
- 我们的 compose/Node 代码应保持可移植；Windows 与 Linux 的差异只在安装方式、路径和端口。

> 当前本机是 Windows 11 Home，所以走下面的 WSL2 + Docker Desktop；办公机如果以后换 Linux/VPS，直接走本节。

## 4. Matrix 本机环境（需要你操作的步骤）

> **2026-11-16 已选路径**：本机 **WSL2 + Tuwunel 单二进制**，不装 Docker Desktop。步骤见 [12 Matrix 宿主](12-matrix-host-wsl.md)。
> 下面 4.2–4.4 的 Docker Desktop 方案保留为备选；以后需要 Synapse/Postgres/Element 多服务时，优先在 WSL 发行版里装 **Docker Engine**（不是 Docker Desktop）。
> 这些步骤需要管理员权限/重启，只能由你执行；装完把版本/路径回填到本节。

### 4.1 前置

1. 任务管理器 → 性能 → 确认“虚拟化：已启用”。若未启用，进 BIOS 打开 SVM/VT-x。
2. Windows 更新到较新版本；保证 C 盘至少 10GB 临时空间（Docker/WSL 安装用）。

### 4.2 安装 WSL2

PowerShell（管理员）：

```powershell
wsl --install
```

- 默认安装 Ubuntu；重启；首次启动设置 Linux 用户名/密码。
- 验证：

```powershell
wsl -l -v
```

应看到 `VERSION 2`。如果只有 WSL1，执行 `wsl --set-default-version 2`。

### 4.3 安装 Docker Desktop（备选，v0 不选）

1. 下载 Docker Desktop for Windows（docker.com）。
2. 安装时勾选 **Use WSL 2 instead of Hyper-V**。
3. 启动 Docker Desktop，登录可跳过；设置 → Resources → WSL Integration，启用 Ubuntu。
4. **把磁盘镜像放到 D 盘**：Settings → Resources → Advanced → Disk image location → `D:\Docker\data`（或 `D:\DockerDesktop`）。
   - C 盘紧张时必做；应用后会迁移镜像。
5. 验证：

```powershell
docker --version
docker compose version
```

### 4.4 启动 Matrix（后续 compose 落地后）

计划的最小服务：

| 服务 | 端口 | 说明 |
|---|---|---|
| Synapse 或 Tuwunel | 8008 | homeserver |
| Postgres（如果 Synapse） | 5432（仅内部） | 数据库 |
| Element Web | 8080 | 人类客户端 |
| agent-im gateway | 8090 | 我们的 gateway/数据平台 |

- 数据卷放 D 盘：`D:\agent-im\data\...`。
- 环境变量放 `.env`（不提交）；提交 `.env.example`。
- 先创建普通用户（human + 2–3 agent），不用 AppService。
- 验证：Element 登录、房间/消息、agent 账号可登录、gateway 能 sync。

## 5. 办公机复现清单

1. `git pull`（Gitee `origin/master`）。
2. 安装 Node 24+；安装 Docker Desktop + WSL2（步骤同上）。
3. 复制 `.env.example` → `.env`，填入本机路径/端口/账号；**不要把 `.env` 提交**。
4. `cd agent-im/spike && node --test` 先验证纯协议。
5. 登录 Claude Code（以及后续 Codex/Hermes）；每台机器各自登录，凭据不进 git。
6. 决定 Matrix 拓扑：
   - **A. 共用**：办公机跑 Matrix，本机通过 LAN/VPN 连；需要防火墙/端口/证书。
   - **B. 各自跑**：两台各自一个 homeserver，数据不共享；适合开发试验。
   - **C. VPS**：一台常驻 homeserver，两台都连；适合以后公开/商业。
   - v0 本机先跑；办公机复现时优先 A 或 B，别一开始搞 federation。
7. 跑 spike → 起 Matrix → 创建用户 → 跑群聊 demo。

## 6. 本机 vs 办公机的差异

| 差异 | 影响 | 处理 |
|---|---|---|
| Win11 Home vs Pro | Docker/WSL/虚拟化能力不同 | Docker Desktop + WSL2；Pro 可启用更多后端 |
| 路径/用户名 | 工作区/数据目录 | 配置走 `.env`/`config.local`，不写死 |
| Node 版本 | 构建/运行 | `package.json engines` + 文档锁版本 |
| Claude/Codex 登录 | 每台机器各自登录 | 不进 git |
| 网络/防火墙/端口 | Matrix/网关访问 | 记录端口；跨机用 LAN/VPN |
| Matrix 数据 | 不在 git | Docker volume + 备份；共用或各自跑 |
| Git 换行/大小写 | Windows CRLF/大小写不敏感 | `.gitattributes` + 统一小写路径 |
| 模型/API 预算 | 各自环境变量 | 不进 git |

## 7. 可移植性规则（写代码时遵守）

- 配置只从 env/配置文件读；代码里不写死 `D:\...`、`localhost`、域名。
- 所有持久数据目录可配置（默认 `./data` 或 `D:\agent-im\data`）。
- 依赖版本锁定（`package.json` engines / lockfile）。
- `.gitattributes` 统一 LF；`.gitignore` 忽略 `.env`、`data/`、`node_modules/`、`worktrees/`。
- 每个服务提供 health check；启动脚本幂等。
- Windows 路径用 `path.join`/`fileURLToPath`，不要手拼 `/`。
- 提交前跑 `node --test`；Matrix 相关测试用 mock/本地 compose。

## 8. 安全与凭据

- `.env` / API key / Matrix token / Claude 登录态都不进 git。
- AppService token（如果以后用）只放服务端，不进 agent 容器。
- 每个 agent 独立 Matrix 账号/凭据；v0 可以先共用 gateway 进程，但 token 分开。
- 开发期可以放宽，但**不要**把 token 写进文档/日志。
- 数据平台/审计的访问控制在 v0 先靠本机文件权限；公开部署再上角色/scope。

## 9. 待办

- [x] 本机安装 WSL2（3.0.5 + `agentim`/Ubuntu 24.04.4）+ Tuwunel 2.0.0；不装 Docker Desktop。见 [12](12-matrix-host-wsl.md) §12。
- [ ] Tuwunel 开机自启（Windows 任务计划程序或 WSL systemd）。
- [ ] （备选，暂不做）写 `docker-compose.yml`（Synapse/Conduit + Postgres + Element + gateway）。
- [ ] 写 `.env.example` / `.gitignore` / `.gitattributes`。
- [ ] 办公机复现并按第 5 节验证。
- [ ] Codex/Hermes 安装与登录（各自机器）。
