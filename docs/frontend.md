# Frontend structure and interaction rules

The app keeps its crimson palette and dark/light themes. Shared tokens in `src/styles/globals.css` control contrast, spacing, focus indicators, buttons and reduced motion. Routes load separately so the player does not download admin and account screens at startup.

## Shared behavior

- `AuthProvider` owns the authenticated account and confirmed credit balance. Screens use `useAuth`; they do not create independent sessions. Login refreshes this state before navigation. A failed session request shows a retry screen instead of silently treating the user as signed out.
- `services/http.ts` rejects failed HTTP requests with an `ApiError`. Only safe reads retry transient gateway/network errors. Mutation callers must await success and catch errors before announcing or changing state. Authentication form errors remain on their forms.
- `Modal` uses a native dialog for keyboard focus, Escape, background isolation and focus restoration. A busy dialog cannot be dismissed while a mutation runs. Notifications render inside an open dialog and survive its close.
- `PageState` provides shared loading, empty and error states. Errors offer a retry when the operation can be retried.
- Dropdown selection uses a native select. Icon buttons have accessible names. Destructive actions explain their effect before confirmation.

## Feature modules

`pages/admin/` contains focused user, key, song, status, usage, log and error screens. `useAdminAction` handles pending mutation state and confirmed outcomes.

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

For browser checks, use an isolated local app and verify both themes, a narrow viewport, keyboard controls, failed requests, playlist dialogs, route navigation and playback. Keep real provider validation separate from synthetic fixture tests.
