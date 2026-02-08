# MelodAI - Core Functionality Reference

> Reference document for reimplementation. Describes **what** the app does, not how it's currently built.

---

## App Overview

MelodAI is an AI-powered karaoke web app. Users search for songs, the backend downloads them from Deezer, splits audio into vocals + instrumental using AI (Demucs), extracts word-level timed lyrics with speaker diarization (WhisperX), and presents a synchronized karaoke player.

---

## 1. Player (Core Component)

### 1.1 Dual-Track Audio Engine

- Two independent audio streams: **vocals** and **instrumental**
- Each has its own volume slider (0-100%, default 50%)
- Streams are kept in perfect sync (seek, play, pause affect both)
- Web Audio API with GainNodes for volume control
- Audio routing: each source -> gain node -> speakers

### 1.2 Playback Controls

- **Play/Pause** toggle button
- **Seek** by clicking anywhere on the progress bar
- **Jump to word** - clicking any word in the lyrics seeks to that word's timestamp
- **Previous/Next** song navigation (cycles through queue)
- **Fullscreen** toggle (browser fullscreen API)
- **No** playback speed, repeat, or shuffle-play modes currently

### 1.3 Progress Bar

- Visual fill showing current position as percentage of duration
- Time display: `current / total` in `MM:SS` format
- Click-to-seek anywhere on the bar
- Shimmer animation effect on the fill
- Hover: slight scale-up, thumb indicator appears at fill edge

### 1.4 Synchronized Lyrics Display

This is the central feature of the app.

**Data format** - lyrics are an array of segments, each containing:
- `start` / `end` timestamps (seconds)
- Array of `words`, each with: `word`, `start`, `end`, `speaker`

**Rendering:**
- Lyrics displayed as lines (one segment = one line)
- Each word is a clickable span with timestamp data
- Lines are color-coded by speaker via left border

**Real-time sync (runs every animation frame):**
- Current **word** gets highlighted (yellow/gold background)
- Current **line** gets highlighted (blue background, full opacity)
- Lines fade based on temporal distance from current playback position
  - Nearby lines: higher opacity
  - Distant lines: lower opacity (gradual fade)
- Active line auto-scrolls to center of the lyrics container
- Smooth scroll behavior

**Speaker identification:**
- Up to 6 speakers supported with distinct colors:
  - Cyan, Pink, Green, Amber, Indigo, Rose
- Each line gets a colored left border matching its speaker
- Speaker detected via WhisperX diarization in the backend

### 1.5 Song Metadata Display

- Album art thumbnail
- Song title
- Artist name
- Updated when a new song loads

### 1.6 Loading States

- Skeleton shimmer lines shown while lyrics are being fetched
- Empty state with prompt when no song is selected

---

## 2. Queue System

### 2.1 Queue Structure

Each queue item has: `id`, `title`, `artist`, `thumbnail`, `vocalsUrl`, `musicUrl`, `lyricsUrl`, `ready`, `progress`, `status`, `error`

### 2.2 Queue States

- **Processing** - song is being downloaded/split/transcribed (shows progress %)
- **Ready** - fully processed, clickable to play
- **Error** - processing failed, shows retry button
- **Active** - currently playing (highlighted)

### 2.3 Queue Interactions

- **Click** a ready song to play it immediately
- **Drag and drop** to reorder (grip handle on each item)
- **Remove** any song except the currently playing one
- **Retry** errored songs (re-triggers backend processing)
- **Shuffle** randomizes order (keeps current song in place)
- **Clear** removes all except currently playing song (confirmation required)
- **Random song** button fetches a random pre-processed song from the library (excludes songs already in queue)

### 2.4 Status Polling

- Every 5 seconds, polls backend for processing status of non-ready songs
- Updates progress percentage and status text in real-time
- Marks songs as ready when processing completes (progress = 100%)
- Marks songs as error if processing fails

### 2.5 Queue Persistence

- Queue is **session-only** - lost on page refresh
- No local storage persistence currently

---

## 3. Library

### 3.1 Purpose

The library is the catalog of all previously processed songs on the server. Unlike the queue, it's persistent.

### 3.2 Features

