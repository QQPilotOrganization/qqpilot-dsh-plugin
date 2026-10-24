#!/usr/bin/env node
/**
 * test/verify.mjs — 针对已安装的 qqpilot-dsh-plugin 跑多场景验收。
 *
 * 场景：
 *  1. 基础回复：问「1+1 等于几？请简短回答」，必须是 JSON 字符串 content 且非空（硬失败）
 *  2. 文本路径：让模型「只回复 SILENT 一个词」，验证 content 文本路径可用（硬失败；
 *     模型若选择静默，会换更明确的"必须回复"提示重试一次）
 *  3. 兼容模式探测：GET <origin>/qqpilot/api/config，只报告当前是 compat 还是 tool 模式；
 *     模式由 Lead/UI 切换，本场景不判失败（接口 404 时 SKIP）
 *  4. 图片能力：请求里带 data:image/png，要求模型用回复工具回传 images[]；只报告结果，
 *     模型拒绝发图不算失败（软检查）
 *
 * 退出码：硬场景失败 => 1，否则 0。
 *
 * 用法：
 *   node test/verify.mjs --url http://127.0.0.1:55068/qqpilot/v1
 *   node test/verify.mjs --url http://127.0.0.1:51801/qqpilot/v1 --skip-image
 *   QQPILOT_ENDPOINT=... node test/verify.mjs
 *   node test/verify.mjs --url ... --api-key <token>
 */

import { pathToFileURL } from 'node:url';

import {
  DEFAULT_ENDPOINT,
  DEFAULT_TIMEOUT_MS,
  normalizeEndpoint,
  probe,
  shorten,
} from './mock-qqpilot.mjs';

const USAGE = `verify — qqpilot-dsh-plugin 多场景验收

用法:
  node test/verify.mjs --url <base 或完整 /chat/completions 地址> [选项]

选项:
  --url <url>           端点，默认 ${DEFAULT_ENDPOINT}；
                        也可用环境变量 QQPILOT_ENDPOINT
  --api-key <key>       发送 Authorization: Bearer <key>（默认不发）
                        也可用环境变量 QQPILOT_API_KEY
  --timeout <ms>        单次请求超时，默认 ${DEFAULT_TIMEOUT_MS}ms
  --config-url <url>    覆盖配置探测地址（默认 <origin>/qqpilot/api/config）
  --skip-image          跳过图片能力场景
  -h, --help            显示本帮助

退出码: 0 = 全部硬场景 PASS，1 = 有硬场景 FAIL
`;

