# App shell

Preact app: `main.tsx` boots the document store, opens the space documents, starts the sync service and renders `App.tsx`.
Modules register views in their `index.ts` (see `registry.ts`) and are imported once in `modules.ts`.
Read `docs/architecture.md` before adding a module.
Styling: design tokens in `theme/tokens.css`, shared building blocks and icons in `ui/` (see `docs/decisions/theme.md`).
