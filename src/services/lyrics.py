"""Quality checks for locally transcribed word-timed lyrics."""
import logging
from difflib import SequenceMatcher

logger = logging.getLogger(__name__)


def _extract_text(output):
    """Concatenate all word tokens from WhisperX output into a single string."""
    if not isinstance(output, dict):
        return ""
    words = []
    for seg in output.get("segments", []):
        for w in seg.get("words", []):
            text = w.get("word", "").strip()
            if text:
                words.append(text)
    return " ".join(words)

def _is_bad_output(output, reference_lines=None):
    """Detect if transcription output is broken (character-level or wrong content).

    Checks:
    1. Empty segments (no words transcribed at all)
    2. Character-level tokenization (>50% single-char 'words')
    3. If reference lyrics provided, low text similarity to reference
    """
    if not isinstance(output, dict):
        return False
    segments = output.get("segments", [])
    total = 0
    single = 0
    for seg in segments:
        for w in seg.get("words", []):
            text = w.get("word", "").strip()
            if text:
                total += 1
                if len(text) <= 1:
                    single += 1

    # Empty transcription — no words at all
    if total == 0:
        logger.warning("Empty transcription — no words detected")
        return True

    # Character-level check
    if total > 10 and single / total > 0.5:
        logger.warning("Character-level tokenization detected (%d/%d single-char words)", single, total)
        return True

    # Cross-check against reference lyrics (lrclib)
    if reference_lines and total > 10:
        asr_text = _extract_text(output).lower()
        ref_text = " ".join(reference_lines).lower()
        # Repeated words and spaces are normal in songs. The default heuristic
        # discards frequent characters in long lyrics and can reject a near match.
        similarity = SequenceMatcher(None, asr_text, ref_text, autojunk=False).ratio()
        if similarity < 0.3:
            logger.warning("Transcription doesn't match reference lyrics (similarity: %.2f)", similarity)
            return True

    return False
