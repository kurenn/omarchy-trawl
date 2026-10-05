import test from "node:test"
import assert from "node:assert/strict"
import vm from "node:vm"
import fs from "node:fs"
import { createRequire } from "node:module"

var require = createRequire(import.meta.url)
var Model = require("../Model.js")

// ---------- parseTime ----------

test("parseTime: microseconds with +00:00 offset", function () {
  var ms = Model.parseTime("2026-06-23T21:02:46.435056+00:00")
  assert.equal(ms, Date.UTC(2026, 5, 23, 21, 2, 46, 435))
})

test("parseTime: with Z", function () {
  var ms = Model.parseTime("2026-06-23T21:02:46Z")
  assert.equal(ms, Date.UTC(2026, 5, 23, 21, 2, 46, 0))
})

test("parseTime: negative offset", function () {
  var ms = Model.parseTime("2026-01-01T00:00:00-05:30")
  assert.equal(ms, Date.UTC(2026, 0, 1, 5, 30, 0, 0))
})

test("parseTime: with null", function () {
  assert.ok(isNaN(Model.parseTime(null)))
})

test("parseTime: with garbage", function () {
  assert.ok(isNaN(Model.parseTime("not-a-timestamp")))
})

// ---------- classifyStatus ----------

test("classifyStatus: 127 with env: stderr -> missing", function () {
  var r = Model.classifyStatus(127, "", "env: trawl-cli: No such file or directory")
  assert.equal(r.kind, "missing")
  assert.equal(r.message, "trawl-cli not found. Install Trawl or set cliPath")
  assert.deepEqual(r.mappings, [])
})

test("classifyStatus: 126 with env: stderr -> missing", function () {
  var r = Model.classifyStatus(126, "", "env: trawl-cli: Permission denied")
  assert.equal(r.kind, "missing")
})

test("classifyStatus: 127 without env: prefix -> error", function () {
  var r = Model.classifyStatus(127, "", "some other failure")
  assert.equal(r.kind, "error")
  assert.equal(r.message, "some other failure")
})

test("classifyStatus: schema mismatch", function () {
  var r = Model.classifyStatus(0, JSON.stringify({ schema: 2, mappings: [] }), "")
  assert.equal(r.kind, "schema")
  assert.match(r.message, /schema 2/)
})

test("classifyStatus: invalid JSON -> parse", function () {
  var r = Model.classifyStatus(0, "{not json", "")
  assert.equal(r.kind, "parse")
  assert.equal(r.message, "Could not read trawl-cli output")
})

test("classifyStatus: schema 1 empty mappings -> empty", function () {
  var r = Model.classifyStatus(0, JSON.stringify({ schema: 1, mappings: [] }), "")
  assert.equal(r.kind, "empty")
})

test("classifyStatus: valid 2-mapping fixture -> ok", function () {
  var fixture = {
    schema: 1,
    mappings: [
      { id: "26475538-8264-49db-b972-f3b522c6a37c", name: "A", provider: "gdrive", dest: "/mnt/a", enabled: true, running: false, last_status: "succeeded", last_at: "2026-06-23T21:02:46.435056+00:00", last_error: null, progress: null },
      { id: "e07cef1e-7a6c-4c7e-8fcc-523d21fb31d0", name: "B", provider: "pcloud", dest: "/mnt/b", enabled: true, running: false, last_status: "succeeded", last_at: null, last_error: null, progress: null }
    ]
  }
  var r = Model.classifyStatus(0, JSON.stringify(fixture), "")
  assert.equal(r.kind, "ok")
  assert.equal(r.mappings.length, 2)
})

// ---------- rows ----------

test("rows: running with progress gives fraction and progressText", function () {
  var nowMs = Date.UTC(2026, 0, 1)
  var mappings = [{
    id: "1a2b3c4d-0000-0000-0000-000000000001",
    name: "Big sync",
    provider: "gdrive",
    dest: "/mnt/x",
    enabled: true,
    running: true,
    last_status: "succeeded",
    last_at: null,
    last_error: null,
    progress: { bytesDone: 512, bytesTotal: 1024, speed: 256, etaSec: 2 }
  }]
  var out = Model.rows(mappings, nowMs)
  assert.equal(out.length, 1)
  var row = out[0]
  assert.equal(row.hasProgress, true)
  assert.equal(row.fraction, 0.5)
  assert.equal(row.providerLabel, "Google Drive")
  assert.equal(row.progressText, "512 B / 1.0 KB · 256 B/s · ETA 2s")
})

