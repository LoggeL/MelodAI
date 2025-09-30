# Track Processing Failure Management Feature

## Overview
This feature adds the ability to track failed track processing attempts and provides admins with an option to delete tracks that have failed multiple times.

## Changes Made

### 1. Database Schema (`src/schema.sql`)
- Added new `processing_failures` table to track failed processing attempts
  - `track_id`: The ID of the track that failed
  - `failure_count`: Number of times the track has failed processing
  - `last_failure`: Timestamp of the most recent failure
  - `error_message`: The error message from the most recent failure

### 2. Database Migration (`src/models/db.py`)
- Added migration to create the `processing_failures` table
- Migration runs automatically on app startup if the table doesn't exist

### 3. Track Processing Logic (`src/routes/track.py`)
- Updated error handling in `de_add_track()` function to log failures to database
- Updated error handling in the `/add` route's background thread to track failures
- Uses SQLite's `ON CONFLICT` clause to increment failure count for repeated failures

### 4. Admin Routes (`src/routes/admin.py`)
- **Updated `/admin/status/unfinished` endpoint**:
  - Now includes `failure_count` and `error_message` for each unfinished track
  - Joins with `processing_failures` table to get failure information

- **New `/admin/track/<track_id>` DELETE endpoint**:
  - Allows admins to delete failed tracks permanently
  - Verifies track has a failure record before deletion
  - Deletes track directory, failure records, and usage logs
  - Requires admin authentication

- **Updated reprocess error handling**:
  - Tracks failures when reprocessing fails

### 5. Admin UI (`src/static/status.html`)
- **Added "Failures" column** to unfinished tracks table
- **Failure count badge**:
  - Shows number of failures with color coding (red: ≥3, yellow: ≥2, green: <2)
  - Displays error message on hover
- **Delete button**:
  - Only appears for tracks with 2 or more failures
  - Shows confirmation dialog before deletion
  - Provides visual feedback during deletion
- **Styling**: Added CSS for delete button matching the existing design system

## Usage

### For Administrators
1. Navigate to **Admin Dashboard → System Status → Unfinished Tracks** tab
2. View the failure count for each unfinished track
3. Hover over the failure count badge to see the error message
4. For tracks with 2+ failures, a **Delete** button will appear
5. Click **Delete** to permanently remove the track and its files
6. Confirm the deletion in the dialog

### Automatic Tracking
- Failures are automatically tracked whenever:
  - A track fails during initial processing
  - A track fails during reprocessing
  - Any processing step (download, split, lyrics) fails
- The failure count increments each time the same track fails
- The error message is updated with the most recent error

## Technical Details

### Failure Tracking Query
```sql
INSERT INTO processing_failures (track_id, failure_count, error_message)
VALUES (?, 1, ?)
ON CONFLICT(track_id) DO UPDATE SET
    failure_count = failure_count + 1,
    last_failure = CURRENT_TIMESTAMP,
    error_message = ?
```

### Delete Track Logic
1. Verify track has failure record
2. Delete track directory (`src/songs/{track_id}/`)
3. Remove from `processing_failures` table
4. Remove from `usage_logs` table
5. Commit transaction

## Security Considerations
- Delete endpoint requires admin authentication
- Only tracks with failure records can be deleted (prevents accidental deletion of working tracks)
- Confirmation dialog prevents accidental deletions
- All deletions are permanent and cannot be undone

## Future Enhancements
- Add configurable failure threshold (currently hardcoded at 2)
- Add bulk delete option for multiple failed tracks
- Add notification/email alerts for repeated failures
- Add automatic cleanup after N failures
- Add failure analytics dashboard