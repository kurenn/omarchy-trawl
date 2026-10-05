// Pure logic for the Trawl bar widget. No QML, no Qt, no imports, no clock
// reads (now is always injected). Loaded by Service.qml as "Model.js" and by
// node tests via createRequire. Dialect: var + function declarations + ES5
// string/array methods only (same rules as the tailscale reference plugin).

var SCHEMA = 1

var GLYPH_IDLE = "󰅟"
var GLYPH_SYNCING = "󰘿"
var GLYPH_FAILED = "󰅤"

function pad2(n) {
  return (n < 10 ? "0" : "") + n
}

function trimString(s) {
  return String(s == null ? "" : s).trim()
}

function capitalize(s) {
  var v = String(s == null ? "" : s)
  if (v === "") return v
  return v.charAt(0).toUpperCase() + v.slice(1)
}

function providerLabel(provider) {
  var p = String(provider == null ? "" : provider)
  if (p === "gdrive") return "Google Drive"
  if (p === "pcloud") return "pCloud"
  return p
}

function isFailedMapping(m) {
  return !!(m && m.enabled !== false && m.running !== true && String(m.last_status) === "failed")
}

function cliPath(settings) {
  var v = settings && settings.cliPath
  if (typeof v !== "string") return "trawl-cli"
  var t = v.trim()
  if (t === "" || t.indexOf("=") !== -1) return "trawl-cli"
  return t
}

function refreshSec(settings) {
  var v = settings && settings.refreshIntervalSec
  var n = parseInt(v, 10)
  if (isNaN(n)) return 30
  if (n < 5) return 5
  if (n > 3600) return 3600
  return n
}

function statusCommand(cli) {
  return ["env", "--", cli, "status", "--json"]
}

function isSafeId(id) {
  return typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)
}

function isOpenablePath(p) {
  if (typeof p !== "string") return false
  if (p.charAt(0) !== "/") return false
  if (p.indexOf("\0") !== -1) return false
  if (p.indexOf("\n") !== -1) return false
  if (p.indexOf("\r") !== -1) return false
  return true
}

function actionCommand(cli, verb, id) {
  if (verb !== "start" && verb !== "cancel") return null
  if (!isSafeId(id)) return null
  return ["env", "--", cli, verb, id]
}

// RFC3339 parser: regex + Date.UTC, no Intl/Date.parse (QML V4 rejects
// 6-digit fractions, which real trawl-cli output has).
var RFC3339_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.(\d+))?(Z|[+-]\d{2}:\d{2})$/

function parseTime(iso) {
  if (typeof iso !== "string") return NaN
  var m = RFC3339_RE.exec(iso)
  if (!m) return NaN

  var year = parseInt(m[1], 10)
  var month = parseInt(m[2], 10)
  var day = parseInt(m[3], 10)
  var hour = parseInt(m[4], 10)
  var minute = parseInt(m[5], 10)
  var second = parseInt(m[6], 10)

  var fracDigits = m[8] || ""
  var ms = 0
  if (fracDigits !== "") {
    var truncated = fracDigits.substring(0, 3)
    while (truncated.length < 3) truncated += "0"
    ms = parseInt(truncated, 10)
  }

  var offsetToken = m[9]
  var offsetMinutes = 0
  if (offsetToken !== "Z") {
    var sign = offsetToken.charAt(0) === "-" ? -1 : 1
    var offH = parseInt(offsetToken.substring(1, 3), 10)
    var offM = parseInt(offsetToken.substring(4, 6), 10)
    offsetMinutes = sign * (offH * 60 + offM)
  }

  return Date.UTC(year, month - 1, day, hour, minute, second, ms) - offsetMinutes * 60000
}

function relativeTime(iso, nowMs) {
  if (iso === null || iso === undefined) return "never"
  var t = parseTime(iso)
  if (isNaN(t)) return "never"
  var diffMs = nowMs - t
  if (diffMs < 0) diffMs = 0
  var diffSec = Math.floor(diffMs / 1000)
  if (diffSec < 45) return "just now"
  var diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return diffMin + "m ago"
  var diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return diffHour + "h ago"
  var diffDay = Math.floor(diffHour / 24)
  return diffDay + "d ago"
}

function formatBytes(n) {
  var num = Number(n)
  if (!isFinite(num) || num < 0) num = 0
  if (num < 1024) return Math.floor(num) + " B"
  var units = ["KB", "MB", "GB", "TB", "PB"]
  var value = num / 1024
  var i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return value.toFixed(1) + " " + units[i]
}

function formatSpeed(v) {
  if (typeof v === "number" && isFinite(v)) return formatBytes(v) + "/s"
  if (typeof v === "string") return v
  return ""
}

function formatEta(sec) {
  if (typeof sec !== "number" || !isFinite(sec) || sec < 0) return ""
  var s = Math.floor(sec)
  if (s < 60) return s + "s"
  var m = Math.floor(s / 60)
  var rem = s % 60
  if (m < 60) return m + "m " + pad2(rem) + "s"
  var h = Math.floor(m / 60)
  var remM = m % 60
  return h + "h " + pad2(remM) + "m"
}

