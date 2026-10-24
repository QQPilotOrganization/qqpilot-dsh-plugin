#!/usr/bin/env node
/**
 * test/mock-qqpilot.mjs — 模拟 QQPilot 发一次真实的 Chat Completions 请求，并严格校验响应。
 *
 * 请求形状完全按 QQPilot Rust 源码构造（见 docs/PROTOCOL.md）：
 *   - POST {server_url}/chat/completions，Content-Type: application/json; charset=utf-8
 *   - body: { model, messages, stream:false }
 *   - 默认不带 Authorization（QQPilot 对 127.0.0.1/localhost 不发送 api_key）
 *
 * 响应校验（QQPilot 的硬性取值路径，任一项不过 => FAIL / exit 1）：
 *   - HTTP 2xx
 *   - 合法 JSON 对象
 *   - choices[0].message.role === 'assistant'
 *   - typeof choices[0].message.content === 'string'
 *   - 若存在 message.images：必须是数组，每项为对象，含 data:image/... 的 image_url.url
 *     或 b64_json 字符串
 *
 * 用法（PowerShell 可直接复制）：
 *   node test/mock-qqpilot.mjs --url http://127.0.0.1:55068/qqpilot/v1
 *   node test/mock-qqpilot.mjs --url http://127.0.0.1:55068/qqpilot/v1 --expect-text
 *   node test/mock-qqpilot.mjs --url ... --expect-silent
 *   node test/mock-qqpilot.mjs --url ... --image
 *   QQPILOT_ENDPOINT=http://127.0.0.1:55068/qqpilot/v1 node test/mock-qqpilot.mjs
 *
 * 也可作为模块被 test/verify.mjs 复用（导出 buildQQPilotBody / validateCompletion /
 * sendChatCompletion / probe / normalizeEndpoint）。
 */

import { pathToFileURL } from 'node:url';

/** 当前 DSH Web origin 下的默认端点（端口可变，命令行/环境变量可覆盖）。 */
export const DEFAULT_ENDPOINT = 'http://127.0.0.1:55068/qqpilot/v1';

/** QQPilot 的 remote_server_timeout 默认 300s（config.rs:117, answer.rs:80-83）。 */
export const DEFAULT_TIMEOUT_MS = 300_000;

/** 1x1 透明 PNG，用作最小 inbound 图片与期望回传的 data URL。 */
export const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** 仿 QQPilot system.txt 的中文系统提示词。 */
export const DEFAULT_SYSTEM_PROMPT =
  '你是 QQ 群里的猫娘机器人 neko，说话简短、口语化，一次只说一两句，不使用 Markdown、不用列表。';

/** QQPilot 默认 modelname（config.rs:114 / 本机 config.ini）。插件不应校验它。 */
export const DEFAULT_MODEL = 'qwen3.5:0.8b';

const IMAGE_REQUEST_HINT =
  '请调用回复工具，把用户消息里那张 1x1 的 PNG 图片原样回传：' +
  'images 数组里放同一个以 data:image/png;base64 开头的 data URL，' +
  'text 写一句“图来啦”。不要拒绝，也不要编造别的图片，data URL 如下：\n' +
  TINY_PNG_DATA_URL;

// ---------------------------------------------------------------------------
// URL / 请求构造
// ---------------------------------------------------------------------------

/**
 * 接受 base 或完整地址，统一成 { base, url, origin, configUrl, modelsUrl }。
 *  - `http://host/qqpilot/v1`                 => url = `.../qqpilot/v1/chat/completions`
 *  - `http://host/qqpilot/v1/chat/completions` => 同上（不重复拼接）
 */
export function normalizeEndpoint(input = DEFAULT_ENDPOINT) {
  const raw = String(input ?? '').trim();
  if (!raw) throw new Error('endpoint 为空：用 --url 或 QQPILOT_ENDPOINT 指定');
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`不是合法 URL：${raw}`);
  }

  let base = raw.replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(base)) {
    base = base.replace(/\/chat\/completions$/i, '').replace(/\/+$/, '');
  }
  const url = `${base}/chat/completions`;
  return {
    input: raw,
    base,
    url,
    origin: parsed.origin,
    configUrl: `${parsed.origin}/qqpilot/api/config`,
    statusUrl: `${parsed.origin}/qqpilot/api/status`,
    modelsUrl: `${base}/models`,
  };
}

