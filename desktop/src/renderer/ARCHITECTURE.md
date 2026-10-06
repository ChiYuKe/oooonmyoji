# Renderer module boundaries

The nine HTML files at the renderer root are stable page addresses. Keep each page's document shell and module script there; Vite expands business template includes before serving or building the page.

## Ownership

- `main.ts` is the main page entry. `app/` assembles the main window and connects editor, command, and runtime services.
- `shell/` owns window controls, menus, docking, and popout behavior. `features/workflow/` owns workflow tabs, document lifecycle, recovery, history, and sidebar behavior.
- `features/content-browser/`, `overview/`, `settings/`, `shikigami/`, `souls/`, and `duel/` own their business behavior and templates. Soul subdirectories follow inventory, optimizer, community, calculator, and components.
- `tools/` contains code and styles for standalone utility windows. `ui/` contains reusable renderer UI such as confirmations, sharing, and reference display.
- `styles/workbench.css` is the ordered stylesheet manifest. Its numeric fragments are consecutive source ranges; keep their import order stable. The light-palette generator expands this same manifest before processing rules.
- `desktop/src/shared/` remains the home for cross-process contracts and shared algorithms.

## Dependencies and initialization

Use direct module paths for cross-feature imports. Keep a small `index.ts` only where it is an explicit module entry point, such as the content browser or docking workspace. A feature must not import `app/`; pass application dependencies through typed arguments or callbacks.

Importing a feature module must not query the DOM or bind browser events. Do that in its `create…` or `install…` initializer, and return cleanup when the feature installs long-lived listeners. Keep document state in the existing workspace/session owner rather than adding another renderer copy.

## Templates and checks

Business HTML fragments use `<!-- @include: path/from/renderer/root.html -->`. The Vite plugin and source checks use `scripts/renderer-templates.cjs` to expand the same fragments. Keep script tags out of fragments so the root page retains predictable script order.

The stylesheet manifest uses local CSS imports in source order. Checks that inspect rules should use `readExpandedCss`; page checks should use `readExpandedHtml`. Do not read a partial source page when the check expects the delivered DOM.
