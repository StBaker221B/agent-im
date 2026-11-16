# 12 Matrix 宿主：本机 WSL2 + Tuwunel

- 状态：2026-11-16 **已安装并验证**（WSL 3.0.5 + Ubuntu 24.04.4 + Tuwunel 2.0.0；真实 Matrix E2E 通过）。安装/排障以本文 + §12 实际记录为准。
- 关联：[10 开发环境](10-dev-setup.md) · [11 无公网 IP 组网](11-local-networking.md) · [09 协议](09-agent-protocol.md)
- 目标：在本机跑一个只监听 `127.0.0.1:8008` 的 Matrix homeserver，给 gateway 和 Element 用；不用 Docker Desktop，不暴露公网。

## 1. 为什么是 Tuwunel，不是 Conduit

Conduit 的上游基本停更；**Tuwunel** 是 Conduit → conduwuit → Tuwunel 这条线的当前维护版本：

- 2026-11-10 发布 **v2.0.0**，有 x86_64 静态二进制 / DEB / RPM / Docker 镜像。
- 单进程、默认 RocksDB、内存小；本地 v0 足够。
- 配置是 TOML；`server_name` 首次启动后不能改（改要清库）。
- 参考：`https://github.com/matrix-construct/tuwunel`、`https://tuwunel.chat/configuration.html`。

> 如果以后需要 Synapse/Postgres/Element 多服务，再在同一个 WSL 发行版里装 **Docker Engine**（不是 Docker Desktop）+ compose。v0 先不装。

## 2. 架构

```
Windows
  Node gateway / Claude CLI / 浏览器
        │  http://127.0.0.1:8008
  WSL2 (agentim 发行版, VHDX 在 D:\WSL\agentim)
        └─ Tuwunel, listen 127.0.0.1:8008, data /var/lib/tuwunel
```

- WSL2 默认把 Linux 的 localhost 端口转发到 Windows；Windows 里的 gateway 直接连 `127.0.0.1:8008`。
- 不需要公网 IP、端口映射或反向代理。
- 跨机（办公机）以后走 EasyTier/Tailscale，再决定是否绑 `0.0.0.0` 或做 Windows portproxy；见 [11](11-local-networking.md)。

## 3. 前置检查

1. **重启 Windows**。两项功能已启用但还没生效：
   - `Microsoft-Windows-Subsystem-Linux`
   - `VirtualMachinePlatform`
2. 重启后验证：

```powershell
wsl --status
wsl --version
```

如果提示“未安装用于 Linux 的 Windows 子系统”或缺少内核：

```powershell
wsl --install --no-distribution
```

（管理员 PowerShell；如果仍缺内核，`wsl --update`，或安装 `https://wslstorestorage.blob.core.windows.net/wslblob/wsl_update_x64.msi`。）

3. 确认虚拟化已启用：任务管理器 → 性能 → “虚拟化：已启用”。
4. D 盘留出 ≥ 2GB；C 盘不再需要 Docker/WSL 大安装。

## 4. 导入 Ubuntu rootfs（放到 D 盘）

已有的 rootfs：

```
D:\Install\WSL\ubuntu-base-24.04.4-base-amd64.tar.gz
```

管理员 PowerShell：

```powershell
New-Item -ItemType Directory -Force D:\WSL\agentim
wsl --import agentim D:\WSL\agentim D:\Install\WSL\ubuntu-base-24.04.4-base-amd64.tar.gz --version 2
wsl -d agentim -u root
```

- 这会把 `ext4.vhdx` 放在 `D:\WSL\agentim`，不占 C 盘。
- 如果 tarball 已删：从 `https://cdimage.ubuntu.com/ubuntu-base/releases/24.04/release/` 下载 base rootfs，或直接 `wsl --install -d Ubuntu`（会装到 C 盘默认位置）。
- 导入后默认用户是 root；v0 够用。

## 5. 安装 Tuwunel 二进制

### 5.1 在 Windows 下载 DEB（推荐）

