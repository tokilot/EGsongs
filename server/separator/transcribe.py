"""Transcribes a recording to MIDI with MuScriptor (Kyutai x Mirelo); run by server/src/transcribe.ts.

Usage: python -I transcribe.py <input.wav> <output dir> <weights> <beat checkpoint|-> [cuda|cpu] [instruments] [bpm]

<weights> is a MuScriptor model.safetensors (its config.json next to it, if there is one); <beat checkpoint> is a
beat_this checkpoint (final0.ckpt), which finds the beats and bar lines, or - for none: the MIDI is then written at a
steady <bpm> (120 when left out), as it also is when the beats cannot be found. Both are local files: nothing is
downloaded. Instruments is a comma-separated list of MuScriptor's instrument groups (e.g. distorted_electric_guitar)
to allow; all of them when left out. Prints one JSON object per line on stdout: {"device": "cuda"} first, {"progress": 0.42}
while it works, then {"midi": {"file": "transcription.mid", "notes": 812, "parts": ["electric_bass", ...],
"bpm": 120.0, "detected": true, "seconds": 215.3}}. Logs and errors go to stderr; a failure exits with code 1.
"""

import json
import os
import sys
from collections import Counter

MIDI_FILE = "transcription.mid"


def emit(message):
    print(json.dumps(message), flush=True)


def main():
    input_path, output_dir, weights, beat_checkpoint = sys.argv[1:5]
    device = sys.argv[5] if len(sys.argv) > 5 else "cuda"
    instruments = [name for name in (sys.argv[6] if len(sys.argv) > 6 else "").split(",") if name] or None
    bpm = float(sys.argv[7]) if len(sys.argv) > 7 and sys.argv[7] else 120.0
    if device == "cpu":
        # Hidden before PyTorch loads (see separate.py): an empty value does not hide it, -1 does.
        os.environ["CUDA_VISIBLE_DEVICES"] = "-1"
    import torch
    import muscriptor.transcription_model as transcription
    from muscriptor.events import NoteStartEvent, ProgressEvent
    from muscriptor.utils.beats import detect_grid
    from muscriptor.utils.midi import ExportOptions, resolve_grid

    run_on = "cuda" if torch.cuda.is_available() else "cpu"
    emit({"device": run_on})
    tracking = beat_checkpoint != "-"
    if tracking:
        # The beat tracker would fetch its checkpoint from the internet and run on the CPU: the local file, on the
        # same device as the transcription.
        transcription.detect_grid = lambda wav, sample_rate, **_: detect_grid(wav, sample_rate, checkpoint=beat_checkpoint, device=run_on)

    model = transcription.TranscriptionModel.load_model(weights_path=weights, device=run_on)
    # As TranscriptionModel.transcribe_and_postprocess does, taken apart to report the progress. Without a beat
    # tracker (or when it finds no beat) there is no grid, and the MIDI is written at the steady tempo asked for.
    grid = model.detect_beat_grid_for(input_path, "best-effort") if tracking else None
    emit({"progress": 0.05})
    events = []
    for event in model.transcribe(input_path, instruments=instruments):
        if isinstance(event, ProgressEvent) and event.total > 0:
            emit({"progress": 0.05 + 0.95 * event.completed / event.total})
        events.append(event)
    starts = [event for event in events if isinstance(event, NoteStartEvent)]
    onsets = [event.start_time for event in starts]
    if grid is not None:
        grid = grid.with_onset_delay(onsets)
    export = ExportOptions() if grid is not None else ExportOptions(bpm=bpm)
    midi = model.events_to_midi_bytes(iter(events), beat_grid=grid, export=export)
    with open(os.path.join(output_dir, MIDI_FILE), "wb") as file:
        file.write(midi)

    written = resolve_grid(grid, export, onsets)
    parts = [name for name, _ in Counter(event.instrument for event in starts).most_common()]
    emit(
        {
            "midi": {
                "file": MIDI_FILE,
                "notes": len(starts),
                "parts": parts,
                "bpm": round(float(written.bpm), 1) if written is not None else None,
                "detected": grid is not None,
                "seconds": round(max(onsets), 1) if onsets else 0,
            }
        }
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"{type(error).__name__}: {error}", file=sys.stderr, flush=True)
        sys.exit(1)
