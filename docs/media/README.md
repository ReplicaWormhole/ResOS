# README demo media

The demo illustrates the existing M05 / CHAT-04 workflow: select an answer,
open a linked discussion, ask a nested question, and return to the main thread.
It is a narrated walkthrough, not an additional automated runtime check.

- `resos-demo.mp4` is the full narrated demo. The first 1.75 seconds before
  speech are removed, with a short lead-in to preserve the first syllable.
  The crop removes the Ubuntu dock, system bar, and window title bar while
  retaining the ResOS project sidebar. The rest of the recording is preserved.
- `resos-demo-preview.gif` is a silent excerpt showing the linked and nested
  discussions, accelerated three times. It displays directly in the README and
  links to the full MP4 with narration.

Source recording: `2026-11-12 17-38-18.mp4` (1280 × 720, 60 fps, 102.5 seconds).
Keep the original outside the repository. Run these commands from the repository
root, replacing the input path with the recording's location:

```sh
ffmpeg -n -ss 1.75 -i '/path/to/2026-11-12 17-38-18.mp4' \
  -map 0:v:0 -map 0:a:0 -vf 'crop=1224:662:56:58,fps=30' \
  -c:v libx264 -preset medium -crf 19 -pix_fmt yuv420p \
  -c:a aac -b:a 128k -map_metadata -1 -movflags +faststart \
  docs/media/resos-demo.mp4

ffmpeg -n -ss 28.25 -t 38 -i docs/media/resos-demo.mp4 \
  -filter_complex \
  '[0:v]setpts=(PTS-STARTPTS)/3,fps=10,scale=1000:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle[v]' \
  -map '[v]' -an -loop 0 docs/media/resos-demo-preview.gif
```

## Verification (2026-11-12)

- Cropped frames at the opening, linked discussion, nested discussion, and ending
  were visually inspected. The dock and system bars are absent; the app sidebar
  and discussion panes remain visible. The preview includes the nested question.
- `ffprobe` confirmed 1224 × 662 H.264 video at 30 fps, AAC audio, both starting
  at timestamp zero, and a total duration of 100.77 seconds.
- `ffmpeg -v error -i docs/media/resos-demo.mp4 -f null -` decoded the entire
  video and audio without errors. Silence detection placed the first voice
  activity about 0.13 seconds into the edited recording.
- Pillow confirmed a 1000 × 541 GIF with 127 frames and a 12.7-second loop.
  All README media paths resolve to the kept files.
- `npx --no-install prettier --check README.md docs/media/README.md` and
  `git diff --check` passed.
- Adversarial review found no scope, crop, media-link, or wording defects.
  Hosted GitHub rendering was not tested; these are local repository changes.
