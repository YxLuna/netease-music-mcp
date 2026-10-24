# 网易云：扫一次码，后面交给程序

> 本项目已经内置了这套流程：`npm run login:qr`（实现在 `src/qr-login.js`），
> 登录后可以用 `netease_account_status` 工具查会员。下面讲原理，方便你在自己的程序里照做或排查。

适用场景：想让自己的程序（一起听歌、播放器、机器人）用**自己的网易云会员账号**放歌。

人只需要在手机网易云 App 里扫一次码、点一次确认。之后保存登录凭证、识别会员、取播放地址都由程序自动完成。

> 常见问题：「cookie 存了，但程序认不出会员 / 只能放 30 秒试听」。大多是下面几处没做对，见文末「排查」。

---

## 总流程

```
程序要一个登录码 key
   → 把 key 拼成链接、生成二维码给人看
   → 人用网易云 App 扫码、确认
   → 程序每 2 秒问一次「扫了没」，直到返回 803
   → 从这次响应的 Set-Cookie 里只挑 MUSIC_U 和 __csrf，存进只有自己能读的文件
   → 以后每次请求都带上这两个 cookie + os=pc; appver=…
   → 查账号接口看 vipType，大于 0 就是会员
   → 取播放地址时带上想要的音质 level；返回里有 freeTrialInfo 就说明只给了试听
```

所有接口都是对 `https://music.163.com/weapi/...` 发 POST，请求体用 weapi 加密（见第 0 步）。

---

## 0. 请求怎么发（weapi）

网页版接口要求请求体加密，格式是 `application/x-www-form-urlencoded`，里面有两个字段：

- `params`：先用固定的公开密钥对 JSON 做一次 AES-128-CBC，再用随机生成的 16 位密钥做一次；两次都转 base64。
- `encSecKey`：把那 16 位随机密钥倒序，用网易云公开的 RSA 公钥做无填充加密，结果是 256 位十六进制。

固定密钥、IV 和 RSA 模数是公开的。社区开源项目（如 NeteaseCloudMusicApi）里都有，直接照抄即可，不用自己逆向。

每个请求的公共部分：

```
POST https://music.163.com/weapi<接口路径>?csrf_token=<__csrf，没有就留空>
Content-Type: application/x-www-form-urlencoded
Referer: https://music.163.com
User-Agent: <一个正常的桌面浏览器 UA>
Cookie: os=pc; appver=2.10.13; MUSIC_U=<...>; __csrf=<...>
```

加密前的 JSON 里也要带 `"csrf_token": "<__csrf>"`。

`os=pc; appver=...` 这两项**每次都要带**，原因见第 4 步。

---

## 1. 要一个登录码

```
接口：/login/qrcode/unikey
参数：{ "type": 1 }
返回：{ "code": 200, "unikey": "xxxx-xxxx-..." }
```

社区封装里这个接口叫 `/login/qr/key`，是同一个东西。这一步还没登录，cookie 里只带 `os=pc; appver=...` 就行。

## 2. 生成二维码

二维码的内容就是这个链接：

```
https://music.163.com/login?codekey=<unikey>
```

用任意二维码库（Python 的 `qrcode`，Node 的 `qrcode`）把它画成图片，放进网页或终端里给人扫。登录码几分钟就会过期（见下一步的 800），过期了回第 1 步重新要一个。

## 3. 轮询，等到 803

```
接口：/login/qrcode/client/login
参数：{ "key": "<unikey>", "type": 1 }
```

每 2 秒左右调一次，看返回里的 `code`：

| code | 意思 | 程序该做什么 |
|---|---|---|
| 801 | 等待扫码 | 继续等 |
| 802 | 已扫码，等手机上点确认（返回里会带 nickname） | 可以提示「请在手机上确认」 |
| 803 | 登录成功 | 进入第 4 步 |
| 800 | 码过期了 | 回第 1 步重新要码 |

## 4. 只挑两个 cookie，存好

**803 那一次响应**的 `Set-Cookie` 响应头里会有一大串 cookie。只需要两个：

- `MUSIC_U`：登录凭证本体，最重要；
- `__csrf`：请求时要回传的 csrf 令牌。

```js
// Node 18+：fetch 的响应头可以用 getSetCookie() 拿到每一条 Set-Cookie
const picked = {};
for (const line of res.headers.getSetCookie()) {
  const m = line.match(/^(MUSIC_U|__csrf)=([^;]*)/);
  if (m && m[2]) picked[m[1]] = m[2];
}
if (!picked.MUSIC_U) throw new Error('登录成功但没拿到 MUSIC_U');
```

