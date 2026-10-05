pragma ComponentBehavior: Bound
import QtQuick
import QtQuick.Controls
import qs.Commons
import qs.Ui

// Bar entry point for Trawl: a bar icon (glyph + syncing-count badge) plus a
// keyboard-and-mouse popup listing sync mappings with start/cancel/open
// controls. All CLI work and parsing live in Service.qml / Model.js; this
// file only renders svc's state and forwards input to it.
Panel {
  id: root
  moduleName: "io.github.kurenn.trawl"

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  property int selectedIndex: 0

  readonly property color foreground: bar ? bar.foreground : Color.foreground
  readonly property color urgent: bar ? bar.urgent : Color.urgent
  readonly property color dim: Qt.darker(foreground, 1.55)
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family

  readonly property int runningCount: {
    var list = svc.rows
    var n = 0
    for (var i = 0; i < list.length; i++) if (list[i].running) n++
    return n
  }
  readonly property string metaText: svc.rows.length + " mappings · " + runningCount + " syncing"
  readonly property bool showStateMessage: svc.kind === "missing" || svc.kind === "schema" || svc.kind === "empty" || svc.kind === "parse" || svc.kind === "error"

  function clampSelectedIndex() {
    var n = svc.rows.length
    if (selectedIndex < 0) selectedIndex = 0
    else if (selectedIndex > n - 1) selectedIndex = Math.max(0, n - 1)
  }

  function scrollSelectedIntoView() {
    if (!flick || !rowRepeater) return
    var item = rowRepeater.itemAt(root.selectedIndex)
    if (!item) return
    Qt.callLater(function() {
      if (!item) return
      var margin = Style.space(6)
      var point = item.mapToItem(flick.contentItem, 0, 0)
      var top = point.y
      var bottom = top + item.height
      var viewTop = flick.contentY
      var viewBottom = viewTop + flick.height
      var maxY = Math.max(0, flick.contentHeight - flick.height)
      if (top < viewTop + margin) flick.contentY = Math.max(0, top - margin)
      else if (bottom > viewBottom - margin) flick.contentY = Math.min(maxY, bottom + margin - flick.height)
    })
  }

  function selectedRow() {
    var list = svc.rows
    if (selectedIndex < 0 || selectedIndex >= list.length) return null
    return list[selectedIndex]
  }

  function activateSelected() {
    var row = selectedRow()
    if (!row) return
    if (row.running) svc.cancel(row.id)
    else svc.sync(row.id)
  }

  function cancelSelected() {
    var row = selectedRow()
    if (row) svc.cancel(row.id)
  }

  function revealSelectedFolder() {
    var row = selectedRow()
    if (row && row.canOpen) svc.openFolder(row.dest)
  }

  onOpenedChanged: {
    svc.panelOpen = opened
    if (opened) {
      svc.refresh()
      root.selectedIndex = 0
      Qt.callLater(function() { keyCatcher.forceActiveFocus() })
    } else {
      svc.actionMessage = ""
    }
  }

  onSelectedIndexChanged: root.scrollSelectedIntoView()

  Service {
    id: svc
    settings: root.settings
    onRowsChanged: root.clampSelectedIndex()
  }

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    tooltipText: svc.barState.tooltip
    iconComponent: Component {
      Item {
        Text {
          id: glyph
          anchors.centerIn: parent
          textFormat: Text.PlainText
          text: svc.barState.glyph
          color: (svc.barState.state === "failed" || svc.barState.state === "problem") ? root.urgent : root.foreground
          opacity: svc.barState.state === "loading" ? 0.5 : 1.0
          font.family: root.fontFamily
          font.pixelSize: Style.font.icon
        }
        Text {
          visible: svc.barState.state === "syncing" && svc.barState.count > 0
          textFormat: Text.PlainText
          anchors.right: parent.right
          anchors.bottom: parent.bottom
          text: String(svc.barState.count)
          color: root.foreground
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
        }
      }
    }
    onPressed: function(buttonCode) {
      if (buttonCode === Qt.MiddleButton) svc.refresh()
      else root.toggle()
    }
  }

  KeyboardPanel {
    id: panel
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(400))
    contentHeight: panel.fittedContentHeight(column.implicitHeight, Style.space(560))

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      onMoveRequested: function(dx, dy) {
        root.selectedIndex = root.selectedIndex + dy
        root.clampSelectedIndex()
      }
      onActivateRequested: root.activateSelected()
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onTextKey: function(t) {
        if (t === "c" || t === "C") root.cancelSelected()
        else if (t === "o" || t === "O") root.revealSelectedFolder()
        else if (t === "r" || t === "R") svc.refresh()
      }

      Flickable {
        id: flick
        anchors.fill: parent
        contentWidth: width
        contentHeight: column.implicitHeight
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        flickableDirection: Flickable.VerticalFlick
        interactive: contentHeight > height
        ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }

        Column {
          id: column
          width: flick.width
          spacing: Style.space(12)

          PanelHero {
            id: hero
            width: parent.width
            title: "Trawl"
            meta: root.metaText
            foreground: root.foreground
            fontFamily: root.fontFamily
            trailingControl: Component {
              Row {
                spacing: Style.space(6)
                PanelActionButton {
                  iconText: "↻"
                  tooltipText: "Refresh"
                  foreground: root.foreground
                  fontFamily: root.fontFamily
                  onClicked: svc.refresh()
                }
                PanelActionButton {
                  iconText: "↗"
                  tooltipText: "Open Trawl"
                  foreground: root.foreground
                  fontFamily: root.fontFamily
                  onClicked: svc.openApp()
                }
              }
            }
          }

          Text {
            textFormat: Text.PlainText
            visible: svc.actionMessage !== ""
            width: parent.width
            text: svc.actionMessage
            color: svc.actionIsError ? root.urgent : root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.bodySmall
            wrapMode: Text.WordWrap
          }

          Text {
            textFormat: Text.PlainText
            visible: root.showStateMessage
            width: parent.width
            text: svc.message
            color: root.dim
            font.family: root.fontFamily
            font.pixelSize: Style.font.body
            wrapMode: Text.WordWrap
          }

          Repeater {
            id: rowRepeater
            model: svc.rows

            delegate: Component {
              CursorSurface {
                id: rowSurface
                required property var modelData
                required property int index

                width: column.width
                implicitHeight: rowInner.implicitHeight + Style.spacing.rowPaddingX
                hasCursor: root.selectedIndex === rowSurface.index
                foreground: root.foreground

                MouseArea {
                  anchors.fill: parent
                  hoverEnabled: true
                  onEntered: root.selectedIndex = rowSurface.index
                  onClicked: root.selectedIndex = rowSurface.index
                }

                Column {
                  id: rowInner
                  anchors.left: parent.left
                  anchors.right: parent.right
                  anchors.verticalCenter: parent.verticalCenter
                  anchors.margins: Style.space(10)
                  spacing: Style.space(2)

                  Row {
                    width: parent.width
                    spacing: Style.space(8)

                    Text {
                      textFormat: Text.PlainText
                      text: rowSurface.modelData.name + (rowSurface.modelData.enabled ? "" : " (disabled)")
                      color: root.foreground
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.body
                      font.bold: true
                      elide: Text.ElideRight
                    }

                    Text {
                      textFormat: Text.PlainText
                      text: rowSurface.modelData.providerLabel
                      color: root.dim
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.bodySmall
                    }

                    Text {
                      textFormat: Text.PlainText
                      text: rowSurface.modelData.statusText
                      color: rowSurface.modelData.failed ? root.urgent : root.dim
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.bodySmall
                    }
                  }

                  Rectangle {
                    visible: rowSurface.modelData.running && rowSurface.modelData.hasProgress && rowSurface.modelData.fraction >= 0
                    width: parent.width
                    height: Style.space(4)
                    radius: height / 2
                    color: Qt.darker(root.foreground, 3.0)

                    Rectangle {
                      width: parent.width * Math.max(0, Math.min(1, rowSurface.modelData.fraction))
                      height: parent.height
                      radius: height / 2
                      color: root.foreground
                    }
                  }

                  Text {
                    textFormat: Text.PlainText
                    visible: rowSurface.modelData.running && (!rowSurface.modelData.hasProgress || rowSurface.modelData.fraction < 0)
                    text: "syncing…"
                    color: root.dim
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.caption
                  }

                  Text {
                    textFormat: Text.PlainText
                    visible: rowSurface.modelData.progressText !== ""
                    text: rowSurface.modelData.progressText
                    color: root.dim
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.caption
                  }

                  Text {
                    textFormat: Text.PlainText
                    visible: !rowSurface.modelData.running
                    text: rowSurface.modelData.lastText
                    color: root.dim
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.caption
                  }

                  Text {
                    textFormat: Text.PlainText
                    visible: rowSurface.modelData.error !== ""
                    width: parent.width
                    text: rowSurface.modelData.error
                    color: root.urgent
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.caption
                    wrapMode: Text.WordWrap
                  }

                  Row {
                    spacing: Style.space(6)

                    PanelActionButton {
                      visible: !rowSurface.modelData.running
                      iconText: "▶"
                      tooltipText: "Sync"
                      foreground: root.foreground
                      fontFamily: root.fontFamily
                      onClicked: svc.sync(rowSurface.modelData.id)
                    }
                    PanelActionButton {
                      visible: rowSurface.modelData.running
                      iconText: "✕"
                      tooltipText: "Cancel"
                      foreground: root.foreground
                      fontFamily: root.fontFamily
                      onClicked: svc.cancel(rowSurface.modelData.id)
                    }
                    PanelActionButton {
                      visible: rowSurface.modelData.canOpen
                      iconText: "⧉"
                      tooltipText: "Open folder"
                      foreground: root.foreground
                      fontFamily: root.fontFamily
                      onClicked: svc.openFolder(rowSurface.modelData.dest)
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
