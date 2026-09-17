# Third-party notices

本文件记录原境英语直接分发或改编的主要第三方内容。原境英语自身源代码的授权见顶层 [LICENSE](LICENSE)；这里列出的第三方内容继续遵循各自的许可证。

## Simple English Wiktionary

原境英语包含从 Simple English Wiktionary 机械清理和压缩得到的本地英英词典。

- Source: https://simple.wiktionary.org/
- Dump: https://dumps.wikimedia.org/simplewiktionary/latest/
- License: Creative Commons Attribution-ShareAlike 4.0 International
- License text: https://creativecommons.org/licenses/by-sa/4.0/
- Changes: entries were parsed, cleaned, compacted and limited to the fields required for local lookup.

按需获取的发音文件来自 Wikimedia Commons。每个录音继续采用 Commons 返回的作者和许可证信息。

## ECDICT

原境英语包含从 ECDICT 派生的中文参考。只有与内置 Simple English Wiktionary 词头重叠的条目会被保留；网络标签被移除，每个词条最多保留四行。

- Source: https://github.com/skywind3000/ECDICT
- License: MIT
- Copyright (c) 2025 Linwei

## OpenAI Whisper model

Small.EN is an OpenAI Whisper model converted to ggml format for whisper.cpp.

- Upstream: https://github.com/openai/whisper
- Converted model source: https://huggingface.co/ggerganov/whisper.cpp
- License: MIT
- Copyright (c) 2022 OpenAI

## whisper.cpp

The Windows x64 local transcription runtime is distributed from whisper.cpp build `b4938`, reporting version `1.9.3`.

- Upstream: https://github.com/ggml-org/whisper.cpp
- Release: https://github.com/ggml-org/whisper.cpp/releases/tag/b4938
- License: MIT
- Copyright (c) 2023-2026 The ggml authors

## MIT License text

The following text applies to the MIT-licensed components identified above.

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The applicable copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## JavaScript and Electron dependencies

Runtime and development dependencies, their exact versions and package licenses are recorded in `package-lock.json`. Electron distributions also include Chromium and related third-party notices in their generated license files.

## On-demand video components

Only after the user actively starts a supported video-page import, 原境英语 downloads the following fixed Windows x64 components into its managed local data directory. Every archive and executable is checked against the pinned SHA-256 values before execution. This on-demand delivery does not remove or weaken the components' license obligations.

### yt-dlp

- Version: `2026.08.19`
- Immutable release: https://github.com/yt-dlp/yt-dlp/releases/tag/2026.08.19
- Downloaded file: `yt-dlp.exe`
- SHA-256: `66674953fe251b89f4d08c5f0e35e0728679bd67ab3d7d05c0562af101dd3e7a`
- Upstream source: https://github.com/yt-dlp/yt-dlp/tree/2026.08.19
- License note: yt-dlp source is primarily Unlicense; the official PyInstaller executable includes additional third-party licenses compiled into the executable, as documented by the release publisher.

### FFmpeg Windows build

- Build: `autobuild-2026-09-14-13-17`, `ffmpeg-N-126549-ga51bb69b09-win64-gpl.zip`
- Immutable release: https://github.com/BtbN/FFmpeg-Builds/releases/tag/autobuild-2026-09-14-13-17
- Archive SHA-256: `d1bd0d4e6ad451ce42de02a13757c46b6f182489c51e5a4a311013b2d3f920a2`
- Extracted `ffmpeg.exe` SHA-256: `8be2934fe6208ef37d725e09838bf099be9ea040ddc343abd5e3651a057b6730`
- Build source: https://github.com/BtbN/FFmpeg-Builds/tree/3e6685e
- FFmpeg source: https://github.com/FFmpeg/FFmpeg
- License: GPLv3 or later for this selected GPL build. The archive's `LICENSE.txt` is retained next to the managed executable. License text: https://www.gnu.org/licenses/gpl-3.0.html

No automatic component update system is implemented. Before publishing a desktop build that enables this delivery, the distributor must complete the applicable GPL source-availability and notice review; downloading at first use is not treated as a way around those duties.
