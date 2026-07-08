# Backend Agent Rules

These rules apply when adding or changing backend functionality in this project.

## Core goals

1. Review the full backend structure before changing behavior.
2. Keep names clear. Rename unclear files, folders, functions, variables, and types when needed.
3. Keep responsibilities easy to find:
   - `src/api`: HTTP route handling
   - `src/realtime`: WebSocket message handling
   - `src/lobbies`: lobby and match state rules
   - `src/gameplay`: gameplay and movement logic
   - `src/shared`: shared types, constants, and shared error class
4. Remove unnecessary complexity, dead code, repeated logic, and confusing abstraction.
5. Do not add frameworks or libraries unless the benefit is obvious and clearly simplifies the backend.
6. Use existing libraries properly instead of reimplementing what they already provide.
7. Use strict TypeScript properly:
   - no `any`
   - no vague unions unless every value is genuinely needed
   - use explicit domain types
   - avoid duplicated shape definitions
8. Make control flow obvious:
   - no silent fallthrough
   - every invalid case must clearly return, throw, or send an error
   - keep success paths easy to read
   - avoid deep nesting
9. Avoid confusing JavaScript and TypeScript tricks.
10. Prefer simple loops, simple array methods, and named code paths when they are clearer.
11. Keep naming consistent across the backend.
12. Do not rename library imports unless there is a real conflict.
13. Do not add comments to explain confusing code. Rewrite the code instead.
14. Keep functions small and focused.
15. Remove redundancy, but do not replace it with over-engineered abstraction.
16. Keep API and WebSocket message names consistent and easy to trace from request or message to handler to response.

## Project-specific decisions

- Use one shared types file: `src/shared/types.ts`.
- Do not split types into separate API, domain, and socket files.
- Before adding a new type, check whether an existing type can be extended or reused safely.
- Do not add shared helpers unless they are actually shared by multiple files.
- Do not add configuration or options that the backend does not currently use.
- If the code always uses the default path, keep the default path direct instead of wrapping it in unused options.
- Derive values from existing constants instead of duplicating them.
- Reuse shared team definitions such as `TEAM_SIDES` and `TEAM_CONFIG` instead of repeating `team1` and `team2` logic in multiple places.
- Keep `soccer` naming consistent throughout the backend.
- Edit `src`. Do not manually edit `dist`.

## Abstraction rules

- Prefer boring, obvious, readable code over clever code.
- Prefer changing the existing code path over adding a second parallel code path.
- Do not create a helper for one or two simple lines unless it clearly improves readability.
- If a helper is used only once and inlining is clearer, inline it.
- Avoid future-proofing that adds code but does not serve the current backend.
- If two places do the same conceptual work, centralize it only when the shared version stays simple and clearer than the duplicated code.

## Comments and documentation

- Keep file header comments short, professional, and direct.
- Short file header comments are allowed and often helpful.
- Only add local comments where the intent is not obvious from the code.
- Do not use comments as a substitute for rewriting confusing code.
- Do not add conversational or informal comments.

## Types and errors

- Use the existing shared types before creating new ones.
- Use `AppError` for backend validation and domain errors that need a client-safe status and message.
- Keep null and undefined handling explicit and minimal.

## Verification

- Run `npm run build` after meaningful backend changes.
- Manually test any affected flow when changing:
  - API routes
  - WebSocket messages
  - lobby readiness or start logic
  - score updates
  - gameplay state
  - ball movement

## Final check before finishing

- Is the code simpler than before?
- Is the current behavior preserved unless a confirmed bug was fixed?
- Did you reuse existing types, constants, and helpers instead of creating new ones?
- Is every new piece of code clearly in the right folder?
- Is there any unused flexibility, unused function, or unused type that should be removed?
