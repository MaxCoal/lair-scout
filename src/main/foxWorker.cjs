'use strict'

delete process.env.PLAYWRIGHT_BROWSERS_PATH
delete process.env.ELECTRON_RUN_AS_NODE

const { chromium } = require('playwright')
const { mkdir, rm } = require('node:fs/promises')
const { execFileSync } = require('node:child_process')
const readline = require('node:readline')

const VIEWPORT = { width: 1280, height: 720 }
const TICK_MS = 1000
const FOCUS_TICK_MS = 280
const QUEUE_HOST = /queue-it\.net|queueit\.com|storequeue\.wizards\.com/i
const PREQUEUE_COPY =
  /secret lair lounge|waiting room|the (sale|event|drop) has not (yet )?started|has not opened yet|please wait.*begin|we're getting ready|we are getting ready|pre-?queue|before the queue|queue has not started|not started yet|will begin shortly|doors (have not|haven'?t) opened/i
const IN_QUEUE_COPY =
  /you are (now )?in line|you're in line|you are in the queue|people ahead of you|visitors ahead of you|your estimated wait|estimated wait time|place in line|queue number/i
const YOUR_TURN = /it['’]?s your turn|you can now enter|you(?:'| a)?re next|the waiting room has ended|you have been redirected/i
const LONG_WAIT = /more than an hour|over an hour|over 1 hour|>\s*an hour|greater than (an|1) hour/i

