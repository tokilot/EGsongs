<h1 align="center">Electric Guitar Tabs</h1>

<p align="center">A guitar practice tool: read tabs, practice mode, effect tones, stem separation and MIDI to tab.</p>

<p align="center"><a href="README.md">中文</a> | English</p>

Electric Guitar Tabs is a guitar tab practice app that runs in the browser. Tabs, practice settings and tones are all
kept on your own computer, and the backend only listens on `127.0.0.1`. The interface is available in Chinese and English.

## What it does

**Tabs**
- Change the speed, loop any range, count-in, a metronome that follows the tab, transpose, note names.
- Volume, solo and mute for each track.
- Import Guitar Pro, MusicXML, alphaTex and MIDI files, or start a blank tab and write your own.
- Import by link from tab sites that draw their tabs from JSON. For personal practice only: follow the terms of use of
  the site in question regarding copyright.
- MIDI files are turned into tablature on import: the rhythm is quantized, a tuning is picked, and strings and frets
  are chosen so the hand moves as little as possible.
- Edit notes directly on the tab, with undo; edit tracks.

**Practice**
- Practice mode: practice speed, count-in, looped bars, metronome, automatic track switches.
- Favourites: keep the songs you like.
- Playlists: when a song ends, the next one starts.

**Tones**
- Playback with SoundFont sample sets: one comes with the repository (`resources/soundfonts/Default.sf2`); put your own in
  `data/soundfonts/`.
- Your own guitar effect tones: dynamics, filter, pedal, amp, cabinet, EQ, modulation, delay and reverb, nine modules,
  each tone given to any track.

**Transcribe (optional, needs PyTorch)**
- Stem separation: split a song into several tracks; how many depends on the model picked.
- Audio to MIDI: turn an audio file into a MIDI file.

## Running

Needs **Node.js 24 or newer** (it uses the built-in `node:sqlite`, and the backend runs TypeScript directly). So far it
has only been developed and tested on Windows; other systems have not been tried.

```bash
npm ci
npm run dev
```

Open [127.0.0.1:7273](http://127.0.0.1:7273). The page and the backend API share this one port (`server/src/dev.ts`:
Vite serves the page with hot reload, and `/api` goes to the backend).

The first run creates the `data/` folder with its database, and the `soundfonts/` and `models/` subfolders that you fill
yourself. The library starts with one demo tab, "赤より紅い夢" (`resources/songs/demo/`); delete it if you don't need it,
and it will not be added back. All your own data (songs, practice settings, tab files, playlists, tones) is in
`data/user.db`, so backing up that one folder is enough. Favourite songs are kept in `user.db` together with their tabs;
the tabs of the other songs are in numbered folders under `data/songs/`. They stay across restarts, and a song only
leaves the library when those files are deleted.

### Sample sets

Put `.sf2` / `.sf3` sample sets into `data/soundfonts/`; [Polyphone](https://www.polyphone.io) is a good place to get them.
The repository comes with GeneralUser GS (`resources/soundfonts/Default.sf2`, with three distortion guitar presets from
Bread added), which loads when the page opens; other sets are loaded by hand on the Tones page.

### Transcribe (optional)

The Transcribe page needs Python and PyTorch.

1. Set up a Python environment and install the dependencies following the steps in
   [`server/separator/requirements.txt`](server/separator/requirements.txt).
2. Before starting, set the environment variable `TABS_PYTHON` to that environment's `python.exe`.
3. Under "Processing device" you can pick the graphics card or the CPU; with an NVIDIA card, the card is the default.
4. Model files:
   - Stem separation: one folder per model in `data/models/separator/`, holding `model.ckpt` and `config.yaml`, e.g.
     `data/models/separator/BS-Roformer-SW/`. Suggested: [BS-RoFormer SW](https://huggingface.co/Noshibest/BS-Roformer-SW).
   - Audio to MIDI: one folder per model in `data/models/transcriber/`, holding `model.safetensors` (and `config.json`),
     e.g. `data/models/transcriber/muscriptor-medium/`. Suggested: [MuScriptor](https://github.com/muscriptor/muscriptor).
   - Beat tracking (optional): [beat_this](https://github.com/CPJKU/beat_this)'s `final0.ckpt`, in
     `data/models/transcriber/beat_this/`. With it, the MIDI is written at the detected tempo and bar lines; without it
     (or with "None" picked under beat tracking), it is written at the steady tempo entered in the "Tempo (BPM)" box.

   The page lists the models these two folders hold; after adding one, reload the page.

### Environment variables

| Variable | Purpose | Default |
| --- | --- | --- |
| `TABS_DEV_PORT` | Port of `npm run dev` (page and API) | `7273` |
| `TABS_PORT` | Port when only the backend runs (`npm start -w server`) | `7274` |
| `TABS_DATA_DIR` | Data folder | `data/` in the repository |
| `TABS_PYTHON` | Python used for transcribing | `.venv` one level above the repository |
| `TABS_SEPARATOR_MODELS` | Folder of the stem separation models | `data/models/separator/` |
| `TABS_TRANSCRIBER_MODELS` | Folder of the audio to MIDI models | `data/models/transcriber/` |
| `TABS_SOUNDFONTS` | Folder of your own sample sets (the bundled one in `resources/soundfonts/` is always listed) | `data/soundfonts/` |
| `TABS_DEMO_SONGS` | Folder of the demo tabs put into the library on the first run | `resources/songs/demo/` |

## Development

```bash
npm test            # unit tests
npm run typecheck
npm run lint
npm run build
```

The front end is in `web/` (Vite + React + TypeScript), the backend in `server/` (Hono + SQLite); tabs are rendered and
played with [alphaTab](https://www.alphatab.net/). Notes for development, code conventions and pitfalls are in
[`AGENTS.md`](AGENTS.md) (in Chinese).

## Licence

The code is released under the [MIT licence](LICENSE). Only the built-in sample set comes with the repository; model
weights and other sample sets are not distributed with the code. Download them yourself and follow the licences of
the third-party components and data:

- alphaTab: MPL-2.0.
- Sample sets: the bundled `Default.sf2` holds basic instrument samples and is free to use; sets downloaded from third
  parties follow their own licences.
- Stem separation models: the licence of the third-party model you download.
- Audio to MIDI models: the licence of the third-party model you download.
- Beat tracking models: the licence of the third-party model you download.
