import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { cpus, totalmem, freemem } from 'node:os'
import { promisify } from 'node:util'
import type { RamSnapshot } from '@shared/types'

const NVIDIA_SMI = [
  'nvidia-smi',
  'C:\\Windows\\System32\\nvidia-smi.exe',
  'C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe'
]

const execFileAsync = promisify(execFile)

type CpuTimes = { user: number; nice: number; sys: number; idle: number; irq: number }

let lastCpu: CpuTimes[] = readCpuTimes()
let lastScoutCpuAt = 0
let lastScoutCpuSeconds = 0
let gpuCache: { percent: number; name: string } | null = null
let gpuBusy = false

function gb(bytes: number): string {
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function readCpuTimes(): CpuTimes[] {
  return cpus().map((cpu) => cpu.times)
}

function cpuPercentSince(prev: CpuTimes[], next: CpuTimes[]): number {
  let idle = 0
  let total = 0
  const n = Math.min(prev.length, next.length)
  for (let i = 0; i < n; i += 1) {
    const a = prev[i]
    const b = next[i]
    idle += b.idle - a.idle
    total += b.user - a.user + b.nice - a.nice + b.sys - a.sys + b.idle - a.idle + b.irq - a.irq
  }
  if (total <= 0) return 0
  return Math.max(0, Math.min(100, Math.round(100 * (1 - idle / total))))
}

export async function readRam(rootPids: number[]): Promise<RamSnapshot> {
  const nextCpu = readCpuTimes()
  const cpuPercent = cpuPercentSince(lastCpu, nextCpu)
  lastCpu = nextCpu

  const totalBytes = totalmem()
  const freeBytes = freemem()
  const usedBytes = Math.max(0, totalBytes - freeBytes)
  const percent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0
  const proc = await readScoutProc(rootPids)
  const now = Date.now()
  let cpuScoutPercent = 0
  if (lastScoutCpuAt && proc.cpuSeconds >= lastScoutCpuSeconds) {
    const dt = (now - lastScoutCpuAt) / 1000
    const cores = Math.max(1, cpus().length)
    if (dt > 0.2) {
      cpuScoutPercent = Math.max(
        0,
        Math.min(100, Math.round(((proc.cpuSeconds - lastScoutCpuSeconds) / dt / cores) * 100))
      )
    }
  }
  lastScoutCpuAt = now
  lastScoutCpuSeconds = proc.cpuSeconds
  void refreshGpu()

  return {
    usedBytes,
    totalBytes,
    freeBytes,
    scoutBytes: proc.bytes,
    percent,
    usedLabel: gb(usedBytes),
    totalLabel: gb(totalBytes),
    scoutLabel: gb(proc.bytes),
    cpuPercent,
    cpuScoutPercent,
    gpuPercent: gpuCache?.percent ?? null,
    gpuName: gpuCache?.name || ''
  }
}

async function readScoutProc(rootPids: number[]): Promise<{ bytes: number; cpuSeconds: number }> {
  const pids = [...new Set(rootPids.filter((pid) => pid > 0))]
  if (!pids.length) return { bytes: 0, cpuSeconds: 0 }
  const list = pids.join(',')
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `$ids = [int[]]@(${list}); $set = [System.Collections.Generic.HashSet[int]]::new(); foreach ($i in $ids) { [void]$set.Add($i) }; $procs = Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId; $added = $true; while ($added) { $added = $false; foreach ($p in $procs) { $id = [int]$p.ProcessId; $parent = [int]$p.ParentProcessId; if ($set.Contains($parent) -and -not $set.Contains($id)) { [void]$set.Add($id); $added = $true } } }; $sum = [int64]0; $cpu = 0.0; Get-Process -Id @($set) -ErrorAction SilentlyContinue | ForEach-Object { $sum += $_.WorkingSet64; if ($_.CPU) { $cpu += $_.CPU } }; Write-Output "$sum $cpu"`
      ],
      { windowsHide: true, timeout: 5000 }
    )
    const parts = String(stdout).trim().split(/\s+/)
    const bytes = Number.parseInt(parts[0] || '0', 10)
    const cpuSeconds = Number.parseFloat(parts[1] || '0')
    return {
      bytes: Number.isFinite(bytes) ? bytes : 0,
      cpuSeconds: Number.isFinite(cpuSeconds) ? cpuSeconds : 0
    }
  } catch {
    return { bytes: 0, cpuSeconds: 0 }
  }
}

async function refreshGpu(): Promise<void> {
  if (gpuBusy) return
  gpuBusy = true
  try {
    gpuCache = (await readNvidiaGpu()) || (await readWindowsGpu()) || gpuCache
  } finally {
    gpuBusy = false
  }
}

async function readNvidiaGpu(): Promise<{ percent: number; name: string } | null> {
  const smi = NVIDIA_SMI.find((path) => path === 'nvidia-smi' || existsSync(path))
  if (!smi) return null
  try {
    const { stdout } = await execFileAsync(
      smi,
      ['--query-gpu=utilization.gpu,name', '--format=csv,noheader,nounits'],
      { windowsHide: true, timeout: 2500 }
    )
    let best = -1
    let name = ''
    for (const line of String(stdout).split(/\r?\n/)) {
      const match = line.match(/^\s*(\d+)\s*,\s*(.+?)\s*$/)
      if (!match) continue
      const percent = Number.parseInt(match[1], 10)
      if (!Number.isFinite(percent) || percent < best) continue
      best = percent
      name = match[2]
    }
    if (best < 0) return null
    return { percent: Math.max(0, Math.min(100, best)), name }
  } catch {
    return null
  }
}

async function readWindowsGpu(): Promise<{ percent: number; name: string } | null> {
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `$s = Get-Counter '\\GPU Engine(*)\\Utilization Percentage' -ErrorAction Stop; $n = 0; foreach ($i in $s.CounterSamples) { if ($i.InstanceName -match 'engtype_3D' -and $i.CookedValue -gt $n) { $n = $i.CookedValue } }; [int][math]::Round($n)`
      ],
      { windowsHide: true, timeout: 4000 }
    )
    const percent = Number.parseInt(String(stdout).trim(), 10)
    if (!Number.isFinite(percent)) return null
    return { percent: Math.max(0, Math.min(100, percent)), name: '' }
  } catch {
    return null
  }
}