test("rows: running with null progress -> indeterminate", function () {
  var mappings = [{
    id: "1a2b3c4d-0000-0000-0000-000000000002",
    name: "Unknown progress",
    provider: "pcloud",
    dest: "/mnt/y",
    enabled: true,
    running: true,
    last_status: "succeeded",
    last_at: null,
    last_error: null,
    progress: null
  }]
  var out = Model.rows(mappings, 0)
  assert.equal(out[0].hasProgress, false)
  assert.equal(out[0].fraction, -1)
})

test("rows: failed mapping carries its error", function () {
  var mappings = [{
    id: "1a2b3c4d-0000-0000-0000-000000000003",
    name: "Broken",
    provider: "pcloud",
    dest: "/mnt/z",
    enabled: true,
    running: false,
    last_status: "failed",
    last_at: null,
    last_error: "connection reset",
    progress: null
  }]
  var out = Model.rows(mappings, 0)
  assert.equal(out[0].failed, true)
  assert.equal(out[0].error, "connection reset")
})

test("rows: last_at null -> never", function () {
  var mappings = [{ id: "1a2b3c4d-0000-0000-0000-000000000004", name: "N", provider: "gdrive", dest: "/mnt/n", enabled: true, running: false, last_status: "succeeded", last_at: null, last_error: null, progress: null }]
  var out = Model.rows(mappings, 0)
  assert.equal(out[0].lastText, "never")
})

test("rows: remote-looking dest -> canOpen false", function () {
  var mappings = [{ id: "1a2b3c4d-0000-0000-0000-000000000005", name: "Remote", provider: "pcloud", dest: "pcloud:someRemote/Path", enabled: true, running: false, last_status: "succeeded", last_at: null, last_error: null, progress: null }]
  var out = Model.rows(mappings, 0)
  assert.equal(out[0].canOpen, false)
})

// ---------- barState ----------

test("barState: precedence problem > syncing > failed > idle", function () {
  assert.equal(Model.barState(undefined, []).state, "loading")
  assert.equal(Model.barState("missing", []).state, "problem")
  assert.equal(Model.barState("ok", [{ running: true, enabled: true, last_status: "succeeded" }]).state, "syncing")
  assert.equal(Model.barState("ok", [{ running: false, enabled: true, last_status: "failed" }]).state, "failed")
  assert.equal(Model.barState("ok", [{ running: false, enabled: true, last_status: "succeeded" }]).state, "idle")
})

test("barState: a stale failed status on a currently-running mapping counts as syncing, not failed", function () {
  var state = Model.barState("ok", [{ running: true, enabled: true, last_status: "failed" }])
  assert.equal(state.state, "syncing")
  assert.equal(state.count, 1)
})

test("barState: a disabled mapping's failed status does not trip the failed state", function () {
  var state = Model.barState("ok", [
    { running: false, enabled: false, last_status: "failed" },
    { running: false, enabled: true, last_status: "succeeded" }
  ])
  assert.equal(state.state, "idle")
})

// ---------- pollIntervalMs / refreshSec ----------

test("pollIntervalMs: open or running polls fast", function () {
  assert.equal(Model.pollIntervalMs(true, false, 30), 2000)
  assert.equal(Model.pollIntervalMs(false, true, 30), 2000)
  assert.equal(Model.pollIntervalMs(false, false, 30), 30000)
})

test("refreshSec: fallback and clamping", function () {
  assert.equal(Model.refreshSec({}), 30)
  assert.equal(Model.refreshSec({ refreshIntervalSec: "45" }), 45)
  assert.equal(Model.refreshSec({ refreshIntervalSec: 1 }), 5)
  assert.equal(Model.refreshSec({ refreshIntervalSec: 99999 }), 3600)
  assert.equal(Model.refreshSec({ refreshIntervalSec: "x" }), 30)
})

