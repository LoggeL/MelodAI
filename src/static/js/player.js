class KaraokePlayer {
  constructor() {
    this.vocalsAudio = new Audio()
    this.musicAudio = new Audio()
    this.lyrics = null
    this.playing = false
    this.currentWordIndex = 0
    this.currentSongIndex = -1
    this.hasUserInteracted = false

    // Add event listener for first interaction
    document.addEventListener(
      'click',
      () => {
        this.hasUserInteracted = true
      },
      { once: true }
    )

    // Ensure buttons are disabled initially
    document.getElementById('downloadButton').disabled = true
    document.getElementById('shareSong').disabled = true

    this.socket = io('')
    this.setupSocketListeners()

    // Sample song queue (in real app, this might come from an API)
    this.songQueue = []

    this.setupControls()
    this.renderQueue()

    // Add click handler for lyrics words
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('word')) {
        const startTime = parseFloat(e.target.dataset.start)
        if (!isNaN(startTime)) {
          this.jumpToTime(startTime)
        }
      }
    })
  }

  setupSocketListeners() {
    this.socket.on('track_ready', (data) => {
      const song = this.songQueue.find((s) => s.id == data.track_id)
      if (song) {
        song.ready = true
        song.status = ''
        this.updateQueue()
        console.log('track_ready', data)
      }
    })

    this.socket.on('track_progress', (data) => {
      const song = this.songQueue.find((s) => s.id == data.track_id)
      if (song) {
        song.ready = song.progress < 100 ? false : true
        song.progress = data.progress
        song.status = data.status
        this.updateQueue()
      }
    })

    this.socket.on('track_error', (data) => {
      const song = this.songQueue.find((s) => s.id == data.track_id)
      if (song) {
        song.status = data.error
        song.error = true
        this.updateQueue()
      }
    })
  }

  async loadLyrics(lyricsUrl) {
    try {
      // Clear lyrics
      this.lyrics = null
      document.querySelector('.lyrics-cover').src = '/logo.svg'
      document.querySelector('.lyrics-content').innerHTML = `
      <div class="lyrics-skeleton">
        ${Array.from({ length: 30 })
          .map(() => '<div class="skeleton-line"></div>')
          .join('')}
      </div>
      `

      const response = await fetch(lyricsUrl)
      if (!response.ok) {
        throw new Error('Failed to load lyrics')
      }
      const data = await response.json()

      // Iterate through the segments / words and split if the speaker changes
      let segments = []
      data.segments.forEach((segment) => {
        let currentSegment = {
          start: segment.start,
          end: segment.end,
          words: [],
        }
        let currentSpeaker = segment.words[0].speaker
        segment.words.forEach((word, i) => {
          let nextWord =
            i < segment.words.length - 1 ? segment.words[i + 1] : word
          if (
            word.speaker &&
            currentSpeaker &&
            word.speaker !== currentSpeaker &&
            nextWord.speaker === word.speaker
          ) {
            segments.push(currentSegment)
            currentSegment = {
              start: word.start,
              end: word.end,
              words: [],
            }
            currentSpeaker = word.speaker
          } else {
            currentSpeaker = word.speaker
          }
          currentSegment.words.push(word)
        })
        segments.push(currentSegment)
      })

      this.lyrics = segments
      setTimeout(() => this.renderLyrics(), 1000)
      // this.renderLyrics()
    } catch (error) {
      console.error('Error loading lyrics:', error)
    }
  }

  renderLyrics() {
    if (!this.lyrics) return

    const lyrics = document.querySelector('.lyrics-content')
    lyrics.innerHTML = ''

    const song = this.songQueue[this.currentSongIndex]

    // Update cover art
    const cover = document.querySelector('.lyrics-cover')
    cover.src = song.thumbnail

    const artist = document.querySelector('.lyrics-artist')
    const title = document.querySelector('.lyrics-title')

    artist.textContent = song.artist
    title.textContent = song.title

    this.lyrics.forEach((segment, segmentIndex) => {
      const lineDiv = document.createElement('div')
      lineDiv.classList.add('lyrics-line', 'speaker')
      lineDiv.id = `line-${segmentIndex}`

      // Get unique speakers and add speaker classes
      const speakers = new Set(segment.words.map((word) => word.speaker))
      speakers.forEach((speaker) => {
        if (speaker) lineDiv.classList.add(`speaker-${speaker}`)
      })

      segment.words.forEach((word, wordIndex) => {
        const wordSpan = document.createElement('span')
        wordSpan.classList.add('word')
        wordSpan.id = `word-${segmentIndex}-${wordIndex}`
        wordSpan.dataset.start = word.start
        wordSpan.dataset.end = word.end
        wordSpan.textContent = word.word

        // Add space after each word except the last one
        if (wordIndex < segment.words.length - 1) {
          lineDiv.appendChild(wordSpan)
          lineDiv.appendChild(document.createTextNode(' '))
        } else {
          lineDiv.appendChild(wordSpan)
        }
      })

      lyrics.appendChild(lineDiv)
    })

    // Only autoplay if user has interacted with the page
    if (this.hasUserInteracted) {
      document.getElementById('playButton').click()
    }

    // Scroll to the first line
    const firstLine = document.querySelector('.lyrics-line')
    if (firstLine) {
      firstLine.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      })
    }
  }

  jumpToTime(time) {
    this.vocalsAudio.currentTime = time
    this.musicAudio.currentTime = time

    // Start playing if not already playing
    if (!this.playing) {
      this.togglePlay()
    }
  }

  clickProgressBar(e) {
    const rect = this.progressBar.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const barWidth = rect.width
    let progress = (clickX / barWidth)
    
    // Clamp progress between 0 and 1
    progress = Math.max(0, Math.min(1, progress))
    
    // Update progress and seek to position
    const duration = this.vocalsAudio.duration
    this.vocalsAudio.currentTime = duration * progress
    this.musicAudio.currentTime = duration * progress
  }

  startLyricsSync() {
    const checkTime = () => {
      if (!this.playing) return

      const currentTime = this.vocalsAudio.currentTime
      const duration = this.vocalsAudio.duration

      // Update progress bar and time displays
      const progress = (currentTime / duration) * 100
      document.getElementById('progress').style.width = `${progress}%`
      document.getElementById('currentTime').textContent = this.formatTime(currentTime)
      document.getElementById('totalTime').textContent = this.formatTime(duration)

      // Get the next lyrics block as active
      let currentIndex = 0
      for (let i = 0; i < this.lyrics.length; i++) {
        const lyricsLine = this.lyrics[i]
        if (lyricsLine.start > currentTime) {
          currentIndex = i
          break
        }
      }

      // Reset all word highlights
      document.querySelectorAll('.word.active').forEach((word) => {
        word.classList.remove('active')
      })

      // Reset all line highlights
      document.querySelectorAll('.lyrics-line.active').forEach((line) => {
        line.classList.remove('active')
      })

      // Find and highlight the current word
      this.lyrics.forEach((segment) => {
        segment.words.forEach((word) => {
          if (currentTime >= word.start && currentTime <= word.end) {
            const wordElement = document.querySelector(
              `[data-start="${word.start}"]`
            )
            if (wordElement) {
              wordElement.classList.add('active')
            }
          }
        })
      })

      this.lyrics.forEach((segment, segmentIndex) => {
        const lineElement = document.getElementById(
          `line-${segmentIndex}`
        )

        const timeDiff = segment.start - currentTime
        const indexDiff =
          Math.max(0.1, 5 - Math.abs(segmentIndex - currentIndex)) / 5

        if (currentTime >= segment.start && currentTime <= segment.end) {
          lineElement.classList.add('active')
          lineElement.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
          })
          lineElement.style.opacity = 1
        } else if (timeDiff > 0) {
          const opacity = Math.max(
            Math.max(0.1, (20 - timeDiff) / 20),
            indexDiff
          )
          lineElement.style.opacity = opacity
        } else {
          const pastDiff = Math.abs(segment.end - currentTime)
          const opacity = Math.max(
            Math.max(0.1, (20 - pastDiff) / 20),
            indexDiff
          )
          lineElement.style.opacity = opacity
        }
      })

      requestAnimationFrame(checkTime)
    }

    requestAnimationFrame(checkTime)
  }

  async loadSong(index) {
    console.log('loadSong', index)
    if (index === null || index < 0 || index >= this.songQueue.length)
      return

    this.currentSongIndex = index
    const song = this.songQueue[index]

    // Enable download and share buttons
    document.getElementById('downloadButton').disabled = false
    document.getElementById('shareSong').disabled = false

    // Update URL hash with current song ID
    window.location.hash = `song=${song.id}`

    this.updateQueueHighlight()

    // Update lyrics info
    document.querySelector('.lyrics-cover').src = song.thumbnail
    document.querySelector('.lyrics-artist').textContent = song.artist
    document.querySelector('.lyrics-title').textContent = song.title

    // Reset player state
    this.playing = false
    this.vocalsAudio.src = song.vocalsUrl
    this.musicAudio.src = song.musicUrl
    document
      .querySelector('#playButton i')
      .classList.replace('fa-pause', 'fa-play')

    // Reset progress bar and time displays
    document.getElementById('progress').style.width = '0'
    document.getElementById('currentTime').textContent = '0:00'
    document.getElementById('totalTime').textContent = '0:00'

    // Add event listener for duration change to update total time immediately when available
    this.vocalsAudio.addEventListener('loadedmetadata', () => {
      document.getElementById('totalTime').textContent = this.formatTime(this.vocalsAudio.duration)
    }, { once: true })

    // Load lyrics
    this.loadLyrics(song.lyricsUrl)
  }

  renderQueue() {
    const queueContainer = document.getElementById('songQueue')
    queueContainer.innerHTML = this.songQueue
      .map(
        (song, index) => `
            <div id="queue-${song.id}"
                 class="queue-item ${
                   index === this.currentSongIndex ? 'active' : ''
                 }">
                <img src="${song.thumbnail}" alt="${song.title}">
                <div class="queue-item-content">
                    <div>${song.title}</div>
                    <div style="font-size: 0.8em">${song.artist}</div>
                    <div class="queue-status">${this.getStatus(song)}</div>
                </div>
                <div class="queue-item-controls">
                    ${song.error ? 
                      `<button class="queue-control-btn retry-btn" title="Retry" onclick="karaokePlayer.retrySong(${index})">
                        <i class="fas fa-redo"></i>
                       </button>` 
                      : ''
                    }
                    ${index !== this.currentSongIndex ? 
                      `<button class="queue-control-btn remove-btn" title="Remove" onclick="karaokePlayer.removeSong(${index})">
                        <i class="fas fa-times"></i>
                       </button>`
                      : ''
                    }
                </div>
                <div class="progress-overlay" style="width: ${
                  song.progress || 0
                }%"></div>
            </div>
        `
      )
      .join('')
    this.updateQueue()
  }

  getStatus(song) {
    if (!song.status) return ''

    const statusMap = {
      starting: 'Starting...',
      downloading: 'Downloading...',
      downloaded: 'Downloaded',
      splitting: 'Splitting audio...',
      extracting_lyrics: 'Extracted lyrics...',
      lyrics_extracted: 'Lyrics extracted...',
      chunking_lyrics: 'Chunking lyrics...',
      merging_lyrics: 'Merging lyrics...',
      lyrics_complete: 'Lyrics complete',
      error: 'Error processing track',
    }

    return statusMap[song.status] || song.status
  }

  updateQueue() {
    this.songQueue.forEach((song, index) => {
      const queueItem = document.getElementById(`queue-${song.id}`)
      if (queueItem) {
        queueItem.style.opacity = song.ready ? 1 : 0.7
        queueItem.style.cursor = song.ready ? 'pointer' : 'not-allowed'
        queueItem.style.cursor = song.error
          ? 'not-allowed'
          : queueItem.style.cursor

        if (index === this.currentSongIndex) {
          queueItem.classList.add('active')
        } else {
          queueItem.classList.remove('active')
        }

        // onclick if ready and doesn't already exist
        if (song.ready && !queueItem.onclick) {
          queueItem.onclick = () => this.loadSong(index)
        }

        if (song.error) {
          queueItem.classList.add('error')
        } else {
          queueItem.classList.remove('error')
        }

        // Update status and progress
        const statusDiv = queueItem.querySelector('.queue-status')
        if (statusDiv) {
          statusDiv.innerText = this.getStatus(song)
        }

        // Update progress bar
        const existingProgress =
          queueItem.querySelector('.progress-overlay')
        if (existingProgress) {
          existingProgress.style.width = `${song.progress || 0}%`
        }
      }
    })
  }

  updateQueueHighlight() {
    console.log('updateQueueHighlight', this.currentSongIndex)
    if (this.currentSongIndex === -1) return
    const items = document.querySelectorAll('.queue-item')
    items.forEach((item) => {
      item.classList.remove('active')
    })
    items[this.currentSongIndex].classList.add('active')
  }

  setupControls() {
    // Store reference to progress bar
    this.progressBar = document.querySelector('.progress-bar')
    
    // Add click handler to progress bar
    this.progressBar.addEventListener('click', (e) => this.clickProgressBar(e))

    document
      .getElementById('playButton')
      .addEventListener('click', () => this.togglePlay())
    document
      .getElementById('randomSong')
      .addEventListener('click', () => this.randomSong())
    document
      .getElementById('toggleFullscreen')
      .addEventListener('click', () => this.toggleFullscreen())

    document
      .getElementById('vocalsVolume')
      .addEventListener('input', (e) => {
        this.vocalsAudio.volume = e.target.value
      })

    document
      .getElementById('musicVolume')
      .addEventListener('input', (e) => {
        this.musicAudio.volume = e.target.value
      })

    // Keep audio tracks synchronized
    this.vocalsAudio.addEventListener('play', () =>
      this.musicAudio.play()
    )
    this.vocalsAudio.addEventListener('pause', () =>
      this.musicAudio.pause()
    )
    this.vocalsAudio.addEventListener('ended', () => this.nextSong())

    // Setup download button
    const downloadButton = document.getElementById('downloadButton')
    const downloadDropdown = document.getElementById('downloadDropdown')

    downloadButton.addEventListener('click', (e) => {
      e.stopPropagation()
      const rect = downloadButton.getBoundingClientRect()
      downloadDropdown.style.top = `${rect.bottom + 5}px`
      downloadDropdown.style.left = `${rect.left}px`
      downloadDropdown.classList.toggle('active')
    })

    // Close dropdown when clicking outside
    document.addEventListener('click', () => {
      downloadDropdown.classList.remove('active')
    })

    // Setup download options
    document
      .getElementById('downloadVocals')
      .addEventListener('click', () => this.downloadTrack('vocals'))
    document
      .getElementById('downloadMusic')
      .addEventListener('click', () => this.downloadTrack('music'))
    document
      .getElementById('downloadFull')
      .addEventListener('click', () => this.downloadTrack('full'))

    // Setup share button
    document
      .getElementById('shareSong')
      .addEventListener('click', () => this.shareSong())

    // Search functionality
    const searchInput = document.querySelector('.search-input')
    const searchDropdown = document.getElementById('searchDropdown')
    let searchTimeout

    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout)
      const query = e.target.value.trim()
      
      if (query.length < 2) {
        searchDropdown.classList.remove('active')
        return
      }

      searchTimeout = setTimeout(async () => {
        try {
          const response = await fetch(`/search?q=${encodeURIComponent(query)}`)
          if (!response.ok) {
            throw new Error('Search failed')
          }
          const results = await response.json()
          
          searchDropdown.innerHTML = results.map(result => `
            <div class="search-result">
              <img src="${result.thumb}" alt="${result.title}">
              <div class="search-result-info">
                <div class="search-result-title">${result.title}</div>
                <div class="search-result-artist">${result.artist}</div>
              </div>
            </div>
          `).join('')

          // Add click handlers after creating the elements
          searchDropdown.querySelectorAll('.search-result').forEach((element, index) => {
            element.addEventListener('click', async () => {
              const result = results[index]
              // Prepare song object with necessary information
              const song = {
                id: result.id,
                title: result.title,
                artist: result.artist,
                thumbnail: result.thumb,
                vocalsUrl: `songs/${result.id}/vocals.mp3`,
                musicUrl: `songs/${result.id}/no_vocals.mp3`,
                lyricsUrl: `songs/${result.id}/lyrics.json`,
                ready: false,
                progress: 0,
                status: 'processing'
              }
              
              // Add to queue
              await this.addToQueue(song)
              
              // Clear search
              searchInput.value = ''
              searchDropdown.classList.remove('active')
            })
          })
          
          searchDropdown.classList.add('active')
        } catch (error) {
          console.error('Search error:', error)
          searchDropdown.innerHTML = '<div class="search-error">Search failed. Please try again.</div>'
          searchDropdown.classList.add('active')
        }
      }, 300)
    })

    // Close search dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.search-container')) {
        searchDropdown.classList.remove('active')
      }
    })
  }

  togglePlay() {
    if (this.currentSongIndex === -1) return

    if (this.playing) {
      this.vocalsAudio.pause()
      this.playing = false
      document
        .querySelector('#playButton i')
        .classList.replace('fa-pause', 'fa-play')
    } else {
      this.vocalsAudio.play()
      this.playing = true
      this.startLyricsSync()
      document
        .querySelector('#playButton i')
        .classList.replace('fa-play', 'fa-pause')
    }
  }

  previousSong() {
    if (this.currentSongIndex > 0) {
      this.loadSong(this.currentSongIndex - 1)
    }
  }

  nextSong() {
    if (this.currentSongIndex < this.songQueue.length - 1) {
      this.loadSong(this.currentSongIndex + 1)
    }
  }

  handleSearch(e) {
    // check if enter key is pressed
    if (e.key !== 'Enter') return

    const query = e.target.value

    const dropdown = document.getElementById('searchDropdown')
    if (query.length < 2) {
      dropdown.classList.remove('active')
      return
    }
    fetch('/search?q=' + query)
      .then((response) => response.json())
      .then((data) => {
        // Show results
        dropdown.innerHTML = data
          .map(
            (song) => `
              <div class="search-result" onclick="karaokePlayer.addToQueue(${song.id})">
                  <img src="${song.thumb}" alt="${song.title}">
                  <div>
                      <div><strong>${song.title}</strong></div>
                      <div style="font-size: 0.8em; color: #666;">${song.artist}</div>
                  </div>
              </div>
          `
          )
          .join('')

        dropdown.classList.add('active')
      })
  }

  async addToQueue(song) {
    try {
      // First check if the song is already being processed
      const existingSong = this.songQueue.find(s => s.id === song.id)
      if (existingSong) {
        console.log('Song is already in queue')
        return
      }

      // Add song to queue with initial processing status
      const queueItem = {
        ...song,
        ready: false,
        status: 'processing',
        progress: 0,
        error: false
      }
      this.songQueue.push(queueItem)
      this.updateQueue()
      this.renderQueue()


      // Request song processing from the server
      const response = await fetch(`/add?id=${song.id}`)
      if (!response.ok) {
        throw new Error('Failed to process song')
      }

      // The socket listeners will handle progress updates and completion
    } catch (error) {
      console.error('Error adding song to queue:', error)
      // Update queue item to show error
      const songIndex = this.songQueue.findIndex(s => s.id === song.id)
      if (songIndex !== -1) {
        this.songQueue[songIndex].error = true
        this.songQueue[songIndex].status = 'Failed to process song'
        this.updateQueue()
      }
    }
  }

  async randomSong() {
    try {
      // Get all track IDs currently in the queue
      const queueIds = this.songQueue.map((song) => song.id)

      const response = await fetch('/random', {
        method: 'POST', // Changed to POST to send data
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          exclude_ids: queueIds,
        }),
      })
      const data = await response.json()

      if (response.ok) {
        const song = {
          id: data.track_id,
          title: data.metadata.title,
          artist: data.metadata.artist,
          thumbnail: `https://e-cdns-images.dzcdn.net/images/cover/${data.metadata.cover}/250x250-000000-80-0-0.jpg`,
          vocalsUrl: `songs/${data.track_id}/vocals.mp3`,
          musicUrl: `songs/${data.track_id}/no_vocals.mp3`,
          lyricsUrl: `songs/${data.track_id}/lyrics.json`,
          ready: true,
          progress: 100,
          status: '',
        }
        this.addToQueue(song)
      } else {
        console.error('Error getting random song:', data.error)
      }
    } catch (error) {
      console.error('Error:', error)
    }
  }

  toggleFullscreen() {
    const i = document.querySelector('#toggleFullscreen i')
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen()
      i.classList.replace('fa-expand', 'fa-compress')
    } else {
      document.exitFullscreen()
      i.classList.replace('fa-compress', 'fa-expand')
    }
  }

  async downloadTrack(type) {
    if (this.currentSongIndex === -1) return

    const song = this.songQueue[this.currentSongIndex]
    let filename, url

    switch (type) {
      case 'vocals':
        filename = `${song.artist} - ${song.title} (vocals).mp3`
        url = song.vocalsUrl
        break
      case 'music':
        filename = `${song.artist} - ${song.title} (instrumental).mp3`
        url = song.musicUrl
        break
      case 'full':
        filename = `${song.artist} - ${song.title}.mp3`
        url = `songs/${song.id}/song.mp3`
        break
    }

    try {
      const response = await fetch(url)
      const blob = await response.blob()
      const downloadUrl = window.URL.createObjectURL(blob)

      const a = document.createElement('a')
      a.href = downloadUrl
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      window.URL.revokeObjectURL(downloadUrl)

      this.showToast('Download started', 'fa-check')
    } catch (error) {
      console.error('Download failed:', error)
      this.showToast('Download failed', 'fa-times')
    }
  }

  shareSong() {
    if (this.currentSongIndex === -1) return

    const song = this.songQueue[this.currentSongIndex]
    const url = `${window.location.origin}/#song=${song.id}`

    navigator.clipboard
      .writeText(url)
      .then(() => {
        this.showToast('Link copied to clipboard', 'fa-check')
      })
      .catch((error) => {
        console.error('Failed to copy link:', error)
        this.showToast('Failed to copy link', 'fa-times')
      })
  }

  showToast(message, icon) {
    const toast = document.createElement('div')
    toast.className = 'toast'
    toast.innerHTML = `
      <i class="fas ${icon}"></i>
      ${message}
    `
    document.body.appendChild(toast)

    // Trigger reflow to enable transition
    toast.offsetHeight

    toast.classList.add('active')

    setTimeout(() => {
      toast.classList.remove('active')
      setTimeout(() => {
        document.body.removeChild(toast)
      }, 300)
    }, 3000)
  }

  async retrySong(index) {
    const song = this.songQueue[index]
    if (!song) return

    // Reset song status
    song.error = false
    song.ready = false
    song.status = 'processing'
    song.progress = 0

    this.renderQueue()

    try {
      // Request song processing from the server again
      const response = await fetch(`/add?id=${song.id}`)
      if (!response.ok) {
        throw new Error('Failed to process song')
      }
      // Socket listeners will handle the progress updates
    } catch (error) {
      console.error('Error retrying song:', error)
      song.error = true
      song.status = 'Failed to process song'
      this.renderQueue()
    }
  }

  removeSong(index) {
    // Don't allow removing the currently playing song
    if (index === this.currentSongIndex) return

    // Remove the song from the queue
    this.songQueue.splice(index, 1)

    // Update currentSongIndex if necessary
    if (index < this.currentSongIndex) {
      this.currentSongIndex--
    }

    this.renderQueue()
  }

  formatTime(seconds) {
    if (isNaN(seconds)) return '0:00'
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = Math.floor(seconds % 60)
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
  }
}