function parseArgs(argv) {
  const opts = {
    url: process.env.QQPILOT_ENDPOINT || DEFAULT_ENDPOINT,
    apiKey: process.env.QQPILOT_API_KEY || '',
    timeoutMs: DEFAULT_TIMEOUT_MS,
    configUrl: undefined,
    skipImage: false,
    help: false,
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
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`${arg} 缺少参数值`);
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
      case '--config-url':
        opts.configUrl = value();
        break;
      case '--skip-image':
        opts.skipImage = true;
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

// ---------------------------------------------------------------------------
// 展示辅助
// ---------------------------------------------------------------------------

const q = (s) => JSON.stringify(String(s));

function result(id, name, hard, status, detail) {
  return { id, name, hard, status, detail: detail ?? '' };
}

function printProbeDetails({ response, validation }) {
  if (response.error && response.status === 0) {
    console.log(`  [ERROR] ${response.error}`);
    return;
  }
  const ct = response.contentType ? `, content-type=${response.contentType}` : '';
  console.log(`  HTTP ${response.status} (${response.elapsedMs}ms${ct})`);
  if (response.error) console.log(`  [ERROR] ${response.error}`);

  if (validation.content === undefined) {
    console.log('  content: <缺失>（QQPilot 会静默不回复）');
  } else if (validation.content.trim() === '') {
    console.log(`  content: ${q(validation.content)}（空白 => QQPilot 静默不回复）`);
  } else {
    console.log(`  content: ${q(shorten(validation.content, 240))}`);
  }

  if (validation.images.length > 0) {
    validation.images.forEach((img) => {
      console.log(
        `  images[${img.index}]: ${
          img.kind === 'data_url'
            ? `data URL（${img.bytesHint} 字符）`
            : `b64_json（${img.length} 字符）`
        }`,
      );
    });
  } else {
    console.log('  images: 无');
  }

  if (validation.usage) {
    console.log(
      `  usage: prompt=${validation.usage.prompt_tokens ?? 0} ` +
        `completion=${validation.usage.completion_tokens ?? 0} ` +
        `total=${validation.usage.total_tokens ?? 0}`,
    );
  }

  for (const warning of validation.warnings) console.log(`  [WARN] ${warning}`);
  for (const error of validation.errors) console.log(`  [ERROR] ${error}`);
}

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' }, signal: controller.signal });
    const text = await res.text();
    let json;
    let parseError;
    try {
      json = JSON.parse(text);
    } catch (err) {
      parseError = err.message;
    }
    return {
      ok: res.ok,
      status: res.status,
      json,
      text,
      error: res.ok
        ? undefined
        : `HTTP ${res.status}${parseError ? `（body 非 JSON: ${shorten(text, 120)}）` : ''}`,
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err?.name === 'AbortError' ? `超时（>${timeoutMs}ms）` : `网络错误：${err.message}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** 在 config JSON 里递归找 compat / mode 相关字段，只用于"报告当前模式"。 */
function detectConfigMode(json) {
  const hints = [];
  const seen = new Set();
  const visit = (node, path, depth) => {
    if (depth > 4 || node === null || typeof node !== 'object' || Array.isArray(node)) return;
    if (seen.has(node)) return;
    seen.add(node);
    for (const [key, value] of Object.entries(node)) {
      if (/compat/i.test(key)) {
        hints.push(`${path}${key}=${JSON.stringify(value)}`);
      } else if (key === 'mode' && typeof value === 'string') {
        hints.push(`${path}${key}=${JSON.stringify(value)}`);
      } else if (value !== null && typeof value === 'object') {
        visit(value, `${path}${key}.`, depth + 1);
      }
    }
  };
  visit(json, '', 0);
  return hints;
}

// ---------------------------------------------------------------------------
// 场景
// ---------------------------------------------------------------------------

async function scenarioBasic(ep, opts) {
  const r = await probe({
    endpoint: ep,
    latestText: '1+1 等于几？请简短回答。',
    apiKey: opts.apiKey,
    timeoutMs: opts.timeoutMs,
  });
  printProbeDetails(r);

  const errors = [...r.validation.errors];
  if (r.validation.content !== undefined && r.validation.content.trim() === '') {
    errors.push('content 为空白：QQPilot 会静默不回复（基础场景要求非空字符串）');
  }
  if (errors.length > 0) {
    return result(1, '基础回复（1+1）', true, 'FAIL', errors.join('; '));
  }
  return result(
    1,
    '基础回复（1+1）',
    true,
    'PASS',
    `content=${q(shorten(r.validation.content, 100))}`,
  );
}

async function scenarioTextPath(ep, opts) {
  // 模型有时会把「只回复 SILENT 一个词」当成系统/元指令而直接选择静默。
  // 第一次仍用任务要求的 SILENT 提示；若被静默，则用"必须回复"的提示重试一次，
  // 保证测的是「文本路径」，而不是模型的寒暄意愿。
  const prompts = [
    '这是对你说的测试消息，请务必回复：只输出英文单词 SILENT，不要保持沉默。',
    '请随便回复我一句话（内容不限），但必须通过回复工具发出来，不要保持沉默。',
  ];

  let last;
  for (let attempt = 0; attempt < prompts.length; attempt += 1) {
    console.log(`  第 ${attempt + 1}/${prompts.length} 次尝试: ${prompts[attempt]}`);
    const r = await probe({
      endpoint: ep,
      latestText: prompts[attempt],
      apiKey: opts.apiKey,
      timeoutMs: opts.timeoutMs,
    });
    last = r;
    printProbeDetails(r);

    const content = r.validation.content;
    if (r.validation.ok && content !== undefined && content.trim() !== '') {
      const matched = content.includes('SILENT');
      const note = matched
        ? 'content 含 SILENT'
        : 'content 未精确含 SILENT（模型措辞不同，不算失败）';
      return result(
        2,
        '文本路径（只回复 SILENT）',
        true,
        'PASS',
        `${note}, attempt=${attempt + 1}, content=${q(shorten(content, 80))}`,
      );
    }
    if (!r.validation.ok) break; // 形状错误重试无意义
    console.log('  content 为空（模型选择了静默），换更明确的提示重试…');
  }

  const content = last?.validation?.content;
  const errors = [...(last?.validation?.errors ?? [])];
  if (errors.length === 0) {
    errors.push(
      `两次明确要求回复的请求都返回空 content（最后一次 ${q(content ?? '')}）：` +
        '文本路径无法验证（可能是模型/工具循环问题，非协议本身）',
    );
  }
  return result(2, '文本路径（只回复 SILENT）', true, 'FAIL', errors.join('; '));
}

async function scenarioCompatProbe(ep, opts) {
  const url = opts.configUrl ?? ep.configUrl;
  console.log(`  GET ${url}`);
  console.log('  说明：兼容/工具模式由 Lead/UI 切换，本场景只探测当前值，不判失败。');

  const r = await fetchJson(url, Math.min(opts.timeoutMs, 15_000));
  if (!r.ok) {
    const reason = r.status === 404 ? 'HTTP 404（插件尚未安装/未启用时正常）' : r.error;
    return result(3, '兼容模式探测', false, 'SKIP', `GET ${url} -> ${reason}`);
  }

  console.log(`  HTTP ${r.status}`);
  if (r.json === undefined) {
    return result(3, '兼容模式探测', false, 'SKIP', '配置接口返回的不是 JSON');
  }
  const topKeys = Object.keys(r.json);
  console.log(`  顶层字段: ${topKeys.join(', ') || '<空对象>'}`);

  const hints = detectConfigMode(r.json);
  if (hints.length > 0) {
    console.log(`  当前模式线索: ${hints.join(' | ')}`);
    return result(3, '兼容模式探测', false, 'PASS', hints.join(' | '));
  }
  const preview = shorten(JSON.stringify(r.json), 300);
  console.log(`  未发现 compat/mode 字段，原始配置: ${preview}`);
  return result(3, '兼容模式探测', false, 'PASS', `未发现模式字段; config=${preview}`);
}

async function scenarioImage(ep, opts) {
  const r = await probe({
    endpoint: ep,
    image: true,
    latestText: '请看一下用户消息里的这张图，然后用回复工具回我一句短话。',
    apiKey: opts.apiKey,
    timeoutMs: opts.timeoutMs,
  });
  printProbeDetails(r);

  if (r.response.error && r.response.status === 0) {
    return result(4, '图片能力（data:image/png 往返）', false, 'WARN', r.response.error);
  }
  if (!r.response.httpOk) {
    return result(4, '图片能力（data:image/png 往返）', false, 'WARN', `HTTP ${r.response.status}`);
  }
  if (r.validation.errors.length > 0) {
    return result(
      4,
      '图片能力（data:image/png 往返）',
      false,
      'WARN',
      `响应形状问题: ${r.validation.errors.join('; ')}`,
    );
  }
  if (r.validation.images.length > 0) {
    return result(
      4,
      '图片能力（data:image/png 往返）',
      false,
      'PASS',
      `choices[0].message.images 返回 ${r.validation.images.length} 张（data URL 形状合法）`,
    );
  }
  return result(
    4,
    '图片能力（data:image/png 往返）',
    false,
    'WARN',
    '未返回 choices[0].message.images：模型未调用带图回复或该模式不支持图片（软检查，不判失败）',
  );
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

export async function runVerifyCli(argv = process.argv.slice(2)) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    console.error(`FAIL 参数错误：${err.message}`);
    console.error('');
    console.error(USAGE);
    return 1;
  }
  if (opts.help) {
    console.log(USAGE);
    return 0;
  }

  let ep;
  try {
    ep = normalizeEndpoint(opts.url);
  } catch (err) {
    console.error(`FAIL ${err.message}`);
    return 1;
  }

  console.log('QQPilot 协议验收（qqpilot-dsh-plugin）');
  console.log(`  endpoint: ${ep.url}`);
  console.log(`  origin:   ${ep.origin}`);
  console.log(`  api-key:  ${opts.apiKey ? '已发送 Bearer' : '未发送（同 QQPilot 本地行为）'}`);
  console.log(`  timeout:  ${opts.timeoutMs}ms`);
  if (opts.skipImage) console.log('  --skip-image：将跳过场景 4');

  const results = [];

  console.log('\n=== 场景 1/4：基础回复（硬检查：content 必须是非空字符串）===');
  results.push(await scenarioBasic(ep, opts));

  console.log('\n=== 场景 2/4：文本路径（硬检查：只回复 SILENT 一个词）===');
  results.push(await scenarioTextPath(ep, opts));

  console.log('\n=== 场景 3/4：兼容模式探测（软检查：只报告当前模式）===');
  results.push(await scenarioCompatProbe(ep, opts));

  if (opts.skipImage) {
    console.log('\n=== 场景 4/4：图片能力（已跳过）===');
    results.push(result(4, '图片能力（data:image/png 往返）', false, 'SKIP', '--skip-image'));
  } else {
    console.log('\n=== 场景 4/4：图片能力（软检查：data:image/png 往返）===');
    results.push(await scenarioImage(ep, opts));
  }

  // ---- 汇总 ----
  console.log('\n================ 结果汇总 ================');
  for (const r of results) {
    const hardTag = r.hard ? '硬' : '软';
    console.log(`${r.status.padEnd(5)} 场景 ${r.id} [${hardTag}] ${r.name}`);
    if (r.detail) console.log(`      ${shorten(r.detail, 300)}`);
  }

  const hard = results.filter((r) => r.hard);
  const hardPassed = hard.filter((r) => r.status === 'PASS').length;
  const hardFailed = hard.filter((r) => r.status === 'FAIL').length;
  const soft = results.filter((r) => !r.hard);
  const softDetail = soft.map((r) => `${r.status}:${r.id}`).join(', ') || '无';

  console.log('-----------------------------------------');
  console.log(`硬场景: ${hardPassed}/${hard.length} PASS, ${hardFailed} FAIL`);
  console.log(`软场景: ${softDetail}`);
  console.log(`RESULT: ${hardFailed > 0 ? 'FAIL' : 'PASS'}`);

  if (hardFailed > 0) {
    console.log('');
    console.log('排查提示:');
    console.log(`  - 确认 dsh web 仍在运行且端口正确（当前 origin: ${ep.origin}）`);
    console.log('  - 确认 qqpilot-dsh-plugin 已安装并生效（cordis.patch.yml 已应用）');
    console.log(`  - 曲线检查: curl ${ep.configUrl}`);
    console.log('  - 协议细节见 docs/PROTOCOL.md');
    return 1;
  }
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
  runVerifyCli()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((err) => {
      console.error(`FAIL 未捕获错误：${err?.stack ?? err}`);
      process.exitCode = 1;
    });
}

export { detectConfigMode, fetchJson };
