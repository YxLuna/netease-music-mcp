# 网易云音乐 MCP 小白部署教程

这是一份从零开始的教程。即使你没用过 GitHub、Docker 或 MCP，也可以按顺序完成。

> 最重要的一句话：**每个人部署自己的一套。**
>
> 你不会连接作者的网易云账号，也不会和别人共享 Cookie、Token、数据库或调用额度。

## 1. 最后可以得到什么

部署完成后，你会拥有一个属于自己的地址：

```text
https://music.你的域名/mcp
```

把这个地址连接到支持远程 MCP 的 AI 客户端后，可以让 AI：

- 搜索网易云歌曲；
- 查询歌曲详情和歌词；
- 查看自己创建的歌单；
- 创建歌单；
- 添加或移除歌单里的歌曲。

项目还提供：

- `https://music.你的域名/dashboard`：个人控制台；
- `https://music.你的域名/openapi.json`：给自建前端或其他工具平台使用；
- `https://music.你的域名/api/v1`：REST API。

### 它不能做什么

- VPS 不能隔空控制你电脑或手机里的网易云 App。
- Mac 本地的播放、暂停、下一首，需要在 Mac 上运行本地模式并授权。
- Windows 本地播放器控制目前没有标记为稳定。
- 手机内切歌需要额外的本地伴侣程序和系统权限。
- 项目不提供音乐下载、会员绕过或版权限制规避。

## 2. 先选择部署位置

| 你的情况 | 推荐做法 |
| --- | --- |
| 有 VPS、NAS 或长期在线的小主机 | 把个人 MCP 部署在那里，最稳定 |
| 只有 Mac 或 Windows 电脑 | 使用 Docker Desktop；电脑关机或休眠时 MCP 会离线 |
| 只有手机 | 手机本身不用安装 Docker，但需要先在 VPS、NAS 或电脑上部署 |
| 只想在 Mac 本地用 | 可以使用 stdio 本地模式，不需要域名 |

下面优先讲最通用的 Docker 部署。

## 3. 开始前需要准备

### 所有人都需要

1. 能访问 GitHub；公开项目不登录账号也能下载；
2. 远程连接时需要一个自己的域名，例如 `example.com`；
3. 一个子域名，例如 `music.example.com`；
4. 需要操作歌单时，准备一个已经登录网易云音乐的账号；
5. 一台可以长期运行 Docker 的设备。

### Mac 或 Windows

安装：

- [Git](https://git-scm.com/downloads)；
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)。

安装 Docker Desktop 后先打开它，看到 Docker 正常运行再继续。

### Linux、VPS 或 NAS

安装：

- Git；
- Docker Engine；
- Docker Compose 插件。

