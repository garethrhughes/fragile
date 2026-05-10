# TypeScript Profile — Scaffolders

Used by `project-bootstrap` Step 3.1 ("Prefer official scaffolders").

| Framework | Command |
|---|---|
| NestJS | `nest new <dir> --package-manager npm --skip-git` |
| Next.js | `npx create-next-app@latest <dir> --typescript --eslint --app --src-dir=false --tailwind=<yes\|no> --import-alias='@/*'` |
| Express / Fastify (no scaffolder) | Hand-write minimal `package.json` + `tsconfig.json` + entry point |
| Vite + React | `npm create vite@latest <dir> -- --template react-ts` |
| SvelteKit | `npx sv create <dir>` |

**Package manager:** `npm` by default; honour `pnpm`/`yarn`/`bun` if the user
specified one in Phase 2.

**Lint/format:**

- ESLint flat config (`eslint.config.mjs`) with `@typescript-eslint` strict +
  framework's recommended preset.
- Prettier `.prettierrc.json` with `singleQuote: true`, `trailingComma: "all"`,
  `printWidth: 100`. Add `prettier-plugin-tailwindcss` only if Tailwind is in the
  stack.

**Smoke test commands:**

- Typecheck: `npm run typecheck` (or `tsc --noEmit`)
- Lint: `npm run lint`
- Build: `npm run build`
- Dev: `npm run dev` / `npm run start:dev`
