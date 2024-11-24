from groq import Groq
import json
import os

# env
from dotenv import load_dotenv

load_dotenv()

client = Groq(api_key=os.environ["GROQ_API_KEY"])


def chunk_lyrics(lyrics_id):
    # songs/{id}/lyrics.json
    lyrics_path = f"songs/{lyrics_id}/lyrics_raw.json"
    with open(lyrics_path, "r") as f:
        lyrics = json.load(f)

    # segments -> text -> join \n
    lyrics_text = "\n".join([segment["text"] for segment in lyrics["segments"]])

    completion = client.chat.completions.create(
        model="gemma2-9b-it",
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
        temperature=0,
        top_p=1,
        stop=None,
    )

    formatted_lyrics_str = completion.choices[0].message.content

    # store txt versions of both
    with open(f"songs/{lyrics_id}/lyrics_formatted.txt", "w") as f:
        f.write(formatted_lyrics_str)

    with open(f"songs/{lyrics_id}/lyrics.txt", "w") as f:
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
    formatted_lines = formatted_lyrics_str.strip().split("\n")

    # Process each formatted line
    for formatted_line in formatted_lines:
        words = formatted_line.split()
        new_segment = {
            "text": formatted_line,
            "speaker": original_segments[current_segment_idx]["speaker"],
            "words": [],
        }

        # Add words from original segment until we match the formatted line
        while len(new_segment["words"]) < len(words):
            if current_word_idx >= len(original_segments[current_segment_idx]["words"]):
                current_segment_idx += 1
                current_word_idx = 0

            word_data = original_segments[current_segment_idx]["words"][
                current_word_idx
            ]
            new_segment["words"].append(word_data)
            current_word_idx += 1

        if len(new_segment["words"]) == 0:
            continue

        # Set start/end times based on first/last word
        if new_segment["words"]:
            new_segment["start"] = new_segment["words"][0].get("start", 0)
            new_segment["end"] = new_segment["words"][-1].get("end", 0)

        # start, end and speaker for new_segment based on its words
        for word in new_segment["words"]:
            if "start" in word:
                new_segment["start"] = min(new_segment["start"], word["start"])
            if "end" in word:
                new_segment["end"] = max(new_segment["end"], word["end"])

        # count speaker occurrences
        speaker_counts = {}
        for word in new_segment["words"]:
            speaker_counts[word["speaker"]] = speaker_counts.get(word["speaker"], 0) + 1
        new_segment["speaker"] = max(speaker_counts, key=speaker_counts.get)

        formatted_segments.append(new_segment)

    lyrics["segments"] = formatted_segments
    formatted_lyrics = lyrics

    # write to json
    with open(f"songs/{lyrics_id}/lyrics_formatted.json", "w") as f:
        json.dump(formatted_lyrics, f)


# Test
if __name__ == "__main__":
    chunk_lyrics("3068802271")
