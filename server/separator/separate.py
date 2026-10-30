"""Splits a recording into stems with a RoFormer model (python-audio-separator); run by server/src/stems.ts.

Usage: python -I separate.py <input.wav> <output dir> <model dir> [cuda|cpu] [checkpoint] [config]
       python -I separate.py --devices

The checkpoint and config are file names in the model directory (BS-RoFormer SW by default; the server's
MODELS list says which). Prints one JSON object per line on stdout: {"device": "cuda"} first, {"progress": 0.42}
while it works, then {"stems": [{"name": "guitar", "file": "guitar.flac", "rmsDb": -18.2}, ...]}. Logs and errors
go to stderr; a failure exits with code 1. With --devices it prints the graphics cards PyTorch can use instead.
"""

import json
import logging
import math
import os
import sys

MODEL = "BS-Roformer-SW.ckpt"
CONFIG = "BS-Roformer-SW.yaml"
# The stem names the models use (training.instruments in their YAML), in the order the page lists them.
STEMS = ["vocals", "drums", "bass", "guitar", "piano", "other"]


def emit(message):
    print(json.dumps(message), flush=True)


class Progress:
    """Stands in for tqdm around the separator's chunk loop, reporting to stdout instead of a console bar."""

    def __init__(self, iterable=None, *args, **kwargs):
        self.items = list(iterable) if iterable is not None else []

    def __iter__(self):
        total = max(len(self.items), 1)
        for index, item in enumerate(self.items):
            emit({"progress": index / total})
            yield item
        emit({"progress": 1})

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def update(self, *args):
        pass

    def close(self):
        pass


def rms_db(path):
    import numpy as np
    import soundfile

    data, _ = soundfile.read(path, dtype="float32")
    rms = float(np.sqrt(np.mean(np.square(data)))) if data.size else 0.0
    return round(20 * math.log10(rms), 1) if rms > 0 else -120.0


def devices():
    import torch

    gpus = []
    if torch.cuda.is_available():
        for index in range(torch.cuda.device_count()):
            properties = torch.cuda.get_device_properties(index)
            gpus.append({"name": properties.name, "memoryGb": round(properties.total_memory / 1024**3, 1)})
    emit({"gpus": gpus, "torch": torch.__version__, "cuda": torch.version.cuda})


def main():
    input_path, output_dir, model_dir = sys.argv[1:4]
    device = sys.argv[4] if len(sys.argv) > 4 else "cuda"
    model = sys.argv[5] if len(sys.argv) > 5 else MODEL
    config = sys.argv[6] if len(sys.argv) > 6 else CONFIG
    if device == "cpu":
        # Hidden before PyTorch loads, so that it (and the separator) cannot see the graphics card. An empty value
        # does not hide it (PyTorch 2.15); -1 does.
        os.environ["CUDA_VISIBLE_DEVICES"] = "-1"
    import torch
    from audio_separator.separator import Separator
    from audio_separator.separator.architectures import mdxc_separator

    mdxc_separator.tqdm = Progress
    # Only pydub needs ffmpeg, and nothing here uses it: the input is WAV and the stems are written by soundfile.
    Separator.check_ffmpeg_installed = lambda self: None
    cuda = torch.cuda.is_available()
    emit({"device": "cuda" if cuda else "cpu"})

    separator = Separator(
        log_level=logging.WARNING,
        model_file_dir=model_dir,
        output_dir=output_dir,
        output_format="FLAC",
        # Only stems that would clip are scaled down, so the stems keep their levels relative to each other.
        normalization_threshold=1.0,
        # Writes FLAC without ffmpeg (pydub needs it).
        use_soundfile=True,
        use_autocast=cuda,
    )
    # The model is on disk already: skip the download step, which looks it up in a list fetched from GitHub.
    separator.download_model_files = lambda filename: (
        filename,
        "MDXC",
        filename,
        os.path.join(model_dir, model),
        os.path.join(model_dir, config),
    )
    separator.load_model(model)
    separator.separate(input_path, {name: name for name in STEMS})

    stems = []
    for name in STEMS:
        file = f"{name}.flac"
        path = os.path.join(output_dir, file)
        if os.path.exists(path):
            stems.append({"name": name, "file": file, "rmsDb": rms_db(path)})
    emit({"stems": stems})


if __name__ == "__main__":
    try:
        if sys.argv[1:2] == ["--devices"]:
            devices()
        else:
            main()
    except Exception as error:
        print(f"{type(error).__name__}: {error}", file=sys.stderr, flush=True)
        sys.exit(1)
