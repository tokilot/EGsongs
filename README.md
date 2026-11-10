<h1 align="center">Electric Guitar Tabs</h1>

<p align="center">吉他谱练习工具：在线看谱、练习模式，效果器音色调教，分离音轨、MIDI转谱。</p>

Electric Guitar Tabs 是一个在浏览器里渲染使用的吉他谱练习项目，曲谱、练习设置和音色都存在本机，后端只监听 `127.0.0.1`。界面支持中文和英文两种。

## 能做什么

**曲谱**
- 变速、循环任意区间、预备拍、跟随曲谱的节拍器、移调、唱名显示。
- 控制每条音轨的音量、独奏、静音。
- 导入 Guitar Pro、MusicXML、alphaTex 和 MIDI 文件，或者新建空白谱自己创作。
- 支持其他采用 Json 绘制的曲谱网站的链接导入，仅供个人练习，版权问题请遵守相应网站的使用条款。
- 导入 MIDI 时自动排成六线谱：量化节奏、选调弦、按手移动最少的原则分配弦和品。
- 在谱上直接编辑音符，可以撤销；编辑音轨。

**练习**
- 练习模式：设置练习速度、预备拍、循环小节，节拍器，自动切换音轨。
- 收藏：保存自己喜爱的曲子。
- 播放列表：一首播完自动接下一首。

**音色**
- 用 SoundFont 采样音色库播放：仓库附带一套（`resources/soundfonts/Default.sf2`），自己的放在 `data/soundfonts/` 里。
- 自己调的吉他效果器音色：动态、滤波、单块、箱头、箱体、均衡、调制、延迟、混响九个模块，可以分给任意音轨。

**转谱（可选，需要 Pytorch）**
- 音轨分离：把一首歌分成多条音轨，具体数量根据选择模型而定。
- 音频转 MIDI：把音频文件转成 MIDI 文件。

## 运行

需要 **Node.js 24 或更新**（用到了内置的 `node:sqlite`，后端直接运行 TypeScript）。当前仅在 Windows 上开发和测试，其他系统未运行过。

```bash
npm ci
npm run dev
```

打开 [127.0.0.1:7273](http://127.0.0.1:7273)。后端在 7274 端口，开发时前端会把 `/api` 转给它。

第一次运行会建好 `data/` 文件夹和里面的数据库，以及要自己往里放东西的 `soundfonts/`、`models/` 子文件夹。曲库里会先放好一首示例谱「赤より紅い夢」（`resources/songs/demo/`），不需要可以直接删掉，之后不会再自动加回来。所有个人数据（曲子、练习设置、谱文件、播放列表、音色）都在 `data/user.db` 里，只需备份这一个文件夹。收藏的曲子连谱子一起存在 `user.db` 里；没收藏的曲子，谱子放在 `data/songs/` 的编号文件夹里，重启后照样保留，
只有这些文件被删掉了，那首曲子才会从曲库里去掉。

### 乐器采样库

把 `.sf2` / `.sf3` 采样音色文件放进 `data/soundfonts/`，推荐 [Polyphone] (https://www.polyphone.io) 下载。
仓库里附带一套 GeneralUser GS（`resources/soundfonts/Default.sf2`，并入了 Bread 的三个失真吉他预设），打开页面时自动加载；
其他音色库需要在「音色」页里手动加载。

### 转谱功能（可选）

「转谱」模块需要 Python 和 PyTorch。

1. 准备 Python 环境，按
   [`server/separator/requirements.txt`](server/separator/requirements.txt) 里写的步骤安装依赖。
2. 启动前把环境变量 `TABS_PYTHON` 设成这个环境的 `python.exe`。
3. 「处理设备」可以选显卡或 CPU，有 NVIDIA 显卡时默认用显卡。
4. 模型文件：
   - 音轨分离：每个模型一个文件夹，放进 `data/models/separator/`，里面是 `model.ckpt` 和 `config.yaml`，
     如 `data/models/separator/BS-Roformer-SW/`，推荐 [BS-RoFormer SW](https://huggingface.co/)。
   - 音频转 MIDI：每个模型一个文件夹，放进 `data/models/transcriber/`，里面是 `model.safetensors`（和 `config.json`），
     如 `data/models/transcriber/muscriptor-medium/`，推荐 [MuScriptor](https://github.com/muscriptor/muscriptor)。
   - 节拍检测（可选）：[beat_this](https://github.com/CPJKU/beat_this) 的 `final0.ckpt`，放在 `data/models/transcriber/beat_this/`。
     有它时，MIDI 按检测到的速度和小节线写出；没有它（或在「节拍检测」里选「不检测」）时，按「速度（BPM）」框里填的速度匀速写出。

   页面上列出的就是这两个文件夹里现有的模型，放进去后刷新页面即可。



### 环境变量

| 变量 | 作用 | 默认 |
| --- | --- | --- |
| `TABS_PORT` | 后端端口 | `7274` |
| `TABS_DATA_DIR` | 数据目录 | 仓库里的 `data/` |
| `TABS_PYTHON` | 转谱用的 Python | 仓库上一级的 `.venv` |
| `TABS_SEPARATOR_MODELS` | 音轨分离模型的目录 | `data/models/separator/` |
| `TABS_TRANSCRIBER_MODELS` | 音频转 MIDI 模型的目录 | `data/models/transcriber/` |
| `TABS_SOUNDFONTS` | 自己的乐器采样库的目录（附带的那套在 `resources/soundfonts/`，总会列出） | `data/soundfonts/` |
| `TABS_DEMO_SONGS` | 第一次运行时放进曲库的示例谱的目录 | `resources/songs/demo/` |

## 开发

```bash
npm test            # 单元测试
npm run typecheck
npm run lint
npm run build
```

前端在 `web/`（Vite + React + TypeScript），后端在 `server/`（Hono + SQLite），谱面渲染和播放用 [alphaTab](https://www.alphatab.net/)。项目开发说明、代码约定和注意事项在 [`AGENTS.md`](AGENTS.md)。

## 许可

代码以 [MIT 许可](LICENSE) 发布。随仓库附带的只有内置音色库；模型权重和其他音色库都不随代码分发，
请自行下载并遵守第三方组件和数据的许可：

- alphaTab：MPL-2.0。
- 乐器采样库：附带的 `Default.sf2` 是 GeneralUser GS（按它的许可）并入了 Bread 的预设（按其原作者的许可）；自己下载的按各自的许可。
- 分离音轨模型：下载的第三方模型许可。
- 转 MIDI 模型：下载的第三方模型许可。
- 节拍检测模型：beat_this 的代码和权重：MIT。
