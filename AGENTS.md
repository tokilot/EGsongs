# 项目介绍

为吉他爱好者开发的曲谱练习网站：支持在线看六线谱、练习模式（变速、循环、节拍器、移调），调教效果器音色，同时支持把音频分离出多条单乐器音轨、转成 MIDI 、MIDI转谱。

## 目录

- `web/`：前端（Vite + React + TypeScript，CSS Modules）。
  - `src/app/`：外壳，拼起顶栏、乐谱区、控制条和三个页面。
  - `src/shared/`：请求封装、地址路由、公共面板样式、`ui/`（Popover、主题、`i18n.ts`）、`alphabetical.ts`（按首字母排序）。
  - `src/audio/`：效果器信号链和引擎（AudioWorklet）、音轨分路、「同一时间只响一种声音」`soundOwner.ts`。
  - `src/tabs/`：曲谱页。`player/`（alphaTab 控制器 `controller.ts`、曲谱编辑、音轨编辑、移调）、`library/`（曲库、
    导入、新建空白谱、导入 MIDI `midiFile.ts` / `midiScore.ts`、播放列表）、`layout/`（顶栏、乐谱区、控制条）、
    `songs/`（在线曲谱 JSON → alphaTab 的转换器）。
  - `src/tones/`：音色页（采样音色库、效果器音色库）。
  - `src/stems/`：转谱页（处理设备、音轨分离、音频转 MIDI）。
  - `alphatab-patches.ts`：构建时对 alphaTab 源码做的精确替换。
- `contracts/`：前后端交换的数据类型，只定义一次（曲目、播放列表、分轨和转换记录、模型、音色库）；后端的模块转出它们，
  网页的 `api.ts` 引用它们。只放类型，用 `import type` 引用，两边的构建里都不留下东西。
- `server/`：后端（Hono，Node 直接运行 TypeScript）。
  - `src/dev.ts` 是 `npm run dev` 的入口：一个端口（7273）上网页由 Vite 中间件提供（带热更新），`/api` 交给后端；
    `src/index.ts` 只启动后端（7274，端到端测试用它配 Vite 自己的服务器）。
  - `src/app.ts` 装配路由，`src/routes/` 各功能的接口，`src/db/` SQLite（`node:sqlite`）。
  - `src/tasks.ts`：转谱页两个功能共用的任务队列、显卡锁、调用 Python 脚本。`src/stems.ts` 音轨分离，`src/transcribe.ts` 音频转 MIDI。
  - `separator/`：Python 脚本 `separate.py`（audio-separator）、`transcribe.py`（MuScriptor + beat_this），依赖见 `requirements.txt`。
- `resources/`（随库附带，和个人数据分开）：`soundfonts/Default.sf2`（内置音色库：GeneralUser GS 并入了 Bread 的三个
  失真吉他预设，放在 1000 号库；默认那套），`songs/demo/`（随库附带的谱，现在是用户自己做的「赤より紅い夢」；全新的曲库第一次启动时导入并设为收藏，
  删掉后不再加回来，`db/library.ts` 的 `addDemos`）。
- `data/`（个人数据，整个不进版本库；第一次启动时自动建好它、`user.db` 和要自己往里放东西的
  `soundfonts/`、`models/separator/`、`models/transcriber/`）：
  - `user.db`：曲子、练习设置、播放列表、音色库，以及**收藏曲子**的谱子内容（上传的文件、在线曲谱的修订版、编辑版）。
  - `songs/`：按 1、2、3… 编号的文件夹（`server/src/songs/songFolders.ts`），每个里有 `origin.json` 说明是什么：
    在线曲谱的一个修订版（`meta.json` + `{音轨}.json`）或上传的文件。**没收藏的曲子**的谱子只在这里；收藏时搬进
    `user.db`、取消收藏时搬回来（`db/library.ts`）。启动时没收藏的曲子和「最近打开」都保留，
    只有谱子在这里找不到的才从曲库去掉。
  - `tmps/`（本次运行的分轨和转换结果，启动时清空）、`soundfonts/`（自己放的乐器采样库，和 `resources/soundfonts/`
    一起列出，同名时用这里的）。
  - `models/separator/<名字>/model.ckpt` + `config.yaml`、`models/transcriber/<名字>/model.safetensors`（+ `config.json`）：
    两个模型目录都按文件夹扫描，有什么列什么；分离模型分出哪几轨读它 YAML 里的 `training.instruments`。
    节拍检测可选：`models/transcriber/beat_this/*.ckpt`；没有或选「不检测」时按页面上填的速度匀速写 MIDI。
