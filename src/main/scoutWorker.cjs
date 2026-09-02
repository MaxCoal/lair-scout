'use strict'

delete process.env.PLAYWRIGHT_BROWSERS_PATH
delete process.env.ELECTRON_RUN_AS_NODE

const { chromium } = require('playwright')
const { mkdir, rm } = require('node:fs/promises')
const { execFileSync } = require('node:child_process')
const readline = require('node:readline')

const VIEWPORT = { width: 1280, height: 720 }
const GRID_TICK_MS = 50
const LIVE_TICK_MS = 1400
const SHOT_CONCURRENCY = 6
const QUEUE_HOST = /queue-it\.net|queueit\.com|storequeue\.wizards\.com/i
const PREQUEUE_COPY =
  /secret lair lounge|waiting room|the (sale|event|drop) has not (yet )?started|has not opened yet|please wait.*begin|we're getting ready|we are getting ready|pre-?queue|before the queue|queue has not started|not started yet|will begin shortly|doors (have not|haven'?t) opened/i
const IN_QUEUE_COPY =
  /you are (now )?in line|you're in line|you are in the queue|people ahead of you|visitors ahead of you|your estimated wait|estimated wait time|place in line|queue number/i
const YOUR_TURN = /it['’]?s your turn|you can now enter|you(?:'| a)?re next|you have been redirected/i
const STOCK_COPY = /sold out|out of stock/i
const LONG_WAIT = /more th[ae]n an hour/i

