# 公网分享：隧道启动说明

场景：后端跑在自己电脑上，想让别人通过一个 HTTPS 地址上传/下载文件。
按下面的顺序做，全程只需要一个终端窗口。

## 1. 启动后端（单端口）

```powershell
bun install
bun run build      # 产出 web/dist，后端启动时会一并托管
bun run start      # 默认 http://localhost:3000
```

先用本机浏览器打开 http://localhost:3000 确认页面、上传、下载都正常，再继续。

## 2. 配置口令（必做）

两个口令都在 `server/` 目录下的 `.env` 里配置（Bun 只自动加载**进程工作目录**的 `.env`，
后端进程的工作目录就是 `server/`；该文件已在 .gitignore 里，**不要提交到 git**）：

```
DELETE_TOKEN=换成一串足够长的随机口令
DOWNLOAD_TOKEN=换成一串足够长的随机口令
```

- `DELETE_TOKEN`：没设置时删除接口整体关闭（返回 403 `DELETE_DISABLED`）——公网部署的安全默认值
- `DOWNLOAD_TOKEN`：没设置时下载开放；设置了则下载前要输入口令

生成随机口令，任选其一：

```powershell
bun -e "console.log(crypto.randomUUID())"
openssl rand -hex 16
```

也可以只在当前终端临时设置（关掉窗口就失效）：

```powershell
$env:DELETE_TOKEN = "你的口令"
$env:DOWNLOAD_TOKEN = "你的口令"
bun run start
```

设好之后：删除文件要输入删除口令；下载文件要输入下载口令（输入一次后当次会话内有效）。
两个口令都可以单独使用，互不影响。

## 3. 选择一条隧道

### 方案 A：Tailscale Funnel（推荐：免费、固定域名、不需要自有域名）

#### ***建议选择方案B***

1. 安装并登录 [Tailscale](https://tailscale.com/download/windows)
2. 启动隧道：

```powershell
tailscale funnel 3000
```

3. 输出里的 `https://<设备名>.<你的 tailnet>.ts.net/` 就是对外地址，**固定不变**，发给别人即可。

- 查看状态：`tailscale funnel status`
- 后台常驻：`tailscale funnel --bg 3000`
- 关闭：`tailscale funnel off`

### 方案 B：Cloudflare Tunnel

快速试用（每次重启地址都变）：
1.下载：[cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
2.启动隧道，在命令行中执行：

```powershell
cloudflared tunnel --url http://localhost:3000
```

固定域名（需要自己的域名托管在 Cloudflare）：

```powershell
cloudflared tunnel login
cloudflared tunnel create archive-dock
cloudflared tunnel route dns archive-dock dock.example.com
cloudflared tunnel run --url http://localhost:3000 archive-dock
```

### 方案 C：ngrok

本仓库用 `@ngrok/ngrok` SDK 直接起隧道，**不需要装 ngrok CLI**。

#### 1. 配置令牌

去 https://dashboard.ngrok.com/get-started/your-authtoken 复制 authtoken，
追加到 `server/.env`（该文件已在 .gitignore 里，不要提交）：

```
NGROK_AUTHTOKEN=你的authtoken
```

#### 2. 启动

```powershell
bun run build
$env:TUNNEL = "1"; bun run start
```

日志里出现 `[archive-dock] public: https://xxx.ngrok-free.dev` 即成功。
`TUNNEL` 不设或不为 `1` 时不会起隧道，正常本地开发不会被挂到公网。

也可以完全绕开服务进程，单跑一个转发脚本（`server/.env` 同样被自动加载）：

```powershell
bun run tunnel
```

#### 已知坑

- **令牌必须显式传参**，不能用 `authtoken_from_env: true`。Bun 的 `.env` 自动加载只填
  `process.env`（JS 侧），不写真实进程环境，而 SDK 的原生层读的是后者 —— 结果就是令牌
  有效却报 `ERR_NGROK_4018`。`server/src/index.ts` 里已经用显式传参绕开了。
- **免费版带宽 1GB/月**，而 `MAX_UPLOAD_BYTES` 默认 512MB，传两个大包就烧完。
- **免费版首次访问有浏览器警告中间页**，SPA 的 `fetch('/api/...')` 可能拿到 HTML 而非
  JSON。前端请求带上 `ngrok-skip-browser-warning: 1` 头，或在 dashboard 绑固定域名。
- 固定域名：在 https://dashboard.ngrok.com/domains 领取后，给 `forward()` 传
  `domain: "你的域名.ngrok-free.app"`。

## 4. 验证与分享

- 用手机流量（不要连家里 Wi-Fi）打开隧道地址，传一个小文件再下载，确认整条链路通了
- 把地址发给别人

## 5. 停止服务

- 后端：终端里 `Ctrl+C`
- Tailscale：`tailscale funnel off`；cloudflared / ngrok 直接关掉窗口
- 服务一停，别人打开地址就是连不上，页面顶部会显示「无法连接后端服务」横幅

## 6. 安全清单

- **必设 `DELETE_TOKEN`**，否则任何人都能删（或删除被整体禁用）
- 想限制下载就设 `DOWNLOAD_TOKEN`，只把口令告诉需要下载的人；不设则拿到地址的人都能下载
- 上传是公开的，拿到地址的人都能传文件；介意的话可以照
  `server/src/modules/archives/index.ts` 里口令校验的写法，给 `POST /api/archives` 也加一道校验
- 上传限额在 `server/.env` 里按需调整：`MAX_UPLOAD_BYTES`、`MAX_ENTRIES`、`MAX_EXTRACT_BYTES`
- 隧道地址等同于你电脑的服务入口，不要到处张贴；Tailscale Funnel 只指向你这台设备，设备关机服务即停

## 7. 常见问题

| 现象 | 原因 / 处理 |
| --- | --- |
| 页面能打开，但上传下载全失败，顶部有黄色横幅 | 后端没启动或隧道没开；启动后点横幅上的「重试」，页面每 5 秒也会自动探测 |
| 前端单独部署在 GitHub Pages，请求后端被浏览器拦截（Mixed Content） | HTTPS 页面不能请求 `http://192.168.x.x:3000`；后端必须走 HTTPS 隧道地址 |
| 端口被占用 | 改 `.env` 里的 `PORT`，隧道目标端口跟着改 |
| 大文件下载慢或中断 | 下载支持 Range 断点续传，速度取决于你家宽带上行 |
| 需要开放防火墙端口吗 | 不需要，隧道是电脑主动出站连接 |
