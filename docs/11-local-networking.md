# 11 本地部署与无公网 IP 组网（调研笔记）

- 状态：调研 2026-11-16；未安装、未实测；星数为 GitHub API 当日值，会变化。
- 背景：笔记本 + 办公机都是本地 Windows，没有公网 IP；目前只能本地部署。以后 Matrix/agent 可能要跨机、手机访问，甚至对公网开放。
- **2026-11-16 更新**：Conduit 上游基本停更，当前维护版是 **Tuwunel**（Conduit → conduwuit → Tuwunel，v2.0.0）。v0 用 Tuwunel 单二进制，安装见 [12 Matrix 宿主](12-matrix-host-wsl.md)。

## 1. 先说结论：没有项目能“凭空给你公网 IP”

家宽/CGNAT 后面，外部无法主动连入。所谓“把家里电脑当公网服务器”通常是三类方案：

1. **内网穿透 / 隧道**：frp、Cloudflare Tunnel、ngrok、tunnelto、FastTunnel、cpolar/花生壳。流量经过一个公网中继。
2. **Mesh VPN / 虚拟局域网**：EasyTier、Tailscale、ZeroTier、NetBird。你的设备组成一个虚拟网络，只有装了客户端的设备能互访；不对外公开。
3. **直接租一台有公网 IP 的 VPS**：最省心，适合长期跑 Matrix。

关键区别：

- **Mesh VPN** 解决“我自己的笔记本/办公机/手机互访”，不需要公网 IP。
- **隧道** 解决“让公网用户访问我本地的某个服务”，但需要第三方/公网中继。
- **frp 本身不是公网 IP**：它需要一个有公网 IP 的 `frps` 服务端；你只装 `frpc` 是不够的。

## 2. 方案对比

| 方案 | GitHub 星 | 需要公网 IP？ | 谁能访问 | 国内可用性 / 备注 | 适合 |
|---|---|---|---|---|---|
| **EasyTier** | 14.7K | 否 | 加入同一虚拟网络的设备 | 国内项目；Rust；WireGuard；P2P NAT 穿透；公共中继；Windows/Linux/macOS/OpenWrt | **本地多机首选** |
| **Tailscale** | 39.2K | 否 | tailnet 内设备 | 体验最好；控制面在境外，国内可能不稳；Funnel 可公开 HTTPS | 有稳定外网时 |
| **ZeroTier** | 17.3K | 否 | 加入同一 network 的设备 | 公共 root；国内时通时断；配置简单 | 备选 |
| **NetBird** | 31.0K | 自托管控制面需要 | 同一 network 的设备 | 企业向；自托管要公网控制面 | 团队/企业 |
| **frp** | 110.6K | **是（frps）** | 公网用户 | 必须有公网服务端；性能好；国内教程多 | 有 VPS 时 |
| **Cloudflare Tunnel** | 16.6K | 否（用 Cloudflare 中继） | 公网用户 | 需要域名/Cloudflare 账号；国内访问 Cloudflare 可能慢/不稳；Matrix 联邦需额外配置 | 有域名、轻量公开 |
| **tunnelto** | 7.1K | 否（公共中继） | 公网用户 | 免费/付费；国内速度未知 | 临时演示 |
| **cpolar / 花生壳** | 商业 | 否 | 公网用户 | 国内商业服务；付费/限速；上手快 | 不想折腾 |

> 星数只代表热度，不代表国内网络体验。EasyTier 是这批里最贴合“国内 + Windows + 无公网 IP + 自己的多台设备”的。

## 3. 对 Agent IM 的建议

### 现在：本地多机验证

- 用 **EasyTier** 把笔记本和办公机加入同一个虚拟网络（也可以加手机）。
- Matrix 跑在其中一台（v0：本机 WSL2 + Tuwunel，不用 Docker Desktop；见 [12](12-matrix-host-wsl.md)）。
- 另一台通过 EasyTier 的虚拟 IP 访问 Matrix/Element。
- 不需要公网 IP；不需要路由器端口映射；不把家宽暴露到公网。
- 如果 EasyTier 在你家网络穿透失败，它会走公共中继；仍不需要公网 IP。

### 以后：对公网开放

- **Cloudflare Tunnel**：本地跑 `cloudflared`，把 Matrix/Element 映射到一个域名；需要 Cloudflare 账号/域名；国内访问质量需实测。
- **小 VPS + frp / 直接跑 Matrix**：最稳。2C2G 的 Linux VPS 约 ¥50–100/月，跑 Conduit/Synapse + 几个 agent gateway 足够；模型 API 另算。
- **不建议**直接暴露家宽：上行、稳定性、动态 IP、运营商 ToS、DDoS 都是问题。
- Matrix 的联邦/公开注册需要稳定的 443/8448 和域名；家庭隧道能演示，但长期不如 VPS。

## 4. 下一步（可选）

1. 先在一台机器上装 EasyTier，确认能创建网络、拿到虚拟 IP。
2. 办公机加入同一网络，`ping` 通；再试 TCP 端口（Matrix 8008/8080）。
3. 如果通了，Matrix 可以跑在任意一台，另一台用虚拟 IP 访问；不需要公网 IP。
4. 以后要公开，再评估 Cloudflare Tunnel 或 VPS；不要现在就把家宽暴露出去。

## 5. 一句话

> **没有公网 IP 也能让自己的设备互访（EasyTier/Tailscale/ZeroTier），但要让公网用户访问，必须有一个中继（Cloudflare Tunnel/ngrok）或一台公网 VPS。** 本地阶段用 mesh VPN，长期公开用 VPS 最省心。
