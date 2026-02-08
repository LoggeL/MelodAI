import string
from collections import Counter
from difflib import SequenceMatcher


def merge_lyrics(segments):
    """Merge WhisperX output into our lyrics format with word-level timing and speakers."""
    merged = []
    for seg in segments:
        words = seg.get("words", [])
        if not words:
            continue

        speaker = seg.get("speaker", "SPEAKER_00")
        processed_words = []
        for w in words:
            start = w.get("start")
            end = w.get("end")
            word_text = w.get("word", "").strip()
            if not word_text:
                continue
            if start is None:
                start = seg.get("start", 0)
            if end is None:
                end = seg.get("end", start + 0.1)
            word_dict = {
                "word": word_text,
                "start": round(start, 3),
                "end": round(end, 3),
                "speaker": speaker,
            }
            score = w.get("score")
            if score is not None:
                word_dict["score"] = score
            processed_words.append(word_dict)

        if processed_words:
            merged.append({
                "start": processed_words[0]["start"],
                "end": processed_words[-1]["end"],
                "words": processed_words,
                "speaker": speaker,
            })

    return {"segments": merged}


def _normalize_word(text):
    """Strip punctuation and lowercase for fuzzy matching."""
    return text.strip().lower().translate(str.maketrans("", "", string.punctuation))


def _flatten_raw_words(segments):
    """Extract all words from WhisperX segments into a flat list with timestamps.

    Handles missing start/end times the same way merge_lyrics does.
    """
    flat = []
    for seg in segments:
        words = seg.get("words", [])
        speaker = seg.get("speaker", "SPEAKER_00")
        for w in words:
            word_text = w.get("word", "").strip()
            if not word_text:
                continue
            start = w.get("start")
            end = w.get("end")
            if start is None:
                start = seg.get("start", 0)
            if end is None:
                end = seg.get("end", start + 0.1)
            word_dict = {
                "word": word_text,
                "start": round(start, 3),
                "end": round(end, 3),
                "speaker": speaker,
            }
            score = w.get("score")
            if score is not None:
                word_dict["score"] = score
            flat.append(word_dict)
    return flat


def _majority_speaker(words):
    """Return the most common speaker label among a list of words."""
    if not words:
        return "SPEAKER_00"
    counts = Counter(w.get("speaker", "SPEAKER_00") for w in words)
    return counts.most_common(1)[0][0]


def _make_segment(words):
    """Build a segment dict from a list of word dicts."""
    return {
        "start": words[0]["start"],
        "end": words[-1]["end"],
        "words": words,
        "speaker": _majority_speaker(words),
    }