/** @type {Map<string, any>} */
const instances = new Map()
const pausedIds = new Set()
let focusedId = null
let shuttingDown = false
let ticking = false
let spawning = false

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function hostOf(url) {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

function normalizeUrl(raw) {
  const trimmed = String(raw || '').trim()
  if (!trimmed) return ''
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function isQueuePopEdge(previous, next) {
  return next === 'in_queue' && previous !== 'in_queue' && previous !== 'loading' && previous !== 'idle'
}

function isAdmissionEdge(previous, next) {
  return next === 'admitted' && previous !== 'admitted' && (previous === 'in_queue' || previous === 'waiting_for_queue')
}

function formatWait(raw) {
  const text = String(raw || '').replace(/\s+/g, ' ').trim()
  if (!text) return ''
  const lower = text.toLowerCase()
  if (LONG_WAIT.test(lower)) return 'more than an hour'
  const hours = lower.match(/(\d+)\s*hours?/)
  if (hours) return `${hours[1]} hour${hours[1] === '1' ? '' : 's'}`
  const mins = lower.match(/(\d+)\s*(min|mins|minute|minutes)\b/)
  if (mins) return `${mins[1]} mins`
  if (/less than a minute|under a minute|<\s*1\s*min/.test(lower)) return '<1 min'
  if (/a minute|1 minute/.test(lower)) return '1 min'
  return text
}

function statusLabel(status, waitTime) {
  if (status === 'not_in_queue') return 'Not In Queue'
  if (status === 'waiting_for_queue') return 'Admitted, waiting for Queue'
  if (status === 'in_queue') {
    if (!waitTime) return 'In Queue'
    if (LONG_WAIT.test(waitTime) || waitTime === 'more than an hour') return 'In Queue, more than an hour'
    return `In Queue, ${waitTime}`
  }
  if (status === 'admitted') return 'Admitted'
  if (status === 'loading') return 'Loading'
  if (status === 'error') return 'Error'
  return 'Idle'
}

function mergeExtract(parts) {
  const merged = {
    queueNumber: '',
    waitTime: '',
    hasQueueUi: false,
    inner: '',
    pageId: '',
    bodyClass: '',
    isBeforeOrIdle: null,
    queueState: null
  }
  for (const part of parts) {
    if (!part) continue
    if (!merged.queueNumber && part.queueNumber) merged.queueNumber = part.queueNumber
    if (!merged.waitTime && part.waitTime) merged.waitTime = part.waitTime
    merged.hasQueueUi = merged.hasQueueUi || part.hasQueueUi
    if (part.inner) merged.inner += `\n${part.inner}`
    if (!merged.pageId && part.pageId) merged.pageId = part.pageId
    if (!merged.bodyClass && part.bodyClass) merged.bodyClass = part.bodyClass
    if (merged.isBeforeOrIdle == null && part.isBeforeOrIdle != null) merged.isBeforeOrIdle = part.isBeforeOrIdle
    if (merged.queueState == null && part.queueState != null) merged.queueState = part.queueState
  }
  return merged
}

async function extractFrame(frame) {
  return frame.evaluate(() => {
    const unwrap = (value) => {
      if (value == null) return value
      if (typeof value === 'function') {
        try {
          return value()
        } catch {
          return undefined
        }
      }
      return value
    }
    const pick = (selectors) => {
      for (const sel of selectors) {
        const el = document.querySelector(sel)
        if (!el) continue
        const text = el.innerText?.trim() || el.getAttribute('content') || ''
        if (text) return text
      }
      return ''
    }
    const vm = window.queueViewModel
    const ticket = vm ? unwrap(vm.ticket) || vm.ticket : null
    const fromVm = {
      pageId: unwrap(vm?.pageId) || document.body?.getAttribute('data-pageid') || '',
      bodyClass: document.body?.className || '',
      isBeforeOrIdle: unwrap(vm?.isBeforeOrIdle),
      queueState: unwrap(vm?.QueueState) ?? unwrap(vm?.queueState),
      queueNumber: String(unwrap(ticket?.queueNumber) ?? pick(['#MainPart_lbQueueNumber']) ?? ''),
      waitTime: String(
        unwrap(ticket?.whichIsIn) ||
          pick(['#MainPart_lbWhichIsIn', '#MainPart_lbExpectedServiceTime']) ||
          ''
      )
    }
    return {
      ...fromVm,
      hasQueueUi: Boolean(
        vm ||
          document.querySelector('#queueit_overlay') ||
          document.querySelector('#MainPart_lbWhichIsIn') ||
          document.querySelector('#MainPart_divProgressbar') ||
          document.querySelector('[id^="MainPart_"]') ||
          document.querySelector('iframe[src*="queue-it.net"]')
      ),
      inner: document.body?.innerText?.slice(0, 12000) ?? ''
    }
  })
}

async function inspectPage(page, previous, wasInQueue) {
  const url = page.url()
  const host = hostOf(url)
  const title = await page.title().catch(() => '')

  if (!url || url === 'about:blank' || url.startsWith('data:')) {
    return { status: 'idle', host, url, title, statusLabel: 'Idle' }
  }

  let extracted
  try {
    const parts = []
    for (const frame of page.frames()) {
      try {
        parts.push(await extractFrame(frame))
      } catch {
        /* cross-origin */
      }
    }
    extracted = mergeExtract(parts)
  } catch {
    return {
      status: previous === 'loading' ? 'loading' : 'error',
      host,
      url,
      title,
      statusLabel: previous === 'loading' ? 'Loading' : 'Error'
    }
  }

  const inner = extracted.inner
  const pageId = String(extracted.pageId || '').toLowerCase()
  const bodyClass = String(extracted.bodyClass || '').toLowerCase()
  const onQueueHost = QUEUE_HOST.test(host)
  const hasToken = /queueittoken=/i.test(url)
  const yourTurn = YOUR_TURN.test(inner)
  const waitTime = formatWait(extracted.waitTime) || (LONG_WAIT.test(inner) ? 'more than an hour' : '')

  let status
  if (pageId === 'after' || pageId === 'exit' || extracted.queueState === 3 || yourTurn) {
    status = 'admitted'
  } else if (pageId === 'queue' || bodyClass.split(/\s+/).includes('queue') || extracted.queueState === 2) {
    status = 'in_queue'
  } else if (
    extracted.isBeforeOrIdle === true ||
    pageId === 'before' ||
    pageId === 'idle' ||
    bodyClass.split(/\s+/).includes('before') ||
    extracted.queueState === 1
  ) {
    status = 'waiting_for_queue'
  } else if (onQueueHost && extracted.hasQueueUi) {
    status = IN_QUEUE_COPY.test(inner) ? 'in_queue' : 'waiting_for_queue'
  } else if (wasInQueue || (hasToken && !onQueueHost)) {
    status = 'admitted'
  } else {
    status = 'not_in_queue'
  }

  return {
    status,
    waitTime: waitTime || undefined,
    queueNumber: extracted.queueNumber || undefined,
    host,
    url,
    title,
    statusLabel: statusLabel(status, waitTime)
  }
}

function pageOf(fox) {
  const open = fox.context.pages().filter((page) => !page.isClosed())
  const page = open.at(-1) ?? fox.page
  fox.page = page
  return page.isClosed() ? null : page
}

function targets(foxId) {
  if (foxId === '*') return [...instances.values()]
  const fox = instances.get(foxId)
  return fox ? [fox] : []
}

async function onPages(foxId, fn) {
  await Promise.allSettled(
    targets(foxId).map(async (fox) => {
      const page = pageOf(fox)
      if (page) await fn(page)
    })
  )
}

function snapshot(fox) {
  return {
    id: fox.id,
    url: fox.url,
    host: fox.host,
    title: fox.title,
    status: fox.status,
    statusLabel: fox.statusLabel || statusLabel(fox.status, fox.waitTime),
    waitTime: fox.waitTime,
    queueNumber: fox.queueNumber,
    screenshot: fox.screenshot,
    error: fox.error,
    admittedFlash: Date.now() < fox.admittedFlashUntil,
    focused: focusedId === fox.id
  }
}

function emitUpdate() {
  send({ type: 'event', event: 'update', payload: [...instances.values()].map(snapshot) })
}

async function prepareProfile(profileDir) {
  await mkdir(profileDir, { recursive: true })
}

function killStrayPlaywrightChromium() {
  try {
    const exe = chromium.executablePath().replace(/'/g, "''")
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '${exe}' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`
      ],
      { timeout: 12000, windowsHide: true }
    )
  } catch {
    /* ignore */
  }
}

function getBrowserPid(context) {
  try {
    const browser = typeof context.browser === 'function' ? context.browser() : null
    if (!browser) return 0
    const procOrFn = browser.process
    const proc = typeof procOrFn === 'function' ? procOrFn.call(browser) : procOrFn
    const pid = proc && proc.pid
    return Number(pid) || 0
  } catch (error) {
    console.error('pid lookup failed', error)
    return 0
  }
}

async function spawnFox(foxId, profileDir) {
  spawning = true
  try {
    await prepareProfile(profileDir)
    const context = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      viewport: VIEWPORT,
      ignoreHTTPSErrors: true,
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
      timeout: 90000,
      executablePath: chromium.executablePath(),
      ignoreDefaultArgs: ['--enable-automation'],
      args: [
        `--window-position=-32000,-32000`,
        `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
        '--disable-blink-features=AutomationControlled',
        '--disable-infobars',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-session-crashed-bubble',
        '--hide-crash-restore-bubble',
        '--disable-features=Translate,MediaRouter,OptimizationHints',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-background-timer-throttling',
        '--app-user-model-id=com.foxbox.app'
      ]
    })
    const pid = getBrowserPid(context)
    send({ type: 'event', event: 'browserPid', payload: { foxId, pid, profileDir } })
    const page = context.pages()[0] ?? (await context.newPage())
    await page.setViewportSize(VIEWPORT)
    const fox = {
      id: foxId,
      profileDir,
      context,
      page,
      status: 'idle',
      statusLabel: 'Idle',
      wasInQueue: false,
      url: page.url(),
      host: '',
      title: `Fox ${foxId}`,
      admittedFlashUntil: 0,
      navigating: false
    }
    context.on('page', (newPage) => {
      fox.page = newPage
    })
    page.on('crash', () => {
      fox.status = 'error'
      fox.error = 'Page crashed'
      emitUpdate()
    })
    instances.set(foxId, fox)
    emitUpdate()
    await page.goto(
      `data:text/html,<html><head><title>FoxBox-${foxId}</title></head><body style="margin:0;background:#0c0d10;color:#e8eaed;font-family:Segoe UI,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh"><div style="text-align:center"><div style="letter-spacing:.2em;text-transform:uppercase;color:#f97316">FoxBox</div><h1>Fox ${foxId}</h1><p style="color:#8b919a">Ready. Use Send all to navigate.</p></div></body></html>`,
      { waitUntil: 'domcontentloaded' }
    )
    fox.url = page.url()
    fox.title = await page.title().catch(() => fox.title)
    emitUpdate()
    return { foxId, pid }
  } finally {
    spawning = false
  }
}

