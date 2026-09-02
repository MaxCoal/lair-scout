import { execFile } from 'node:child_process'
import { totalmem, freemem } from 'node:os'
import { promisify } from 'node:util'
import type { RamSnapshot } from '@shared/types'

const execFileAsync = promisify(execFile)

function gb(bytes: number): string {
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

export async function readRam(rootPids: number[]): Promise<RamSnapshot> {
  const totalBytes = totalmem()
  const freeBytes = freemem()
  const usedBytes = Math.max(0, totalBytes - freeBytes)
  const percent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0
  const foxboxBytes = await readFoxboxBytes(rootPids)
  return {
    usedBytes,
    totalBytes,
    freeBytes,
    foxboxBytes,
    percent,
    usedLabel: gb(usedBytes),
    totalLabel: gb(totalBytes),
    foxboxLabel: gb(foxboxBytes)
  }
}

async function readFoxboxBytes(rootPids: number[]): Promise<number> {
  const pids = [...new Set(rootPids.filter((pid) => pid > 0))]
  if (!pids.length) return 0
  const list = pids.join(',')
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `$ids = [int[]]@(${list}); $set = [System.Collections.Generic.HashSet[int]]::new(); foreach ($i in $ids) { [void]$set.Add($i) }; $procs = Get-CimInstance Win32_Process; $added = $true; while ($added) { $added = $false; foreach ($p in $procs) { $id = [int]$p.ProcessId; $parent = [int]$p.ParentProcessId; if ($set.Contains($parent) -and -not $set.Contains($id)) { [void]$set.Add($id); $added = $true } } }; $sum = [int64]0; Get-Process -Id @($set) -ErrorAction SilentlyContinue | ForEach-Object { $sum += $_.WorkingSet64 }; Write-Output $sum`
      ],
      { windowsHide: true, timeout: 5000 }
    )
    const value = Number.parseInt(String(stdout).trim(), 10)
    return Number.isFinite(value) ? value : 0
  } catch {
    return 0
  }
}