def _split_segment_at_gaps(words, max_words=8):
    """Recursively split a word list into segments of at most max_words.

    Splits at the largest timing gap near the middle of the word list.
    Returns a list of word-lists (each will become one segment).
    """
    if len(words) <= max_words:
        return [words]

    # Find the biggest timing gap in the middle third
    third = max(1, len(words) // 3)
    search_start = max(1, third)
    search_end = min(len(words) - 1, 2 * third)

    best_split = len(words) // 2
    best_gap = -1
    for j in range(search_start, search_end):
        gap = words[j].get("start", 0) - words[j - 1].get("end", 0)
        if gap > best_gap:
            best_gap = gap
            best_split = j

    left = words[:best_split]
    right = words[best_split:]

    # Recurse on both halves
    return _split_segment_at_gaps(left, max_words) + _split_segment_at_gaps(right, max_words)


def _split_long_lines_basic(lyrics_data):
    """Split segments with >8 words at timing gaps (recursive)."""
    segments = lyrics_data.get("segments", [])
    new_segments = []
    for seg in segments:
        words = seg.get("words", [])
        if len(words) <= 8:
            new_segments.append(seg)
            continue

        for word_group in _split_segment_at_gaps(words, max_words=8):
            if word_group:
                new_segments.append(_make_segment(word_group))

    return {"segments": new_segments}


def _split_at_speaker_changes(segments):
    """Split any segment where the speaker changes mid-segment."""
    result = []
    for seg in segments:
        words = seg.get("words", [])
        if not words:
            continue

        current_group = [words[0]]
        for w in words[1:]:
            if w.get("speaker") != current_group[-1].get("speaker"):
                result.append(_make_segment(current_group))
                current_group = [w]
            else:
                current_group.append(w)

        if current_group:
            result.append(_make_segment(current_group))

    return result


def _merge_tiny_segments(segments, min_words=2, max_gap=0.5):
    """Merge segments with fewer than min_words into adjacent segments when gap is small."""
    if len(segments) <= 1:
        return segments

    result = list(segments)
    changed = True
    while changed:
        changed = False
        new_result = []
        i = 0
        while i < len(result):
            seg = result[i]
            words = seg.get("words", [])

            if len(words) < min_words:
                merged = False

                # Try merging with previous segment
                if new_result:
                    prev = new_result[-1]
                    prev_words = prev.get("words", [])
                    gap_to_prev = words[0].get("start", 0) - prev_words[-1].get("end", 0)
                    if gap_to_prev < max_gap and prev.get("speaker") == seg.get("speaker"):
                        combined = prev_words + words
                        new_result[-1] = _make_segment(combined)
                        merged = True
                        changed = True

                # Try merging with next segment
                if not merged and i + 1 < len(result):
                    nxt = result[i + 1]
                    nxt_words = nxt.get("words", [])
                    gap_to_next = nxt_words[0].get("start", 0) - words[-1].get("end", 0)
                    if gap_to_next < max_gap and nxt.get("speaker") == seg.get("speaker"):
                        combined = words + nxt_words
                        new_result.append(_make_segment(combined))
                        i += 1  # skip next since we consumed it
                        merged = True
                        changed = True

                if not merged:
                    new_result.append(seg)
            else:
                new_result.append(seg)
            i += 1
        result = new_result

    return result


def _tokenize_provider(ref_lines):
    """Tokenize provider lyrics into a flat list of (normalized, raw_text, line_idx) tuples."""
    tokens = []
    for line_idx, line in enumerate(ref_lines):
        for word in line.split():
            word = word.strip()
            if word:
                tokens.append((_normalize_word(word), word, line_idx))
    return tokens


def _word_similarity(a, b):
    """Similarity between two normalized words. 0.0 = no match, 1.0 = exact."""
    if a == b:
        return 1.0
    if not a or not b:
        return 0.0
    # Use SequenceMatcher ratio for fuzzy matching
    return SequenceMatcher(None, a, b).ratio()


def _align_provider_tokens(asr_normalized, provider_tokens):
    """Align provider tokens to ASR words using Needleman-Wunsch global alignment.

    Returns a list of (asr_idx | None, provider_idx | None) pairs.
    Each pair maps an ASR word to a provider token. None on either side
    means an insertion/deletion (gap).

    Also returns an alignment quality score (0.0 to 1.0).
    """
    n = len(asr_normalized)
    m = len(provider_tokens)

    if n == 0 or m == 0:
        return [], 0.0

    provider_normalized = [t[0] for t in provider_tokens]

    # Scoring parameters
    MATCH_BONUS = 2.0
    MISMATCH_PENALTY = -1.0
    GAP_PENALTY = -0.5

    # Build score matrix with Needleman-Wunsch
    # dp[i][j] = best score aligning asr[:i] with provider[:j]
    dp = [[0.0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        dp[i][0] = dp[i - 1][0] + GAP_PENALTY
    for j in range(1, m + 1):
        dp[0][j] = dp[0][j - 1] + GAP_PENALTY

    for i in range(1, n + 1):
        for j in range(1, m + 1):
            sim = _word_similarity(asr_normalized[i - 1], provider_normalized[j - 1])
            if sim >= 0.6:
                match_score = MATCH_BONUS * sim
            else:
                match_score = MISMATCH_PENALTY

            dp[i][j] = max(
                dp[i - 1][j - 1] + match_score,  # align
                dp[i - 1][j] + GAP_PENALTY,       # gap in provider
                dp[i][j - 1] + GAP_PENALTY,       # gap in ASR
            )

    # Traceback
    alignment = []
    i, j = n, m
    while i > 0 or j > 0:
        if i > 0 and j > 0:
            sim = _word_similarity(asr_normalized[i - 1], provider_normalized[j - 1])
            match_score = MATCH_BONUS * sim if sim >= 0.6 else MISMATCH_PENALTY
            if dp[i][j] == dp[i - 1][j - 1] + match_score:
                alignment.append((i - 1, j - 1, sim))
                i -= 1
                j -= 1
                continue
        if i > 0 and dp[i][j] == dp[i - 1][j] + GAP_PENALTY:
            alignment.append((i - 1, None, 0.0))
            i -= 1
        else:
            alignment.append((None, j - 1, 0.0))
            j -= 1

    alignment.reverse()

    # Compute quality score: ratio of well-matched pairs
    matched_pairs = [(a, p, s) for a, p, s in alignment if a is not None and p is not None]
    if not matched_pairs:
        return alignment, 0.0

    good_matches = sum(1 for _, _, s in matched_pairs if s >= 0.6)
    quality = good_matches / max(n, m)

    return alignment, quality


def _extract_line_breaks_from_alignment(alignment, provider_tokens, quality):
    """Extract reference line break positions mapped to ASR word indices.

    Walks the alignment and identifies ASR word indices where a new reference line
    starts. Only considers well-matched pairs (sim >= 0.6). Returns an empty
    list if alignment quality is below 0.4.

    Returns a sorted list of ASR word indices where new lines begin.
    """
    MIN_QUALITY = 0.4

    if quality < MIN_QUALITY:
        return []

    # Map each ASR word to its best-matched reference line index
    asr_to_line = {}
    for asr_idx, prov_idx, sim in alignment:
        if asr_idx is None or prov_idx is None:
            continue
        if sim < 0.6:
            continue
        asr_to_line[asr_idx] = provider_tokens[prov_idx][2]  # line_idx

    if not asr_to_line:
        return []

    # Walk ASR words in order, detect where the reference line changes
    sorted_asr_indices = sorted(asr_to_line.keys())
    line_breaks = []
    prev_line = None
    for asr_idx in sorted_asr_indices:
        cur_line = asr_to_line[asr_idx]
        if prev_line is not None and cur_line != prev_line:
            line_breaks.append(asr_idx)
        prev_line = cur_line

    return line_breaks


def _context_supports_rewrite(alignment, align_idx, quality, window=3, min_quality=0.55, min_ratio=0.6):
    """Check if surrounding alignment context supports trusting a low-similarity rewrite.

    When ASR produces a word that is textually very different from the provider
    word (e.g. "Pläne" vs "Fans"), the text similarity is too low for a direct
    match. But if the overall alignment quality is decent and surrounding words
    match well, we can trust that the alignment is correct and the provider word
    should replace the ASR word.
    """
    if quality < min_quality:
        return False

    good = 0
    total = 0
    for offset in range(-window, window + 1):
        if offset == 0:
            continue
        idx = align_idx + offset
        if 0 <= idx < len(alignment):
            a, p, s = alignment[idx]
            if a is not None and p is not None:
                total += 1
                if s >= 0.6:
                    good += 1

    return total >= 2 and good / total >= min_ratio


def _rewrite_with_provider(raw_segments, asr_words, alignment, provider_tokens, quality):
    """Rewrite ASR words with provider text (aggressive policy).

    Only rewrites if alignment quality is above threshold.
    Preserves all timing and speaker data from ASR.
    """
    MIN_QUALITY = 0.4  # minimum global alignment quality to apply corrections

    if quality < MIN_QUALITY:
        print(f"Reference correction: skipped (alignment quality {quality:.2f} < {MIN_QUALITY})")
        return raw_segments

    corrections = 0
    context_corrections = 0
    for align_idx, (asr_idx, prov_idx, sim) in enumerate(alignment):
        if asr_idx is None or prov_idx is None:
            continue  # gap — nothing to rewrite

        seg_idx, word_idx, w = asr_words[asr_idx]
        original = w["word"]
        provider_text = provider_tokens[prov_idx][1]  # raw text from provider

        # Only rewrite if similarity is decent (avoid wild mismatches)
        # For exact normalized matches (sim=1.0), always apply (fixes casing/spelling)
        # For fuzzy matches (sim>=0.6), apply the provider's version
        # For low-similarity pairs, trust the provider if surrounding context matches well
        if sim < 0.6:
            if not _context_supports_rewrite(alignment, align_idx, quality):
                continue
            context_corrections += 1

        # Transfer trailing punctuation from ASR to provider text
        asr_stripped = original.rstrip(string.punctuation)
        asr_trailing = original[len(asr_stripped):]
        prov_stripped = provider_text.rstrip(string.punctuation)
        prov_trailing = provider_text[len(prov_stripped):]

        # Use provider punctuation if it has any, otherwise keep ASR punctuation
        if prov_trailing:
            corrected = provider_text
        elif asr_trailing:
            corrected = prov_stripped + asr_trailing
        else:
            corrected = prov_stripped

        # Match casing of original when the provider word is title-cased
        # but the ASR word was all lowercase (common with line-initial words)
        if (corrected[0].isupper() and original[0].islower()
                and not corrected[1:2].isupper()):  # not an acronym
            corrected = corrected[0].lower() + corrected[1:]

        if original != corrected:
            raw_segments[seg_idx]["words"][word_idx]["word"] = corrected
            corrections += 1

    print(f"Reference correction: {corrections} words corrected out of {len(asr_words)} "
          f"({context_corrections} context-trusted, alignment quality: {quality:.2f})")

    # Update segment-level text field if present
    for seg in raw_segments:
        words = seg.get("words", [])
        if words and "text" in seg:
            seg["text"] = " ".join(w.get("word", "") for w in words)

    return raw_segments


def _remove_compound_fragments(raw_segments, asr_words, asr_normalized, alignment, provider_tokens):
    """Remove ASR word fragments from incorrectly split compound words.

    When WhisperX splits a compound word like 'Gleitsichtbrille' into
    'Kleid, Schicht, Brille', alignment matches 'Brille' to 'Gleitsichtbrille'
    and leaves 'Kleid', 'Schicht' as unmatched gaps. This function detects
    such cases by checking if the concatenation of gap fragments + the matched
    ASR word approximates the provider word, and removes the fragments.

    Returns (modified_segments, set_of_removed_flat_indices).
    """
    # Build gap set and match map from alignment
    gap_indices = set()
    match_map = {}
    for asr_idx, prov_idx, sim in alignment:
        if asr_idx is not None and prov_idx is None:
            gap_indices.add(asr_idx)
        elif asr_idx is not None and prov_idx is not None:
            match_map[asr_idx] = prov_idx

    to_remove = set()

    for asr_idx in sorted(match_map.keys()):
        prov_idx = match_map[asr_idx]
        prov_norm = _normalize_word(provider_tokens[prov_idx][1])
        matched_norm = asr_normalized[asr_idx]

        # Target must be a long word (compound candidate)
        target = max(prov_norm, matched_norm, key=len)
        if len(target) < 8:
            continue

        # Collect consecutive gap words immediately before this match
        before = []
        i = asr_idx - 1
        while i >= 0 and i in gap_indices:
            before.insert(0, i)
            i -= 1

        if not before:
            continue

        # Use the shorter form as the "root" (handles both first-run and re-run)
        root = min(prov_norm, matched_norm, key=len)
        gap_concat = "".join(asr_normalized[idx] for idx in before)
        concat = gap_concat + root

        # The concatenation should be longer than the root alone
        if len(concat) < len(root) + 3:
            continue

        # Check if gap fragments + root ≈ the compound target word
        if SequenceMatcher(None, concat, target).ratio() >= 0.55:
            to_remove.update(before)

    if not to_remove:
        return raw_segments, set()

    # Delete words from segments (reverse order to preserve indices)
    by_seg = {}
    for flat_idx in to_remove:
        seg_idx, word_idx, _ = asr_words[flat_idx]
        by_seg.setdefault(seg_idx, []).append(word_idx)

    for seg_idx in by_seg:
        for word_idx in sorted(by_seg[seg_idx], reverse=True):
            del raw_segments[seg_idx]["words"][word_idx]
        # Update text field
        words = raw_segments[seg_idx].get("words", [])
        if "text" in raw_segments[seg_idx]:
            raw_segments[seg_idx]["text"] = " ".join(w.get("word", "") for w in words)

    # Remove empty segments
    raw_segments[:] = [s for s in raw_segments if s.get("words")]

    print(f"Reference compound fix: removed {len(to_remove)} fragment words")
    return raw_segments, to_remove


def _adjust_line_breaks(line_breaks, removed_indices):
    """Adjust line break ASR indices after removing compound fragment words."""
    if not removed_indices:
        return line_breaks

    removed_sorted = sorted(removed_indices)
    adjusted = []
    for lb in line_breaks:
        if lb in removed_indices:
            continue
        shift = sum(1 for r in removed_sorted if r < lb)
        adjusted.append(lb - shift)
    return adjusted


def correct_lyrics_with_reference(raw_segments, ref_lines):
    """Correct WhisperX transcription using reference lyrics as ground truth.

    Pipeline:
      1. Tokenize provider (reference) lyrics
      2. Align provider tokens to ASR words using Needleman-Wunsch
      3. Score alignment quality
      4. Rewrite ASR words with provider text (aggressive) while keeping timing
      4b. Remove compound word fragments left behind by rewrite
      5. Extract line break positions from reference alignment

    Returns (corrected_segments, line_breaks, stats) where line_breaks is a
    sorted list of ASR word indices where new reference lines begin, and stats
    is a dict with correction metadata (quality, corrections, total_words).
    """
    if not ref_lines:
        return raw_segments, [], {"skipped": True, "reason": "no_ref_lines"}

    # Flatten ASR words with segment/word indices for write-back
    asr_words = []
    for seg_idx, seg in enumerate(raw_segments):
        for word_idx, w in enumerate(seg.get("words", [])):
            word_text = w.get("word", "").strip()
            if word_text:
                asr_words.append((seg_idx, word_idx, w))

    if not asr_words:
        return raw_segments, [], {"skipped": True, "reason": "no_asr_words"}

    asr_normalized = [_normalize_word(w[2]["word"]) for w in asr_words]

    # Step 1: Tokenize provider lyrics
    provider_tokens = _tokenize_provider(ref_lines)
    if not provider_tokens:
        return raw_segments, [], {"skipped": True, "reason": "no_provider_tokens"}

    # Step 2+3: Align and score
    alignment, quality = _align_provider_tokens(asr_normalized, provider_tokens)

    # Step 4: Rewrite
    corrected = _rewrite_with_provider(raw_segments, asr_words, alignment, provider_tokens, quality)

    # Step 4b: Remove compound word fragments
    corrected, removed_indices = _remove_compound_fragments(
        corrected, asr_words, asr_normalized, alignment, provider_tokens)

    # Step 5: Extract line breaks from alignment
    line_breaks = _extract_line_breaks_from_alignment(alignment, provider_tokens, quality)

    # Adjust line breaks for removed fragment words
    line_breaks = _adjust_line_breaks(line_breaks, removed_indices)

    if line_breaks:
        print(f"Reference line breaks: {len(line_breaks)} break points extracted")

    stats = {
        "quality": round(quality, 4),
        "total_words": len(asr_words),
        "applied": quality >= 0.4,
    }
    if quality < 0.4:
        stats["reason"] = "low_quality"

    return corrected, line_breaks, stats


def _split_at_ref_breaks(flat_words, line_breaks):
    """Split a flat word list into segments at reference line break positions.

    line_breaks is a sorted list of word indices where new lines start.
    Returns a list of segments.
    """
    if not flat_words:
        return []

    break_set = set(line_breaks)
    segments = []
    current_words = []

    for i, w in enumerate(flat_words):
        if i in break_set and current_words:
            segments.append(_make_segment(current_words))
            current_words = []
        current_words.append(w)

    if current_words:
        segments.append(_make_segment(current_words))

    return segments


def postprocess_lyrics_heuristic(raw_data, ref_line_breaks=None, ref_stats=None):
    """Process WhisperX output into karaoke-ready lyrics using heuristics.

    When ref_line_breaks is provided and non-empty, uses reference line
    boundaries for splitting instead of timing-gap heuristics.

    ref_stats is an optional dict with correction metadata from
    correct_lyrics_with_reference() to include in the output.

    Heuristic pipeline (fallback):
      1. Merge raw WhisperX segments into our format
      2. Split at speaker changes within segments
      3. Recursively split segments > 8 words at largest timing gaps
      4. Merge tiny (1-word) segments into neighbors when gap is small

    Reference pipeline:
      1. Flatten all words from raw segments
      2. Split at reference line break positions
      3. Split at speaker changes within lines
      4. Safety-net split lines > 12 words at timing gaps
      5. Merge tiny (1-word) segments into neighbors
    """
    segments = raw_data.get("segments", raw_data if isinstance(raw_data, list) else [])
    if not segments:
        return merge_lyrics(segments)

    # Compute avg_confidence from raw word scores
    all_scores = []
    for seg in segments:
        for w in seg.get("words", []):
            score = w.get("score")
            if score is not None:
                all_scores.append(score)
    avg_confidence = round(sum(all_scores) / len(all_scores), 4) if all_scores else None

    if ref_line_breaks:
        # Reference-guided pipeline
        flat_words = _flatten_raw_words(segments)
        if not flat_words:
            return merge_lyrics(segments)

        # Split at reference line boundaries
        ref_segs = _split_at_ref_breaks(flat_words, ref_line_breaks)

        # Split at speaker changes within reference lines
        ref_segs = _split_at_speaker_changes(ref_segs)

        # Safety-net: split lines > 20 words at timing gaps
        final_segs = []
        for seg in ref_segs:
            words = seg.get("words", [])
            if len(words) <= 20:
                final_segs.append(seg)
            else:
                for word_group in _split_segment_at_gaps(words, max_words=20):
                    if word_group:
                        final_segs.append(_make_segment(word_group))

        # Merge tiny segments
        final_segs = _merge_tiny_segments(final_segs, min_words=2, max_gap=0.5)

        result = {"segments": final_segs, "lyrics_source": "reference"}
        if avg_confidence is not None:
            result["avg_confidence"] = avg_confidence
        if ref_stats:
            result["ref_stats"] = ref_stats
        return result

    # Heuristic fallback pipeline
    # Step 1: Merge into our lyrics format
    merged = merge_lyrics(segments)

    # Step 2: Split at speaker changes
    split_segs = _split_at_speaker_changes(merged.get("segments", []))

    # Step 3: Recursively split long segments (>8 words)
    final_segs = []
    for seg in split_segs:
        words = seg.get("words", [])
        if len(words) <= 8:
            final_segs.append(seg)
        else:
            for word_group in _split_segment_at_gaps(words, max_words=8):
                if word_group:
                    final_segs.append(_make_segment(word_group))

    # Step 4: Merge tiny segments (1-word) into neighbors
    final_segs = _merge_tiny_segments(final_segs, min_words=2, max_gap=0.5)

    result = {"segments": final_segs, "lyrics_source": "heuristic"}
    if avg_confidence is not None:
        result["avg_confidence"] = avg_confidence
    if ref_stats:
        result["ref_stats"] = ref_stats
    return result