浏览器或 PowerShell：

```powershell
New-Item -ItemType Directory -Force D:\Install\tuwunel
curl.exe -L -o D:\Install\tuwunel\tuwunel.deb `
  https://github.com/matrix-construct/tuwunel/releases/download/v2.0.0-assets/v2.0.0-assets-release-default-x86_64-v1-linux-gnu-tuwunel.deb
```

- 选 `x86_64-v1` 最稳（Ryzen 5800H 也支持 v2/v3，但 v1 通用）。
- GitHub 不通时用浏览器/代理下载；文件放 `D:\Install\tuwunel\`，WSL 里通过 `/mnt/d/Install/tuwunel/` 访问。
- 文件约 53MB（实测 53,655,342 字节）。
- **本机网络实测（2026-11-16）**：`github.com` 直连被 reset；`gh-proxy.com` 与 `ghproxy.net` 可用，`ghfast.top` / `github.moeyy.xyz` 不通。可用镜像前缀：

```powershell
curl.exe -L --retry 3 -o D:\Install\tuwunel\tuwunel.deb `
  "https://gh-proxy.com/https://github.com/matrix-construct/tuwunel/releases/download/v2.0.0-assets/v2.0.0-assets-release-default-x86_64-v1-linux-gnu-tuwunel.deb"
```

- 下载后先校验大小（应为 53,655,342）并确认 `file` 识别为 `Debian binary package`，再解包。

### 5.2 在 WSL 里解包

```bash
apt update
apt install -y ca-certificates
mkdir -p /opt/tuwunel
dpkg-deb -x /mnt/d/Install/tuwunel/tuwunel.deb /opt/tuwunel
find /opt/tuwunel -type f -name tuwunel
```

记下二进制路径。**v2.0.0 实际是 `/opt/tuwunel/usr/sbin/tuwunel`**（143MB；deb 里只有 `usr/sbin`，没有 `usr/bin`）。

```bash
/opt/tuwunel/usr/sbin/tuwunel --version   # tuwunel 2.0.0
```

> Tuwunel v1.9+ 在 chroot/distroless 环境需要 CA bundle；`ca-certificates` 就是为此。

## 6. 配置

```bash
mkdir -p /etc/tuwunel /var/lib/tuwunel
TOKEN=$(head -c 32 /dev/urandom | base64)
cat > /etc/tuwunel/tuwunel.toml <<EOF
[global]
server_name = "localhost"
database_path = "/var/lib/tuwunel"

[global.http.listen]
address = ["127.0.0.1"]
port = 8008

[global.registration]
enable = true
token = "$TOKEN"

[global.federation]
enable = false
EOF
echo "$TOKEN"
```

- 记下 `$TOKEN`，下一步 `setup-matrix` 要用。建议直接存一份到 Windows 侧（已在 `.gitignore` 里）：

```bash
printf '%s' "$TOKEN" > /mnt/d/Git/learn/agent-im/spike/.tmp/matrix-registration-token.txt
```

- `server_name = "localhost"` 决定 MXID：`@kudo:localhost`、`@claude-dev:localhost`。
- **首次启动后不要改 `server_name`**，否则只能清库重来。
- v0 只绑 `127.0.0.1`；不要现在绑 `0.0.0.0`。

## 7. 启动与验证

前台启动，先看日志：

```bash
/opt/tuwunel/usr/sbin/tuwunel -c /etc/tuwunel/tuwunel.toml
```

后台常驻（验证可用；进程在，WSL 发行版就不会自动关）：

```bash
mkdir -p /var/log
nohup /opt/tuwunel/usr/sbin/tuwunel -c /etc/tuwunel/tuwunel.toml > /var/log/tuwunel.log 2>&1 &
```

启动成功的日志尾巴应包含 `Listening on ["tcp:127.0.0.1:8008"]`。

另开一个 Windows 终端：

```powershell
curl.exe http://127.0.0.1:8008/_matrix/client/versions
```