async function killFox(foxId) {
  const fox = instances.get(foxId)
  if (!fox) return
  instances.delete(foxId)
  try {
    await fox.context.close()
  } catch {
    /* closed */
  }
  await rm(fox.profileDir, { recursive: true, force: true }).catch(() => undefined)
  emitUpdate()
}

async function navigate(fox, url) {
  fox.navigating = true
  fox.status = 'loading'
  fox.error = undefined
  emitUpdate()
  try {
    await fox.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
  } catch (error) {
    fox.status = 'error'
    fox.error = error instanceof Error ? error.message : 'Navigation failed'
  } finally {
    fox.navigating = false
  }
}

async function refreshFox(fox) {
  const page = pageOf(fox)
  if (!page) {
    fox.status = 'error'
    fox.error = 'No page'
    fox.statusLabel = 'Error'
    return
  }
  if (fox.navigating) {
    fox.status = 'loading'
    fox.statusLabel = 'Loading'
  } else {
    const previous = fox.status
    const read = await inspectPage(page, previous, fox.wasInQueue)
    if (read.status === 'in_queue' || read.status === 'waiting_for_queue') fox.wasInQueue = true
    fox.status = read.status
    fox.statusLabel = read.statusLabel
    fox.waitTime = read.waitTime
    fox.queueNumber = read.queueNumber
    fox.url = read.url
    fox.host = read.host
    fox.title = read.title
    fox.error = read.status === 'error' ? fox.error || 'Could not read page' : undefined
    if (isQueuePopEdge(previous, fox.status)) {
      send({ type: 'event', event: 'queuePopped', payload: fox.id })
    }
    if (isAdmissionEdge(previous, fox.status)) {
      fox.admittedFlashUntil = Date.now() + 12000
      send({ type: 'event', event: 'admitted', payload: fox.id })
    }
  }
  if (pausedIds.has(fox.id)) return
  try {
    const quality = focusedId === fox.id ? 58 : 38
    const buffer = await page.screenshot({ type: 'jpeg', quality })
    fox.screenshot = `data:image/jpeg;base64,${buffer.toString('base64')}`
  } catch {
    /* keep last frame */
  }
}