function classifyStatus(exitCode, stdout, stderr) {
  var err = typeof stderr === "string" ? stderr : ""

  if (exitCode === 126 || exitCode === 127) {
    if (err.indexOf("env:") === 0) {
      return { kind: "missing", message: "trawl-cli not found. Install Trawl or set cliPath", mappings: [] }
    }
    return { kind: "error", message: err.trim() !== "" ? err.trim() : ("exit " + exitCode), mappings: [] }
  }
  if (exitCode !== 0) {
    return { kind: "error", message: err.trim() !== "" ? err.trim() : ("exit " + exitCode), mappings: [] }
  }

  var data
  try {
    data = JSON.parse(String(stdout == null ? "" : stdout))
  } catch (e) {
    return { kind: "parse", message: "Could not read trawl-cli output", mappings: [] }
  }
  if (!data || typeof data !== "object") {
    return { kind: "parse", message: "Could not read trawl-cli output", mappings: [] }
  }
  if (data.schema !== SCHEMA) {
    return { kind: "schema", message: "Update Trawl: status schema " + data.schema + ", plugin expects " + SCHEMA, mappings: [] }
  }

  var mappings = Array.isArray(data.mappings) ? data.mappings : []
  if (mappings.length === 0) {
    return { kind: "empty", message: "No mappings yet. Add one in Trawl", mappings: [] }
  }
  return { kind: "ok", message: "", mappings: mappings }
}

function rows(mappings, nowMs) {
  var list = Array.isArray(mappings) ? mappings : []
  var result = []
  for (var i = 0; i < list.length; i++) {
    var m = list[i] || {}
    var running = m.running === true
    var enabled = m.enabled !== false
    var status = running ? "syncing" : String(m.last_status == null ? "" : m.last_status)
    var statusText = running ? "Syncing" : capitalize(status)
    var progress = running ? (m.progress || null) : null
    var hasProgress = !!progress
    var fraction = -1
    var progressText = ""

    if (hasProgress) {
      var bytesDone = Number(progress.bytesDone) || 0
      var bytesTotal = Number(progress.bytesTotal) || 0
      if (bytesTotal > 0) {
        fraction = bytesDone / bytesTotal
        progressText = formatBytes(bytesDone) + " / " + formatBytes(bytesTotal)
      } else {
        progressText = formatBytes(bytesDone)
      }
      if (progress.speed !== undefined && progress.speed !== null) {
        progressText += " · " + formatSpeed(progress.speed)
      }
      if (typeof progress.etaSec === "number") {
        var etaText = formatEta(progress.etaSec)
        if (etaText !== "") progressText += " · ETA " + etaText
      }
    } else if (running) {
      progressText = "Syncing…"
    }

    var dest = typeof m.dest === "string" ? m.dest : ""

    result.push({
      id: String(m.id == null ? "" : m.id),
      name: String(m.name == null ? "" : m.name),
      provider: String(m.provider == null ? "" : m.provider),
      providerLabel: providerLabel(m.provider),
      status: status,
      statusText: statusText,
      failed: isFailedMapping(m),
      enabled: enabled,
      running: running,
      hasProgress: hasProgress,
      fraction: fraction,
      progressText: progressText,
      lastText: relativeTime(m.last_at, nowMs),
      error: typeof m.last_error === "string" ? m.last_error : "",
      dest: dest,
      canOpen: isOpenablePath(dest)
    })
  }
  return result
}

function anyRunning(mappings) {
  var list = Array.isArray(mappings) ? mappings : []
  for (var i = 0; i < list.length; i++) {
    if (list[i] && list[i].running === true) return true
  }
  return false
}

function problemTooltip(kind) {
  if (kind === "missing") return "trawl-cli not found. Install Trawl or set cliPath"
  if (kind === "schema") return "Update Trawl: status schema mismatch"
  if (kind === "parse") return "Could not read trawl-cli output"
  return "trawl-cli error"
}

function barState(kind, mappings) {
  var list = Array.isArray(mappings) ? mappings : []

  if (!kind) {
    return { state: "loading", count: 0, glyph: GLYPH_IDLE, tooltip: "Loading…" }
  }
  if (kind === "missing" || kind === "schema" || kind === "parse" || kind === "error") {
    return { state: "problem", count: 0, glyph: GLYPH_FAILED, tooltip: problemTooltip(kind) }
  }

  var running = 0
  var failed = 0
  for (var i = 0; i < list.length; i++) {
    if (list[i] && list[i].running === true) running++
    if (isFailedMapping(list[i])) failed++
  }

  if (running > 0) {
    return { state: "syncing", count: running, glyph: GLYPH_SYNCING, tooltip: running + (running === 1 ? " mapping syncing" : " mappings syncing") }
  }
  if (failed > 0) {
    return { state: "failed", count: failed, glyph: GLYPH_FAILED, tooltip: failed + (failed === 1 ? " mapping failed" : " mappings failed") }
  }
  return { state: "idle", count: list.length, glyph: GLYPH_IDLE, tooltip: list.length + (list.length === 1 ? " mapping" : " mappings") }
}

function pollIntervalMs(panelOpen, running, sec) {
  if (panelOpen || running) return 2000
  return sec * 1000
}

function actionError(verb, code, stderr) {
  var trimmed = trimString(stderr)
  var message
  if (code === 126 || code === 127) {
    message = "trawl-cli not found. Install Trawl or set cliPath"
  } else if (/unit|systemd|systemctl/i.test(trimmed)) {
    message = trimmed + " Run `trawl-cli install-units`"
  } else {
    message = trimmed !== "" ? trimmed : ("exit " + code)
  }
  if (message.length > 300) message = message.substring(0, 300)
  return message
}

if (typeof module !== "undefined") {
  module.exports = {
    SCHEMA: SCHEMA,
    cliPath: cliPath,
    refreshSec: refreshSec,
    statusCommand: statusCommand,
    actionCommand: actionCommand,
    isSafeId: isSafeId,
    isOpenablePath: isOpenablePath,
    classifyStatus: classifyStatus,
    rows: rows,
    barState: barState,
    anyRunning: anyRunning,
    pollIntervalMs: pollIntervalMs,
    parseTime: parseTime,
    relativeTime: relativeTime,
    formatBytes: formatBytes,
    formatSpeed: formatSpeed,
    formatEta: formatEta,
    actionError: actionError
  }
}
