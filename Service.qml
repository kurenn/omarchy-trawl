import QtQuick
import Quickshell.Io
import qs.Commons
import "Model.js" as Model

// Polls `<cliPath> status --json` and runs start/cancel actions for Trawl
// mappings. Never reads files itself; all parsing happens in Model.js inside
// onExited, which never throws. One statusProcess, one actionProcess, each
// with its own watchdog so a hung trawl-cli can never silently stop the
// panel refreshing or wedge an action button forever.
Item {
  id: root

  property var settings: ({})
  property bool panelOpen: false

  property string kind: ""
  property string message: ""
  property var mappings: []
  readonly property var rows: Model.rows(mappings, nowMs)
  readonly property var barState: Model.barState(kind, mappings)

  property string actionMessage: ""
  property bool actionIsError: false
  readonly property bool actionBusy: actionProcess.running

  property double nowMs: Date.now()

  property string _actionVerb: ""
  property bool _statusTimedOut: false
  property bool _actionTimedOut: false

  function refresh() {
    if (!statusProcess.running) {
      statusProcess.command = Model.statusCommand(Model.cliPath(root.settings))
      statusProcess.running = true
      statusWatchdog.restart()
    }
  }

  function runAction(verb, id) {
    if (!actionProcess.running) {
      var cmd = Model.actionCommand(Model.cliPath(root.settings), verb, id)
      if (cmd === null) {
        root.actionMessage = "Invalid request"
        root.actionIsError = true
        return
      }
      root._actionVerb = verb
      actionProcess.command = cmd
      actionProcess.running = true
      actionWatchdog.restart()
    } else {
      root.actionMessage = "Busy, try again"
      root.actionIsError = true
    }
  }

  function sync(id) { runAction("start", id) }
  function cancel(id) { runAction("cancel", id) }

  function openFolder(dest) {
    if (Model.isOpenablePath(dest)) Util.execArgv(["xdg-open", dest])
  }

  function openApp() {
    Util.execArgv(["trawl"])
  }

  onPanelOpenChanged: {
    if (panelOpen) root.nowMs = Date.now()
  }

  Timer {
    id: pollTimer
    interval: Model.pollIntervalMs(root.panelOpen, Model.anyRunning(root.mappings), Model.refreshSec(root.settings))
    repeat: true
    triggeredOnStart: true
    onTriggered: root.refresh()
  }

  Timer {
    id: statusWatchdog
    interval: 15000
    repeat: false
    onTriggered: {
      if (statusProcess.running) {
        root._statusTimedOut = true
        statusProcess.running = false
      }
    }
  }

  Timer {
    id: actionWatchdog
    interval: 30000
    repeat: false
    onTriggered: {
      if (actionProcess.running) {
        root._actionTimedOut = true
        actionProcess.running = false
      }
    }
  }

  Timer {
    id: postActionRefresh
    interval: 600
    repeat: false
    onTriggered: root.refresh()
  }

  Process {
    id: statusProcess
    running: false
    command: []
    stdout: StdioCollector { id: statusStdout; waitForEnd: true }
    stderr: StdioCollector { id: statusStderr; waitForEnd: true }
    onExited: function(exitCode) {
      statusWatchdog.stop()
      root.nowMs = Date.now()
      if (root._statusTimedOut) {
        root._statusTimedOut = false
        root.kind = "error"
        root.message = "trawl-cli status timed out"
        return
      }
      var result = Model.classifyStatus(exitCode, statusStdout.text, statusStderr.text)
      if (result.kind !== "error" && result.kind !== "parse") root.mappings = result.mappings
      root.kind = result.kind
      root.message = result.message
    }
  }

  Process {
    id: actionProcess
    running: false
    command: []
    stdout: StdioCollector { id: actionStdout; waitForEnd: true }
    stderr: StdioCollector { id: actionStderr; waitForEnd: true }
    onExited: function(exitCode) {
      actionWatchdog.stop()
      if (root._actionTimedOut) {
        root._actionTimedOut = false
        root.actionMessage = root._actionVerb + " timed out"
        root.actionIsError = true
      } else if (exitCode === 0) {
        root.actionMessage = root._actionVerb === "start" ? "Sync started" : "Cancel requested"
        root.actionIsError = false
      } else {
        root.actionMessage = Model.actionError(root._actionVerb, exitCode, actionStderr.text)
        root.actionIsError = true
      }
      postActionRefresh.restart()
    }
  }
}
