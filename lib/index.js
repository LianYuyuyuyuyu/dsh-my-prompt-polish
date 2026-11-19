/**
 * dsh-my-prompt-polish — 宿主半边。
 *
 * 三件事：
 *  1) POST /prompt-polish-9f2c/optimize  { text }  → 套「基准提示词」改写，只回正文
 *  2) GET|POST /prompt-polish-9f2c/config          → 读/存 基准提示词 + 指定模型
 *  3) GET /prompt-polish-9f2c/models?provider=x    → 给设置页列该通道的模型
 *
 * 不单独存 API Key：直接用 DSH「设置 → 模型」里已经配好的通道（密钥只存一份）。
 * 数据落在 $DSH_HOME/prompt-polish/：rule.md（基准提示词）、config.json（模型选择）。
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

export const name = 'dsh-my-prompt-polish'
export const inject = ['llm', 'webServer']

const ROUTE = '/prompt-polish-9f2c'
const MAX_INPUT_CHARS = 4000
const MAX_BODY_BYTES = 256 * 1024
const TIMEOUT_MS = 60_000

const DEFAULT_RULE = `你要做两件事。用户会给一段原始提示词：
1. 把他真正想要的事，提炼成 3-5 条大白话要点。
2. 改写后的提示词里不要出现「我」和「你」。

规矩：
- 说人话：不用专业词、术语，能用大白话就不用行话。
- 要短：能一句说完别写两句，别长篇大论。
- 分点：重点用 1、2、3 列出来，一眼扫完。
- 抓重点：去掉啰嗦、重复、客套，只留真正想要的。
- 不跑偏：用户的意思不能改。

优化后的提示词里必须写上这一条（逼 AI 用大白话回答）：
- 大白话、简短直奔重点、分点说 | 不能：客套、铺垫、啰嗦、用专业词

你的输出：只输出提炼后的要点，最后一行加上面那条要求。

格式例子：
1. 想在原生输入框里直接加个按钮。
2. 点一下按钮，就按预设提示词把当前输入的文字优化一下。
3. 再点一下，退回优化前的原文。
4. 核心是「一键优化 / 一键还原」的来回切换。
要求：大白话、简短直奔重点、分点说 | 不能：客套、铺垫、啰嗦、用专业词
`

const baseDir = () => join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'prompt-polish')
const ruleFile = () => join(baseDir(), 'rule.md')
const configFile = () => join(baseDir(), 'config.json')

function ensureDir() {
  try {
    mkdirSync(dirname(ruleFile()), { recursive: true })
  } catch {
    /* 已有或不可写，后面按默认值兜底 */
  }
}

function loadRule() {
  ensureDir()
  try {
    const text = readFileSync(ruleFile(), 'utf8')
    if (text.trim() !== '') return text
  } catch {
    /* 走下面写默认 */
  }
  try {
    writeFileSync(ruleFile(), DEFAULT_RULE, 'utf8')
  } catch {
    /* 不可写就用内存里的默认 */
  }
  return DEFAULT_RULE
}

function loadConfig() {
  try {
    const raw = JSON.parse(readFileSync(configFile(), 'utf8'))
    const provider = typeof raw?.provider === 'string' ? raw.provider.trim() : ''
    const model = typeof raw?.model === 'string' ? raw.model.trim() : ''
    return provider && model ? { provider, model } : {}
  } catch {
    return {}
  }
}

function saveConfig(patch) {
  ensureDir()
  const next = { ...loadConfig() }
  for (const key of ['provider', 'model']) {
    if (!(key in patch)) continue
    const value = typeof patch[key] === 'string' ? patch[key].trim() : ''
    if (value === '') delete next[key]
    else next[key] = value
  }
  writeFileSync(configFile(), JSON.stringify(next, null, 2) + '\n', 'utf8')
  return next
}

/** 模型偶尔不听话加前缀/包代码块，这里统一剥掉。 */
function cleanOutput(raw) {
  let text = String(raw ?? '').trim()
  const fence = text.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/)
  if (fence) text = fence[1].trim()
  for (let i = 0; i < 4; i += 1) {
    const stripped = text
      .replace(/^(以下是|下面是)?\s*(优化后的?提示词|优化后|改写后的?提示词|改写后|润色后)\s*[:：]\s*/u, '')
      .trim()
    if (stripped === text) break
    text = stripped
  }
  return text.trim()
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) {
      const err = new Error('body too large')
      err.code = 'body-too-large'
      throw err
    }
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (raw.trim() === '') return {}
  return JSON.parse(raw)
}

function currentModel(ctx) {
  try {
    const service = (typeof ctx.get === 'function' ? ctx.get('agentDefaultModel') : undefined) ?? ctx.agentDefaultModel
    const selection = service?.currentSelection?.()
    if (selection?.provider && selection?.model) {
      return { provider: selection.provider, model: selection.model }
    }
  } catch {
    /* 无当前会话模型 */
  }
  return undefined
}

/** 设置页指定的模型优先；没指定就跟随当前会话选中的模型。 */
function resolveModel(ctx) {
  const configured = loadConfig()
  if (configured.provider && configured.model) return { ...configured, source: 'configured' }
  const session = currentModel(ctx)
  return session ? { ...session, source: 'session' } : undefined
}

