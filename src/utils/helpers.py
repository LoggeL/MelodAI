from groq import Groq
import json
import os
import logging
import time
from typing import Dict, List, Any, Optional

# env
from dotenv import load_dotenv

load_dotenv()

client = Groq(api_key=os.environ["GROQ_API_KEY"])
logger = logging.getLogger(__name__)


def chunk_lyrics_with_llm(lyrics_text: str, max_retries: int = 3) -> Optional[str]:
    """Call Groq API to chunk lyrics with retry logic."""
    for attempt in range(max_retries):
        try:
            logger.info(f"Chunking lyrics with LLM, attempt {attempt + 1}/{max_retries}")
            completion = client.chat.completions.create(
                model="meta-llama/llama-4-scout-17b-16e-instruct",
                messages=[
                    {
                        "role": "system",
                        "content": "You chunk lyrics into meaningful lines\nOnly return the lyrics in proper formatting",
                    },
                    {
                        "role": "user",
                        "content": lyrics_text,
                    },
                ],
                temperature=0.1,
                top_p=1,
                stop=None,
            )
            return completion.choices[0].message.content
        except Exception as e:
            logger.error(f"Error calling Groq API, attempt {attempt + 1}: {e}")
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)  # Exponential backoff
            else:
                return None
    return None


def chunk_lyrics(lyrics_id):
    """Chunks lyrics into meaningful lines using a large language model.

    This function takes a lyrics ID, loads the corresponding lyrics from a JSON
    file, sends the lyrics to a large language model for chunking, and then
    saves the formatted lyrics and original lyrics to text files. It also
    updates the original JSON file with the formatted lyrics, including start
    and end times for each segment.

    Args:
        lyrics_id: The ID of the song lyrics to process.
    """
    # songs/{id}/lyrics.json
    lyrics_path = f"src/songs/{lyrics_id}/lyrics_merged.json"
    
    if not os.path.exists(lyrics_path):
        logger.error(f"Lyrics merged file not found: {lyrics_path}")
        raise FileNotFoundError(f"Lyrics merged file not found: {lyrics_path}")
    
    try:
        with open(lyrics_path, "r", encoding="utf-8") as f:
            lyrics = json.load(f)
    except json.JSONDecodeError as e:
        logger.error(f"Invalid JSON in lyrics file {lyrics_path}: {e}")
        raise
    
    # Validate lyrics structure
    if "segments" not in lyrics or not isinstance(lyrics["segments"], list):
        logger.error(f"Invalid lyrics structure in {lyrics_path}")
        raise ValueError("Invalid lyrics structure: missing or invalid segments")
    
    if len(lyrics["segments"]) == 0:
        logger.warning(f"No segments found in lyrics for {lyrics_id}")
        # Save empty lyrics file
        with open(f"src/songs/{lyrics_id}/lyrics.json", "w", encoding="utf-8") as f:
            json.dump(lyrics, f, ensure_ascii=False, indent=2)
        return

    # segments -> text -> join \n
    lyrics_text = "\n".join([segment.get("text", "") for segment in lyrics["segments"] if "text" in segment])
    
    if not lyrics_text.strip():
        logger.warning(f"No text found in lyrics segments for {lyrics_id}")
        # Save as-is without chunking
        with open(f"src/songs/{lyrics_id}/lyrics.json", "w", encoding="utf-8") as f:
            json.dump(lyrics, f, ensure_ascii=False, indent=2)
        return

    formatted_lyrics_str = chunk_lyrics_with_llm(lyrics_text)
    
    if formatted_lyrics_str is None:
        logger.error(f"Failed to chunk lyrics with LLM for {lyrics_id}")
        # Fallback: use original lyrics without chunking
        with open(f"src/songs/{lyrics_id}/lyrics.json", "w", encoding="utf-8") as f:
            json.dump(lyrics, f, ensure_ascii=False, indent=2)
        raise Exception("Failed to chunk lyrics with LLM")

    # store txt versions of both
    with open(
        f"src/songs/{lyrics_id}/lyrics_formatted.txt", "w", encoding="utf-8"
    ) as f:
        f.write(formatted_lyrics_str)

    with open(f"src/songs/{lyrics_id}/lyrics.txt", "w", encoding="utf-8") as f:
        f.write(lyrics_text)

    #     "segments": [
    # {
    #     "end": 14.587,
    #     "speaker": "SPEAKER_00",
    #     "start": 11.144,
    #     "text": " I am the monster you created.",
    #     "words": [
    #         {
    #             "end": 11.204,
    #             "score": 0.801,
    #             "speaker": "SPEAKER_00",
    #             "start": 11.144,
    #             "word": "I"
    #         },

    formatted_segments = []
    original_segments = lyrics["segments"]
    current_segment_idx = 0
    current_word_idx = 0
    formatted_lines = [line for line in formatted_lyrics_str.strip().split("\n") if line.strip()]

    # Process each formatted line
    for formatted_line in formatted_lines:
        # Skip empty lines
        if not formatted_line.strip():
            continue
            
        words = formatted_line.split()
        if len(words) == 0:
            continue
            
        # Safety check: ensure we haven't exhausted all segments
        if current_segment_idx >= len(original_segments):
            logger.warning(f"Exhausted all segments while processing formatted lines for {lyrics_id}")
            break
            
        new_segment = {
            "text": formatted_line,
            "speaker": original_segments[current_segment_idx].get("speaker", "SPEAKER_00"),
            "words": [],
        }

        # Add words from original segment until we match the formatted line
        while len(new_segment["words"]) < len(words):
            # Safety check: ensure we haven't exhausted all segments
            if current_segment_idx >= len(original_segments):
                logger.warning(f"Ran out of segments while matching words for {lyrics_id}")
                break
                
            # Check if we need to move to next segment
            if current_word_idx >= len(original_segments[current_segment_idx].get("words", [])):
                current_segment_idx += 1
                current_word_idx = 0
                
                # Double check we're still in bounds
                if current_segment_idx >= len(original_segments):
                    logger.warning(f"Reached end of segments for {lyrics_id}")
                    break
                    
            # Get word data with safety check
            segment_words = original_segments[current_segment_idx].get("words", [])
            if current_word_idx >= len(segment_words):
                current_segment_idx += 1
                current_word_idx = 0
                continue
                
            word_data = segment_words[current_word_idx]
            new_segment["words"].append(word_data)
            current_word_idx += 1

        if len(new_segment["words"]) == 0:
            continue

        # Set start/end times based on first/last word
        new_segment["start"] = new_segment["words"][0].get("start", 0)
        new_segment["end"] = new_segment["words"][-1].get("end", 0)

        # Refine start, end based on all words
        for word in new_segment["words"]:
            if "start" in word:
                new_segment["start"] = min(new_segment["start"], word["start"])
            if "end" in word:
                new_segment["end"] = max(new_segment["end"], word["end"])

        # Count speaker occurrences
        speaker_counts = {}
        for word in new_segment["words"]:
            if "speaker" in word:
                speaker_counts[word["speaker"]] = (
                    speaker_counts.get(word["speaker"], 0) + 1
                )
        # if none have been found set SPEAKER_00
        if len(speaker_counts) == 0:
            new_segment["speaker"] = "SPEAKER_00"
        else:
            new_segment["speaker"] = max(speaker_counts, key=speaker_counts.get)

        formatted_segments.append(new_segment)

    # If no formatted segments were created, use original
    if len(formatted_segments) == 0:
        logger.warning(f"No formatted segments created for {lyrics_id}, using original")
        formatted_segments = original_segments
    
    lyrics["segments"] = formatted_segments
    formatted_lyrics = lyrics

    # write to json
    try:
        with open(f"src/songs/{lyrics_id}/lyrics.json", "w", encoding="utf-8") as f:
            json.dump(formatted_lyrics, f, ensure_ascii=False, indent=2)
        logger.info(f"Successfully saved chunked lyrics for {lyrics_id}")
    except Exception as e:
        logger.error(f"Error saving chunked lyrics for {lyrics_id}: {e}")
        raise