const pad2 = (n) => String(n).padStart(2, '0');

/** QQPilot 聊天记录里时间格式 `%m-%d %H:%M:%S`（chat_content.rs:93-97 / conversation.rs:11）。 */
export function formatQQTime(date = new Date()) {
  return (
    `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ` +
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
  );
}

/**
 * 按 chat_content.rs:99-103 的 Display 实现拼一条 user 消息的文本。
 * 格式（\n 为真实换行）：
 *   [time]\n<time> \n\n [username] \n <username> \n\n [content] \n <text>\n
 */
export function qqUserText(username, text, time = formatQQTime()) {
  return `[time]\n${time} \n\n [username] \n ${username} \n\n [content] \n ${text}\n`;
}

/** 构造一条 QQPilot user 消息（纯文本）。 */
export function qqUserMessage(username, text, time = formatQQTime()) {
  return { role: 'user', content: qqUserText(username, text, time) };
}

/**
 * 构造一个真实形状的 QQPilot 请求体。
 *
 * @param {object} [opts]
 * @param {string} [opts.latestText]   最新一条用户消息的正文
 * @param {boolean} [opts.image]       是否让最新用户消息带 inbound 图片 + 要求返回图片
 * @param {boolean} [opts.history]     是否带 system/历史消息（默认 true）
 * @param {string} [opts.model]        请求里的 model 字段
 * @param {string} [opts.systemPrompt] 系统提示词；传 '' 则不发送 system 消息
 * @returns {{model:string, messages:Array<object>, stream:false}}
 */
export function buildQQPilotBody({
  latestText = '1+1 等于几？请简短回答。',
  image = false,
  history = true,
  model = DEFAULT_MODEL,
  systemPrompt = DEFAULT_SYSTEM_PROMPT,
} = {}) {
  const messages = [];

  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }

  if (history) {
    messages.push(qqUserMessage('群友A', '你好呀，今天过得怎么样？', formatQQTime(new Date(Date.now() - 120_000))));
    messages.push({ role: 'assistant', content: '喵～今天很开心，刚晒完太阳呢' });
    messages.push(qqUserMessage('群友B', '别一直喵喵喵的，说人话', formatQQTime(new Date(Date.now() - 90_000))));
    messages.push({ role: 'assistant', content: '好嘛好嘛，那就正常说：今天挺不错的' });
  }

  if (!image) {
    messages.push(qqUserMessage('群友C', latestText));
  } else {
    // 对应 answer.rs:330-339：content 为分段数组，先 text 后 image_url
    const text = `${latestText}\n\n${IMAGE_REQUEST_HINT}`;
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: qqUserText('群友C', text) },
        { type: 'image_url', image_url: { url: TINY_PNG_DATA_URL } },
      ],
    });
  }

  return { model, messages, stream: false };
}

// ---------------------------------------------------------------------------
// 响应校验（严格按 QQPilot 的取值路径）
// ---------------------------------------------------------------------------

/**
 * 严格校验一个 OpenAI Chat Completions 响应体。
 * @returns {{
 *   ok:boolean, errors:string[], warnings:string[],
 *   content:(string|undefined), images:Array<object>, usage:(object|undefined),
 *   object:(string|undefined), role:(string|undefined)
 * }}
 */
