// Lead-owned offline smoke test for the host half of qqpilot-dsh-plugin.
// Loads lib/index.js with a fake Cordis context (fake webServer + fake llm),
// invokes the registered HTTP routes directly, and asserts the OpenAI-shaped
// responses. Run: node test/host-unit.mjs
//
// This file is owned by the Lead; do not edit it from another task.

import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'

// Keep the plugin's settings state inside the workspace so the offline test
// does not need access to the real ~/.dsh.
const STATE_DIR = path.join(process.cwd(), '.tmp-test-state')
rmSync(STATE_DIR, { recursive: true, force: true })
mkdirSync(STATE_DIR, { recursive: true })
process.env.DSH_HOME = STATE_DIR

const { apply } = await import('../lib/index.js')

function makeReq(method, body) {
  const req = new EventEmitter()
  req.method = method
  req.destroy = () => {}
  process.nextTick(() => {
    if (body !== undefined) req.emit('data', Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)))
    req.emit('end')
  })
  return req
}

function makeRes() {
  const res = new EventEmitter()
  res.statusCode = 200
  res.headers = {}
  res.chunks = []
  res.writableEnded = false
  res.writeHead = (status, headers) => {
    res.statusCode = status
    res.headers = headers || {}
  }
  res.end = (chunk) => {
    if (chunk) res.chunks.push(Buffer.from(chunk))
    res.writableEnded = true
  }
  res.json = () => JSON.parse(Buffer.concat(res.chunks).toString('utf8'))
  return res
}

function toolCallChunks(id, name, args) {
  return [
    { type: 'block-start', index: 0, blockType: 'tool-call' },
    { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: JSON.stringify(args) },
    { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: JSON.stringify(args) } },
    { type: 'usage', usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 } },
    { type: 'finish', reason: { kind: 'tool-calls' } },
  ]
}

