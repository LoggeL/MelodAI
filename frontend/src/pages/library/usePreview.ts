import { useCallback, useEffect, useRef, useState } from 'react'
import { useToast } from '../../hooks/useToast'

/** Own the audio lifetime, including rapid switches and rejected play promises. */
export function usePreview() {
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [previewProgress, setPreviewProgress] = useState(0)
  const [previewVolume, setPreviewVolume] = useState(80)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const playingIdRef = useRef<string | null>(null)
  const volumeRef = useRef(previewVolume)
  const toast = useToast()

  const stopPreview = useCallback(() => {
    const audio = audioRef.current
    audioRef.current = null
    playingIdRef.current = null
    if (audio) {
      audio.pause()
      audio.onended = null
      audio.onerror = null
      audio.ontimeupdate = null
      audio.onloadedmetadata = null
      audio.removeAttribute('src')
      audio.load()
    }
    setPreviewId(null)
    setPreviewProgress(0)
  }, [])

  const togglePreview = useCallback((id: string) => {
    const wasPlaying = playingIdRef.current === id
    stopPreview()
    if (wasPlaying) return
    const audio = new Audio(`/songs/${encodeURIComponent(id)}/song.mp3`)
    audioRef.current = audio
    playingIdRef.current = id
    audio.volume = volumeRef.current / 100
    let start = 0
    audio.onloadedmetadata = () => {
      if (audioRef.current !== audio) return
      start = audio.duration > 60 ? 30 : 0
      audio.currentTime = start
    }
    audio.ontimeupdate = () => {
      if (audioRef.current !== audio) return
      const duration = Number.isFinite(audio.duration) ? Math.min(30, audio.duration - start) : 30
      const elapsed = Math.max(0, audio.currentTime - start)
      setPreviewProgress(duration > 0 ? Math.min(100, elapsed / duration * 100) : 0)
      if (elapsed >= 30) stopPreview()
    }
    audio.onended = stopPreview
    const failed = () => {
      if (audioRef.current !== audio) return
      stopPreview()
      toast.error('Could not play this preview. Please try again.')
    }
    audio.onerror = failed
    setPreviewId(id)
    void audio.play().catch(failed)
  }, [stopPreview, toast])

  useEffect(() => {
    volumeRef.current = previewVolume
    if (audioRef.current) audioRef.current.volume = previewVolume / 100
  }, [previewVolume])

  useEffect(() => () => {
    const audio = audioRef.current
    audioRef.current = null
    if (audio) {
      audio.onended = null
      audio.onerror = null
      audio.ontimeupdate = null
      audio.onloadedmetadata = null
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
  }, [])

  return { previewId, previewProgress, previewVolume, setPreviewVolume, togglePreview, stopPreview }
}