应返回 JSON。WSL 的 localhost 转发不通时：

```powershell
wsl -d agentim hostname -I
# 用 WSL IP 试；仍不通再考虑 bind 0.0.0.0 + portproxy
```

前台跑通后，用 Windows 任务计划程序（登录时）或一个启动脚本常驻：

```powershell
wsl.exe -d agentim -u root -- /opt/tuwunel/usr/bin/tuwunel -c /etc/tuwunel/tuwunel.toml
```

只要这个进程在，WSL 发行版就不会自动关。

## 8. 初始化用户 / 房间

在 Windows：

```powershell
cd D:\Git\learn\agent-im\spike
npm run setup-matrix -- --registration-token "<第 6 步的 TOKEN>"
```

脚本会：

- 注册 `kudo`（human，第一个用户，Tuwunel 默认给 admin）、`claude-dev`、`script-peer`；已存在则登录。
- 建群 `#agent-room:localhost`，邀请两个 agent 并加入。
- 建 DM `#agent-room-dm:localhost`，邀请 `script-peer` 并加入。
- 写 `spike/.tmp/matrix-config.json`（含 token，**不要提交**）。
- 密码在 `spike/.tmp/matrix-users.json`（也是本地文件）。

重复执行是幂等的：用户已存在就登录，房间已存在就复用并补 invite/join。

## 9. 跑 gateway

```powershell
cd D:\Git\learn\agent-im\spike
npm run matrix-gateway
```

另开终端，用人类身份发消息：

```powershell
npm run say -- --text "@claude-dev 用一句话说明登录功能怎么做；需要 review 请 @script-peer"
npm run say -- --room dm --text "在吗？"
```

也可以打开 Element Desktop / Element Web，homeserver 填 `http://localhost:8008`，用 `kudo` + `.tmp/matrix-users.json` 里的密码登录。

验收顺序：

1. 群里 @claude-dev → Claude 回复；回复里 @script-peer → script peer 回复；Claude 再收到 → `PASS` 或 `DONE`。
2. DM 里随便说一句 → script peer 回复（2 人房间自动视为 direct）。
3. 群里发一条不 @ 任何人的消息 → 默认不唤醒；需要主动发言用 `requestFloor` 或 agent 自己的 cron。
4. 停掉 gateway，发一条 @claude-dev，再启动 → 只处理停机期间那条，不重跑旧消息。
5. 等 `quietWindowMs`（默认 30s）→ 日志出现 `quiescent`。

## 10. 重置 / 排障

| 现象 | 处理 |
|---|---|
| `wsl --import` 报缺少内核 | 管理员 `wsl --install --no-distribution` 或 `wsl --update`，再重启 |
| `wsl --status` 仍说未安装 | 确认两项 Windows 功能已启用并**重启**；BIOS 虚拟化 |
| Tuwunel 启动报 CA/证书 | `apt install ca-certificates` |
| Windows 连不上 8008 | `wsl -d agentim hostname -I` 用 WSL IP 试；检查 Tuwunel 监听地址；必要时 `address = ["0.0.0.0"]` + 防火墙 |
| 注册 401 / 注册 token 失败 | 确认 `[global.registration] token` 与 `--registration-token` 一致；或看 `/tmp` 日志 |
| 想清空重来 | 停 Tuwunel，`rm -rf /var/lib/tuwunel/*`，重启；删 `spike/.tmp/matrix-config.json` 与 `matrix-users.json` |
| Element 登录失败 | homeserver 填 `http://localhost:8008`（不是 `https://`）；服务器名是 `localhost` |
| 端口被占 | 改 `[global.http.listen] port`，同步改 `setup-matrix --homeserver` |

## 11. 安全边界