保存：

- 写进一个 JSON 文件，权限设成 **600**（只有运行程序的那个用户能读）；
- 不进 git 仓库、不打进日志、不通过任何接口返回给前端。`MUSIC_U` 等于账号本身，泄露了别人就能直接用你的会员；
- 不需要存整串 cookie。整串里有很多有效期短或跟设备绑定的项，存进去反而容易出问题。

```js
writeFileSync(file, JSON.stringify({ ...picked, at: new Date().toISOString() }), { mode: 0o600 });
chmodSync(file, 0o600);   // 文件原来就存在时，mode 参数不生效，所以再设一次
```

之后每次请求都把它们拼进 Cookie：

```
os=pc; appver=2.10.13; MUSIC_U=<...>; __csrf=<...>
```

**为什么要带 `os=pc; appver=...`**：不带的话，服务器会把请求当成普通网页访客。账号即使是会员，也常常只给 128k 或者试听片段，看起来就像「认不出会员」。

## 5. 识别会员

```
接口：/w/nuser/account/get
参数：{}
返回：{ "account": { "vipType": 11, ... }, "profile": { "userId": ..., "nickname": ... } }
```

- 有 `profile`，说明登录有效；`profile` 是空的，说明 `MUSIC_U` 失效了，要重新扫码；
- `account.vipType > 0` 就是会员（常见值 11 = 黑胶 VIP），0 是普通账号。

可以在程序启动时和每次扫码成功后调一次，在界面上显示「已登录：xxx（会员）」，出问题一眼就能看到。

## 6. 取播放地址

```
接口：/song/enhance/player/url/v1
参数：{ "ids": "[歌曲id]", "level": "exhigh", "encodeType": "aac" }
```

- `ids` 是**字符串形式的 JSON 数组**，例如 `"[33894312]"`；
- `level` 可选：`standard`（标准）、`higher`（较高）、`exhigh`（极高）、`lossless`（无损）、`hires`（Hi-Res）。要无损或 Hi-Res 时，把 `encodeType` 设成 `flac`；
- 返回的 `data[0]` 里：
  - `url`：播放地址，大约 20 分钟后过期（`expi` 字段是秒数）。**每次播放前现取，不要缓存**；
  - `br` / `level`：实际给到的码率和音质；
  - `freeTrialInfo`：**不是 null 就说明这次只给了试听片段**（一般 30 秒）。会员账号也出现这个，就说明 cookie 没被认出会员，按下面的「排查」逐条查；
  - `url` 为空、`code` 为 404：这首歌网易云没有版权。

返回的地址有时是 `http://`。如果你的页面是 https，把它换成 `https://`，否则浏览器会拦掉。

---

## 排查：「存了 cookie 但认不出会员」

按顺序查：

1. **请求的 Cookie 里有没有 `os=pc; appver=...`**？最常见的原因就是这个。
2. **`MUSIC_U` 是不是完整的**？从浏览器手动复制时容易截断、多了引号，或者带上了 `MUSIC_U=` 前缀导致重复。用扫码流程拿到的最可靠。
3. **调一下账号接口**（第 5 步）：
   - `profile` 是空的：凭证已经失效，重新扫码；
   - `vipType` 是 0：登录的不是会员那个号。
4. **看取地址的返回**：`freeTrialInfo` 不为空，说明还是被当成非会员，回到第 1 条。
5. **程序跑在哪个网络上**？同一个账号突然从陌生 IP（尤其是海外机房、代理出口）发请求，容易触发网易云的风控，被踢下线或降级。尽量让程序从平时用网易云的网络直连 `music.163.com`，不要走代理。
6. **账号同时在太多地方登录**，也可能被挤掉。被挤掉的症状是 `profile` 变空，重新扫码即可。

---

## 小结

- 人只做一件事：扫码、点确认。
- 程序要做的：要码 → 出二维码 → 轮询到 803 → 只存 `MUSIC_U` 和 `__csrf`（600 权限）→ 每次请求带上 `os=pc; appver` → 用 `vipType` 判断会员 → 取地址时带 `level`，用 `freeTrialInfo` 判断是不是试听。
- 凭证等于账号本身：不进仓库、不进日志、不发给别人。
- 只给自己听：不要下载、存储或转发音频文件。