export function apply(ctx) {
  const log = (msg) => {
    try {
      ctx.logger?.warn?.(`[prompt-polish] ${msg}`)
    } catch {
      /* 日志失败不影响功能 */
    }
  }

  const handler = async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const rest = url.pathname.slice(ROUTE.length) || '/'

    if (req.method === 'GET' && (rest === '/' || rest === '/health')) {
      return sendJson(res, 200, {
        ok: true,
        ruleFile: ruleFile(),
        configFile: configFile(),
        model: resolveModel(ctx) ?? null,
      })
    }

    if (rest === '/config') {
      if (req.method === 'GET') {
        let providers = []
        try {
          providers = (ctx.llm.listProviders?.() ?? []).map((p) => ({ id: p.id, name: p.name ?? p.id }))
        } catch {
          providers = []
        }
        return sendJson(res, 200, {
          ok: true,
          rule: loadRule(),
          defaultRule: DEFAULT_RULE,
          provider: loadConfig().provider ?? '',
          model: loadConfig().model ?? '',
          sessionModel: currentModel(ctx) ?? null,
          providers,
          ruleFile: ruleFile(),
        })
      }
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false, message: 'method not allowed' })
      let payload
      try {
        payload = await readJsonBody(req)
      } catch {
        return sendJson(res, 400, { ok: false, message: '请求格式不对' })
      }
      try {
        if (typeof payload?.rule === 'string') {
          const text = payload.rule.trim() === '' ? DEFAULT_RULE : payload.rule
          ensureDir()
          writeFileSync(ruleFile(), text, 'utf8')
        }
        const saved = saveConfig({ provider: payload?.provider, model: payload?.model })
        return sendJson(res, 200, { ok: true, provider: saved.provider ?? '', model: saved.model ?? '' })
      } catch (error) {
        log(`save config failed: ${error instanceof Error ? error.message : String(error)}`)
        return sendJson(res, 500, { ok: false, message: '保存失败（文件可能不可写）' })
      }
    }

    if (req.method === 'GET' && rest === '/models') {
      const provider = url.searchParams.get('provider') ?? ''
      if (provider === '') return sendJson(res, 400, { ok: false, message: 'provider required' })
      try {
        const list = await ctx.llm.listModels(provider)
        return sendJson(res, 200, {
          ok: true,
          models: (list ?? []).map((m) => ({ id: m.id, name: m.name ?? m.id })),
        })
      } catch (error) {
        return sendJson(res, 502, {
          ok: false,
          message: '取这个通道的模型列表失败：' + (error instanceof Error ? error.message : String(error)).slice(0, 120),
        })
      }
    }

    if (req.method !== 'POST' || rest !== '/optimize') {
      return sendJson(res, 404, { ok: false, message: 'not found' })
    }

    let payload
    try {
      payload = await readJsonBody(req)
    } catch (error) {
      const tooLarge = error?.code === 'body-too-large'
      return sendJson(res, tooLarge ? 413 : 400, {
        ok: false,
        message: tooLarge ? '输入太长，服务端拒收' : '请求格式不对',
      })
    }

    const text = typeof payload?.text === 'string' ? payload.text : ''
    if (text.trim() === '') {
      return sendJson(res, 400, { ok: false, message: '输入是空的，没什么可优化的' })
    }
    if (text.length > MAX_INPUT_CHARS) {
      return sendJson(res, 400, {
        ok: false,
        message: `输入太长了（${text.length} 字，上限 ${MAX_INPUT_CHARS}），先裁短一点`,
      })
    }

    const model = resolveModel(ctx)
    if (!model) {
      return sendJson(res, 503, { ok: false, message: '没找到可用模型，先在设置里选一个模型' })
    }

    let out = ''
    try {
      const stream = ctx.llm.stream({
        provider: model.provider,
        model: model.model,
        system: loadRule(),
        messages: [{ role: 'user', content: [{ type: 'text', text }] }],
        temperature: 0.3,
        maxTokens: 2000,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      for await (const chunk of stream) {
        if (chunk?.type === 'text-delta') out += chunk.text
      }
    } catch (error) {
      log(`optimize failed: ${error instanceof Error ? error.message : String(error)}`)
      return sendJson(res, 502, {
        ok: false,
        message: '模型调用失败，文字没有动，可以再试一次',
      })
    }

    const cleaned = cleanOutput(out)
    if (cleaned === '') {
      return sendJson(res, 502, { ok: false, message: '模型没输出可用内容，再试一次' })
    }
    return sendJson(res, 200, { ok: true, text: cleaned, model })
  }

  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE,
        handler: async (req, res) => {
          try {
            await handler(req, res)
          } catch (error) {
            log(`route crashed: ${error instanceof Error ? error.message : String(error)}`)
            if (!res.writableEnded) {
              sendJson(res, 500, { ok: false, message: '插件内部出错' })
            }
          }
        },
      }),
    'prompt-polish: routes',
  )

  log(`ready at ${ROUTE} (rule: ${ruleFile()})`)
}