- v0 只绑 loopback；不要直接暴露家宽。
- token 只在 `spike/.tmp/` 和 WSL 的 `/etc/tuwunel/tuwunel.toml`；不进 git、不进日志。
- 注册 token 只用于初始化；用户建完后可以关掉 `[global.registration] enable`，需要再加用户时临时打开。
- agent 房间默认不加密（透明模式）；不要放真实密钥/密码到聊天里。
- 以后跨机：先 EasyTier/Tailscale，再决定 portproxy 或反向代理；见 [11](11-local-networking.md)。

## 12. 本次实际执行记录（2026-11-16）

环境：

| 项 | 值 |
|---|---|
| WSL | 3.0.5.0，内核 6.18.58.1-1 |
| 发行版 | `agentim`（Ubuntu 24.04.4 LTS），VHDX 在 `D:\WSL\agentim`，默认用户 root |
| Tuwunel | 2.0.0，二进制 `/opt/tuwunel/usr/sbin/tuwunel`（deb 解包到 `/opt/tuwunel`） |
| 配置 | `/etc/tuwunel/tuwunel.toml`（`server_name=localhost`，`127.0.0.1:8008`，federation 关，注册 token） |
| 数据 | `/var/lib/tuwunel`；日志 `/var/log/tuwunel.log` |
| 启动 | `nohup /opt/tuwunel/usr/sbin/tuwunel -c /etc/tuwunel/tuwunel.toml > /var/log/tuwunel.log 2>&1 &` |
| 注册 token | `/etc/tuwunel/registration-token.txt`，Windows 侧副本 `spike/.tmp/matrix-registration-token.txt`（gitignored） |

生成的 Matrix 对象：

- `@kudo:localhost`（human，首个用户 = Tuwunel admin）、`@claude-dev:localhost`、`@script-peer:localhost`
- 群 `#agent-room:localhost` → `!6-pmYU692mgXFO2K0VFgTp1r3qBZK_hherxA5Vtbfi8`
- DM `#agent-room-dm:localhost` → `!ySjRXz07rychMaLG7cyyLV4iqcuKJMtMkk54rMBFnTo`
- 本地配置 `spike/.tmp/matrix-config.json`、密码 `spike/.tmp/matrix-users.json`

验收结果（§9 的 5 条全过）：

| # | 验收项 | 结果 |
|---|---|---|
| 1 | 群 @claude-dev → Claude 回复 @script-peer → peer 回复 → Claude PASS | 通过；agent→agent 链在人类只 @ 第一个 agent 时触发 |
| 2 | DM 随便说一句 → peer 回复（2 人房间自动 direct） | 通过，`mentions=[]` 也能唤醒 |
| 3 | 群里不 @ 任何人的消息 | 只有 inbound，不唤醒 |
| 4 | 停 gateway → 发 @claude-dev → 重启 | `state loaded: processed=6`，只处理停机那条一次 |
| 5 | `quietWindowMs` 后 quiescent | 群和 DM 都出现 `[gateway] quiescent` |

真实 Claude 成本：4 个 turn 约 **$0.029**（首轮 $0.00979、重启 OK $0.00224、风险分析 $0.006553、PASS $0.010223）。

### 排障补充

- 从 Git Bash 调 WSL 时，`wsl -d agentim -- bash -c '...$VAR...'` 里的变量可能被外层吃掉（实测 `X=abc; echo $X` 输出空）。改用 stdin 传脚本：`wsl -d agentim -u root -- bash -s <<'EOF' ... EOF`。
- `printf '%s' "$TOKEN" > /mnt/d/...` 曾写出 0 字节；改成先写 WSL 内文件再 `cp` 到 `/mnt/d/` 可靠。

### 还没做

- **开机自启**：目前 Tuwunel 靠 `nohup` 常驻，Windows 重启后需要重新拉起。可选 Windows 任务计划程序（登录时）或 WSL 内 systemd（`/etc/wsl.conf` 开 `systemd=true`，用 deb 自带的 unit）。
- Element Desktop/Web 登录实测（homeserver 填 `http://localhost:8008`，用 `matrix-users.json` 的密码）。
- 跨机（办公机）组网仍是后续项，见 [11](11-local-networking.md)。
