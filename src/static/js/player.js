class KaraokePlayer {
  constructor() {
    // Initialize Web Audio API context
    this.audioContext = new (window.AudioContext || window.webkitAudioContext)()

    // Create audio elements
    this.vocalsAudio = new Audio()
    this.musicAudio = new Audio()

    // Create audio sources and gain nodes
    this.vocalsSource = null
    this.musicSource = null
    this.vocalsGain = this.audioContext.createGain()
    this.musicGain = this.audioContext.createGain()

    // Connect gain nodes to destination
    this.vocalsGain.connect(this.audioContext.destination)
    this.musicGain.connect(this.audioContext.destination)

    // Set initial volumes
    this.vocalsGain.gain.value = 1
    this.musicGain.gain.value = 1

    this.lyrics = null
    this.playing = false
    this.currentWordIndex = 0
    this.currentSongIndex = -1
    this.hasUserInteracted = false
    this.pollingInterval = null
    this.playedTrackIds = new Set()

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

    // Start polling for track status updates
    this.startStatusPolling()

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

  startStatusPolling() {
    // Do first check immediately
    setTimeout(() => {
      this.checkTrackStatus()
    }, 1000)

    // Poll every 5 seconds for track status updates
    this.pollingInterval = setInterval(() => {
      this.checkTrackStatus()
    }, 5000)
  }

  stopStatusPolling() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval)
      this.pollingInterval = null
    }
  }

  async checkTrackStatus() {
    // Only check if we have songs in the queue that are not yet ready
    const unreadySongs = this.songQueue.filter(
      (song) => !song.ready && !song.error
    )
    if (unreadySongs.length === 0) return

    try {
      // Fetch status for all tracks in the queue
      const response = await fetch('/track/status')
      if (!response.ok) {
        throw new Error('Failed to fetch track status')
      }

      const data = await response.json()

      // Update each track's status
      for (const trackInfo of data.tracks) {
        const song = this.songQueue.find((s) => s.id == trackInfo.track_id)
        if (song) {
          song.ready = trackInfo.progress === 100
          song.progress = trackInfo.progress
          song.status = trackInfo.status

          // If the track has an error status, mark it as an error
          if (trackInfo.status === 'error') {
            song.error = true
          }
        }
      }

      // Also check for completed tracks that might not be in the processing queue anymore
      for (const song of unreadySongs) {
        const trackFound = data.tracks.some((t) => t.track_id == song.id)
        if (!trackFound) {
          // If the track is not in the queue, check if it's completed
          try {
            const trackResponse = await fetch(`/track/status?id=${song.id}`)
            if (trackResponse.ok) {
              const trackData = await trackResponse.json()
              if (trackData.status === 'complete') {
                song.ready = true
                song.progress = 100
                song.status = 'complete'
              }
            }
          } catch (e) {
            console.error(`Error checking status for track ${song.id}:`, e)
          }
        }
      }

      // Update the UI
      this.updateQueue()
    } catch (error) {
      console.error('Error checking track status:', error)
    }
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

      // Scroll the first line into view
      const firstLine = document.querySelector('.skeleton-line')
      if (firstLine) {
        firstLine.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        })
      }

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
    if (isNaN(time) || time < 0) {
      console.warn('Invalid time value:', time)
      return
    }

    this.seekToTime(time)

    // Start playing if not already playing
    if (!this.playing) {
      this.togglePlay()
    }
  }

  clickProgressBar(e) {
    const rect = this.progressBar.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const barWidth = rect.width
    let progress = clickX / barWidth

    // Clamp progress between 0 and 1
    progress = Math.max(0, Math.min(1, progress))

    // Update progress and seek to position
    const duration = this.vocalsAudio.duration
    if (isNaN(duration) || duration === 0) {
      console.warn('Audio duration not available yet')
      return
    }

    const seekTime = duration * progress
    this.seekToTime(seekTime)
  }

  seekToTime(time) {
    // Pause both tracks to ensure sync
    const wasPlaying = this.playing
    if (wasPlaying) {
      this.vocalsAudio.pause()
      this.musicAudio.pause()
    }

    // Set the time on both tracks
    this.vocalsAudio.currentTime = time
    this.musicAudio.currentTime = time

    // Resume playback if it was playing, ensuring both start together
    if (wasPlaying) {
      // Use Promise.all to start both at the same time
      Promise.all([
        this.vocalsAudio.play(),
        this.musicAudio.play()
      ]).catch(error => {
        console.error('Error resuming playback after seek:', error)
      })
    }
  }

  startLyricsSync() {
    const checkTime = () => {
      if (!this.playing) return

      const currentTime = this.vocalsAudio.currentTime
      const duration = this.vocalsAudio.duration

      // Update progress bar and time displays
      const progress = (currentTime / duration) * 100
      document.getElementById('progress').style.width = `${progress}%`
      document.getElementById('currentTime').textContent =
        this.formatTime(currentTime)
      document.getElementById('totalTime').textContent =
        this.formatTime(duration)

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
        const lineElement = document.getElementById(`line-${segmentIndex}`)

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
    if (index === null || index < 0 || index >= this.songQueue.length) return

    this.currentSongIndex = index
    const song = this.songQueue[index]

    // Enable download and share buttons
    document.getElementById('downloadButton').disabled = false
    document.getElementById('shareSong').disabled = false

    // Update URL hash with current song ID
    window.location.hash = `song=${song.id}`

    this.updateQueueHighlight()

    // Reset player state
    this.playing = false

    // Disconnect and clean up old audio elements and sources
    if (this.vocalsSource) {
      this.vocalsSource.disconnect()
      this.vocalsSource = null
    }
    if (this.musicSource) {
      this.musicSource.disconnect()
      this.musicSource = null
    }

    // Create new audio elements
    this.vocalsAudio.pause()
    this.musicAudio.pause()
    const newVocalsAudio = new Audio()
    const newMusicAudio = new Audio()

    // Set the sources
    newVocalsAudio.src = song.vocalsUrl
    newMusicAudio.src = song.musicUrl

    // Replace old audio elements
    this.vocalsAudio = newVocalsAudio
    this.musicAudio = newMusicAudio

    // Setup event listeners for new audio elements
    this.setupAudioEventListeners()

    // Create new audio sources and connect them
    this.vocalsSource = this.audioContext.createMediaElementSource(
      this.vocalsAudio
    )
    this.musicSource = this.audioContext.createMediaElementSource(
      this.musicAudio
    )
    this.vocalsSource.connect(this.vocalsGain)
    this.musicSource.connect(this.musicGain)

    document
      .querySelector('#playButton i')
      .classList.replace('fa-pause', 'fa-play')

    // Reset progress bar and time displays
    document.getElementById('progress').style.width = '0'
    document.getElementById('currentTime').textContent = '0:00'
    document.getElementById('totalTime').textContent = '0:00'

    // Add event listener for duration change to update total time immediately when available
    this.vocalsAudio.addEventListener(
      'loadedmetadata',
      () => {
        document.getElementById('totalTime').textContent = this.formatTime(
          this.vocalsAudio.duration
        )
      },
      { once: true }
    )

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
                 }"
                 draggable="true"
                 data-index="${index}">
                <i class="fas fa-grip-vertical queue-drag-handle"></i>
                <img src="${song.thumbnail}" alt="${song.title}">
                <div class="queue-item-content">
                    <div>${song.title}</div>
                    <div style="font-size: 0.8em">${song.artist}</div>
                    <div class="queue-status">${this.getStatus(song)}</div>
                </div>
                <div class="queue-item-controls">
                    ${
                      song.error
                        ? `<button class="queue-control-btn retry-btn" title="Retry" onclick="window.karaokePlayer.retrySong(${index})">
                        <i class="fas fa-redo"></i>
                       </button>`
                        : ''
                    }
                    ${
                      index !== this.currentSongIndex
                        ? `<button class="queue-control-btn remove-btn" title="Remove" onclick="window.karaokePlayer.removeSong(${index})">
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

    // Update queue count
    const queueCountEl = document.getElementById('queueCount')
    if (queueCountEl) {
      queueCountEl.textContent = `(${this.songQueue.length})`
    }

    this.updateQueue()
    this.attachDragAndDropListeners()
  }

  getStatus(song) {
    if (!song.status) return ''

    const statusMap = {
      loading: 'Loading...',
      starting: 'Starting...',
      downloading: 'Downloading...',
      downloaded: 'Downloaded',
      splitting: 'Splitting audio...',
      extracting_lyrics: 'Extracting lyrics...',
      lyrics_extracted: 'Lyrics extracted...',
      chunking_lyrics: 'Chunking lyrics...',
      merging_lyrics: 'Merging lyrics...',
      lyrics_complete: 'Lyrics complete',
      lyrics_split: 'Lyrics split',
      error: 'Error processing track',
      complete: 'Complete',
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
        const existingProgress = queueItem.querySelector('.progress-overlay')
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

  setupAudioEventListeners() {
    // Keep audio tracks synchronized
    this.vocalsAudio.addEventListener('play', () => this.musicAudio.play())
    this.vocalsAudio.addEventListener('pause', () => this.musicAudio.pause())
    this.vocalsAudio.addEventListener('ended', () => this.nextSong())
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

    document.getElementById('vocalsVolume').addEventListener('input', (e) => {
      this.vocalsGain.gain.value = e.target.value
      // Update volume display
      const volumeValue = document.getElementById('vocalsVolumeValue')
      if (volumeValue) {
        volumeValue.textContent = `${Math.round(e.target.value * 100)}%`
      }
    })

    document.getElementById('musicVolume').addEventListener('input', (e) => {
      this.musicGain.gain.value = e.target.value
      // Update volume display
      const volumeValue = document.getElementById('musicVolumeValue')
      if (volumeValue) {
        volumeValue.textContent = `${Math.round(e.target.value * 100)}%`
      }
    })

    // Setup queue management buttons
    document.getElementById('shuffleQueue')?.addEventListener('click', () => {
      this.shuffleQueue()
    })

    document.getElementById('clearQueue')?.addEventListener('click', () => {
      this.clearQueue()
    })

    // Setup initial audio event listeners
    this.setupAudioEventListeners()

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
    const searchClear = document.getElementById('searchClear')
    const searchIcon = document.getElementById('searchIcon')
    const searchSpinner = document.getElementById('searchSpinner')
    let searchTimeout

    // Search clear button
    if (searchClear) {
      searchClear.addEventListener('click', () => {
        searchInput.value = ''
        searchClear.style.display = 'none'
        searchDropdown.classList.remove('active')
        searchInput.focus()
      })
    }

    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout)
      const query = e.target.value.trim()

      // Show/hide clear button
      if (searchClear) {
        searchClear.style.display = query.length > 0 ? 'block' : 'none'
      }

      if (query.length < 2) {
        searchDropdown.classList.remove('active')
        // Hide spinner, show search icon
        if (searchSpinner) searchSpinner.style.display = 'none'
        if (searchIcon) searchIcon.style.display = 'block'
        return
      }

      // Show spinner, hide search icon
      if (searchSpinner) searchSpinner.style.display = 'block'
      if (searchIcon) searchIcon.style.display = 'none'

      searchTimeout = setTimeout(async () => {
        try {
          const response = await fetch(`/search?q=${encodeURIComponent(query)}`)
          if (!response.ok) {
            throw new Error('Search failed')
          }
          const results = await response.json()

          // Hide spinner, show search icon
          if (searchSpinner) searchSpinner.style.display = 'none'
          if (searchIcon) searchIcon.style.display = 'block'

          searchDropdown.innerHTML = results
            .map(
              (result) => `
            <div class="search-result">
              <img src="${result.thumb}" alt="${result.title}">
              <div class="search-result-info">
                <div class="search-result-title">${result.title}</div>
                <div class="search-result-artist">${result.artist}</div>
              </div>
            </div>
          `
            )
            .join('')

          // Add click handlers after creating the elements
          searchDropdown
            .querySelectorAll('.search-result')
            .forEach((element, index) => {
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
                  status: 'processing',
                }

                // Add to queue
                await window.karaokePlayer.addToQueue(song)

                // Clear search
                searchInput.value = ''
                searchDropdown.classList.remove('active')
              })
            })

          searchDropdown.classList.add('active')
        } catch (error) {
          console.error('Search error:', error)
          // Hide spinner, show search icon
          if (searchSpinner) searchSpinner.style.display = 'none'
          if (searchIcon) searchIcon.style.display = 'block'
          searchDropdown.innerHTML =
            '<div class="search-error">Search failed. Please try again.</div>'
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

    // Resume audio context if it's suspended (browser autoplay policy)
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume()
    }

    if (this.playing) {
      this.vocalsAudio.pause()
      this.musicAudio.pause()
      this.playing = false
      document
        .querySelector('#playButton i')
        .classList.replace('fa-pause', 'fa-play')
    } else {
      Promise.all([this.vocalsAudio.play(), this.musicAudio.play()])
        .then(() => {
          this.playing = true
          this.startLyricsSync()
          document
            .querySelector('#playButton i')
            .classList.replace('fa-play', 'fa-pause')

          // Log first play for this track (once per track)
          const currentSong = this.songQueue[this.currentSongIndex]
          if (currentSong && !this.playedTrackIds.has(currentSong.id)) {
            fetch('/play', {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ track_id: currentSong.id }),
            }).catch((err) => console.error('Error logging play:', err))
            this.playedTrackIds.add(currentSong.id)
          }
        })
        .catch((error) => {
          console.error('Error playing audio:', error)
        })
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

  async addToQueue(song, skipProcessing = false) {
    try {
      // First check if the song is already being processed
      const existingSong = this.songQueue.find((s) => s.id === song.id)
      if (existingSong) {
        console.log('Song is already in queue')
        return
      }

      // If skipProcessing is true, add as ready (for library songs)
      if (skipProcessing) {
        const queueItem = {
          ...song,
          ready: true,
          status: 'ready',
          progress: 100,
          error: false,
        }
        this.songQueue.push(queueItem)
        this.updateQueue()
        this.renderQueue()
        return
      }

      // Add song to queue with initial processing status
      const queueItem = {
        ...song,
        ready: false,
        status: 'processing',
        progress: 0,
        error: false,
      }
      this.songQueue.push(queueItem)
      this.updateQueue()
      this.renderQueue()

      // Request song processing from the server
      const response = await fetch(`/add?id=${song.id}`)
      if (!response.ok) {
        throw new Error('Failed to process song')
      }

      // Status updates will be handled by the polling mechanism
    } catch (error) {
      console.error('Error adding song to queue:', error)
      // Update queue item to show error
      const songIndex = this.songQueue.findIndex((s) => s.id === song.id)
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

  shuffleQueue() {
    if (this.songQueue.length <= 1) return

    // Save the currently playing song
    const currentSong =
      this.currentSongIndex !== -1
        ? this.songQueue[this.currentSongIndex]
        : null

    // Remove current song from shuffle
    let songsToShuffle = this.songQueue.filter(
      (_, index) => index !== this.currentSongIndex
    )

    // Fisher-Yates shuffle
    for (let i = songsToShuffle.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[songsToShuffle[i], songsToShuffle[j]] = [
        songsToShuffle[j],
        songsToShuffle[i],
      ]
    }

    // Rebuild queue with current song at the same position
    if (currentSong) {
      songsToShuffle.splice(this.currentSongIndex, 0, currentSong)
      this.songQueue = songsToShuffle
    } else {
      this.songQueue = songsToShuffle
      this.currentSongIndex = -1
    }

    this.renderQueue()
    this.showToast('Queue shuffled', 'success')
  }

  clearQueue() {
    if (this.songQueue.length === 0) return

    // Confirm before clearing
    if (!confirm('Are you sure you want to clear the queue?')) return

    // Keep only the currently playing song
    if (this.currentSongIndex !== -1) {
      const currentSong = this.songQueue[this.currentSongIndex]
      this.songQueue = [currentSong]
      this.currentSongIndex = 0
    } else {
      this.songQueue = []
      this.currentSongIndex = -1
    }

    this.renderQueue()
    this.showToast('Queue cleared', 'success')
  }

  attachDragAndDropListeners() {
    const queueItems = document.querySelectorAll('.queue-item')
    
    queueItems.forEach((item) => {
      item.addEventListener('dragstart', (e) => this.handleDragStart(e))
      item.addEventListener('dragover', (e) => this.handleDragOver(e))
      item.addEventListener('drop', (e) => this.handleDrop(e))
      item.addEventListener('dragenter', (e) => this.handleDragEnter(e))
      item.addEventListener('dragleave', (e) => this.handleDragLeave(e))
      item.addEventListener('dragend', (e) => this.handleDragEnd(e))
    })
  }

  handleDragStart(e) {
    const item = e.currentTarget
    const index = parseInt(item.dataset.index)
    
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/html', item.innerHTML)
    e.dataTransfer.setData('text/plain', index.toString())
    
    item.classList.add('dragging')
    this.draggedIndex = index
  }

  handleDragOver(e) {
    if (e.preventDefault) {
      e.preventDefault()
    }
    
    e.dataTransfer.dropEffect = 'move'
    return false
  }

  handleDragEnter(e) {
    const item = e.currentTarget
    if (!item.classList.contains('dragging')) {
      item.classList.add('drag-over')
    }
  }

  handleDragLeave(e) {
    const item = e.currentTarget
    item.classList.remove('drag-over')
  }

  handleDrop(e) {
    if (e.stopPropagation) {
      e.stopPropagation()
    }
    
    e.preventDefault()
    
    const dropTarget = e.currentTarget
    const dropIndex = parseInt(dropTarget.dataset.index)
    
    if (this.draggedIndex !== dropIndex && this.draggedIndex !== undefined) {
      this.reorderQueue(this.draggedIndex, dropIndex)
    }
    
    dropTarget.classList.remove('drag-over')
    return false
  }

  handleDragEnd(e) {
    const item = e.currentTarget
    item.classList.remove('dragging')
    
    // Remove drag-over class from all items
    document.querySelectorAll('.queue-item').forEach((item) => {
      item.classList.remove('drag-over')
    })
    
    this.draggedIndex = undefined
  }

  reorderQueue(fromIndex, toIndex) {
    // Remove the item from the old position
    const [movedSong] = this.songQueue.splice(fromIndex, 1)
    
    // Insert it at the new position
    this.songQueue.splice(toIndex, 0, movedSong)
    
    // Update currentSongIndex if necessary
    if (fromIndex === this.currentSongIndex) {
      // The currently playing song was moved
      this.currentSongIndex = toIndex
    } else if (fromIndex < this.currentSongIndex && toIndex >= this.currentSongIndex) {
      // A song before the current song was moved to after it
      this.currentSongIndex--
    } else if (fromIndex > this.currentSongIndex && toIndex <= this.currentSongIndex) {
      // A song after the current song was moved to before it
      this.currentSongIndex++
    }
    
    this.renderQueue()
  }

  showToast(message, type = 'success') {
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
      <span>${this.escapeHtml(message)}</span>
    `

    toastContainer.appendChild(toast)

    // Auto remove after 3 seconds
    setTimeout(() => {
      toast.style.animation = 'fadeOut 0.3s ease forwards'
      setTimeout(() => toast.remove(), 300)
    }, 3000)
  }

  escapeHtml(text) {
    const div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
  }

  formatTime(seconds) {
    if (isNaN(seconds)) return '0:00'
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = Math.floor(seconds % 60)
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`
  }
}

// Initialize the player when the page loads
window.addEventListener('DOMContentLoaded', () => {
  window.karaokePlayer = new KaraokePlayer()

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
      const profileInitials = document.querySelectorAll('.profile-initial')
      profileInitials.forEach((initial) => {
        initial.textContent = data.name.substring(0, 2).toUpperCase()
      })

      // Update profile name
      document.getElementById('profileName').querySelector('span').textContent =
        data.name

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
          lyricsUrl: `songs/${songId}/lyrics.json`,
        }
        window.karaokePlayer.addToQueue(song)
      })
      .catch((error) => console.error('Error loading song from URL:', error))
  }
})

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
