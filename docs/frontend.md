# Frontend structure and interaction rules

The design follows the „Bühne“ (stage) concept: a dark stage with a warm spotlight, red for the voice and blue for the instrumental. Light mode is a paper-white variant with the same structure. Routes load separately so the player does not download admin and account screens at startup. The UI language is German, always with real umlauts and ß.

## Styling conventions

- **Tokens** live in `src/styles/tokens.css`: colours (`--stage-0…3`, `--ink`, `--ink-2`, `--muted`, `--line`, `--vocal`, `--inst`, `--spot`, `--ok`, `--warn`), spacing (`--s-1…8`), radii (`--r-*`), type scale (`--fs-*`), motion (`--dur-*`, `--ease`), layers (`--z-*`) and layout sizes (`--header-h`, `--desk-h`, `--setlist-w`). Both themes are defined there: dark is the default, `[data-theme='light']` switches. Colour literals belong only in `tokens.css`.
- **Utilities** live in `src/styles/globals.css`: `.btn` (+ `--primary`, `--ghost`, `--danger`, `--danger-solid`, `--sm`, `--block`), `.iconbtn`, `.playdisc`, `.seg` (segmented control, state via `aria-pressed`/`aria-current`), `.chip` (`--ok`, `--work`, `--err`, `--warn`, `--live`), `.badge`, `.meter` (value via `--v`), `.kicker`, `.input`/`.field`, `.panel`, `.stats`/`.stat`, `.table-wrap`/`.table`, `.emptyState`, `.error-panel`, `.skeleton`, `.spinner` and `.page-shell`/`.page-column`/`.page-head`.
- **Components** style themselves with CSS Modules. A module uses tokens and utilities, never raw colours. Class names that e2e tests select on stay stable (`controls`, `resultItem`, `navTab`, `actionBtn`, `filterInput`, `grid`, `emptyState`, `message`, `tab`, …), as do the `data-testid` hooks.
- **Breakpoints** are mobile first and only `min-width`: 600, 900 and 1440 px, no other values (base styles are the phone layout). Below 900 the Setlist is a drawer and the desk is the compact „Ton“ layout; the preset labels appear from 1440, where the desk also shows two full faders. Touch targets are 44 px by default; the dense 36/40 px sizes apply only under `(min-width: 900px) and (pointer: fine)`. The header wordmark drops out on very narrow screens without a breakpoint (it wraps into a clipped second line).
- **Tables** use `.table` inside `.table-wrap`. Add `.table--cards` and a `data-label` on each `td` to turn rows into labelled cards below 900 px (phones and tablets); `cell-main`, `cell-acts` and `cell-inline` place cells inside a card.
- **Icons** come from `components/common/icons.ts` through `<Icon name=… />` (24 px grid, 2 px stroke, `currentColor`). Icons are decorative; buttons carry a visible label or an `aria-label`.
- **Fonts** are self-hosted in `src/assets/fonts`: Archivo (variable, with a condensed width axis for lyrics and a wide one for headlines) and JetBrains Mono for numbers, times and kickers. Lyric lines use `--font-lyric`, whose fallbacks (`Archivo Narrow Fallback` = Arial Narrow Bold at 101 %, `Archivo Condensed Fallback` = Arial Bold at 83 %) match Archivo at `wdth` 82 within about 1 % line width, so lines barely reflow when the web font arrives.
- **Motion** respects `prefers-reduced-motion`; the lyric sweep, spotlight and transitions turn off there.
- **Copy**: backend messages stay English; `utils/messages.ts` maps known texts to German through `de()`. Numbers and dates use `utils/format.ts` (German formats).

## Shared behavior

- `AuthProvider` owns the authenticated account and confirmed credit balance. Screens use `useAuth`; they do not create independent sessions. Login refreshes this state before navigation. A failed session request shows a retry screen instead of silently treating the user as signed out.
- `services/http.ts` rejects failed HTTP requests with an `ApiError`. Only safe reads retry transient gateway/network errors. Mutation callers must await success and catch errors before announcing or changing state. Authentication form errors remain on their forms.
- `Modal` uses a native dialog for keyboard focus, Escape, background isolation and focus restoration. A busy dialog cannot be dismissed while a mutation runs. Notifications render inside an open dialog and survive its close.
- `PageState` provides shared loading, empty and error states. Errors offer a retry when the operation can be retried.
- Dropdown selection uses a native select. Icon buttons have accessible names. Destructive actions explain their effect before confirmation.

## Feature modules

`pages/admin/` contains focused user, key, song, status, usage, log and error screens („Backstage“). `shared.tsx` holds the pager, search field and section head they share. `useAdminAction` handles pending mutation state and confirmed outcomes. Tabs have `data-testid="admin-tab-<name>"`.

**Code splitting in the player.** Parts that are not needed for the first paint load on demand through `React.lazy` + `Suspense`: the Ton sheet, Bühnenmodus (top bar and desk row), the translation panel, the options sheet, the library panel of the Setlist, the suggestions, the processing/error stage states and the album colour maths. The loaders live in `components/Player/lazyParts.ts`; `preload(load)` starts a download on hover, focus or pointer-down so the part is usually ready on click. Fallbacks keep the layout (for example the TV transport renders without the desk row until it arrives).

`components/Layout/` holds the `Header`, the drawer navigation, the player `Sidebar` (Setlist) and `AppShell`, the frame for every page other than the player.

`pages/library/` separates catalog search, library loading/polling, preview audio and song presentation. Request generations prevent stale search/filter responses from replacing newer results. Playlist counts come from the server after changes.

`hooks/AudioPlayback.ts` owns Web Audio resources. `usePlayer` connects queue, lyrics, credits and sync behavior; queue normalization and account-specific storage live in small tested modules. Translation controls start collapsed behind an accessible disclosure; closing the menu preserves the active language and display mode. Player lifecycle tests use fake Web Audio resources, including activation of pending remote playback in a newly opened tab. Browser verification with generated local MP3s complements these tests; neither verifies external music providers.

## Verification

```sh
cd frontend
npm test
npm run test:integration
npm run lint
npm run build
```

For browser checks, use an isolated local app and verify both themes at 390 px and 1440 px, keyboard controls, failed requests, playlist dialogs, route navigation and playback. Keep real provider validation separate from synthetic fixture tests.

`screenshots.mjs` in the repository root regenerates `docs/screenshots`. It reads the account and a demo song ID from environment variables (see the file header). Run it only against a demo song store with self-written lyrics, never against real song data.