- Lazy-loaded (only fetches when Library tab is first opened)
- Each song shows: cover art, title, artist, completion status indicator
- **Search/filter** by title or artist (client-side, case-insensitive)
- **Add to queue** button (skips processing since already complete)
- **Play now** button (adds to queue and immediately plays)
- **Add all** button (adds all ready songs to queue, skips duplicates)
- **Refresh** button to re-fetch from server
- Unfinished songs shown with orange indicator (can't be added to queue)

---

## 4. Search

- Search input with 300ms debounce
- Minimum 2 characters to trigger
- Queries Deezer API via backend
- Results shown in dropdown: thumbnail, title, artist
- Click result to add to queue (triggers full processing pipeline)
- Clear button to reset search
- Loading spinner during search

---

## 5. Downloads

Three download options per song:
- **Vocals only** (`vocals.mp3`)
- **Instrumental only** (`no_vocals.mp3`)
- **Full original song** (`song.mp3`)

Downloads via blob fetch + programmatic anchor click. Filenames formatted as `Artist - Title (type).mp3`.

---

## 6. Sharing

- Generates clean URL: `/song/{id}`
- Copies to clipboard via Clipboard API
- URL updates automatically when current track changes (via React Router)
- On page load, reads track ID from URL path and adds to queue
- Legacy hash URLs (`/#song={id}`) are redirected to clean URLs

---

## 7. Theming

- Light/dark mode toggle
- Persisted in localStorage
- CSS custom properties for all colors
- Smooth 300ms transitions on theme change
- Both modes have full color palettes (primary, secondary, success, danger, warning, background, surface, text, border, hover)

---

## 8. Notifications (Toasts)

- Three types: success (green), error (red), warning (orange)
- Slide-in from right, auto-dismiss after 3 seconds, fade-out
- Used for: download status, queue actions, errors, clipboard operations

---

## 9. Responsive Layout

- Collapsible sidebar (queue/library panel)
- Toggle button collapses/expands sidebar
- Mobile adjustments at 768px breakpoint
- Touch-friendly control sizes

---

## 10. Authentication & User System

### 10.1 Auth Flow

- Session-based auth with optional "Remember Me" (30-day token cookie)
- Login, register, forgot password forms on `/login` page
- Registration requires invite key OR admin approval
- First registered user auto-becomes admin
- Password reset via email (SMTP, optional)

### 10.2 User Roles

- **User** - search, play, download, queue management
- **Admin** - all user features + admin panel access

### 10.3 Profile

- Profile dropdown in player header
- Shows username, links to About page, theme toggle, admin panel (if admin), logout

---

## 11. Admin Panel

### 11.1 User Management

- View all users (username, creation date, status, role, last online, activity count)
- Approve pending users
- Promote/demote admin role
- Delete users
- Generate and manage invite keys

### 11.2 Usage Analytics

- Stats: total users, downloads, plays, searches, most active user
- Filterable usage logs (by username, action type)
- Paginated log table

### 11.3 Song Management

- List all songs with metadata, file sizes, completion status
- Search/filter songs
- Shows which components exist (audio, vocals, instrumental, lyrics)
- Delete songs

### 11.4 System Status

- Health checks: Database, Deezer API, File System (disk space), Replicate API, Processing Queue, OpenRouter API
- Processing queue view with real-time progress (3s polling)
- Unfinished tracks view with failure counts (5s polling)
- Reprocess failed tracks
- Delete tracks with 2+ failures
- Status history log

---

## 12. Backend Processing Pipeline

### 12.1 Steps (triggered when user adds a song)

1. **Metadata fetch** (0-10%) - fetch song info from Deezer
2. **Download** (10-20%) - download + decrypt audio from Deezer
3. **Audio splitting** (20-50%) - Demucs via Replicate separates vocals from instrumental
4. **Lyrics extraction** (50-85%) - WhisperX via Replicate produces word-level timestamps + speaker diarization
5. **Lyrics post-processing** (85-90%) - LLM (via OpenRouter) splits long lines naturally
6. **Complete** (100%)

### 12.2 Error Recovery

- Failures tracked in database with count and error message
- Manual reprocess from admin panel
- Auto-reprocess of unfinished tracks on server startup

### 12.3 External Services

| Service | Purpose |
|---------|---------|
| Deezer | Song search, download, metadata, cover art |
| Replicate (Demucs) | Vocal/instrumental separation |
| Replicate (WhisperX) | Lyrics extraction with timing + diarization |
| OpenRouter (LLM) | Intelligent lyrics line splitting |
| SMTP (optional) | Password reset emails |

---

## 13. Data Storage

### 13.1 Database (SQLite)

- `users` - accounts, roles, approval status
- `usage_logs` - action tracking (search, download, play)
- `invite_keys` - registration invite system
- `password_resets` - reset tokens
- `auth_tokens` - remember-me tokens
- `system_status` - health check history
- `processing_failures` - track error tracking

### 13.2 File System (per track)

```
songs/{track_id}/
  metadata.json       # title, artist, album, duration, cover
  song.mp3            # original audio
  vocals.mp3          # extracted vocals
  no_vocals.mp3       # instrumental
  lyrics.json         # final word-level timed lyrics with speakers
  lyrics_raw.json     # raw WhisperX output
```

---

## 14. Key Improvement Opportunities

Areas where the current implementation has known gaps:

- **No queue persistence** - queue lost on refresh
- **No keyboard shortcuts** - no hotkeys for play/pause, skip, volume, seek
- **No playback rate control**
- **No repeat modes** (repeat-one, repeat-all)
- **No pre-loading** of next song in queue
- **No offline/PWA support**
- **No WebSocket for processing status** - uses polling
- **No EQ or audio effects** beyond volume
- **No lyrics editing** capability
- **No playlist saving/loading**
- **Mobile UX** could be improved (sidebar behavior, touch gestures)
- **Accessibility** - ARIA attributes exist but keyboard interaction is minimal
