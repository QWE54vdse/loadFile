# archive-dock

上传压缩包 → 服务端流式解包 → 在线浏览包内结构 → 下载单个文件或原包。

- **前端**：React 19 + Vite 8 + TypeScript
- **后端**：Bun + Elysia 1.4（`@elysiajs/cors`、`fflate` 流式解压）
- **存储**：本地磁盘 + 每个包一个 `meta.json`，不依赖数据库

## 目录结构

```
.
├── package.json          # bun workspaces + 一键脚本
├── scripts/dev.ts        # 同时拉起 API 与 Vite，转发 Ctrl+C
├── server/
│   ├── src/config.ts                     # 端口、数据目录、各类限额
│   ├── src/index.ts                      # 应用装配：CORS、错误映射、SPA 托管
│   ├── src/lib/http.ts                   # Content-Disposition + Range 文件响应
│   ├── src/modules/archives/index.ts     # 路由（控制器）
│   ├── src/modules/archives/service.ts   # 落盘、索引、路径解析（业务逻辑）
│   ├── src/modules/archives/model.ts     # TypeBox 校验模型与类型
│   ├── src/modules/archives/zip.ts       # 流式解压 + zip-slip 防护
│   └── test/zip.test.ts                  # 路径安全单元测试
└── web/
    ├── src/App.tsx                       # 页面骨架：上传区 / 文件库 / 包内结构
    ├── src/api.ts                        # fetch + XHR（上传进度）客户端
    ├── src/components/UploadPanel.tsx    # 拖拽上传、进度、取消
    ├── src/components/ArchiveList.tsx    # 列表、下载、二次确认删除
    ├── src/components/FileTree.tsx       # 包内文件树，逐文件下载
    └── src/styles/{tokens,app}.css       # 设计 token 与样式
```

## 快速开始

```bash
bun install
bun run dev
```

- API → http://localhost:3000
- Web → http://localhost:5173（Vite 把 `/api` 代理到 3000，浏览器同源，无预检请求）

也可以分开跑：`bun run dev:server` / `bun run dev:web`。

## 生产部署

```bash
bun run build     # 产出 web/dist
bun run start     # Elysia 单端口同时托管 /api 与 web/dist
```

`server/src/index.ts` 启动时检测 `web/dist/index.html`：存在就直接托管（含 SPA 回退），
不存在则只提供 API，开发期交给 Vite。

想把这个服务通过 HTTPS 分享给别人（Tailscale Funnel / Cloudflare Tunnel / ngrok），
见 [docs/tunnel.md](docs/tunnel.md)。

## API

| 方法     | 路径                                  | 说明                                            |
| -------- | ------------------------------------- | ----------------------------------------------- |
| `GET`    | `/api/health`                         | 健康检查 + 限额 + 删除/下载开关（前端据此禁用删除、弹口令框） |
| `GET`    | `/api/archives`                       | 列表（不含包内文件），按上传时间倒序            |
| `POST`   | `/api/archives`                       | `multipart/form-data`，字段名 `file`，返回 201  |
| `GET`    | `/api/archives/:id`                   | 详情，含 `entries`（包内文件清单）              |
| `DELETE` | `/api/archives/:id`                   | 删除记录与原文件/解包目录，需 `x-delete-token` 头 |
| `GET`    | `/api/archives/:id/download`          | 下载原始文件，支持 `Range`；配了 `DOWNLOAD_TOKEN` 需带 `?token=` |
| `GET`    | `/api/archives/:id/files/*`           | 下载包内某个文件，支持 `Range`；同上            |

上传时若文件头是 zip 魔数（`PK\x03\x04` 等）即解包；其他格式按单个不透明文件保存，
`kind` 字段为 `file`，只能整包下载。

## 环境变量

| 变量                 | 默认值       | 说明                                        |
| -------------------- | ------------ | ------------------------------------------- |
| `PORT`               | `3000`       | 监听端口                                    |
| `HOST`               | `0.0.0.0`    | 监听地址                                    |
| `DATA_DIR`           | `server/data`| 落盘根目录                                  |
| `CORS_ORIGIN`        | `*`          | 生产建议收紧成具体域名                      |
| `DELETE_TOKEN`       | 空           | 删除口令；为空则删除接口整体关闭（403）     |
| `DOWNLOAD_TOKEN`     | 空           | 下载口令；为空则下载开放，无需口令          |
| `MAX_UPLOAD_BYTES`   | `512MB`      | 单次请求体上限，同时传给 Bun 的 body 限制   |
| `MAX_ENTRIES`        | `5000`       | 单个包最多解出多少条目                      |
| `MAX_EXTRACT_BYTES`  | `2048MB`     | 解压后总体积上限（防 zip bomb）             |

也可以把变量写进 `server/.env`，Bun 会自动加载（只读进程工作目录，后端的工作目录是 `server/`）。

## 安全与限额

- **zip-slip 防护**：每个条目名都走 `safeEntryPath()` 归一化，含 `..`、绝对路径、
  Windows 非法字符（`<>:"|?*`、控制字符）的条目直接跳过并计入 `skippedEntries`；
  下载时再用 `resolve()` + 前缀比对复核一次，双保险。
- **容量三重闸门**：请求体上限、条目数上限、解压后总体积上限。任一条触发即中止，
  并把该包目录整体删除，不留半成品。
- **不支持的压缩方式**（非 store/deflate，例如加密 zip、LZMA）条目跳过而不是整包失败。
- **流式处理**：解压时数据块直接从 inflater 写进 `Bun.file().writer()`，内存占用与包大小无关。

## 已知取舍

- **上传是内存态解析**：Elysia 的 `t.File()` 会把 multipart 先解析成 `File` 再 `Bun.write()`
  落盘。512MB 以内没问题；要支撑 GB 级上传，请在 `onRequest` 里自行做流式 multipart 解析
  （或用 `@elysiajs/node` 之外的对象存储直传方案）。
- **删除口令**：`DELETE_TOKEN` 为空时删除接口整体关闭（403 `DELETE_DISABLED`）；
  设置后删除需带 `x-delete-token` 头，前端会要求输入口令。
- **下载口令**：`DOWNLOAD_TOKEN` 为空时下载开放；设置后下载需带 `?token=`（或
  `x-download-token` 头），前端首次下载会弹窗要求输入口令，先发一个 1 字节 Range
  请求校验，通过后才真正开始下载。
- 两个口令都用 `crypto.timingSafeEqual` 做常数时间比较。上传仍无鉴权，适合内网或临时收件场景；
  要加完整登录，推荐在 `server/src/index.ts` 里挂 `@elysiajs/jwt` 或 `@elysiajs/bearer`，
  用 `guard` 包住 `archives` 插件。
- **无数据库**：`server/data/archives/<id>/meta.json` 即索引，`GET /api/archives` 每次扫目录。
  包数量上千后建议换成 SQLite（`bun:sqlite`）。
- **前端未用 Eden Treaty**：目前是手写 `web/src/api.ts`。想拿到端到端类型推导，
  可 `bun add @elysiajs/eden`，把 `export type App = typeof app` 引到前端用 `treaty<App>()`。
- **界面字体用系统栈**（等宽做标题/数据、无衬线做正文），不依赖外网字体，离线可用。