- `test/`（测试脚本）：`e2e.ts`、`e2e-songs.ts`、`fetch-fixtures.ts`；`songs/` 是 10 首测试曲目（清单在 `web/src/fixtures.ts`，
  `npm run fixtures` 下载，是在线曲谱的内容，不进版本库）。

## 命令

```bash
npm ci
npm run dev          # 网页和接口都在 7273（server/src/dev.ts）；改后端文件自动重启，改网页文件走 Vite 热更新
npm run build
npm test             # vitest 单元测试（测试曲目缺失时相关测试跳过）
npm run typecheck
npm run lint         # oxlint
npm run e2e          # 无头 Edge 跑全流程（端口 5183/5184、临时数据目录；--shots 截图到 test/shots/ DEBUG）
npm run e2e:songs    # 渲染 10 首测试曲目的全部音轨
npm run fixtures     # 把测试曲目下载到 test/songs/
```

后端环境变量：`TABS_DEV_PORT`（`npm run dev` 的端口）、`TABS_PORT`（只启动后端时的端口）、`TABS_DATA_DIR`、`TABS_PYTHON`、`TABS_SEPARATOR_MODELS`、`TABS_TRANSCRIBER_MODELS`、`TABS_SOUNDFONTS`、`TABS_DEMO_SONGS`（随库附带的谱的目录；e2e 指向空目录，免得新曲库里多出它）。

## 代码约定

- 和用户用中文交流；代码、标识符、提交信息用英文，注释跟随周围代码。
- 修改了界面文字要同步英文对照表和 `docs/note.md`（见下）。
- 乐谱区用配置 alphaTab 实现，求内容、结构、行为一致，不求逐像素。配置和 CSS 解决不了的差异先告诉用户，不要重写渲染层。
- AI 只用本机跑的模型（音轨分离、音频转 MIDI）。模型权重不进仓库，放 `data/models/`。
- alphaTab 的播放器 API 只在 `tabs/player/controller.ts` 里调用；其他组件用 `usePlayer()` 拿快照和方法。播放状态以 alphaTab 的事件为准，React 里不另存一份播放位置。
- 当前打开哪首曲子以地址栏 `#/song/{id}` 为准；音色页（`#/tones`）和转谱页（`#/stems`）盖在乐谱区上，不关闭曲子。
- 依赖边界：`audio/`、`shared/` 不引用任何功能模块；转谱页（`stems/`）不引用曲谱和音色；曲谱只通过 `tones/library.ts` 的查找函数和 `useTones()` 用音色；互相打断播放只走 `soundOwner`。
- 界面文字都经过 `t()`（组件外用 `translate()`），中文原文作键；新中文要在 `shared/ui/i18n.ts` 的 EN 表里加英文，`i18n.test.ts` 会检查。不是界面文字的中文（比如排序用的汉字）写成转义。
- 界面上的说明、提示文字登记在 `docs/note.md`（编号、场景、文字、文件:行号、「修改」列）。增删改这类文字时同步更新；用户在「修改」列填了新文字（「无文本」表示删掉）后，按编号改代码、英文对照表 `docs/note.md`。
- 样式用 CSS Modules + CSS 变量，不引入 UI 组件库。TypeScript 开着 `erasableSyntaxOnly`：不用构造函数参数属性和 enum。
- 单元测试 `*.test.ts` 和被测代码以及测试曲目放在一起。
- 按音轨下标记的设置（音色、采样音色、自动切换音轨、手动选的音轨）和播放器快照的 `tracks` 都按谱里的顺序；列表只在显示时排序（`shared/alphabetical.ts`）。
- 曲谱编辑直接改内存里的乐谱，每步后调 `score.finish()`；撤销靠按字段复制的快照（`modelClone.ts`）。改这块先读 `tabEditor.ts` 的注释。