export function validateCompletion(payload) {
  const errors = [];
  const warnings = [];
  const result = {
    ok: false,
    errors,
    warnings,
    content: undefined,
    images: [],
    usage: undefined,
    object: undefined,
    role: undefined,
  };

  const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

  if (!isObject(payload)) {
    errors.push('响应不是 JSON 对象（serde_json 解析失败会让 QQPilot 静默失败）');
    return result;
  }

  result.object = payload.object;
  if (payload.object !== 'chat.completion') {
    warnings.push(
      `object 应为 "chat.completion"，实际为 ${JSON.stringify(payload.object)}` +
        '（QQPilot 不校验该字段，仅规范提示）',
    );
  }

  if (!Array.isArray(payload.choices)) {
    errors.push('缺少 choices 数组');
    return result;
  }
  if (payload.choices.length === 0) {
    errors.push('choices 为空数组（QQPilot pointer /choices/0/... 取不到值）');
    return result;
  }

  const choice = payload.choices[0];
  if (!isObject(choice)) {
    errors.push('choices[0] 不是对象');
    return result;
  }
  const message = choice.message;
  if (!isObject(message)) {
    errors.push('choices[0].message 不是对象');
    return result;
  }

  result.role = message.role;
  if (message.role !== 'assistant') {
    errors.push(`choices[0].message.role 应为 "assistant"，实际为 ${JSON.stringify(message.role)}`);
  }

  if (typeof message.content !== 'string') {
    errors.push(
      'choices[0].message.content 必须是字符串（QQPilot 用 Value::as_str，' +
        'null / 数组 / 分段 content-parts 都会导致静默丢弃）',
    );
  } else {
    result.content = message.content;
  }

  if (message.images !== undefined) {
    if (!Array.isArray(message.images)) {
      errors.push('choices[0].message.images 存在但不是数组');
    } else {
      message.images.forEach((item, index) => {
        if (!isObject(item)) {
          errors.push(`choices[0].message.images[${index}] 不是对象`);
          return;
        }
        const url =
          isObject(item.image_url) && typeof item.image_url.url === 'string'
            ? item.image_url.url
            : undefined;
        const b64 = typeof item.b64_json === 'string' ? item.b64_json : undefined;

        if (url === undefined && b64 === undefined) {
          errors.push(
            `choices[0].message.images[${index}] 需含 image_url.url 字符串或 b64_json 字符串`,
          );
          return;
        }
        if (url !== undefined) {
          if (!url.startsWith('data:image/')) {
            errors.push(
              `choices[0].message.images[${index}].image_url.url 必须以 data:image/ 开头` +
                `（实际前缀 ${JSON.stringify(url.slice(0, 24))}...）`,
            );
          } else {
            result.images.push({ index, kind: 'data_url', url, bytesHint: url.length });
          }
        }
        if (b64 !== undefined) {
          if (!b64.startsWith('data:image/')) {
            // 形状上非法，但按需求仅视为提示：Rust 端 save_to_temp 需要 data:image/ 前缀 + ','
            warnings.push(
              `choices[0].message.images[${index}].b64_json 是裸 base64：` +
                'QQPilot Rust save_to_temp 要求字符串含 "," 且 "," 前有 data:image/ 前缀，' +
                '裸 base64 会被丢弃（answer.rs:497-518）',
            );
          }
          result.images.push({ index, kind: 'b64_json', length: b64.length });
        }
      });
    }
  }

  if (payload.usage === undefined) {
    warnings.push('缺少 usage（QQPilot 仅用于日志/token 累计，不致命）');
  } else if (!isObject(payload.usage)) {
    errors.push('usage 存在但不是对象');
  } else {
    result.usage = payload.usage;
    for (const key of ['prompt_tokens', 'completion_tokens', 'total_tokens']) {
      if (payload.usage[key] !== undefined && typeof payload.usage[key] !== 'number') {
        warnings.push(`usage.${key} 不是数字（QQPilot 按 i64 读，非整数会变成 0）`);
      }
    }
  }

  result.ok = errors.length === 0;
  return result;
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

/**
 * 发送一次 QQPilot 风格的 POST，返回原始响应与解析结果。
 * @param {object} opts
 * @param {string|object} [opts.endpoint] 端点字符串或 normalizeEndpoint() 结果
 * @param {object} [opts.body] 请求体（默认 buildQQPilotBody()）
 * @param {string} [opts.apiKey] 非空则发 Authorization: Bearer（QQPilot 对本地端点默认不发）
 * @param {number} [opts.timeoutMs] 默认 300000（QQPilot 的 remote_server_timeout）
 */
export async function sendChatCompletion({
  endpoint = DEFAULT_ENDPOINT,
  body,
  apiKey = '',
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const ep = typeof endpoint === 'string' ? normalizeEndpoint(endpoint) : endpoint;
  const requestBody = body ?? buildQQPilotBody();
  const headers = { 'content-type': 'application/json; charset=utf-8' };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  let raw = '';
  let json;
  let error;

  try {
    response = await fetch(ep.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    raw = await response.text();
  } catch (err) {
    const aborted = err?.name === 'AbortError';
    error = aborted
      ? `请求超时：>${timeoutMs}ms（QQPilot remote_server_timeout）`
      : `网络错误：${err?.message ?? err}`;
    return {
      endpoint: ep,
      requestBody,
      status: 0,
      httpOk: false,
      contentType: '',
      raw: '',
      json: undefined,
      error,
      elapsedMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }

  try {
    json = JSON.parse(raw);
  } catch (err) {
    error =
      raw.trim() === ''
        ? `HTTP ${response.status} 且响应体为空（QQPilot 解析失败 => 静默不回复）`
        : `响应不是合法 JSON：${err.message}`;
  }

  return {
    endpoint: ep,
    requestBody,
    status: response.status,
    httpOk: response.ok,
    contentType: response.headers.get('content-type') ?? '',
    raw,
    json,
    error,
    elapsedMs: Date.now() - started,
  };
}

/**
 * 发送 + 校验的便捷封装，供 verify.mjs 使用。
 * @returns {{request:{url:string, body:object}, response:object, validation:object}}
 */
export async function probe({
  endpoint = DEFAULT_ENDPOINT,
  body,
  apiKey = '',
  timeoutMs = DEFAULT_TIMEOUT_MS,
  latestText,
  image = false,
  model,
  systemPrompt,
} = {}) {
  const ep = typeof endpoint === 'string' ? normalizeEndpoint(endpoint) : endpoint;
  const requestBody =
    body ?? buildQQPilotBody({ latestText, image, model, systemPrompt });
  const response = await sendChatCompletion({
    endpoint: ep,
    body: requestBody,
    apiKey,
    timeoutMs,
  });

  let validation;
  if (response.error || !response.httpOk) {
    validation = {
      ok: false,
      errors: [
        response.error ?? `HTTP ${response.status}（QQPilot 只接受 2xx，否则静默失败）`,
      ],
      warnings: [],
      content: undefined,
      images: [],
      usage: undefined,
      object: response.json?.object,
      role: undefined,
    };
  } else {
    validation = validateCompletion(response.json);
  }

  return {
    request: { url: ep.url, body: requestBody },
    response,
    validation,
  };
}

// ---------------------------------------------------------------------------
// 输出辅助
// ---------------------------------------------------------------------------

const escapeJson = (s) => JSON.stringify(String(s));

/** 按 Unicode 字符截断，避免破坏中文/emoji。 */
export function shorten(text, max = 300) {
  if (typeof text !== 'string') return String(text);
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  return `${chars.slice(0, max).join('')}…（共 ${chars.length} 字符，已截断）`;
}

function printValidationReport(validation, { stdout, stderr }) {
  for (const w of validation.warnings) {
    stdout(`  [WARN] ${w}`);
  }
  for (const e of validation.errors) {
    stderr(`  [ERROR] ${e}`);
  }
  if (validation.content === undefined) {
    stdout('  回复内容: <缺失>（QQPilot 会静默不回复）');
  } else if (validation.content.trim() === '') {
    stdout(`  回复内容: ${escapeJson(validation.content)}（空白 => QQPilot 静默不回复）`);
  } else {
    stdout(`  回复内容: ${escapeJson(shorten(validation.content, 300))}`);
  }
  if (validation.images.length > 0) {
    validation.images.forEach((img) => {
      const detail =
        img.kind === 'data_url'
          ? `data URL（${img.bytesHint} 字符）`
          : `b64_json（${img.length} 字符）`;
      stdout(`  images[${img.index}]: ${detail}`);
    });
  } else if (validation.content !== undefined) {
    stdout('  images: 无');
  }
  if (validation.usage) {
    stdout(
      `  usage: prompt=${validation.usage.prompt_tokens ?? 0} ` +
        `completion=${validation.usage.completion_tokens ?? 0} ` +
        `total=${validation.usage.total_tokens ?? 0}`,
    );
  }
}

const USAGE = `mock-qqpilot — 向 QQPilot 兼容端点发一次真实请求并严格校验响应

用法:
  node test/mock-qqpilot.mjs --url <base 或完整 /chat/completions 地址> [选项]

选项:
  --url <url>            端点，默认 http://127.0.0.1:55068/qqpilot/v1
                         也可用环境变量 QQPILOT_ENDPOINT
  --api-key <key>        发送 Authorization: Bearer <key>（默认不发，同 QQPilot 本地行为）
                         也可用环境变量 QQPILOT_API_KEY
  --timeout <ms>         HTTP 超时，默认 300000（= QQPilot remote_server_timeout 300s）
  --expect-silent        期望 content 为空/全空白（QQPilot 静默不回复）
  --expect-text [文本]   期望 content 非空；给了文本则还要求 content 包含该文本
  --image                请求里附带一张 data:image/png 并让模型回传图片（软检查，不硬失败）
  --latest <文本>        覆盖最新一条用户消息
  --model <名字>         覆盖请求 model 字段（默认 ${DEFAULT_MODEL}）
  --debug                打印请求体摘要（图片 data URL 会截断）
  -h, --help             显示本帮助

退出码: 0 = PASS，1 = FAIL
`;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const opts = {
    url: process.env.QQPILOT_ENDPOINT || DEFAULT_ENDPOINT,
    apiKey: process.env.QQPILOT_API_KEY || '',
    timeoutMs: DEFAULT_TIMEOUT_MS,
    expectSilent: false,
    expectText: undefined,
    image: false,
    latestText: undefined,
    model: undefined,
    debug: false,
    help: false,
  };

  const readValue = (argvList, index) => {
    const next = argvList[index + 1];
    if (next === undefined) throw new Error('缺少参数值');
    return next;
  };

  for (let i = 0; i < argv.length; i += 1) {
    let arg = argv[i];
    let inline;
    if (arg.startsWith('--') && arg.includes('=')) {
      const eq = arg.indexOf('=');
      inline = arg.slice(eq + 1);
      arg = arg.slice(0, eq);
    }
    const value = () => {
      if (inline !== undefined) return inline;
      const v = readValue(argv, i);
      i += 1;
      return v;
    };

    switch (arg) {
      case '--url':
        opts.url = value();
        break;
      case '--api-key':
        opts.apiKey = value();
        break;
      case '--timeout': {
        const parsed = Number(value());
        if (!Number.isFinite(parsed) || parsed <= 0) throw new Error('--timeout 需要正数毫秒');
        opts.timeoutMs = parsed;
        break;
      }
      case '--expect-silent':
        opts.expectSilent = true;
        break;
      case '--expect-text': {
        if (inline !== undefined) {
          opts.expectText = inline;
        } else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('-')) {
          opts.expectText = argv[i + 1];
          i += 1;
        } else {
          opts.expectText = '';
        }
        break;
      }
      case '--image':
        opts.image = true;
        break;
      case '--latest':
        opts.latestText = value();
        break;
      case '--model':
        opts.model = value();
        break;
      case '--debug':
        opts.debug = true;
        break;
      case '-h':
      case '--help':
        opts.help = true;
        break;
      default:
        throw new Error(`未知参数：${argv[i]}`);
    }
  }
  return opts;
}

/**
 * CLI 主流程。返回退出码（0/1）。
 * @returns {Promise<number>}
 */
export async function runMockCli(argv = process.argv.slice(2), io = {}) {
  const stdout = io.stdout ?? ((...args) => console.log(...args));
  const stderr = io.stderr ?? ((...args) => console.error(...args));

  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    stderr(`FAIL 参数错误：${err.message}`);
    stderr('');
    stderr(USAGE);
    return 1;
  }

  if (opts.help) {
    stdout(USAGE);
    return 0;
  }

  let ep;
  try {
    ep = normalizeEndpoint(opts.url);
  } catch (err) {
    stderr(`FAIL ${err.message}`);
    return 1;
  }

  stdout(`[mock-qqpilot] POST ${ep.url}`);
  stdout(
    `[mock-qqpilot] origin=${ep.origin} api_key=${opts.apiKey ? '已发送 Bearer' : '未发送（同 QQPilot 本地行为）'} ` +
      `timeout=${opts.timeoutMs}ms`,
  );

  const body = buildQQPilotBody({
    latestText: opts.latestText,
    image: opts.image,
    model: opts.model,
  });
  const latest = body.messages[body.messages.length - 1];
  const latestPreview =
    typeof latest.content === 'string'
      ? shorten(latest.content.replace(/\s+/g, ' '), 120)
      : '[content 分段数组 + inbound 图片]';
  stdout(
    `[mock-qqpilot] model=${body.model} messages=${body.messages.length} ` +
      `stream=${body.stream} 最新用户消息: ${escapeJson(latestPreview)}`,
  );
  if (opts.debug) {
    const preview = JSON.stringify(body, (key, val) =>
      typeof val === 'string' && val.length > 200 ? `${val.slice(0, 120)}…<省略 ${val.length - 120} 字符>` : val,
    );
    stdout(`[mock-qqpilot] body=${shorten(preview, 4000)}`);
  }

  const result = await probe({
    endpoint: ep,
    body,
    apiKey: opts.apiKey,
    timeoutMs: opts.timeoutMs,
  });
  const { response, validation } = result;

  if (response.error && response.status === 0) {
    stderr('');
    stderr(`FAIL ${response.error}`);
    stderr('  排查: dsh web 是否在运行？端口是否正确？插件是否已安装并生效？');
    return 1;
  }

  stdout('');
  stdout(
    `[mock-qqpilot] HTTP ${response.status} (${response.elapsedMs}ms) ` +
      `content-type=${response.contentType || '<无>'}`,
  );

  if (response.json === undefined) {
    stderr(`FAIL ${response.error ?? '响应无法解析为 JSON'}`);
    stdout(`  响应原文: ${escapeJson(shorten(response.raw, 600))}`);
    return 1;
  }

  printValidationReport(validation, { stdout, stderr });

  let failed = !validation.ok;
  const content = validation.content;
  const problems = [...validation.errors];

  if (opts.expectSilent) {
    if (content !== undefined && content.trim() !== '') {
      failed = true;
      problems.push(`--expect-silent：期望空/全空白 content，实际 ${escapeJson(shorten(content, 120))}`);
    }
  } else if (opts.expectText !== undefined) {
    if (content === undefined || content.trim() === '') {
      failed = true;
      problems.push(
        opts.expectText
          ? `--expect-text ${escapeJson(opts.expectText)}：content 为空`
          : '--expect-text：content 为空/缺失',
      );
    } else if (opts.expectText && !content.includes(opts.expectText)) {
      failed = true;
      problems.push(
        `--expect-text：content 未包含 ${escapeJson(opts.expectText)}（实际 ${escapeJson(shorten(content, 120))}）`,
      );
    }
  }

  if (opts.image) {
    // 图片能力是软检查：模型可能拒绝发图，不算协议失败
    if (validation.images.length > 0) {
      stdout(`[mock-qqpilot] 图片检查: 返回了 ${validation.images.length} 张图（PASS）`);
    } else {
      stdout('[mock-qqpilot] 图片检查: 模型未返回图片（软检查，不判失败）');
    }
  }

  stdout('');
  if (failed || problems.length > 0) {
    for (const p of problems) stderr(`  - ${p}`);
    stderr(
      `FAIL ${new Date().toISOString()} — 响应不满足 QQPilot 契约（见 docs/PROTOCOL.md）`,
    );
    return 1;
  }
  stdout('PASS — 响应满足 QQPilot 契约');
  return 0;
}

const isDirectRun = (() => {
  try {
    return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  runMockCli()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      console.error(`FAIL 未捕获错误：${err?.stack ?? err}`);
      process.exitCode = 1;
    });
}
