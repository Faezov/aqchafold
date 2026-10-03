# AqchaFold

**AqchaFold** is the development codename for **Ledgerase**, an open-source, local-first personal and household finance app.

Ledgerase turns bank statements, receipts, and transaction data into a clean, understandable household ledger.

## Product goals

- Work well first for a real household, not for a hypothetical enterprise.
- Import bank statements reliably and reconcile them before accepting data.
- Parse receipt photos into structured purchases.
- Learn merchant identities and categories from user corrections.
- Keep financial data local by default.
- Support Android and iOS from one codebase.
- Be extensible to more banks, countries, currencies, and languages.

## Technology direction

- **Mobile:** React Native + Expo
- **Language:** TypeScript
- **Navigation:** Expo Router
- **Local database:** SQLite
- **Database layer:** Drizzle ORM
- **Validation:** Zod
- **Workspace:** pnpm workspaces
- **Testing:** Vitest
- **Backend:** none for v0.1

## Naming

- Repository / development codename: **AqchaFold**
- Public product name: **Ledgerase**
- User-facing copy should use **Ledgerase**.
- `AqchaFold` may also refer to the internal parsing/enrichment engine.

## Architecture

See [`ARCHITECTURE.md`](./ARCHITECTURE.md).
