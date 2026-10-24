# test/ — QQPilot 协议验收脚本

两个 Node（ESM）脚本，用来**独立**验证 `qqpilot-dsh-plugin` 的
`/qqpilot/v1/chat/completions` 是否满足 QQPilot 的真实协议契约。
协议细节（含 QQPilot Rust 源码行号）见 [`../docs/PROTOCOL.md`](../docs/PROTOCOL.md)。

- `mock-qqpilot.mjs`：构造一次真实的 QQPilot 风格请求并**严格校验**响应；也可作为模块复用。
- `verify.mjs`：跑 4 个场景（基础回复 / 文本路径 / 兼容模式探测 / 图片能力），打印 PASS/FAIL 汇总。

要求：Node ≥ 18（用到全局 `fetch`；本机 Node 24 已验证）。无需 `pnpm install`，脚本不依赖任何 npm 包。

---

## 快速开始

```powershell
# 当前 DSH Web origin（端口可能变化，以实际为准）
node test/mock-qqpilot.mjs --url http://127.0.0.1:55068/qqpilot/v1

# 4 场景验收
node test/verify.mjs --url http://127.0.0.1:55068/qqpilot/v1
```

`--url` 接受 **base** 或**完整**地址，两者等价：

```
http://127.0.0.1:55068/qqpilot/v1
http://127.0.0.1:55068/qqpilot/v1/chat/completions   # 不会重复拼接
```

也可用环境变量（端口变了不用改命令）：

```powershell
$env:QQPILOT_ENDPOINT = 'http://127.0.0.1:55068/qqpilot/v1'
node test/verify.mjs
```

---

## mock-qqpilot.mjs

```powershell
node test/mock-qqpilot.mjs --url <url> [选项]
```

它做的事：

1. 按 QQPilot 源码构造请求：中文 system 提示词 + 2 轮 user/assistant 历史 + 最新 user 消息；
   body 为 `{model, messages, stream:false}`；`Content-Type: application/json; charset=utf-8`；
   **默认不带 Authorization**（QQPilot 对 `127.0.0.1` / `localhost` 不发 api_key）。
2. POST 到 `{url}/chat/completions`，默认超时 300s（对应 QQPilot `remote_server_timeout`）。
3. 严格校验响应，任一项不过即 FAIL / exit 1：
   - HTTP 2xx
   - 响应体是合法 JSON 对象
   - `choices[0].message.role === "assistant"`
   - `typeof choices[0].message.content === "string"`（QQPilot 用 `Value::as_str`，null/数组都会静默丢弃）
   - 若存在 `choices[0].message.images`：必须是数组，每项为对象，含以 `data:image/` 开头的
     `image_url.url` 或 `b64_json` 字符串
   - `object === "chat.completion"`、缺少 `usage` 只给 `[WARN]`（QQPilot 不校验）
4. 打印回复文本（截断 300 字）、图片/usage 摘要，最后一行 `PASS` / `FAIL`。

| 选项 | 说明 |
| --- | --- |
| `--url <url>` | 端点（base 或完整），默认 `http://127.0.0.1:55068/qqpilot/v1` |
| `--api-key <key>` | 发送 `Authorization: Bearer <key>`（默认不发） |
| `--timeout <ms>` | HTTP 超时，默认 `300000` |
| `--expect-silent` | 期望 `content` 为空/全空白（QQPilot 会静默不回复） |
| `--expect-text [文本]` | 期望 `content` 非空；带文本时还要求包含该文本 |
| `--image` | 请求带一张 `data:image/png;base64` 并要求模型回传图片；图片检查是**软**的 |
| `--latest <文本>` | 覆盖最新一条用户消息 |
| `--model <名字>` | 覆盖请求 `model` 字段（默认 `qwen3.5:0.8b`） |
| `--debug` | 打印请求体摘要（data URL 截断） |
| `-h, --help` | 帮助 |

示例：

```powershell
# 普通请求
node test/mock-qqpilot.mjs --url http://127.0.0.1:55068/qqpilot/v1 --expect-text

# 静默路径
node test/mock-qqpilot.mjs --url http://127.0.0.1:55068/qqpilot/v1 `
  --latest '请保持安静，直接返回空内容' --expect-silent