/** @type {Map<string, any>} */
const instances = new Map()
const pausedIds = new Set()
let focusedId = null
let shuttingDown = false
let ticking = false
let spawning = false
let shippingProfile = {
  email: '',
  firstName: '',
  lastName: '',
  address1: '',
  address2: '',
  city: '',
  state: '',
  zip: ''
}

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
    queueState: null,
    messageId: '',
    messageHeader: '',
    messageTime: '',
    messageText: '',
    stockText: ''
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
    if (!merged.messageText && part.messageText) {
      merged.messageId = part.messageId || ''
      merged.messageHeader = part.messageHeader || ''
      merged.messageTime = part.messageTime || ''
      merged.messageText = part.messageText
    }
    if (!merged.stockText && part.stockText) merged.stockText = part.stockText
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
          pick([
            '#MainPart_lbWhichIsIn',
            '#MainPart_lbExpectedServiceTime',
            '#MainPart_divWaitingTimeText',
            '#MainPart_divProgressbarBox',
            '[class*="waitTime"]',
            '[id*="waitTime"]',
            '[class*="estimatedWait"]'
          ]) ||
          ''
      )
    }
    const rawMsg = unwrap(vm?.message)
    let messageId = ''
    let messageHeader = ''
    let messageTime = ''
    let messageText = pick(['#MainPart_pMessageOnQueueTicket'])
    if (rawMsg && typeof rawMsg === 'object') {
      messageId = String(unwrap(rawMsg.id) || '')
      messageHeader = String(unwrap(rawMsg.header) || '').trim()
      messageText = messageText || String(unwrap(rawMsg.text) || '').trim()
      const stamp = String(unwrap(rawMsg.timestampFormatted) || '').replace(/\u202f/g, ' ').trim()
      const zone = String(unwrap(rawMsg.timeZonePostfix) || '').trim()
      messageTime = [stamp, zone].filter(Boolean).join(' ')
    }
    if (messageText) {
      messageHeader = messageHeader || pick(['#MainPart_h2MessageOnQueueTicket'])
      const stamp = pick(['#MainPart_h2MessageOnQueueTicketTimeText']).replace(/\u202f/g, ' ')
      const zone = pick(['#MainPart_h2MessageOnQueueTicketTimeTextTimeZonePostfix'])
      messageTime = messageTime || [stamp, zone].filter(Boolean).join(' ')
    }
    if (!messageText) {
      const box = document.querySelector('#MainPart_divTimeBox')
      if (box && box.offsetHeight) {
        const copy = String(box.innerText || '').trim()
        if (/message last updated|sold out|out of stock/i.test(copy)) messageText = copy
      }
    }
    let stockText = ''
    const stockModal = document.querySelector(
      '#modal_errorPopup.in, #modal_errorPopup.show, #popup_waitingList.in, #popup_waitingList.show'
    )
    if (stockModal && stockModal.offsetHeight) stockText = String(stockModal.innerText || '').trim()
    if (!stockText) {
      const visible = [...document.querySelectorAll('p, li, .modal-body, .toast-msg, [role="alert"]')].find((el) => {
        if (!el.offsetHeight) return false
        const copy = String(el.innerText || '')
        return /sold out|out of stock/i.test(copy) && copy.length < 800
      })
      if (visible) stockText = String(visible.innerText || '').trim()
    }
    return {
      ...fromVm,
      messageId,
      messageHeader,
      messageTime,
      messageText,
      stockText,
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

function cleanNoticeText(text) {
  return String(text || '')
    .replace(/\u202f/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function toQueueNotice(extracted) {
  const lounge = cleanNoticeText(extracted.messageText)
  const stock = cleanNoticeText(extracted.stockText)
  const text = lounge || stock
  if (!text) return undefined
  const kind = STOCK_COPY.test(text) ? 'stock' : 'message'
  const header =
    kind === 'stock'
      ? String(extracted.messageHeader || 'Out of stock').trim() || 'Out of stock'
      : String(extracted.messageHeader || 'Message').trim()
  const time = String(extracted.messageTime || '')
    .replace(/\u202f/g, ' ')
    .trim()
  const id = String(extracted.messageId || `${header}|${time}|${text}`).trim()
  return { id, header, time, text, kind }
}

function noticeFromInner(inner) {
  const src = String(inner || '')
  const idx = src.search(/Message last updated:/i)
  if (idx < 0) return null
  const slice = src.slice(idx)
  const timeMatch = slice.match(/Message last updated:\s*([^\n]+)/i)
  const rest = slice.replace(/Message last updated:\s*[^\n]+\n*/i, '')
  const cut = rest.split(/\n\s*DO NOT CLOSE|\n\s*YES! You|\n\s*A couple of reminders/i)[0]
  const text = cleanNoticeText(cut)
  if (!text || text.length < 8) return null
  return {
    messageHeader: 'Message last updated:',
    messageTime: String(timeMatch?.[1] || '')
      .replace(/\u202f/g, ' ')
      .trim(),
    messageText: text,
    messageId: ''
  }
}

async function scrapeMessageDom(page) {
  for (const frame of page.frames()) {
    const frameUrl = frame.url()
    if (/youtube|google|doubleclick|facebook/i.test(frameUrl)) continue
    const text = await frame
      .locator('#MainPart_pMessageOnQueueTicket')
      .innerText({ timeout: 80 })
      .catch(() => '')
    if (text && text.trim()) {
      const header = await frame
        .locator('#MainPart_h2MessageOnQueueTicket')
        .innerText({ timeout: 80 })
        .catch(() => 'Message last updated:')
      const stamp = await frame
        .locator('#MainPart_h2MessageOnQueueTicketTimeText')
        .innerText({ timeout: 80 })
        .catch(() => '')
      const zone = await frame
        .locator('#MainPart_h2MessageOnQueueTicketTimeTextTimeZonePostfix')
        .innerText({ timeout: 80 })
        .catch(() => '')
      return {
        messageId: '',
        messageHeader: String(header || 'Message last updated:').trim(),
        messageTime: `${stamp} ${zone}`.replace(/\u202f/g, ' ').replace(/\s+/g, ' ').trim(),
        messageText: text.trim()
      }
    }
    const box = await frame
      .locator('#MainPart_divTimeBox')
      .innerText({ timeout: 80 })
      .catch(() => '')
    if (/message last updated|sold out|out of stock/i.test(box)) {
      return noticeFromInner(box) || { messageId: '', messageHeader: 'Message', messageTime: '', messageText: box.trim() }
    }
  }
  return null
}

async function readPageText(page) {
  const chunks = []
  for (const frame of page.frames()) {
    const frameUrl = frame.url()
    if (/youtube|google|doubleclick|facebook/i.test(frameUrl)) continue
    const text = await frame.locator('body').innerText({ timeout: 600 }).catch(() => '')
    if (text) chunks.push(text)
  }
  return chunks.join('\n')
}

async function inspectPage(page, previous, wasInQueue) {
  const url = page.url()
  const host = hostOf(url)
  const title = await page.title().catch(() => '')

  if (!url || url === 'about:blank' || url.startsWith('data:')) {
    return { status: 'idle', host, url, title, statusLabel: 'Idle' }
  }

  let extracted = mergeExtract([])
  try {
    const parts = []
    for (const frame of page.frames()) {
      try {
        parts.push(await extractFrame(frame))
      } catch {
        /* ignore */
      }
    }
    extracted = mergeExtract(parts)
  } catch {
    /* use page text */
  }

  const visible = await readPageText(page)
  const inner = `${extracted.inner || ''}\n${visible}`
  if (!extracted.messageText) {
    const fromInner = noticeFromInner(inner)
    if (fromInner) {
      extracted.messageHeader = fromInner.messageHeader
      extracted.messageTime = fromInner.messageTime
      extracted.messageText = fromInner.messageText
    }
  }
  if (!extracted.messageText) {
    const fromDom = await scrapeMessageDom(page).catch(() => null)
    if (fromDom?.messageText) {
      extracted.messageId = fromDom.messageId || extracted.messageId
      extracted.messageHeader = fromDom.messageHeader || extracted.messageHeader
      extracted.messageTime = fromDom.messageTime || extracted.messageTime
      extracted.messageText = fromDom.messageText
    }
  }

  const pageId = String(extracted.pageId || '').toLowerCase()
  const bodyClass = String(extracted.bodyClass || '').toLowerCase()
  const onQueueHost = QUEUE_HOST.test(host) || isOnQueue(url)
  const hasToken = /queueittoken=/i.test(url)
  const labeledWait = inner.match(/estimated wait(?: time)?(?: is)?:\s*([^\n\r]+)/i)
  const waitTime =
    formatWait(extracted.waitTime) ||
    formatWait(labeledWait?.[1] || '') ||
    (LONG_WAIT.test(inner) ? 'more than an hour' : '')
  const stillInQueue =
    Boolean(waitTime) ||
    IN_QUEUE_COPY.test(inner) ||
    /secret lair lounge/i.test(inner) && /estimated wait/i.test(inner) ||
    pageId === 'queue' ||
    bodyClass.split(/\s+/).includes('queue') ||
    extracted.queueState === 2 ||
    onQueueHost
  const yourTurn = YOUR_TURN.test(inner) && !stillInQueue

  let status
  if (stillInQueue) {
    status = 'in_queue'
  } else if (pageId === 'after' || pageId === 'exit' || extracted.queueState === 3 || yourTurn) {
    status = 'admitted'
  } else if (
    extracted.isBeforeOrIdle === true ||
    pageId === 'before' ||
    pageId === 'idle' ||
    bodyClass.split(/\s+/).includes('before') ||
    extracted.queueState === 1 ||
    PREQUEUE_COPY.test(inner)
  ) {
    status = 'waiting_for_queue'
  } else if (wasInQueue || (hasToken && !onQueueHost)) {
    status = 'admitted'
  } else {
    status = 'not_in_queue'
  }

  return {
    status,
    waitTime: waitTime || undefined,
    queueNumber: extracted.queueNumber || undefined,
    queueNotice: toQueueNotice(extracted),
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
    queueNotice: fox.queueNotice,
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

function hasShipping(profile) {
  if (!profile) return false
  return Boolean(
    profile.email ||
      profile.firstName ||
      profile.lastName ||
      profile.address1 ||
      profile.address2 ||
      profile.city ||
      profile.state ||
      profile.zip ||
      profile.name ||
      profile.address
  )
}

function parseAddressBlob(raw) {
  const lines = String(raw || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  let street = lines[0] || String(raw || '').trim()
  let street2 = ''
  let city = ''
  let state = ''
  let zip = ''
  const last = lines[lines.length - 1] || ''
  const zipOnly = last.match(/^(\d{5}(?:-\d{4})?)$/)
  const cityStateZip =
    last.match(/^(.+?),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/) ||
    last.match(/^(.+?)\s+([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/)
  if (cityStateZip) {
    city = cityStateZip[1].replace(/,\s*$/, '').trim()
    state = cityStateZip[2].toUpperCase()
    zip = cityStateZip[3]
    if (lines.length === 1) {
      street = last.slice(0, last.length - cityStateZip[0].length).replace(/,\s*$/, '').trim() || street
    } else {
      street = lines[0]
      if (lines.length > 2) street2 = lines.slice(1, -1).join(', ')
    }
  } else if (zipOnly && lines.length >= 2) {
    zip = zipOnly[1]
    const prev = lines[lines.length - 2]
    const cityState = prev.match(/^(.+?),\s*([A-Za-z]{2})$/) || prev.match(/^(.+?)\s+([A-Za-z]{2})$/)
    if (cityState) {
      city = cityState[1].replace(/,\s*$/, '').trim()
      state = cityState[2].toUpperCase()
      street = lines[0]
      if (lines.length > 3) street2 = lines.slice(1, -2).join(', ')
    } else {
      street2 = lines.slice(1).join(', ')
    }
  } else if (lines.length > 1) {
    street2 = lines.slice(1).join(', ')
  }
  return { street, street2, city, state, zip }
}

function parseAddress(profile) {
  const email = String(profile?.email || '').trim()
  let firstName = String(profile?.firstName || '').trim()
  let lastName = String(profile?.lastName || '').trim()
  const blobName = String(profile?.name || '').trim()
  if ((!firstName || !lastName) && blobName) {
    const bits = blobName.split(/\s+/).filter(Boolean)
    if (!firstName) firstName = bits[0] || ''
    if (!lastName) lastName = bits.slice(1).join(' ')
  }
  let street = String(profile?.address1 || '').trim()
  let street2 = String(profile?.address2 || '').trim()
  let city = String(profile?.city || '').trim()
  let state = String(profile?.state || '')
    .trim()
    .toUpperCase()
  let zip = String(profile?.zip || '').trim()
  const raw = String(profile?.address || '').trim()
  if (raw && (!street || !city || !zip)) {
    const parsed = parseAddressBlob(raw)
    street = street || parsed.street
    street2 = street2 || parsed.street2
    city = city || parsed.city
    state = state || parsed.state
    zip = zip || parsed.zip
  }
  const name = [firstName, lastName].filter(Boolean).join(' ') || blobName
  const address =
    [street, street2, [city, state, zip].filter(Boolean).join(' ')].filter(Boolean).join('\n') || raw
  return { email, firstName, lastName, name, street, street2, city, state, zip, address }
}

function fillProfileInPage(data) {
  if (
    !data ||
    !(data.email || data.firstName || data.lastName || data.name || data.street || data.city || data.zip || data.address)
  ) {
    return 0
  }
  const setValue = (el, value) => {
    if (!el || !value || el.disabled || el.readOnly) return false
    const next = String(value)
    const current = String(el.value || '')
    if (current === next) return true
    const tag = el.tagName
    try {
      el.click()
      el.focus()
    } catch {
      /* ignore */
    }
    if (tag === 'SELECT') {
      const want = next.toLowerCase()
      const opt = [...el.options].find(
        (item) =>
          item.value.toLowerCase() === want ||
          item.text.toLowerCase() === want ||
          item.value.toLowerCase() === want.slice(0, 2) ||
          item.text.toLowerCase().startsWith(want)
      )
      if (!opt) return false
      el.value = opt.value
    } else {
      const proto = tag === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      const desc = Object.getOwnPropertyDescriptor(proto, 'value')
      const tracker = el._valueTracker
      if (tracker && typeof tracker.setValue === 'function') tracker.setValue(current)
      if (desc && desc.set) desc.set.call(el, next)
      else el.value = next
    }
    el.dispatchEvent(new Event('input', { bubbles: true }))
    try {
      el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertFromPaste', data: next }))
    } catch {
      /* ignore */
    }
    el.dispatchEvent(new Event('change', { bubbles: true }))
    el.dispatchEvent(new Event('blur', { bubbles: true }))
    el.dispatchEvent(new Event('focusout', { bubbles: true }))
    return true
  }
  const labelText = (el) => {
    const bits = []
    if (el.labels) for (const lab of el.labels) bits.push(lab.innerText || lab.textContent || '')
    if (el.id) {
      try {
        const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
        if (lab) bits.push(lab.innerText || lab.textContent || '')
      } catch {
        /* ignore */
      }
    }
    const labelled = el.getAttribute('aria-labelledby')
    if (labelled) {
      for (const id of labelled.split(/\s+/)) {
        const node = document.getElementById(id)
        if (node) bits.push(node.innerText || node.textContent || '')
      }
    }
    const wrap = el.closest('label')
    if (wrap) bits.push(wrap.innerText || wrap.textContent || '')
    const prev = el.previousElementSibling
    if (prev && /label/i.test(prev.tagName)) bits.push(prev.innerText || prev.textContent || '')
    const next = el.nextElementSibling
    if (next && /label/i.test(next.tagName)) bits.push(next.innerText || next.textContent || '')
    const parent = el.parentElement
    if (parent) {
      const direct = parent.querySelectorAll(':scope > label')
      if (direct.length === 1) bits.push(direct[0].innerText || direct[0].textContent || '')
    }
    return bits.join(' ')
  }
  const blobOf = (el) =>
    [
      el.id,
      el.name,
      el.placeholder,
      el.getAttribute('aria-label'),
      el.autocomplete,
      el.getAttribute('ng-model'),
      el.getAttribute('formcontrolname'),
      el.getAttribute('data-internal-id'),
      el.getAttribute('data-template-value'),
      el.getAttribute('data-field'),
      labelText(el)
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .replace(/\s+/g, ' ')
  const collect = (root, out) => {
    if (!root) return out
    for (const el of root.querySelectorAll('input, textarea, select')) out.push(el)
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) collect(el.shadowRoot, out)
    }
    return out
  }
  let filled = 0
  const nodes = collect(document, [])
  for (const el of nodes) {
    const type = (el.getAttribute('type') || 'text').toLowerCase()
    if (['hidden', 'checkbox', 'radio', 'password', 'submit', 'button', 'file'].includes(type)) continue
    const blob = blobOf(el)
    const auto = String(el.autocomplete || '').toLowerCase()
    const isEmail = type === 'email' || auto === 'email' || /(^|[^a-z])e-?mail([^a-z]|$)/.test(blob)
    const isFirst = /first[-_\s]?name|given[-_\s]?name/.test(blob) || auto === 'given-name'
    const isLast = /last[-_\s]?name|family[-_\s]?name|surname/.test(blob) || auto === 'family-name'
    const isFullName =
      /full[-_\s]?name|customer[-_\s]?name|shipping[-_\s]?name|ship[-_\s]?name|billing[-_\s]?name/.test(blob) ||
      auto === 'name' ||
      /^(name|full_name|fullname|shipping_name|billing_name)$/i.test(el.name || el.id || '')
    const isStreet2 =
      /address[-_\s]?(line[-_\s]?)?2|address2|addr2|apt|suite|unit/.test(blob) || auto === 'address-line2'
    const isStreet =
      /street|address[-_\s]?(line[-_\s]?)?1|address1|addr1|shippingaddress|billingaddress|shipping[-_\s]?address|billing[-_\s]?address|(^|[-_\s.])address($|[-_\s.*])/.test(
        blob
      ) ||
      auto === 'street-address' ||
      auto === 'address-line1'
    const isSearch = /type[-_\s]?to[-_\s]?search|start typing|find address|address search|lookup address/.test(blob)
    if (isEmail && data.email) filled += setValue(el, data.email) ? 1 : 0
    else if (isFirst && data.firstName) filled += setValue(el, data.firstName) ? 1 : 0
    else if (isLast && data.lastName) filled += setValue(el, data.lastName) ? 1 : 0
    else if (isFullName && !/user|login|account|company|card/.test(blob) && data.name) filled += setValue(el, data.name) ? 1 : 0
    else if (isSearch && data.address) filled += setValue(el, data.address) ? 1 : 0
    else if (isStreet2 && data.street2) filled += setValue(el, data.street2) ? 1 : 0
    else if (isStreet && data.street) filled += setValue(el, data.street) ? 1 : 0
    else if ((/city|town|locality|shipping[-_\s]?city/.test(blob) || auto === 'address-level2') && data.city)
      filled += setValue(el, data.city) ? 1 : 0
    else if ((/state|province|region|shipping[-_\s]?state/.test(blob) || auto === 'address-level1') && data.state)
      filled += setValue(el, data.state) ? 1 : 0
    else if ((/zip|postal|postcode|shipping[-_\s]?zip/.test(blob) || auto === 'postal-code') && data.zip)
      filled += setValue(el, data.zip) ? 1 : 0
  }
  return filled
}

async function tryFill(locator, value) {
  if (!value) return
  try {
    const loc = locator.first()
    if (!(await loc.count().catch(() => 0))) return
    await loc.fill(String(value), { timeout: 500 })
  } catch {
    /* ignore */
  }
}

async function trySelect(locator, value) {
  if (!value) return
  try {
    const loc = locator.first()
    if (!(await loc.count().catch(() => 0))) return
    const next = String(value)
    await loc.selectOption({ value: next }, { timeout: 400 }).catch(() =>
      loc.selectOption({ label: next }, { timeout: 400 }).catch(() => loc.fill(next, { timeout: 400 }))
    )
  } catch {
    /* ignore */
  }
}

function isCheckoutUrl(url) {
  return /cart|checkout|billing|shipping/i.test(String(url || ''))
}

async function applyShippingToFox(fox) {
  const page = pageOf(fox)
  if (!page || !hasShipping(shippingProfile)) return
  if (!isCheckoutUrl(page.url())) return
  const data = parseAddress(shippingProfile)
  await fillWithPlaywright(page, data)
  await Promise.all(page.frames().map((frame) => frame.evaluate(fillProfileInPage, data).catch(() => 0)))
}

async function fillWithPlaywright(page, data) {
  const jobs = [
    {
      role: /e-?mail/i,
      sel: 'input[type="email"], input[autocomplete="email"], input[name="email" i], input[id="email" i], input[name="Email" i]'
    },
    {
      role: /first name|given name/i,
      sel: 'input[autocomplete="given-name"], input[name="FirstName" i], input[id="FirstName" i], input[name="firstName" i], input[name="first_name" i]'
    },
    {
      role: /last name|family name|surname/i,
      sel: 'input[autocomplete="family-name"], input[name="LastName" i], input[id="LastName" i], input[name="lastName" i], input[name="last_name" i]'
    },
    {
      role: /address line 1|street address/i,
      sel: 'input[autocomplete="street-address"], input[autocomplete="address-line1"], input[name="Address1" i], input[name="address1" i], input[id="Address1" i], input[id="address1" i], [data-template-value="checkout.customer.shipping_address"]'
    },
    {
      role: /address line 2/i,
      sel: 'input[autocomplete="address-line2"], input[name="Address2" i], input[id="Address2" i], input[name="address2" i]'
    },
    {
      role: /^(city|town|locality)$/i,
      sel: 'input[autocomplete="address-level2"], input[name="City" i], input[id="City" i], [data-template-value="checkout.customer.shipping_city"]'
    },
    {
      role: /^(state|province|region)$/i,
      sel: 'select[autocomplete="address-level1"], select[name="State" i], select[id="State" i], input[name="State" i], input[name="state" i], [data-template-value="checkout.customer.shipping_state"]',
      select: true
    },
    {
      role: /zip|postal/i,
      sel: 'input[autocomplete="postal-code"], input[name="Zip" i], input[name="PostalCode" i], input[id="Zip" i], input[name="zip" i], [data-template-value="checkout.customer.shipping_zip"]'
    }
  ]
  const values = [
    data.email,
    data.firstName,
    data.lastName,
    data.street,
    data.street2,
    data.city,
    data.state,
    data.zip
  ]
  for (const frame of page.frames()) {
    for (let i = 0; i < jobs.length; i += 1) {
      const val = values[i]
      if (!val) continue
      const { role, sel, select } = jobs[i]
      if (select) {
        await trySelect(frame.getByLabel(role), val)
        await trySelect(frame.locator(sel), val)
        await tryFill(frame.getByRole('textbox', { name: role }), val)
        continue
      }
      await tryFill(frame.getByRole('textbox', { name: role }), val)
      await tryFill(frame.getByLabel(role), val)
      await tryFill(frame.getByPlaceholder(role), val)
      await tryFill(frame.locator(sel), val)
    }
    if (data.name) {
      await tryFill(frame.locator('input[autocomplete="name"], input[name="FullName" i], input[id="FullName" i]'), data.name)
    }
  }
}

function scheduleFill(fox) {
  if (fox.fillTimer) clearTimeout(fox.fillTimer)
  let n = 0
  const step = async () => {
    fox.fillTimer = null
    await applyShippingToFox(fox)
    n += 1
    if (n < 20) fox.fillTimer = setTimeout(() => { void step() }, 400)
  }
  void step()
}

function hookProfile(fox) {
  if (fox.profileHooked) return
  fox.profileHooked = true
  const attach = (page) => {
    page.on('domcontentloaded', () => {
      scheduleFill(fox)
    })
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) scheduleFill(fox)
    })
  }
  for (const page of fox.context.pages()) attach(page)
  fox.context.on('page', (page) => {
    fox.page = page
    attach(page)
  })
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
        '--disable-pinch',
        '--overscroll-history-navigation=0',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-session-crashed-bubble',
        '--hide-crash-restore-bubble',
        '--disable-features=Translate,MediaRouter,OptimizationHints',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-background-timer-throttling',
        '--ignore-gpu-blocklist',
        '--enable-gpu',
        '--enable-gpu-rasterization',
        '--enable-zero-copy',
        '--use-angle=d3d11',
        '--app-user-model-id=com.lairscout.app'
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
      title: `Scout ${foxId}`,
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
    hookProfile(fox)
    await applyShippingToFox(fox)
    emitUpdate()
    await page.goto(
      `data:text/html,<html><head><title>LairScout-${foxId}</title></head><body style="margin:0;background:#100c0a;color:#f4ead8;font-family:Segoe UI,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh"><div style="text-align:center"><div style="letter-spacing:.2em;text-transform:uppercase;color:#e8943a">Lair Scout</div><h1>Scout ${foxId}</h1><p style="color:#a89278">Ready. Use Send all to navigate.</p></div></body></html>`,
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
  if (fox.fillTimer) clearTimeout(fox.fillTimer)
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
  fox.statusLabel = 'Loading'
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

async function inspectFox(fox) {
  const page = pageOf(fox)
  if (!page) {
    fox.status = 'error'
    fox.error = 'No page'
    fox.statusLabel = 'Error'
    return
  }
  try {
    const previous = fox.status
    const read = await inspectPage(page, previous, fox.wasInQueue)
    if (read.status === 'in_queue' || read.status === 'waiting_for_queue') fox.wasInQueue = true
    fox.navigating = false
    fox.status = read.status
    fox.statusLabel = read.statusLabel
    fox.waitTime = read.waitTime
    fox.queueNumber = read.queueNumber
    fox.url = read.url
    fox.host = read.host
    fox.title = read.title
    fox.error = read.status === 'error' ? fox.error || 'Could not read page' : undefined
    const notice = read.queueNotice
    fox.queueNotice = notice
    const noticeKey = notice ? `${notice.id}|${notice.kind}|${notice.text}` : ''
    if (notice && noticeKey !== fox.lastNoticeId) {
      fox.lastNoticeId = noticeKey
      send({ type: 'event', event: 'queueMessage', payload: { foxId: fox.id, notice } })
    }
    if (!notice) fox.lastNoticeId = ''
    if (isQueuePopEdge(previous, fox.status)) {
      send({ type: 'event', event: 'queuePopped', payload: fox.id })
    }
    if (isAdmissionEdge(previous, fox.status)) {
      fox.admittedFlashUntil = Date.now() + 12000
      send({ type: 'event', event: 'admitted', payload: fox.id })
    }
  } catch (error) {
    process.stderr.write(`[inspect ${fox.id}] ${error instanceof Error ? error.stack || error.message : error}\n`)
  }
}

async function shotFox(fox) {
  if (pausedIds.has(fox.id)) return
  const page = pageOf(fox)
  if (!page) return
  try {
    const quality = focusedId === fox.id ? 58 : 38
    const buffer = await page.screenshot({ type: 'jpeg', quality })
    fox.screenshot = `data:image/jpeg;base64,${buffer.toString('base64')}`
  } catch {
    /* keep last frame */
  }
}

async function mapPool(items, limit, fn) {
  let index = 0
  const n = Math.max(1, Math.min(limit, items.length || 1))
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (index < items.length) {
        const item = items[index++]
        await fn(item)
      }
    })
  )
}

async function tick() {
  if (ticking || shuttingDown) {
    scheduleTick()
    return
  }
  ticking = true
  try {
    const foxes = [...instances.values()]
    await Promise.allSettled(foxes.map((fox) => inspectFox(fox)))
    emitUpdate()
    const live = pausedIds.size > 0
    if (!live && foxes.length) {
      await mapPool(foxes, SHOT_CONCURRENCY, shotFox)
      emitUpdate()
    }
  } finally {
    ticking = false
    scheduleTick()
  }
}

function scheduleTick() {
  const delay = pausedIds.size > 0 ? LIVE_TICK_MS : GRID_TICK_MS
  setTimeout(() => {
    void tick()
  }, delay)
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isOnQueue(url) {
  return /storequeue\.wizards\.com|queue-it\.net|queueittoken=/i.test(String(url || ''))
}

function setRushLabel(fox, label) {
  fox.statusLabel = label
  emitUpdate()
}

async function clickByScript(page, fn, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const ok = await page.evaluate(fn).catch(() => false)
    if (ok) return true
    await wait(150)
  }
  return false
}

function scriptClickAdd() {
  const cookie = document.querySelector('#onetrust-accept-btn-handler')
  if (cookie && cookie.offsetParent) cookie.click()
  const nodes = [
    ...document.querySelectorAll(
      '#buy_button_container button[data-internal-id^="add-to-cart-"], button.buy-link[data-internal-id^="add-to-cart-"], button.buy-link'
    )
  ]
  const extra = [...document.querySelectorAll('button, a.btn, a[role="button"]')]
  const pool = [...nodes, ...extra]
  const matches = pool.filter((el) => {
    if (el.disabled) return false
    const text = (el.innerText || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim()
    if (!/preorder now|add to cart/i.test(text)) return false
    const r = el.getBoundingClientRect()
    const s = getComputedStyle(el)
    return r.width > 24 && r.height > 16 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0
  })
  if (!matches.length) return false
  matches.sort((a, b) => b.getBoundingClientRect().width * b.getBoundingClientRect().height - a.getBoundingClientRect().width * a.getBoundingClientRect().height)
  matches[0].click()
  return true
}

function scriptClickProceed() {
  function shown(el) {
    if (!el) return false
    const r = el.getBoundingClientRect()
    if (r.width < 8 || r.height < 8) return false
    if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return false
    let node = el
    while (node && node.nodeType === 1) {
      const s = getComputedStyle(node)
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false
      node = node.parentElement
    }
    return true
  }
  function fire(el) {
    el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, view: window }))
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }))
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }))
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
    el.click()
  }

  const toast = document.querySelector('#custom-cart-toast')
  if (toast && shown(toast)) {
    const btn = toast.querySelector('button.view-cart, [sf-checkout], button, a')
    if (btn && shown(btn)) {
      fire(btn)
      return true
    }
  }

  const labeled = [
    ...document.querySelectorAll(
      '[aria-label="Proceed to Cart"], button.view-cart, a.view-cart, #minicart button[sf-checkout], button[sf-checkout], a[sf-checkout]'
    )
  ]
  const byText = [...document.querySelectorAll('button, a')].filter((el) =>
    /proceed to cart|view cart/i.test((el.innerText || el.getAttribute('aria-label') || '').replace(/\s+/g, ' '))
  )
  const visible = [...labeled, ...byText].filter(shown)
  if (visible.length) {
    visible.sort((a, b) => {
      const ar = a.getBoundingClientRect()
      const br = b.getBoundingClientRect()
      return ar.top - br.top || ar.left - br.left
    })
    fire(visible[0])
    return true
  }

  const wrap = document.querySelector('.minicart-container')
  const mini = document.querySelector('#minicart-button')
  if (wrap && !wrap.classList.contains('open')) wrap.classList.add('open')
  if (mini) {
    mini.setAttribute('aria-expanded', 'true')
    fire(mini)
  }
  return false
}