async function tick() {
  if (ticking || shuttingDown || spawning) {
    scheduleTick()
    return
  }
  ticking = true
  try {
    for (const fox of instances.values()) await refreshFox(fox)
    emitUpdate()
  } finally {
    ticking = false
    scheduleTick()
  }
}

function scheduleTick() {
  const delay = focusedId ? FOCUS_TICK_MS : TICK_MS
  setTimeout(() => {
    void tick()
  }, delay)
}

async function handle(msg) {
  const { requestId, cmd } = msg
  try {
    let result
    if (cmd === 'spawn') {
      result = await spawnFox(msg.foxId, msg.profileDir)
    } else if (cmd === 'kill') {
      await killFox(msg.foxId)
    } else if (cmd === 'goto') {
      const fox = instances.get(msg.foxId)
      const target = normalizeUrl(msg.url)
      if (fox && target) await navigate(fox, target)
    } else if (cmd === 'gotoAll') {
      const target = normalizeUrl(msg.url)
      if (target) {
        await Promise.allSettled([...instances.values()].map((fox) => navigate(fox, target)))
      }
    } else if (cmd === 'reload') {
      const fox = instances.get(msg.foxId)
      if (fox) {
        fox.navigating = true
        fox.status = 'loading'
        try {
          await fox.page.reload({ waitUntil: 'domcontentloaded' })
          fox.error = undefined
        } catch (error) {
          fox.status = 'error'
          fox.error = error instanceof Error ? error.message : 'Reload failed'
        } finally {
          fox.navigating = false
        }
      }
    } else if (cmd === 'click') {
      const x = clamp(msg.nx, 0, 1) * VIEWPORT.width
      const y = clamp(msg.ny, 0, 1) * VIEWPORT.height
      const button = msg.button || 'left'
      await onPages(msg.foxId, async (page) => {
        if (msg.double) await page.mouse.dblclick(x, y, { button })
        else await page.mouse.click(x, y, { button })
      })
    } else if (cmd === 'move') {
      const x = clamp(msg.nx, 0, 1) * VIEWPORT.width
      const y = clamp(msg.ny, 0, 1) * VIEWPORT.height
      await onPages(msg.foxId, (page) => page.mouse.move(x, y))
    } else if (cmd === 'key') {
      await onPages(msg.foxId, async (page) => {
        if (!msg.key) return
        try {
          if (msg.keyType === 'down') await page.keyboard.down(msg.key)
          else if (msg.keyType === 'up') await page.keyboard.up(msg.key)
          else await page.keyboard.press(msg.key)
        } catch {
          if (msg.keyType !== 'up' && msg.key.length === 1) {
            await page.keyboard.insertText(msg.key).catch(() => undefined)
          }
        }
      })
    } else if (cmd === 'scroll') {
      await onPages(msg.foxId, (page) => page.mouse.wheel(msg.dx, msg.dy))
    } else if (cmd === 'setFocused') {
      focusedId = msg.foxId
    } else if (cmd === 'setPaused') {
      if (msg.paused) pausedIds.add(String(msg.foxId))
      else pausedIds.delete(String(msg.foxId))
    } else if (cmd === 'shutdown') {
      shuttingDown = true
      const ids = [...instances.keys()]
      await Promise.all(ids.map((id) => killFox(id)))
    } else {
      throw new Error(`Unknown command ${cmd}`)
    }
    if (requestId) send({ type: 'result', requestId, ok: true, result })
  } catch (error) {
    if (requestId) {
      send({
        type: 'result',
        requestId,
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      })
    } else {
      console.error(error)
    }
  }
}

const INPUT_CMDS = new Set(['move', 'click', 'key', 'scroll'])
const rl = readline.createInterface({ input: process.stdin })
let chain = Promise.resolve()
rl.on('line', (line) => {
  if (!line.trim()) return
  const msg = JSON.parse(line)
  if (INPUT_CMDS.has(msg.cmd)) {
    if (spawning) {
      if (msg.requestId) send({ type: 'result', requestId: msg.requestId, ok: true })
      return
    }
    void handle(msg)
    return
  }
  chain = chain.then(() => handle(msg)).catch((error) => {
    console.error(error)
  })
})

killStrayPlaywrightChromium()
scheduleTick()
send({ type: 'event', event: 'ready', payload: { executable: chromium.executablePath() } })
