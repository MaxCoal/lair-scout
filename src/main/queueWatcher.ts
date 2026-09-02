import type { Page } from 'playwright'
import type { SessionStatus } from '@shared/types'

export type QueueRead = {
  status: SessionStatus
  waitTime?: string
  queueNumber?: string
  host: string
  url: string
  title: string
}

const QUEUE_HOST = /queue-it\.net|queueit\.com/i
const WAIT_COPY =
  /waiting room|you are in line|you're in line|you are now in line|estimated wait|pre-queue|secret lair lounge|please wait|people ahead of you|your place in line/i
const YOUR_TURN = /it['’]?s your turn|you can now enter|you(?:'| a)?re next|the waiting room has ended/i

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ''
  }
}

export async function inspectPage(
  page: Page,
  previous: SessionStatus,
  wasInQueue: boolean
): Promise<QueueRead> {
  const url = page.url()
  const host = hostOf(url)
  const title = await page.title().catch(() => '')

  if (!url || url === 'about:blank' || url.startsWith('data:')) {
    return { status: 'idle', host, url, title }
  }

  let extracted: {
    queueNumber: string
    waitTime: string
    hasQueueUi: boolean
    inner: string
  } | null = null

  try {
    extracted = await page.evaluate(() => {
      const pick = (selectors: string[]): string => {
        for (const sel of selectors) {
          const el = document.querySelector(sel)
          if (!el) continue
          const text = (el as HTMLElement).innerText?.trim() || el.getAttribute('content') || ''
          if (text) return text
        }
        return ''
      }

      const queueNumber = pick([
        '#h2MainHeaderQueueNumber',
        '#MainPart_lbUsersInLineAheadOfYou',
        '[class*="queueNumber"]',
        '[id*="queuePosition"]',
        '[id*="queueNumber"]'
      ])
      const waitTime = pick([
        '#MainPart_divWaitingTimeText',
        '#MainPart_lbExpectedServiceTime',
        '[class*="waitTime"]',
        '[id*="waitTime"]',
        '[class*="estimatedWait"]'
      ])
      const hasQueueUi = Boolean(
        document.querySelector('#queueit_overlay') ||
          document.querySelector('iframe[src*="queue-it.net"]') ||
          document.querySelector('[class*="queueit" i]') ||
          document.querySelector('[id*="queueit" i]') ||
          document.querySelector('#h2MainHeaderQueueNumber') ||
          document.querySelector('#MainPart_divWaitingTimeText') ||
          document.querySelector('#MainPart_lbUsersInLineAheadOfYou')
      )

      return {
        queueNumber,
        waitTime,
        hasQueueUi,
        inner: document.body?.innerText?.slice(0, 9000) ?? ''
      }
    })
  } catch {
    return { status: previous === 'loading' ? 'loading' : 'error', host, url, title }
  }

  const onQueueHost = QUEUE_HOST.test(host) || /queueittoken=/i.test(url)
  const waitingCopy = WAIT_COPY.test(extracted.inner)
  const yourTurn = YOUR_TURN.test(extracted.inner)
  const stillQueued = extracted.hasQueueUi || onQueueHost || waitingCopy

  let status: SessionStatus
  if (yourTurn && !stillQueued) {
    status = 'admitted'
  } else if (stillQueued && !yourTurn) {
    status = 'in_queue'
  } else if (yourTurn) {
    status = 'admitted'
  } else if (wasInQueue || previous === 'admitted') {
    status = 'admitted'
  } else {
    status = 'idle'
  }

  return {
    status,
    waitTime: extracted.waitTime || undefined,
    queueNumber: extracted.queueNumber || undefined,
    host,
    url,
    title
  }
}

export function isAdmissionEdge(previous: SessionStatus, next: SessionStatus): boolean {
  return previous === 'in_queue' && next === 'admitted'
}