安装方式以 [Docker 官方安装说明](https://docs.docker.com/engine/install/) 为准。

用下面两条命令检查：

```bash
docker --version
docker compose version
```

两条命令都能显示版本号，才代表准备完成。

## 4. 下载项目

打开终端。

Mac、Linux、Windows PowerShell 都执行：

```bash
git clone https://github.com/tianyupaipai-cmd/netease-music-mcp.git
cd netease-music-mcp
```

如果不会使用 Git，也可以在 GitHub 项目页面点击：

```text
Code → Download ZIP
```

解压后，在终端进入解压出来的 `netease-music-mcp` 文件夹。

## 5. 设置自己的域名

假设你准备使用：

```text
https://music.example.com
```

请把教程里的这个示例替换成你自己的真实域名。

为了避免关闭终端后设置消失，推荐把域名写入项目根目录的 `.env` 文件。

### Mac 或 Linux

```bash
printf '%s\n' 'NETEASE_PERSONAL_ORIGIN=https://music.example.com' > .env
```

### Windows PowerShell

```powershell
Set-Content -Path .env -Value 'NETEASE_PERSONAL_ORIGIN=https://music.example.com'
```

这个地址必须和最终打开 MCP 的地址完全一致。公网使用时必须是 `https://`。
`.env` 含有你的私人部署配置，不要上传到 GitHub。

## 6. 第一次初始化并启动

仍然在项目文件夹中执行：

```bash
docker compose run --rm netease-mcp npm run init:personal -- /data
docker compose up -d
```

第一条命令会创建：

- `auth.json`：你的账号、授权客户端和 Token 数据；
- `master.key`：用于加密网易云会话的主密钥。

第二条命令会在后台启动服务。

检查运行状态：

```bash
docker compose ps
```

查看日志：

```bash
docker compose logs --tail=100 netease-mcp
```

看到服务监听 `3304` 端口，且没有持续报错，说明启动成功。

### 在本机测试

Mac 或 Linux：

```bash
curl http://127.0.0.1:3304/healthz
```

Windows PowerShell：

```powershell
Invoke-WebRequest http://127.0.0.1:3304/healthz
```

正常结果会包含：

```json
{"ok":true,"service":"netease-music-personal-mcp","version":"0.6.0"}
```

## 7. 给服务配置 HTTPS 域名

服务只开放在本机的 `127.0.0.1:3304`，不要直接把 3304 端口暴露到公网。

你可以选择下面一种方法。

### 方法 A：Cloudflare Tunnel

适合已经把域名放在 Cloudflare 管理的人。

1. 进入 Cloudflare Zero Trust；
2. 创建一个 Cloudflare Tunnel；
3. 按页面提示在运行 MCP 的设备上安装并启动 `cloudflared`；
4. 给隧道添加 Public Hostname；
5. Hostname 填你的子域名，例如 `music.example.com`；
6. Service Type 选择 `HTTP`；
7. Service URL 填：

```text
http://localhost:3304
```

8. 保存后访问：

```text
https://music.example.com/healthz
```

能看到 `ok: true` 就表示域名已经接通。使用 Tunnel 时通常不需要给公网开放 3304 端口。

### 方法 B：Nginx

仓库已经提供示例：

```text
deploy/netease-personal.nginx.conf.example
```

把示例里的域名换成自己的域名，并配置有效的 HTTPS 证书。Nginx 应把请求转发到：

```text
http://127.0.0.1:3304
```

如果你还不熟悉证书和 Nginx，优先选择 Cloudflare Tunnel。

## 8. 创建唯一管理员

第一次打开：

```text
https://music.example.com/setup
```

设置：

- 管理员用户名；
- 管理员密码。

一个实例只能创建一个管理员。创建成功后 `/setup` 会自动锁定，别人不能再注册第二个账号。

请把密码存进可信的密码管理器。

之后使用：

```text
https://music.example.com/dashboard
```

进入个人控制台。

## 9. 连接自己的网易云账号

只有搜索、详情和歌词时，可以不填网易云会话。

需要创建或修改歌单时，才需要自己的 `MUSIC_U`。

### 在浏览器中找到 `MUSIC_U`

以下步骤以 Chrome 或 Edge 为例：

1. 在电脑浏览器打开 [网易云音乐网页版](https://music.163.com/)；
2. 登录自己的网易云账号；
3. 打开浏览器开发者工具；
4. 进入 `Application` 或“应用”；
5. 在左侧找到 `Storage → Cookies → https://music.163.com`；
6. 找到 `MUSIC_U`；
7. 如果存在，再找到 `__csrf`；
8. 回到 MCP 的 `/dashboard`；
9. 在“网易云账号会话”中只粘贴：

```text
MUSIC_U=你的值; __csrf=你的值
```

没有 `__csrf` 时可以只填：

```text
MUSIC_U=你的值
```

### 隐私提醒

- 不要把网易云账号密码交给 MCP；
- 不要截图或公开 `MUSIC_U`；
- 不要把完整 Cookie 发给别人；
- 不要把 `auth.json`、`master.key` 上传到 GitHub；
- 怀疑泄露时，先在网易云退出相关登录，再从控制台断开会话。

## 10. 连接到 AI 客户端

你的远程 MCP 地址始终是：

```text
https://music.example.com/mcp
```

第一次连接时，客户端会打开浏览器，让你登录刚才创建的 MCP 管理员账号并确认授权。

### Claude

1. 打开 Claude 的 Connectors 设置；
2. 添加 Custom Connector；
3. Name 可以填“网易云音乐”；
4. Remote MCP server URL 填：

```text
https://music.example.com/mcp
```

5. OAuth Client ID 和 Client Secret 通常留空；
6. 点击连接；
7. 在打开的授权页面登录并同意授权。

如果客户端提示无法自动注册，再检查 MCP 域名是否能正常打开，以及：

```text
https://music.example.com/.well-known/oauth-authorization-server
```

是否能返回 JSON。

### ChatGPT

ChatGPT 的自定义 MCP 功能取决于套餐、工作区权限和当前发布范围。如果设置里没有创建自定义 App 或 MCP 的入口，不代表你的服务器坏了。

在支持的 ChatGPT 工作区中：

1. 管理员或获准用户启用 Developer mode；
2. 在 Apps 中创建自定义 App；
3. 填入远程 MCP 地址；
4. 扫描工具；
5. 按提示完成 OAuth；
6. 测试无误后再由管理员发布给工作区。

当前入口和套餐限制以
[OpenAI 官方说明](https://help.openai.com/en/articles/12584461-developer-mode-apps-and-full-mcp-connectors-in-chatgpt-beta)
为准。ChatGPT 不能直接连接只运行在你电脑 `localhost` 上的 MCP，需要远程 HTTPS 地址或平台支持的安全隧道。

如果你的 ChatGPT 暂时没有远程 MCP 入口，可以使用后面的 OpenAPI 方式。

### Codex 或其他支持远程 MCP 的客户端

添加一个远程 MCP Server，URL 填：

```text
https://music.example.com/mcp
```

如果客户端支持标准 OAuth 和动态客户端注册，它会自动进入网页登录授权。

不同客户端按钮名称可能不同，但服务器地址不变。

### DeepSeek、自建前端或不支持远程 MCP 的平台

1. 登录 `/dashboard`；
2. 创建一个个人 Token；
3. 只勾选真正需要的权限；
4. 立即复制并安全保存 Token，它只显示一次；
5. 让前端的服务端导入：

```text
https://music.example.com/openapi.json
```

6. 请求时添加：

```http
Authorization: Bearer 你的个人Token
```

不要把具有写入权限的 Token 写进公开网页 JavaScript、手机安装包或公开仓库。Token 应保存在自建前端的服务端环境变量中。

### Android、iPhone 和 iPad

手机不需要安装 Node.js 或 Docker。

你需要：

1. 先在自己的 VPS、NAS 或电脑部署个人 MCP；
2. 使用支持远程 MCP 的手机端 AI 客户端；
3. 添加自己的 `/mcp` 地址；
4. 在浏览器完成 OAuth。

如果电脑休眠、关机或 Docker Desktop 退出，部署在电脑上的 MCP 就会离线。

## 11. 第一次测试

连接成功后，可以依次让 AI：

```text
搜索周杰伦的晴天。
```

```text
查看我的网易云歌单。
```

```text
创建一个叫“周末散步”的隐私歌单。
```

```text
把刚才搜索到的歌曲加入“周末散步”。
```

创建、添加或删除歌曲属于写入操作，工具会要求显式确认。

## 12. 常用维护命令

进入项目文件夹后执行。

查看状态：

```bash
docker compose ps
```

查看日志：

```bash
docker compose logs --tail=200 netease-mcp
```

停止：

```bash
docker compose down
```

重新启动：

```bash
docker compose up -d
```

更新代码：

```bash
git pull
docker compose build --pull
docker compose up -d
```

`docker compose down` 不会主动删除数据卷。不要执行带 `-v` 的删除命令，除非你明确要清空账号、Token 和加密会话。

## 13. 备份

最重要的两个文件是：

```text
/data/auth.json
/data/master.key
```

它们必须一起备份：

- 只有 `auth.json` 没有 `master.key`，无法解密会话；
- 只有 `master.key` 没有 `auth.json`，没有账号和授权数据。

备份文件同样含有敏感信息，请加密保存，不要上传到公开仓库或网盘公开链接。

## 14. 常见问题

### `docker: command not found`

Docker 没有安装完成，或者 Docker Desktop 还没打开。

### `set NETEASE_PERSONAL_ORIGIN`

项目目录里没有正确的 `.env` 配置。重新执行第 5 步，再运行 Docker Compose。

### 打不开 `/setup`

依次检查：

```bash
docker compose ps
docker compose logs --tail=100 netease-mcp
```

然后先测试本机：

```text
http://127.0.0.1:3304/healthz
```

本机正常而域名不正常，问题通常在 Cloudflare Tunnel、DNS、Nginx 或 HTTPS。

### OAuth 授权后没有返回客户端

检查：

1. 客户端填写的是完整 `/mcp` 地址；
2. `NETEASE_PERSONAL_ORIGIN` 与浏览器地址完全一致；
3. 公网地址使用 HTTPS；
4. 反向代理没有缓存流式 MCP 响应；
5. 客户端是否支持 OAuth 动态客户端注册。

### 搜索能用，但歌单不能用

检查 `/dashboard` 的网易云账号会话是否显示“已连接”，并确认 Token 或 OAuth 授权包含相应歌单权限。

### 网易云会话过期

重新登录网易云网页版，再按第 9 步更新 `MUSIC_U`。

### 手机连接不上

手机不能连接电脑的 `localhost`。必须填写可从手机访问的 HTTPS 域名，并确保运行 MCP 的设备没有关机或休眠。

### AI 不能控制电脑里的下一首

远程 VPS 只负责网络工具，不会自动控制你的桌面播放器。Mac 播放控制需要在 Mac 本地运行 stdio 模式。

## 15. 提问时请带上这些信息

请不要发送 Cookie、Token、密码或完整私人 URL。

可以提供：

```text
设备：Mac / Windows / Ubuntu / NAS
部署方式：Docker / Node.js
出错步骤：
访问 /healthz 的结果：
docker compose ps 的结果：
日志最后 30 行：
客户端名称：
```

这样别人才能快速判断问题发生在 Docker、域名、OAuth、客户端还是网易云会话。

## 16. 安全检查清单

正式使用前确认：

- [ ] 这是我自己独立部署的实例；
- [ ] 公网地址使用 HTTPS；
- [ ] 3304 端口没有直接暴露到公网；
- [ ] 管理员密码没有与其他网站复用；
- [ ] 只保存了 `MUSIC_U` 和可选的 `__csrf`；
- [ ] 写入权限只给真正需要的客户端；
- [ ] Token 没有写进公开前端或 GitHub；
- [ ] `auth.json` 和 `master.key` 已加密备份；
- [ ] 我知道电脑关机或休眠后，本机部署会离线。

完成这些步骤后，你就拥有了一套只属于自己的网易云音乐 MCP。