# 图片能力
node test/mock-qqpilot.mjs --url http://127.0.0.1:55068/qqpilot/v1 --image
```

---

## verify.mjs

```powershell
node test/verify.mjs --url <url> [选项]
```

场景：

| # | 场景 | 类型 | 判定 |
| --- | --- | --- | --- |
| 1 | 基础回复：`1+1 等于几？请简短回答` | 硬 | `content` 必须是字符串且非空 |
| 2 | 文本路径：`只回复 SILENT 一个词`（被静默时用"必须回复"提示重试一次） | 硬 | `content` 必须非空（未精确含 SILENT 只提示，不失败） |
| 3 | 兼容模式探测：`GET <origin>/qqpilot/api/config` | 软 | 只报告 compat/mode 字段；404 记 SKIP（模式由 Lead/UI 切换） |
| 4 | 图片能力：请求带 `data:image/png` 并要求回传 `images[]` | 软 | 报告是否返回图片；模型拒绝不判失败 |

选项：

| 选项 | 说明 |
| --- | --- |
| `--url <url>` | 端点，默认 `http://127.0.0.1:55068/qqpilot/v1`（`QQPILOT_ENDPOINT` 同效） |
| `--api-key <key>` | 发送 Bearer（默认不发，`QQPILOT_API_KEY` 同效） |
| `--timeout <ms>` | 单次请求超时，默认 `300000` |
| `--config-url <url>` | 覆盖配置探测地址（默认 `<origin>/qqpilot/api/config`） |
| `--skip-image` | 跳过场景 4 |
| `-h, --help` | 帮助 |

输出末尾：

```
================ 结果汇总 ================
PASS  场景 1 [硬] 基础回复（1+1）
...
硬场景: 2/2 PASS, 0 FAIL
软场景: PASS:3, WARN:4
RESULT: PASS
```

退出码：硬场景有 FAIL → `1`，否则 `0`。软场景（3、4）不影响退出码。

---

## 插件尚未安装时

预期表现（当前 DSH Web 已在 `http://127.0.0.1:55068` 运行，但路由未注册）：

- `mock-qqpilot.mjs` → `HTTP 405`（或 404）→ `FAIL`，exit 1；
- `verify.mjs` → 场景 1 FAIL、场景 2 FAIL、场景 3 SKIP、场景 4 WARN，`RESULT: FAIL`，exit 1。

这是**正常现象**，说明是"端点未就绪"而不是脚本坏了。安装插件（Lead 完成 `lib/` 并应用
`cordis.patch.yml`）后重新执行即可：

```powershell
node test/verify.mjs --url http://127.0.0.1:55068/qqpilot/v1
```

如果端口变了：以 DSH Web 实际 URL 为准（或 `$env:QQPILOT_ENDPOINT`），脚本不接受写死端口。

## 排查

| 现象 | 可能原因 |
| --- | --- |
| `ECONNREFUSED` | DSH Web 未运行 / 端口写错 |
| `HTTP 404` + 空 body | 插件未安装，路由未注册 |
| `HTTP 405` | 该路径存在但不接受 POST（DSH 静态路由兜底） |
| `content 必须是字符串` | 插件返回了 `content:null` / content-parts 数组 / tool_calls 直出 |
| `images... image_url.url 必须以 data:image/ 开头` | 图片用了 http URL 或裸 base64 |
| 响应不是合法 JSON | 返回了 SSE/流式数据；QQPilot 要求 `stream:false` 的单个 JSON |

更多协议细节（请求体合并、`[[NEXT]]`、500 字截断、空内容静默等）见
[`../docs/PROTOCOL.md`](../docs/PROTOCOL.md)。

---

## Live evidence (2026-10-24, host 0.2.1-rc.2)

以下为插件安装后在本机 `http://127.0.0.1:55068` 跑出的**一次性**实测记录（端口可变，
以实际 origin 为准），只作证据参考，不是协议定义。

```powershell
node test/mock-qqpilot.mjs --url http://127.0.0.1:55068/qqpilot/v1
node test/verify.mjs --url http://127.0.0.1:55068/qqpilot/v1
```

| 观测项 | 结果 |
| --- | --- |
| `mock-qqpilot.mjs` | PASS：HTTP 200（约 0.5s），`content="等于2"`，`usage.total_tokens=895` |
| `verify.mjs` 硬场景 | 2/2 PASS：场景 1 `content="等于2"`；场景 2 文本路径 `content="SILENT"` |
| 场景 3 兼容模式探测 | `compatibilityMode=false`、`fallbackToCompat=true`（tool 模式） |
| 场景 4 出站图片 | tool 模式可回 `data:image/...`；Lead 的一次运行返回 1 张 data URL 图，另一次运行模型只回文本（软检查 WARN，不算失败） |
| 静默路径 | 工具模式映射为 `content=""`，QQPilot 侧跳过发送（`silences=1`） |
| 入站图片 | 1x1 PNG `image_url` data URL → 模型回答"粉红色"（手动验证 vision 入站正常） |
| `/qqpilot/api/test` | tool 模式 `{"mode":"tool","reply":{"text":"连接正常，测试通过。"}}`；compat 模式 `{"mode":"compat","reply":{"text":"连接正常。"}}` |
| 配置持久化 | `compatibilityMode` 切换后写入 `~/.dsh/qqpilot-dsh-plugin.json` |
| 插件统计 | `requests=8 replies=7 silences=1 errors=0` |

出站图片是否返回取决于模型与提示，属能力项而非协议硬约束；生产验收建议用真实图片再测一次。