// Initialize the player when the page loads
let karaokePlayer
window.addEventListener('DOMContentLoaded', () => {
  karaokePlayer = new KaraokePlayer()
  document
    .querySelector('.progress-bar')
    .addEventListener('click', (e) => karaokePlayer.clickProgressBar(e))
  document
    .querySelector('.search-input')
    .addEventListener('keyup', karaokePlayer.handleSearch)

  // Setup profile dropdown
  const profileButton = document.getElementById('profileButton')
  const profileDropdown = document.getElementById('profileDropdown')

  profileButton.addEventListener('click', (e) => {
    e.stopPropagation()
    profileDropdown.classList.toggle('active')
  })

  document.addEventListener('click', () => {
    profileDropdown.classList.remove('active')
  })

  // Fetch user profile
  fetch('/auth/profile')
    .then((response) => response.json())
    .then((data) => {
      // Update profile button
      const profileInitials =
        document.querySelectorAll('.profile-initial')
      profileInitials.forEach((initial) => {
        initial.textContent = data.name.substring(0, 2).toUpperCase()
      })

      // Update profile name
      document
        .getElementById('profileName')
        .querySelector('span').textContent = data.name

      // Show admin button if user is admin
      if (data.is_admin) {
        document.getElementById('adminButton').style.display = 'flex'
      }
    })
    .catch((error) => console.error('Error fetching profile:', error))

  // Check for song ID in URL hash
  const hash = window.location.hash
  const songMatch = hash.match(/song=(\d+)/)
  if (songMatch) {
    const songId = songMatch[1]
    // Fetch the song metadata and add it to the queue
    fetch(`/track/${songId}`)
      .then((response) => response.json())
      .then((metadata) => {
        const song = {
          id: songId,
          title: metadata.title,
          artist: metadata.artist,
          thumbnail: `https://e-cdns-images.dzcdn.net/images/cover/${metadata.cover}/250x250-000000-80-0-0.jpg`,
          vocalsUrl: `songs/${songId}/vocals.mp3`,
          musicUrl: `songs/${songId}/no_vocals.mp3`, 
          lyricsUrl: `songs/${songId}/lyrics.json`
        }
        karaokePlayer.addToQueue(song)
      })
      .catch((error) =>
        console.error('Error loading song from URL:', error)
      )
  }
})