function scriptClickGuest() {
  const el =
    document.querySelector('#intersticial_checkout [aria-label="Continue as guest"], button[aria-label="Continue as guest"], button[ng-click="goCart()"]') ||
    [...document.querySelectorAll('button')].find((btn) => /continue as guest/i.test((btn.innerText || '').replace(/\s+/g, ' ')))
  if (!el) return false
  const s = getComputedStyle(el)
  if (s.display === 'none' || s.visibility === 'hidden') return false
  el.click()
  return true
}

async function runRushCheckout(fox, page) {
  if (isOnQueue(page.url())) return

  setRushLabel(fox, 'Adding to cart…')
  if (!(await clickByScript(page, scriptClickAdd, 12000))) {
    throw new Error('Could not find Preorder now / Add to cart')
  }

  setRushLabel(fox, 'Proceeding to cart…')
  await wait(400)
  if (!(await clickByScript(page, scriptClickProceed, 16000))) {
    throw new Error('Could not find Proceed to Cart')
  }

  if (isOnQueue(page.url())) return

  setRushLabel(fox, 'Continue as guest…')
  const guestClicked = await clickByScript(page, scriptClickGuest, 20000)
  if (!guestClicked && !isOnQueue(page.url()) && !/\/cart|checkout/i.test(page.url())) {
    throw new Error('Could not find Continue as guest')
  }

  await wait(600)
  scheduleFill(fox)

  setRushLabel(fox, 'Waiting in queue…')
  await page.waitForURL(/storequeue\.wizards\.com|queue-it\.net|queueittoken=/i, { timeout: 60000 }).catch(() => undefined)
}

