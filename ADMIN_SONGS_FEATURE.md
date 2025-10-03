# Admin Song Management Feature

## Overview
Added a comprehensive admin page for managing and deleting songs from the MelodAI library. This feature allows administrators to view all songs in the library with detailed information and delete any song permanently.

## Changes Made

### 1. Backend Routes (`src/routes/admin.py`)

Added three new admin-only routes:

#### `/admin/songs` (GET)
- Renders the song management page
- Requires admin authentication
- Serves the `admin_songs.html` static file

#### `/admin/songs/list` (GET)
- Returns a JSON list of all songs in the library
- Requires admin authentication
- Includes detailed metadata for each song:
  - Track ID, title, artist, album, duration
  - Cover image URL
  - File existence status (song.mp3, vocals.mp3, no_vocals.mp3, lyrics.json)
  - Total size in MB
  - Last modified timestamp
- Songs are sorted alphabetically by title

#### `/admin/songs/<track_id>` (DELETE)
- Deletes any song from the library (not restricted to failed tracks)
- Requires admin authentication
- Removes:
  - Complete track directory (`src/songs/{track_id}/`)
  - Any processing failure records
  - All usage logs for the track
- Returns success/error JSON response

### 2. Frontend Page (`src/static/admin_songs.html`)

Created a modern, responsive admin interface with:

#### Statistics Dashboard
- **Total Songs**: Count of all songs in the library
- **Complete Songs**: Count of songs with all required files
- **Total Storage**: Total disk space used by all songs

#### Song Management Table
Features:
- **Search**: Filter by title, artist, album, or track ID
- **Filter**: Show all songs, complete only, or incomplete only
- **Sortable columns**: Click column headers to sort
- **Song information display**:
  - Album cover thumbnail
  - Title and artist
  - Album name
  - Duration (formatted as MM:SS)
  - File size in MB
  - Status badges (showing missing components)
  - Track ID
- **Delete button**: Permanently delete any song with confirmation

#### User Experience
- Real-time search and filtering
- Visual feedback for all actions
- Success/error notifications
- Responsive design for mobile and desktop
- Loading states and spinners
- Empty state messages
- Confirmation dialogs before deletion

### 3. Navigation Integration (`src/static/admin.html`)

Added a "Songs" tab to the admin dashboard navigation:
- Positioned between "Usage Logs" and "System Status"
- Maintains consistent design with other admin tabs
- Navigates to `/admin/songs` when clicked

## Security Features

1. **Admin Authentication**: All routes require `@admin_required` decorator
2. **Confirmation Dialogs**: Users must confirm before deleting songs
3. **Error Handling**: Proper error messages for all failure cases
4. **Transaction Safety**: Database operations use commits for data integrity

## Usage

### For Administrators

1. Navigate to **Admin Dashboard** → **Songs** tab
2. View all songs in the library with their status and details
3. Use the search box to find specific songs
4. Filter by completion status (all/complete/incomplete)
5. Click column headers to sort by different attributes
6. Click **Delete** button on any song to remove it
7. Confirm the deletion in the dialog
8. The song and all its files will be permanently removed

### API Endpoints

```bash
# Get all songs (JSON)
GET /admin/songs/list

# Delete a song
DELETE /admin/songs/{track_id}
```

## Differences from Existing Track Deletion

The existing track deletion feature (`/admin/track/<track_id>`) is:
- Limited to **failed tracks only** (requires failure record)
- Accessible only from the System Status page
- Intended for cleanup of processing failures

The new song deletion feature (`/admin/songs/<track_id>`) is:
- Available for **any song** in the library
- Accessible from a dedicated Song Management page
- Intended for general library management and administration

## Technical Details

### File Structure
```
src/
├── routes/
│   └── admin.py (3 new routes added)
└── static/
    ├── admin.html (navigation updated)
    └── admin_songs.html (new page)
```

### Dependencies
- Uses existing Flask blueprints and decorators
- Uses existing database connection (`get_db()`)
- Uses standard Python libraries (json, pathlib, os, shutil)
- No new external dependencies required

### Data Flow
1. Frontend loads and calls `/admin/songs/list`
2. Backend scans `src/songs/` directory
3. For each song, reads metadata and checks file existence
4. Returns JSON with all song details
5. Frontend displays songs in sortable, filterable table
6. On delete, sends DELETE request to `/admin/songs/<track_id>`
7. Backend removes files and database records
8. Frontend updates display and shows notification

## Future Enhancements

Potential improvements:
- Bulk delete functionality
- Export song list to CSV
- Show usage statistics per song
- Show who added each song
- Add song details modal/popup
- Download individual song files
- Batch operations (delete multiple songs at once)
- Storage cleanup recommendations