function textChunks(text) {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    { type: 'text-delta', index: 0, text },
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

// Each scenario supplies a script: an array of steps; every model call consumes one step.
function makeLlm(script) {
  const state = { calls: [], index: 0 }
  return {
    state,
    stream(options) {
      state.calls.push(options)
      const step = script[Math.min(state.index, script.length - 1)]
      state.index += 1
      return (async function* () {
        for (const chunk of step) yield chunk
      })()
    },
  }
}

async function loadPlugin(script) {
  const llm = makeLlm(script)
  const routes = new Map()
  const ctx = {
    get(name) {
      if (name === 'llm') return llm
      if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-flash' }) }
      return undefined
    },
    webServer: {
      getOrigin: () => 'http://127.0.0.1:12345',
      register: (route) => {
        assert.ok(!routes.has(route.path), `duplicate route ${route.path}`)
        routes.set(route.path, route.handler)
        return () => routes.delete(route.path)
      },
    },
    effect: (fn) => {
      const disposer = fn()
      assert.equal(typeof disposer, 'function')
      return disposer
    },
  }
  apply(ctx, {})
  return { llm, routes }
}

async function post(routes, path, body) {
  const handler = routes.get(path)
  assert.ok(handler, `route ${path} registered`)
  const req = makeReq('POST', body)
  const res = makeRes()
  await handler(req, res)
  return { status: res.statusCode, body: res.json() }
}

async function get(routes, path) {
  const handler = routes.get(path)
  assert.ok(handler, `route ${path} registered`)
  const req = makeReq('GET')
  const res = makeRes()
  await handler(req, res)
  return { status: res.statusCode, body: res.json() }
}

function qqpilotBody(userText) {
  return {
    model: 'qwen3.5:0.8b',
    stream: false,
    messages: [
      { role: 'system', content: '你的名字是猫娘 neko，只输出发言内容。' },
      { role: 'user', content: '[time]\n2026-07-12T10:54:54+08:00\n\n[username]\nAlice\n\n[content]\n' + userText },
    ],
  }
}

let failures = 0
async function scenario(name, fn) {
  try {
    await fn()
    console.log(`PASS  ${name}`)
  } catch (err) {
    failures += 1
    console.log(`FAIL  ${name}`)
    console.log(err && err.stack ? err.stack : err)
  }
}

await scenario('routes registered and models route works', async () => {
  const { routes } = await loadPlugin([textChunks('ok')])
  for (const path of ['/qqpilot/v1/chat/completions', '/qqpilot/v1/models', '/qqpilot/api/config', '/qqpilot/api/test', '/qqpilot/api/status']) {
    assert.ok(routes.has(path), `missing ${path}`)
  }
  const models = await get(routes, '/qqpilot/v1/models')
  assert.equal(models.status, 200)
  assert.equal(models.body.data[0].id, 'deepseek-flash')
})

await scenario('tool mode: reply tool call becomes OpenAI completion text', async () => {
  const { routes, llm } = await loadPlugin([toolCallChunks('call_1', 'qqpilot_reply', { text: '你好呀喵～' })])
  const result = await post(routes, '/qqpilot/v1/chat/completions', qqpilotBody('在吗'))
  assert.equal(result.status, 200)
  assert.equal(result.body.object, 'chat.completion')
  assert.equal(result.body.choices[0].message.role, 'assistant')
  assert.equal(result.body.choices[0].message.content, '你好呀喵～')
  assert.equal(result.body.choices[0].finish_reason, 'stop')
  assert.equal(result.body.usage.total_tokens, 18)
  assert.equal(llm.state.calls.length, 1, 'one model call for a single tool decision')
  assert.ok(Array.isArray(llm.state.calls[0].tools), 'tools passed to the model')
  assert.deepEqual(
    llm.state.calls[0].tools.map((t) => t.name),
    ['qqpilot_reply', 'qqpilot_do_not_reply'],
  )
  // Instruction and QQPilot persona share ONE system message.
  const systems = llm.state.calls[0].messages.filter((m) => m.role === 'system')
  assert.equal(systems.length, 1, 'a single system message')
  assert.ok(systems[0].content[0].text.includes('qqpilot_reply'))
  assert.ok(systems[0].content[0].text.includes('猫娘 neko'))
  // User message carried through with the QQPilot framing.
  const user = llm.state.calls[0].messages.find((m) => m.role === 'user')
  assert.ok(user.content[0].text.includes('在吗'))
})

await scenario('tool mode: silence tool call returns empty content', async () => {
  const { routes } = await loadPlugin([toolCallChunks('call_2', 'qqpilot_do_not_reply', { reason: '闲聊' })])
  const result = await post(routes, '/qqpilot/v1/chat/completions', qqpilotBody('哈哈哈'))
  assert.equal(result.status, 200)
  assert.equal(result.body.choices[0].message.content, '')
})

await scenario('tool mode: plain text fallback still surfaces a reply', async () => {
  const { routes } = await loadPlugin([textChunks('直接说一句')])
  const result = await post(routes, '/qqpilot/v1/chat/completions', qqpilotBody('你好'))
  assert.equal(result.status, 200)
  assert.equal(result.body.choices[0].message.content, '直接说一句')
})

await scenario('tool mode: reply with data URL image returns images array', async () => {
  const png =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
  const { routes } = await loadPlugin([toolCallChunks('call_3', 'qqpilot_reply', { text: '给你图', images: [png] })])
  const result = await post(routes, '/qqpilot/v1/chat/completions', qqpilotBody('来张图'))
  assert.equal(result.status, 200)
  const message = result.body.choices[0].message
  assert.equal(message.content, '给你图')
  assert.equal(message.images.length, 1)
  assert.ok(message.images[0].image_url.url.startsWith('data:image/png;base64,'))
})

await scenario('compatibility mode: no tools, direct text returned', async () => {
  const { routes, llm } = await loadPlugin([textChunks('兼容模式输出')])
  const set = await post(routes, '/qqpilot/api/config', { compatibilityMode: true })
  assert.equal(set.body.config.compatibilityMode, true)
  const result = await post(routes, '/qqpilot/v1/chat/completions', qqpilotBody('你好'))
  assert.equal(result.body.choices[0].message.content, '兼容模式输出')
  assert.equal(llm.state.calls[0].tools, undefined, 'no tools in compatibility mode')
  const cfg = await get(routes, '/qqpilot/api/config')
  assert.equal(cfg.body.config.compatibilityMode, true)
})

await scenario('invalid request is refused with 400', async () => {
  const { routes } = await loadPlugin([textChunks('x')])
  const result = await post(routes, '/qqpilot/v1/chat/completions', { model: 'x' })
  assert.equal(result.status, 400)
  assert.ok(result.body.error && result.body.error.message.includes('messages'))
})

console.log(failures === 0 ? '\nALL HOST-UNIT SCENARIOS PASSED' : `\n${failures} SCENARIO(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