async function rushCheckoutFox(fox) {
  const page = pageOf(fox)
  if (!page) throw new Error(`Scout ${fox.id} has no page`)
  if (isOnQueue(page.url())) {
    fox.navigating = false
    return
  }
  setRushLabel(fox, 'Adding to cart…')
  try {
    await runRushCheckout(fox, page)
    await inspectFox(fox)
    if (fox.status === 'loading' || fox.status === 'idle' || /waiting in queue/i.test(fox.statusLabel || '')) {
      if (isOnQueue(page.url())) {
        fox.status = 'in_queue'
        fox.statusLabel = statusLabel('in_queue', fox.waitTime)
      } else {
        fox.statusLabel = 'In checkout / queue'
      }
    }
  } catch (error) {
    fox.status = 'error'
    fox.error = error instanceof Error ? error.message : String(error)
    fox.statusLabel = 'Error'
  } finally {
    fox.navigating = false
    emitUpdate()
  }
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
    } else if (cmd === 'rushCheckout') {
      await Promise.allSettled([...instances.values()].map((fox) => rushCheckoutFox(fox)))
    } else if (cmd === 'setProfile') {
      const profile = msg.profile || {}
      shippingProfile = {
        email: String(profile.email || ''),
        firstName: String(profile.firstName || ''),
        lastName: String(profile.lastName || ''),
        address1: String(profile.address1 || ''),
        address2: String(profile.address2 || ''),
        city: String(profile.city || ''),
        state: String(profile.state || ''),
        zip: String(profile.zip || ''),
        name: String(profile.name || ''),
        address: String(profile.address || '')
      }
      for (const fox of instances.values()) scheduleFill(fox)
    } else if (cmd === 'reload') {
      const fox = instances.get(msg.foxId)
      if (fox) {
        fox.navigating = true
        fox.status = 'loading'
        fox.statusLabel = 'Loading'
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

if (process.env.LAIRSCOUT_KILL_STRAY === '1') killStrayPlaywrightChromium()
scheduleTick()
send({ type: 'event', event: 'ready', payload: { executable: chromium.executablePath() } })
