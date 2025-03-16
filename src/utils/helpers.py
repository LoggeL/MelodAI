from groq import Groq
import json
import os
import requests

# env
from dotenv import load_dotenv

load_dotenv()


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
    with open(lyrics_path, "r") as f:
        lyrics = json.load(f)

    old_segments = lyrics["segments"]
    new_segments = []

    def interpolate_timestamp(word_index, words, key):
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
            return words[next_index][key]
        # If next timestamp is missing, use the previous timestamp
        if next_index >= len(words):
            return words[prev_index][key]
        # Perform linear interpolation using previous and next timestamps
        prev_time = words[prev_index][key]
        next_time = words[next_index][key]
        fraction = (word_index - prev_index) / (next_index - prev_index)
        return prev_time + (next_time - prev_time) * fraction

    for segment in old_segments:
        # sometimes the words are on a char based level but the text is correct. I want to merge the chars back to words.
        words = segment["text"].split(" ")
        if len(words) < len(segment["words"]):
            word_index = 0
            new_words = []
            for word in words:
                word_collector = []
                collected_text = ""
                while len(collected_text) < len(word):
                    word_collector.append(segment["words"][word_index])
                    collected_text += segment["words"][word_index]["word"]
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
                if "start" not in new_word:
                    new_word["start"] = interpolate_timestamp(
                        word_index, segment["words"], "start"
                    )

                if "end" not in new_word:
                    new_word["end"] = interpolate_timestamp(
                        word_index, segment["words"], "end"
                    )

                new_words.append(new_word)

            segment["words"] = new_words
            new_segments.append(segment)

        else:
            new_segments.append(segment)

    lyrics["segments"] = new_segments

    # write to json
    with open(f"src/songs/{lyrics_id}/lyrics_merged.json", "w", encoding="utf-8") as f:
        json.dump(lyrics, f)


def split_long_lyrics_lines(lyrics_id):
    """Splits long lyrics lines into shorter, more manageable chunks using OpenRouter.

    This function takes a lyrics ID, loads the corresponding lyrics from a JSON file,
    sends the lyrics text to OpenRouter for line length analysis, and returns split
    points for long lines.

    Args:
        lyrics_id: The ID of the song lyrics to process.

    Returns:
        A modified lyrics JSON with split lines and adjusted timestamps.
    """
    # Load the lyrics
    lyrics_path = f"src/songs/{lyrics_id}/lyrics_raw.json"
    with open(lyrics_path, "r") as f:
        lyrics = json.load(f)

    # Extract just the text for each segment
    segments_text = []
    for segment in lyrics["segments"]:
        segments_text.append(segment["text"].strip())

    # Join with line markers for easy splitting later
    lyrics_text = "\n".join(segments_text)

    try:
        # Call OpenRouter API
        headers = {
            "Authorization": f"Bearer {os.environ['OPENROUTER_API_KEY']}",
            "HTTP-Referer": "https://github.com/LoggeL/MelodAI",
            "X-Title": "MelodAI",
        }

        response = requests.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers=headers,
            json={
                "model": os.environ["LLM_MODEL"],
                "messages": [
                    {
                        "role": "system",
                        "content": "You are a lyrics formatting expert. Your task is to split long lyrics lines into shorter, more natural segments while preserving the meaning and flow. Split on natural breaks in the lyrics. Return only the split lyrics with no additional text. Preserve all original text exactly as provided. Do not modify any words.",
                    },
                    {"role": "user", "content": lyrics_text},
                ],
            },
        )

        response.raise_for_status()
        split_lyrics = response.json()["choices"][0]["message"]["content"]
        split_lines = [
            line.strip() for line in split_lyrics.strip().split("\n") if line.strip()
        ]

    except Exception as e:
        print(f"Error calling OpenRouter API: {str(e)}")
        return lyrics

    # Create new segments based on the split lines
    new_segments = []
    new_idx = 0
    old_idx = 0
    new_offset = 0

    while old_idx < len(lyrics["segments"]):
        old_count = len(lyrics["segments"][old_idx]["words"])
        new_count = len(split_lines[new_idx].split(" "))
        old_words = lyrics["segments"][old_idx]["words"]
        if old_count == new_count + new_offset:
            start_times = [
                old_words[i]["start"] for i in range(new_offset, new_offset + new_count)
            ]
            end_times = [
                old_words[i]["end"] for i in range(new_offset, new_offset + new_count)
            ]
            new_segments.append(
                {
                    "words": old_words[new_offset : new_offset + new_count],
                    "text": split_lines[new_idx],
                    "speaker": lyrics["segments"][old_idx]["speaker"],
                    "start": min(start_times),
                    "end": max(end_times),
                }
            )
            new_idx += 1
            old_idx += 1
            new_offset = 0
        elif old_count > new_count + new_offset:
            start_times = [
                old_words[i]["start"] for i in range(new_offset, new_offset + new_count)
            ]
            end_times = [
                old_words[i]["end"] for i in range(new_offset, new_offset + new_count)
            ]
            new_segments.append(
                {
                    "words": old_words[new_offset : new_offset + new_count],
                    "text": split_lines[new_idx],
                    "speaker": lyrics["segments"][old_idx]["speaker"],
                    "start": min(start_times),
                    "end": max(end_times),
                }
            )
            new_idx += 1
            new_offset += new_count
        else:
            old_idx += 1
            print("oh no")

    # print old lyrics and new lyrics structure
    print("Old lyrics:")
    for i, segment in enumerate(lyrics["segments"]):
        print(i, len(segment["words"]))
    print(f"Sum: {sum([len(segment['words']) for segment in lyrics['segments']])}")

    print("\nNew lyrics:")
    for i, segment in enumerate(new_segments):
        print(i, len(segment["words"]))
    print(f"Sum: {sum([len(segment['words']) for segment in new_segments])}")

    # Update the lyrics with new segments
    lyrics["segments"] = new_segments

    # Save the split lyrics
    output_path = f"src/songs/{lyrics_id}/lyrics.json"
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(lyrics, f, ensure_ascii=False, indent=4)

    print(f"Successfully processed {len(new_segments)} segments")
    return lyrics


# Test
if __name__ == "__main__":
    # chunk_lyrics("2984775641")
    # merge_lyrics("2867606132")
    split_long_lyrics_lines("3122055081")