## alphaTab 1.8.4 的坑（升级后逐条复查）

- 不要订阅 `api.midiLoaded`（栈溢出，整页空白）；不用自带的预备拍（用 `clicks.ts`）；不用 `StaveProfile.Tab`（鼓轨崩溃）；不用 `changeTrackTranspositionPitch`（移调要重新渲染一份改写过品位的乐谱）。
- 改了乐谱要用 `api.renderer.renderScore()` 发给 Worker（`render()` 只重排旧副本），要让播放跟上再调 `loadMidiForScore()`。重新加载 MIDI 会清掉位置、循环、混音，由 `reloadMidi()` / `applyPending()` 恢复。
- 独奏、静音、音量按 MIDI 通道保存，换曲子不会清零：`resetMixer()` / `applyMixer()`。
- 每个小节的声部数量必须一致，任何声部都不能没有拍；长短混合的三连音分组不可靠（导入 MIDI 时写成等长三连音）。
- 循环区间要等渲染完才能设；`renderFinished` 时谱面的 svg 可能还没插进页面；新的 bounds 要等 `postRenderFinished`。
- `alphatab-patches.ts` 找不到原文就报错；升级 alphaTab 后先跑构建，逐条核对补丁。

## 开发服务器

- `npm run dev` 用 `node --watch-path=src --watch-path=../contracts`，只监视后端源码和共用类型，不能改回 `--watch`：Vite 读 `vite.config.ts` 时会生成一个临时文件、加载后马上删掉，`--watch` 会把它当成改动，无限重启（2026-11-11 踩过）。
- 端口被占用时 `dev.ts` 会直接说明并退出。

## Python（转谱页，可选）

- 只有音轨分离和音频转 MIDI 用到 Python；网页和其他功能不需要。后端用 `TABS_PYTHON` 指定解释器。
- 安装步骤和需要降回的包写在 `server/separator/requirements.txt` 里；audio-separator 要 `--no-deps` 装。装新包前先看会不会升级已有的包（`pip install --dry-run`），如果环境和其他项目共用，要先问用户。
- 脚本不联网下载权重，只读 `data/models/` 里的本地文件；每行输出一个 JSON（`{"progress": …}` 等），最后一行 stderr 是错误。
- 选 CPU 时设 `CUDA_VISIBLE_DEVICES=-1`（空字符串藏不住显卡）。音频由浏览器解码成 44.1 kHz WAV 后上传，后端不依赖 ffmpeg。

## 验证

- 改了播放器或布局，至少跑 `npm test` 和 `npm run e2e`；改了在线曲谱转换器再跑 `npm run e2e:songs`。
- e2e 的各项检查共用一个页面，前一项留下的状态会带到后面：前一项失败时，先看它，后面的失败可能是连带的。
- e2e 涉及谱面的预期要从谱子本身算，不要写死；它会向在线曲谱网站发少量请求。
- 截图和测试输出是临时产物，不进版本库。

## 先问用户再做

- 调整界面（布局、交互、视觉、按钮）、改用户定下的做法。
- 加依赖或升级依赖。
- 提交：未经允许不提交；允许时直接提交到 main，提交信息干净简练，符合git提交规范；不加 `Co-Authored-By` 之类的署名行。
- 会碰到项目以外的东西：共用的 Python 环境、用户的个人文件、外部服务。