// ---------- cliPath ----------

test("cliPath: fallbacks to trawl-cli", function () {
  assert.equal(Model.cliPath({ cliPath: "" }), "trawl-cli")
  assert.equal(Model.cliPath({ cliPath: "  " }), "trawl-cli")
  assert.equal(Model.cliPath({ cliPath: 42 }), "trawl-cli")
  assert.equal(Model.cliPath({ cliPath: "A=B" }), "trawl-cli")
  assert.equal(Model.cliPath({ cliPath: "/opt/trawl/bin/trawl-cli" }), "/opt/trawl/bin/trawl-cli")
})

// ---------- actionCommand / isSafeId ----------

test("actionCommand: rejects unsafe ids and bad verbs", function () {
  assert.equal(Model.actionCommand("trawl-cli", "start", "-rf"), null)
  assert.equal(Model.actionCommand("trawl-cli", "start", ""), null)
  assert.equal(Model.actionCommand("trawl-cli", "start", "a b"), null)
  assert.equal(Model.actionCommand("trawl-cli", "start", "a;b"), null)
  assert.equal(Model.actionCommand("trawl-cli", "sync", "26475538-8264-49db-b972-f3b522c6a37c"), null)
})

test("actionCommand: accepts a UUID and returns exact argv", function () {
  var id = "26475538-8264-49db-b972-f3b522c6a37c"
  assert.deepEqual(Model.actionCommand("trawl-cli", "start", id), ["env", "--", "trawl-cli", "start", id])
  assert.deepEqual(Model.actionCommand("trawl-cli", "cancel", id), ["env", "--", "trawl-cli", "cancel", id])
})

// ---------- isOpenablePath ----------

test("isOpenablePath: rejects relative paths, flags, newlines", function () {
  assert.equal(Model.isOpenablePath("relative/path"), false)
  assert.equal(Model.isOpenablePath("-x"), false)
  assert.equal(Model.isOpenablePath("/mnt/ok\npath"), false)
  assert.equal(Model.isOpenablePath("/mnt/ok"), true)
})

// ---------- formatBytes / formatEta ----------

test("formatBytes: boundaries", function () {
  assert.equal(Model.formatBytes(0), "0 B")
  assert.equal(Model.formatBytes(1023), "1023 B")
  assert.equal(Model.formatBytes(1024), "1.0 KB")
  assert.equal(Model.formatBytes(28876863923), "26.9 GB")
})

test("formatEta: durations", function () {
  assert.equal(Model.formatEta(45), "45s")
  assert.equal(Model.formatEta(185), "3m 05s")
  assert.equal(Model.formatEta(3720), "1h 02m")
  assert.equal(Model.formatEta(null), "")
})

// ---------- actionError ----------

test("actionError: 126/127 give install hint", function () {
  assert.equal(Model.actionError("start", 126, "env: trawl-cli: Permission denied"), "trawl-cli not found. Install Trawl or set cliPath")
  assert.equal(Model.actionError("start", 127, ""), "trawl-cli not found. Install Trawl or set cliPath")
})

test("actionError: stderr mentioning unit/systemd/systemctl gets the install-units hint", function () {
  var msg = Model.actionError("start", 1, "Failed to start trawl-sync.service: Unit not found")
  assert.match(msg, /^Failed to start trawl-sync\.service: Unit not found/)
  assert.match(msg, /Run `trawl-cli install-units`$/)
})

test("actionError: otherwise trimmed stderr or exit N", function () {
  assert.equal(Model.actionError("start", 1, "  disk full  "), "disk full")
  assert.equal(Model.actionError("start", 1, ""), "exit 1")
})

test("actionError: capped at 300 characters", function () {
  var long = new Array(400).join("x")
  var msg = Model.actionError("start", 1, long)
  assert.equal(msg.length, 300)
})

// ---------- vm load without module ----------

test("Model.js loads under vm.runInNewContext with no module global", function () {
  var src = fs.readFileSync(new URL("../Model.js", import.meta.url), "utf8")
  assert.doesNotThrow(function () {
    vm.runInNewContext(src, {})
  })
})
