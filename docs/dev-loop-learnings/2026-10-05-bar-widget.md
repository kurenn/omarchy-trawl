# bar-widget — 2026-10-05

- **The shell caches compiled plugin QML by URL** — "Local plugin changed, reloading" and even
  disable/enable keep running the first-loaded `Service.qml`. Any live test of changed QML needs
  `omarchy restart shell`; otherwise you are testing the old code and will draw wrong conclusions.
- **QML `Timer` needs `running: true`** — `repeat` + `triggeredOnStart` alone never fire. No lint
  or unit test catches it; only a live check of "polls without opening the panel" does.
- **Shell logs** — `qs log` reads a 100 MB binary `log.qslog` and can hang; grep the plain
  `/run/user/$UID/quickshell/by-id/<id>/log.log` instead. It records WARN, so temporary
  instrumentation must use `console.warn`, not `console.log`.
- **Live-test a widget's CLI calls with a wrapper** — point the entry's `cliPath` in
  `shell.json` at a script that logs argv then `exec`s the real binary. Re-enabling the plugin
  drops entry settings, so re-apply it after enable.
- **qmllint for `qs.*` imports** — `-I` a temp dir holding a `qs` symlink to `$OMARCHY_PATH/shell`
  (never inside the plugin: validate rejects symlinks). Keep `missing-property` ON and filter only
  members on `QObject`-typed groups (`bar.*`, `Style.font.*`, `Style.spacing.*`); disabling it hides
  misnamed bindings that make the component fail to load. qmllint exits 0 on warnings without `-W 0`.
- **`node --test <dir>` breaks on Node 26.7** (treated as a CJS entry) — use `tests/*.test.mjs`.
- **Bar widgets are instantiated once per monitor** — every Service polls independently.
