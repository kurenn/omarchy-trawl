# Trawl for Omarchy

Native Omarchy bar widget for [Trawl](https://github.com/kurenn/trawl): Google
Drive and pCloud sync mappings in the bar, with start/cancel controls.

## Features

- Shows sync state (idle, syncing, failed) in the bar, polling
  `trawl-cli status --json`
- Left click opens a keyboard-friendly panel listing every mapping
- Start or cancel a sync, see live progress (bytes, speed, ETA)
- Open a mapping's destination folder, or launch the Trawl app

## Requirements

- `trawl-cli` on `PATH`, reporting `status --json` in the schema this plugin
  expects. Build it from a checkout of
  [kurenn/trawl](https://github.com/kurenn/trawl):
  `cargo install --path crates/trawl-cli`
- `rclone`, which `trawl-cli` drives to do the actual syncing
- the Trawl desktop app, for adding and editing sync mappings (this widget
  does not add mappings)
- `trawl-cli install-units`, to install the systemd units that Sync/Cancel
  and the background sync timer depend on

## Install

```
omarchy plugin add https://github.com/kurenn/omarchy-trawl
omarchy plugin enable io.github.kurenn.trawl
omarchy bar move io.github.kurenn.trawl
```

## Keyboard shortcuts

Inside the panel:

| Key | Action |
| --- | --- |
| `j` / `k` or arrows | move cursor |
| `Enter` | sync selected mapping |
| `c` | cancel selected mapping's sync |
| `o` | open selected mapping's destination folder |
| `r` | refresh status |
| `Esc` | close |
| `Tab` | switch panel |

## Mouse

- Left click the bar icon: toggle the panel
- Middle click the bar icon: refresh status

## Settings

| Key | Type | Default | Notes |
| --- | --- | --- | --- |
| `refreshIntervalSec` | integer | `30` | 5–3600. How often the bar polls `trawl-cli status --json` while the panel is closed and nothing is syncing. |
| `cliPath` | string | `trawl-cli` | Path to the CLI. If the shell's `PATH` doesn't include the directory it lives in, set an absolute path here. |

## States and hints

- **CLI missing** — install hint: install Trawl, or set `cliPath`
- **Schema mismatch** — hint to update Trawl (the plugin and `trawl-cli`
  disagree on the status JSON schema)
- **No mappings** — hint to add one in the Trawl app
- **Units not installed** — hint to run `trawl-cli install-units`

## Security

This plugin runs exactly three commands: `trawl-cli`, `xdg-open` and `trawl`
(the last two via Omarchy's `Util.execArgv`). Every command is passed as an
argv array with no shell involved, so there is nothing to quote or inject.
The plugin never touches sync destinations itself — all file movement is
`trawl-cli`'s and `rclone`'s job — and makes no network calls of its own.

## Development

```
node --test tests/*.test.mjs
```

(Node 26 rejects a bare directory argument to `--test`, so pass the glob.)

```
omarchy plugin validate .
```

Lint (the reference plugins' `qmllint -I /usr/share/omarchy/shell` can't
resolve `qs.*` imports directly, hence the symlinked import dir below;
`[missing-property]` warnings on `bar`/`Style.font` members are expected,
since those are `QtObject`-typed — anything else is a real problem):

```
L=$(mktemp -d) && ln -s /usr/share/omarchy/shell "$L/qs" && \
/usr/lib/qt6/bin/qmllint -I "$L" -W 0 --signal-handler-parameters disable Panel.qml Service.qml; echo "exit=$?"; rm -rf "$L"
```

## License

MIT. See [LICENSE](LICENSE).
