// Library Management
let libraryData = []

// Initialize library when page loads
document.addEventListener('DOMContentLoaded', () => {
  setupLibraryTabs()
  setupLibraryActions()
})

// Setup tab switching
function setupLibraryTabs() {
  const tabs = document.querySelectorAll('.queue-tab')
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab
      switchTab(tabName)
    })
  })
}

// Switch between queue and library tabs
function switchTab(tabName) {
  // Update tab buttons
  document.querySelectorAll('.queue-tab').forEach((tab) => {
    tab.classList.toggle('active', tab.dataset.tab === tabName)
  })

  // Update content
  document.querySelectorAll('.tab-content').forEach((content) => {
    content.classList.remove('active')
  })

  if (tabName === 'queue') {
    document.getElementById('songQueue').classList.add('active')
    document.getElementById('queueActionsBar').style.display = 'flex'
    document.getElementById('libraryActionsBar').style.display = 'none'
  } else if (tabName === 'library') {
    document.getElementById('libraryContent').classList.add('active')
    document.getElementById('queueActionsBar').style.display = 'none'
    document.getElementById('libraryActionsBar').style.display = 'flex'

    // Load library if not already loaded
    if (libraryData.length === 0) {
      loadLibrary()
    }
  }
}

// Setup library action buttons
function setupLibraryActions() {
  document.getElementById('refreshLibrary')?.addEventListener('click', () => {
    loadLibrary(true)
  })

  document.getElementById('addAllToQueue')?.addEventListener('click', () => {
    addAllToQueue()
  })
}

// Load library from backend
async function loadLibrary(force = false) {
  const libraryContent = document.getElementById('libraryContent')

  // Show loading state
  libraryContent.innerHTML = `
    <div class="library-loading">
      <i class="fas fa-circle-notch fa-spin"></i>
      <p>Loading library...</p>
    </div>
  `

  try {
    const response = await fetch('/track/library', {
      credentials: 'include',
    })

    if (!response.ok) {
      throw new Error('Failed to load library')
    }

    const data = await response.json()
    libraryData = data.songs

    // Update library count
    document.getElementById('libraryCount').textContent = `(${data.count})`

    // Display library
    displayLibrary(libraryData)

    // Show toast notification
    if (force) {
      showToast('Library refreshed', 'success')
    }
  } catch (error) {
    console.error('Error loading library:', error)
    libraryContent.innerHTML = `
      <div class="library-empty">
        <i class="fas fa-exclamation-triangle"></i>
        <h3>Error loading library</h3>
        <p>${error.message}</p>
      </div>
    `
    showToast('Failed to load library', 'error')
  }
}

// Display library items
function displayLibrary(songs) {
  const libraryContent = document.getElementById('libraryContent')

  if (songs.length === 0) {
    libraryContent.innerHTML = `
      <div class="library-empty">
        <i class="fas fa-folder-open"></i>
        <h3>Library is empty</h3>
        <p>Search and add songs to build your library</p>
      </div>
    `
    return
  }

  libraryContent.innerHTML = songs
    .map(
      (song) => `
    <div class="library-item" data-song-id="${song.id}">
      <img 
        src="https://e-cdns-images.dzcdn.net/images/cover/${
          song.cover
        }/250x250-000000-80-0-0.jpg" 
        alt="${song.title}"
        onerror="this.src='/logo.svg'"
      />
      <div class="library-item-content">
        <div class="library-item-title">${escapeHtml(song.title)}</div>
        <div class="library-item-artist">${escapeHtml(song.artist)}</div>
      </div>
      <div class="library-item-actions">
        <button 
          class="library-item-btn" 
          onclick="addLibrarySongToQueue('${song.id}')"
          title="Add to queue"
          aria-label="Add to queue"
        >
          <i class="fas fa-plus"></i>
        </button>
        <button 
          class="library-item-btn" 
          onclick="playLibrarySong('${song.id}')"
          title="Play now"
          aria-label="Play now"
        >
          <i class="fas fa-play"></i>
        </button>
      </div>
      <div class="library-item-status ${song.ready ? '' : 'incomplete'}" 
           title="${song.ready ? 'Ready to play' : 'Processing incomplete'}">
      </div>
    </div>
  `
    )
    .join('')
}

// Add library song to queue
window.addLibrarySongToQueue = function addLibrarySongToQueue(songId) {
  const song = libraryData.find((s) => s.id === songId)
  if (!song) return

  if (!song.ready) {
    showToast('Song is not fully processed yet', 'warning')
    return
  }

  // Check if song is already in queue
  if (window.karaokePlayer && window.karaokePlayer.songQueue) {
    const inQueue = window.karaokePlayer.songQueue.some((q) => q.id === songId)
    if (inQueue) {
      showToast('Song already in queue', 'warning')
      return
    }
  }

  // Add to queue (skip processing since song is already ready)
  if (window.karaokePlayer) {
    window.karaokePlayer.addToQueue(
      {
        id: songId,
        title: song.title,
        artist: song.artist,
        thumbnail: `https://e-cdns-images.dzcdn.net/images/cover/${song.cover}/250x250-000000-80-0-0.jpg`,
        duration: song.duration,
        vocalsUrl: `/songs/${songId}/vocals.mp3`,
        musicUrl: `/songs/${songId}/no_vocals.mp3`,
        lyricsUrl: `/songs/${songId}/lyrics.json`,
      },
      true // Skip processing for library songs
    )

    showToast(`Added "${song.title}" to queue`, 'success')
  }
}

// Play library song immediately
window.playLibrarySong = function playLibrarySong(songId) {
  const song = libraryData.find((s) => s.id === songId)
  if (!song) return

  if (!song.ready) {
    showToast('Song is not fully processed yet', 'warning')
    return
  }

  // Add to queue and play
  if (window.karaokePlayer) {
    addLibrarySongToQueue(songId)

    // Switch to the newly added song
    setTimeout(() => {
      const newIndex = window.karaokePlayer.songQueue.length - 1
      window.karaokePlayer.loadSong(newIndex)
      showToast(`Now playing "${song.title}"`, 'success')
    }, 100)
  }
}

// Add all ready songs to queue
function addAllToQueue() {
  const readySongs = libraryData.filter((s) => s.ready)

  if (readySongs.length === 0) {
    showToast('No songs ready to add', 'warning')
    return
  }

  let addedCount = 0
  readySongs.forEach((song) => {
    // Check if already in queue
    const inQueue =
      window.karaokePlayer &&
      window.karaokePlayer.songQueue.some((q) => q.id === song.id)

    if (!inQueue) {
      addLibrarySongToQueue(song.id)
      addedCount++
    }
  })

  if (addedCount > 0) {
    showToast(
      `Added ${addedCount} song${addedCount > 1 ? 's' : ''} to queue`,
      'success'
    )
  } else {
    showToast('All songs already in queue', 'warning')
  }
}

// Show toast notification
function showToast(message, type = 'success') {
  const toastContainer = document.getElementById('toastContainer')
  if (!toastContainer) return

  const toast = document.createElement('div')
  toast.className = `toast ${type}`

  const icon =
    type === 'success'
      ? 'fa-check-circle'
      : type === 'error'
      ? 'fa-exclamation-circle'
      : 'fa-exclamation-triangle'

  toast.innerHTML = `
    <i class="fas ${icon}"></i>
    <span>${escapeHtml(message)}</span>
  `

  toastContainer.appendChild(toast)

  // Auto remove after 3 seconds
  setTimeout(() => {
    toast.style.animation = 'fadeOut 0.3s ease forwards'
    setTimeout(() => toast.remove(), 300)
  }, 3000)
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}