def merge_lyrics(lyrics_id):
    """Merges character-level lyrics into word-level lyrics.

    This function takes a lyrics ID, loads the corresponding raw lyrics from a
    JSON file, and merges character-level segments into word-level segments.
    It handles cases where the lyrics are segmented by character instead of
    word, ensuring that the output JSON file contains properly formatted
    word-level lyrics.

    Args:
        lyrics_id: The ID of the song lyrics to process.
    """
    # songs/{id}/lyrics.json
    lyrics_path = f"src/songs/{lyrics_id}/lyrics_raw.json"
    
    if not os.path.exists(lyrics_path):
        logger.error(f"Lyrics raw file not found: {lyrics_path}")
        raise FileNotFoundError(f"Lyrics raw file not found: {lyrics_path}")
    
    try:
        with open(lyrics_path, "r", encoding="utf-8") as f:
            lyrics = json.load(f)
    except json.JSONDecodeError as e:
        logger.error(f"Invalid JSON in lyrics file {lyrics_path}: {e}")
        raise
    
    # Validate lyrics structure
    if "segments" not in lyrics or not isinstance(lyrics["segments"], list):
        logger.error(f"Invalid lyrics structure in {lyrics_path}")
        raise ValueError("Invalid lyrics structure: missing or invalid segments")
    
    if len(lyrics["segments"]) == 0:
        logger.warning(f"No segments found in raw lyrics for {lyrics_id}")
        # Save empty lyrics file
        with open(f"src/songs/{lyrics_id}/lyrics_merged.json", "w", encoding="utf-8") as f:
            json.dump(lyrics, f, ensure_ascii=False, indent=2)
        return

    old_segments = lyrics["segments"]
    new_segments = []

    def interpolate_timestamp(word_index: int, words: List[Dict[str, Any]], key: str) -> Optional[float]:
        """Interpolates a missing timestamp using linear interpolation.

        Args:
            word_index: The index of the word with the missing timestamp.
            words: The list of words in the segment.
            key: The key of the timestamp to interpolate ('start' or 'end').

        Returns:
            The interpolated timestamp, or None if interpolation is not possible.
        """

        # Find previous and next valid timestamps in the word list
        prev_index = word_index - 1
        while prev_index >= 0 and key not in words[prev_index]:
            prev_index -= 1

        next_index = word_index + 1
        while next_index < len(words) and key not in words[next_index]:
            next_index += 1

        # If no valid timestamps are found for interpolation, return None
        if prev_index < 0 and next_index >= len(words):
            return None
        # If previous timestamp is missing, use the next timestamp
        if prev_index < 0:
            return words[next_index].get(key)
        # If next timestamp is missing, use the previous timestamp
        if next_index >= len(words):
            return words[prev_index].get(key)
        # Perform linear interpolation using previous and next timestamps
        prev_time = words[prev_index].get(key)
        next_time = words[next_index].get(key)
        
        # Safety check: ensure both timestamps exist
        if prev_time is None or next_time is None:
            return prev_time if prev_time is not None else next_time
            
        fraction = (word_index - prev_index) / (next_index - prev_index)
        return prev_time + (next_time - prev_time) * fraction

    for segment in old_segments:
        # Validate segment structure
        if not isinstance(segment, dict):
            logger.warning(f"Skipping invalid segment in {lyrics_id}")
            continue
        
        if "text" not in segment or "words" not in segment:
            logger.warning(f"Skipping segment missing text or words in {lyrics_id}")
            continue
            
        # sometimes the words are on a char based level but the text is correct. I want to merge the chars back to words.
        words = segment["text"].split(" ")
        segment_words = segment.get("words", [])
        
        if len(words) < len(segment_words):
            word_index = 0
            new_words = []
            for word in words:
                # Skip empty words
                if not word.strip():
                    continue
                    
                word_collector = []
                collected_text = ""
                
                # Safety check: don't go out of bounds
                while len(collected_text) < len(word) and word_index < len(segment_words):
                    current_word_data = segment_words[word_index]
                    if not isinstance(current_word_data, dict) or "word" not in current_word_data:
                        word_index += 1
                        continue
                        
                    word_collector.append(current_word_data)
                    collected_text += current_word_data.get("word", "")
                    word_index += 1

                new_word = {"word": collected_text}

                # merge to a single word
                # count speaker occurrences
                speaker_counts = {}
                for word in word_collector:
                    if "speaker" in word:
                        speaker_counts[word["speaker"]] = (
                            speaker_counts.get(word["speaker"], 0) + 1
                        )
                # if non have been found set SPEAKER_00
                if len(speaker_counts) == 0:
                    new_word["speaker"] = "SPEAKER_00"
                else:
                    new_word["speaker"] = max(speaker_counts, key=speaker_counts.get)

                # start, end and speaker for new_segment based on its words
                for word in word_collector:
                    if "start" in word:
                        new_word["start"] = min(
                            new_word.get("start", float("inf")), word["start"]
                        )
                    if "end" in word:
                        new_word["end"] = max(
                            new_word.get("end", float("-inf")), word["end"]
                        )

                # Interpolate missing timestamps
                if "start" not in new_word or new_word["start"] is None:
                    interpolated_start = interpolate_timestamp(word_index, segment_words, "start")
                    if interpolated_start is not None:
                        new_word["start"] = interpolated_start
                    else:
                        new_word["start"] = 0.0  # Default fallback

                if "end" not in new_word or new_word["end"] is None:
                    interpolated_end = interpolate_timestamp(word_index, segment_words, "end")
                    if interpolated_end is not None:
                        new_word["end"] = interpolated_end
                    else:
                        new_word["end"] = 0.0  # Default fallback


                # Only add if we have valid data
                if new_word.get("word"):
                    new_words.append(new_word)

            # Only update if we successfully created new words
            if new_words:
                segment["words"] = new_words
                new_segments.append(segment)
            else:
                # Keep original segment if merging failed
                logger.warning(f"Failed to merge words for segment in {lyrics_id}, keeping original")
                new_segments.append(segment)

        else:
            # Words already at correct level
            new_segments.append(segment)

    lyrics["segments"] = new_segments

    # write to json
    try:
        with open(f"src/songs/{lyrics_id}/lyrics_merged.json", "w", encoding="utf-8") as f:
            json.dump(lyrics, f, ensure_ascii=False, indent=2)
        logger.info(f"Successfully saved merged lyrics for {lyrics_id}")
    except Exception as e:
        logger.error(f"Error saving merged lyrics for {lyrics_id}: {e}")
        raise


# Test
if __name__ == "__main__":
    # chunk_lyrics("2984775641")
    merge_lyrics("2867606132")