function debounce(func, wait) {
  let timeout
  return function (...args) {
    clearTimeout(timeout)
    timeout = setTimeout(() => func.apply(this, args), wait)
  }
}

// Theme management
function getTheme() {
  return localStorage.getItem('theme') || 'light'
}

function setTheme(theme) {
  localStorage.setItem('theme', theme)
  document.documentElement.setAttribute('data-theme', theme)
}

function toggleTheme() {
  const currentTheme = getTheme()
  const newTheme = currentTheme === 'light' ? 'dark' : 'light'
  const darkModeButton = document.getElementById('darkModeButton')
  darkModeButton.innerHTML =
    newTheme === 'light'
      ? `<i class="fas fa-moon"></i>Dark Mode`
      : `<i class="fas fa-sun"></i>Light Mode`
  setTheme(newTheme)
}

function toggleMenu() {
  document.body.classList.toggle('collapsed')
}

// Initialize theme
document.addEventListener('DOMContentLoaded', () => {
  setTheme(getTheme())
})

function logout() {
  fetch('/auth/logout', {
    method: 'POST',
    credentials: 'include',
  })
    .then((response) => {
      if (response.ok) {
        window.location.href = '/login'
      } else {
        console.error('Logout failed')
      }
    })
    .catch((error) => console.error('Error during logout:', error))
}
