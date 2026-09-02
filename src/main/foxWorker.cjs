'use strict'

delete process.env.PLAYWRIGHT_BROWSERS_PATH
delete process.env.ELECTRON_RUN_AS_NODE

const { firefox } = require('playwright')
const { mkdir, rm, writeFile } = require('node:fs/promises')
const { join } = require('node:path')
const { execFileSync } = require('node:child_process')
const readline = require('node:readline')

const VIEWPORT = { width: 1280, height: 720 }
const TICK_MS = 1000
const FOCUS_TICK_MS = 280
const QUEUE_HOST = /queue-it\.net|queueit\.com/i
const WAIT_COPY =
  /waiting room|you are in line|you're in line|you are now in line|estimated wait|pre-queue|secret lair lounge|please wait|people ahead of you|your place in line/i
const YOUR_TURN = /it['’]?s your turn|you can now enter|you(?:'| a)?re next|the waiting room has ended/i

/** @type {Map<string, any>} */
const instances = new Map()
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

function isAdmissionEdge(previous, next) {
  return previous === 'in_queue' && next === 'admitted'
}

async function inspectPage(page, previous, wasInQueue) {
  const url = page.url()
  const host = hostOf(url)
  const title = await page.title().catch(() => '')

  if (!url || url === 'about:blank' || url.startsWith('data:')) {
    return { status: 'idle', host, url, title }
  }

  let extracted
  try {
    extracted = await page.evaluate(() => {
      const pick = (selectors) => {
        for (const sel of selectors) {
          const el = document.querySelector(sel)
          if (!el) continue
          const text = el.innerText?.trim() || el.getAttribute('content') || ''
          if (text) return text
        }
        return ''
      }
      return {
        queueNumber: pick([
          '#h2MainHeaderQueueNumber',
          '#MainPart_lbUsersInLineAheadOfYou',
          '[class*="queueNumber"]',
          '[id*="queuePosition"]',
          '[id*="queueNumber"]'
        ]),
        waitTime: pick([
          '#MainPart_divWaitingTimeText',
          '#MainPart_lbExpectedServiceTime',
          '[class*="waitTime"]',
          '[id*="waitTime"]',
          '[class*="estimatedWait"]'
        ]),
        hasQueueUi: Boolean(
          document.querySelector('#queueit_overlay') ||
            document.querySelector('iframe[src*="queue-it.net"]') ||
            document.querySelector('[id*="queueit" i]') ||
            document.querySelector('#h2MainHeaderQueueNumber') ||
            document.querySelector('#MainPart_divWaitingTimeText') ||
            document.querySelector('#MainPart_lbUsersInLineAheadOfYou')
        ),
        inner: document.body?.innerText?.slice(0, 9000) ?? ''
      }
    })
  } catch {
    return {
      status: previous === 'loading' ? 'loading' : 'error',
      host,
      url,
      title
    }
  }

  const onQueueHost = QUEUE_HOST.test(host) || /queueittoken=/i.test(url)
  const waitingCopy = WAIT_COPY.test(extracted.inner)
  const yourTurn = YOUR_TURN.test(extracted.inner)
  const stillQueued = extracted.hasQueueUi || onQueueHost || waitingCopy

  let status
  if (yourTurn && !stillQueued) status = 'admitted'
  else if (stillQueued && !yourTurn) status = 'in_queue'
  else if (yourTurn) status = 'admitted'
  else if (wasInQueue || previous === 'admitted') status = 'admitted'
  else status = 'idle'

  return {
    status,
    waitTime: extracted.waitTime || undefined,
    queueNumber: extracted.queueNumber || undefined,
    host,
    url,
    title
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
    waitTime: fox.waitTime,
    queueNumber: fox.queueNumber,
    screenshot: fox.screenshot,
    error: fox.error,
    admittedFlash: Date.now() < fox.admittedFlashUntil
  }
}

function emitUpdate() {
  send({ type: 'event', event: 'update', payload: [...instances.values()].map(snapshot) })
}

async function prepareProfile(profileDir) {
  await mkdir(profileDir, { recursive: true })
  await writeFile(
    join(profileDir, 'xulstore.json'),
    JSON.stringify({
      'chrome://browser/content/browser.xhtml': {
        'main-window': {
          screenX: '-32000',
          screenY: '-32000',
          width: '1280',
          height: '720',
          sizemode: 'normal'
        }
      }
    })
  )
}

function killStrayPlaywrightFirefox() {
  try {
    const exe = firefox.executablePath().replace(/'/g, "''")
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
    const context = await firefox.launchPersistentContext(profileDir, {
      headless: false,
      viewport: VIEWPORT,
      ignoreHTTPSErrors: true,
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
      timeout: 90000,
      ignoreDefaultArgs: ['-foreground'],
      executablePath: firefox.executablePath(),
      firefoxUserPrefs: {
        'browser.tabs.warnOnClose': false,
        'browser.sessionstore.resume_from_crash': false,
        'browser.shell.checkDefaultBrowser': false,
        'toolkit.telemetry.reportingpolicy.firstRun': false,
        'startup.homepage_welcome_url': '',
        'startup.homepage_welcome_url.additional': '',
        'browser.startup.homepage_override.mstone': 'ignore',
        'datareporting.policy.dataSubmissionEnabled': false,
        'datareporting.policy.dataSubmissionPolicyBypassNotification': true
      }
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
    return
  }
  if (fox.navigating) {
    fox.status = 'loading'
  } else {
    const previous = fox.status
    const read = await inspectPage(page, previous, fox.wasInQueue)
    if (read.status === 'in_queue') fox.wasInQueue = true
    fox.status = read.status
    fox.waitTime = read.waitTime
    fox.queueNumber = read.queueNumber
    fox.url = read.url
    fox.host = read.host
    fox.title = read.title
    fox.error = read.status === 'error' ? fox.error || 'Could not read page' : undefined
    if (isAdmissionEdge(previous, fox.status)) {
      fox.admittedFlashUntil = Date.now() + 12000
      send({ type: 'event', event: 'admitted', payload: fox.id })
    }
  }
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

killStrayPlaywrightFirefox()
scheduleTick()
send({ type: 'event', event: 'ready', payload: { executable: firefox.executablePath() } })
