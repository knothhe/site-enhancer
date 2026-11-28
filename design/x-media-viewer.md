# X media viewer, playback speed and screenshot preview design

Scope: `utils/x-image-viewer.ts`, `utils/x-video-viewer.ts`, `utils/x-video-playback.ts`,
`utils/x-screenshot.ts`, `utils/x-screenshot-preview.ts`, `utils/x-menu.ts`, `utils/x-columns.ts`.

## 1. One media viewer for images and videos

The image viewer and the video viewer become one viewer. It has one ordered item list per post, one
counter, one set of prev/next controls, one close action, one keyboard map and one help panel. Only
the tools differ by item kind:

```
┌───────────────────────────────────────────────────────────────────────────┐
│ [×]  2 / 4  ▣│▶                     [kind tools ………………]  [⧉] [⤓]  [?]    │  ← shared top bar
│                                                                           │
│ [‹]                     current item (image stage OR X player)        [›] │  ← shared side buttons
│                                                                           │
└───────────────────────────────────────────────────────────────────────────┘
 image tools: [−] 100% [+] [fit] [1:1] [rotate]
 video tools: [speed 1.5× ▾]   (X's own controls stay at the bottom of the player)
```

* Items are the photos and videos of one post, in DOM order. Quoted-post media belongs to the quoted
  post's own list, as photos do today. GIFs are video items without the speed tool.
* The counter shows a small kind glyph (image/play) before `n / total` only when the list is mixed.
* Opening: clicking a photo opens at that photo, as now. The video "Full screen" button opens at that
  video. Inside the viewer, every item is reachable with prev/next.
* Video items keep X's real player in place. Do not clone or move it, so MediaSource, X controls and
  Readomi captions keep working (see commit ce8244f). Show the video through `requestFullscreen()` on
  the player. Mount the shared chrome (top bar and side buttons) inside the player while it is
  fullscreen. The chrome uses the same CSS tokens, sizes and icons as the image viewer, not a second
  style.
* Image items use the existing dialog stage. When the viewer is fullscreen, put the image dialog into
  fullscreen too. Switching between kinds must then be a fullscreen-element swap: request fullscreen on
  the next element before leaving the current one. The window must not leave fullscreen and enter it
  again (no resize flash). If fullscreen is unavailable or rejected, fall back to the modal dialog for
  images and the CSS-expanded fixed player for video. Navigation must still work then.
* Leaving a video item pauses that video. Entering a video item plays it with the shared volume and
  speed. Closing the viewer restores the page's scroll position and focus, and ends fullscreen.
* Keyboard (same everywhere; the help panel lists it):
  * `←/→`, `PageUp/PageDown`, `↑/↓` when the item is not pannable: previous/next item. `Home/End`:
    first/last item. `Esc`: close.
  * Image only: as today (`+ − 0 F 1 T C E R`, WASD pan).
  * Video only: `Space/K` play/pause, `J/L` seek −5/+5 s, `M` mute, `<` / `>` speed down/up. Hold
    `Shift+>` or long-press the speed pill for a temporary 2× while held. With a single item, `←/→`
    also seek ±5 s.
  * Keys must not leak to X's shortcuts while the viewer is open. Don't hijack keys while focus is in
    X's own player controls (sliders).
* Trackpad horizontal swipe and image slide motion: keep them for image→image. For any switch that
  involves a video, use a short 120 ms crossfade. Respect `prefers-reduced-motion`.
* Timeline frames (multi-column detail iframes) keep today's "Watch on X post" behaviour for video.

## 2. Playback speed

Replace the cycling text button with a speed pill and popover.

```
 feed / viewer pill          popover (opens below/above the pill, stays inside the player)
 ┌──────┐                    ┌─────────────────────────────────────┐
 │ ⏱ 1× │  (1×: muted)       │ 0.5  0.75 [1] 1.25  1.5  1.75  2  3  │  ← segmented, current filled
 └──────┘                    │ ─────────────────────────────────── │
 ┌───────┐                   │ ◂  1.5×  ▸   fine steps ±0.25        │
 │⏱ 1.5× │  (≠1×: accent)    └─────────────────────────────────────┘
 └───────┘
```

* Pill: icon plus rate, tabular numbers, `1×` style (not `1x`). Neutral at 1×; accent tint
  (`--se-x-accent`, default `#1d9bf0`) when it is not 1×, so a changed speed is obvious.
* Click opens the popover. Wheel over the pill steps ±0.25. Clicking a preset applies it and closes.
  `Esc` or an outside click closes only the popover. Popover keyboard: arrow keys move, Enter applies,
  with `role="radiogroup"` semantics.
* Rate changes show a centred HUD (`1.5×`, 600 ms fade) in the player.
* The chosen speed is shared and remembered like the volume (same pattern as `VIDEO_VOLUME_KEY` in
  `x-video-playback.ts`, a new `localStorage` key). It is applied to every non-GIF video when it starts
  playing, including X re-creating the `<video>`. Range 0.25–4.
* Feed pill: top-left, as today, only on hover/focus of the player or when the rate is not 1×. Viewer:
  in the shared top bar's video tools.

## 3. Screenshot preview (icon-first)

```
┌────────────────────────────────────────────────────── [×] ┐   no title text; close is an icon
│                                                           │
│                 ┌───────────────────────────┐             │
│                 │       rendered post       │             │   canvas on raised surface
│                 └───────────────────────────┘             │
│                                                           │
│        ╭───────────────────────────────────────────╮      │
│        │ [▥̸] [↰]   │   [⤓]  [⧉ Copy]           ⟳  │      │   one floating pill toolbar
│        ╰───────────────────────────────────────────╯      │
└───────────────────────────────────────────────────────────┘
```

* Remove the `<h2>` title and the persistent footer sentence. The dialog keeps its `aria-label`.
* Toolbar, left to right:
  * Toggle "Hide metrics": icon button (bar chart, crossed out when hidden), `aria-pressed`.
  * Toggle "Include original post" (only when there is a parent): thread/reply icon, `aria-pressed`.
  * A divider.
  * Download: icon only.
  * Copy: the primary accent button, icon plus the short word "Copy"/"复制". It is the only text.
* Every icon button has `title` and `aria-label` with its shortcut, e.g. `隐藏互动数据 (H)`.
  Shortcuts: `C` copy, `S` download, `H` metrics, `P` parent, `Esc` close.
* Pressed toggles use the accent tint plus the icon state. Don't rely on colour alone.
* Status: no permanent text. Rendering shows a small spinner inside the toolbar (right slot). Copy
  success turns the copy icon into a check for 1.5 s. Errors use a compact toast above the toolbar.
  Keep one visually hidden `role="status"` live region for screen readers.
* Light and dark follow the existing host-tone detection and `--se-x-*` tokens.

### No flicker when toggling options

* Keep the current canvas on screen until the new one is ready, then swap it in one frame. Never
  empty the body, collapse its height or reset its scroll during a rerender.
* Don't change layout while busy. Disabled states must not shift sizes. Show the spinner only after
  150 ms.
* Pre-render the alternate `hideMetrics` variant (and the parent variant if present) at idle time
  after the first canvas, and cache canvases and PNG promises by option key. Toggling back and forth
  is then instant.
* Swap with a 120 ms opacity crossfade between the stacked old and new canvases, or instantly under
  reduced motion. Keep the vertical scroll ratio stable.
* Find the real cause of the flash in a browser first (for example the dialog height jumping, the
  canvas being replaced, or the page mutating during capture). Fix that cause. Don't just mask it.

### Videos in screenshots

* A video in the post must appear as a still preview: poster or first frame, at the media box's
  exact size and crop (`object-fit` as displayed). No black or empty box.
* Hide all player tools in the capture: X's play/pause, progress bar, time and duration labels,
  volume, settings and fullscreen buttons, "GIF"/"ALT" badges on video, loading spinners, and this
  extension's own expand and speed buttons (`[data-site-enhancer-video-expand]`,
  `[data-site-enhancer-video-speed]`, the speed popover and the HUD).
* Draw one subtle centred play glyph (a 56 px translucent dark circle with a white triangle) so the
  still image reads as a video. Don't draw it for GIFs.
* Use the poster (`video.poster` or X's poster `<img>`, both pbs.twimg.com). Don't draw a
  cross-origin `<video>` frame, because it taints the canvas. If there's no poster, draw a frame
  only when it is same-origin or CORS-safe. Otherwise use a neutral placeholder with the play glyph.

## 4. Video control bar in the viewer

In the viewer, a video item gets its own bottom control bar, made from the same tokens and icons as
the top bar. X's native control bar is hidden while the player is expanded, so controls are never
shown twice. The feed keeps X's own controls.

```
│                                                                              │
│ ▔▔▔ bottom gradient #000 0% → #0000 (96px) ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔ │
│ ━━━━━━━━━━━━━━━━━━━━━━━━●━━━━━━━━━━──────────────────────────────────── 0:23 │  seek: played ━ accent, buffered ━ #fff6, rest #fff3
│ [⏸] [🔊]─────●──  0:11 / 0:23                              [⏱ 1.25×]  [⧉PiP] │  40px buttons, same style as top bar
```

* Seek bar: full width, with 16px side insets matching the top bar. It is 4px tall and grows to 6px on
  hover or drag, with a 12px thumb that appears on hover, drag or focus. A hover tooltip shows the
  time under the pointer. Use pointer capture for drag and seek live while dragging. Show the buffered
  ranges. Give it `role="slider"` with aria-valuetext such as "0:11 / 0:23". When it is focused, ←/→
  seek 5 s and Home/End jump (it is a slider, so the viewer's item navigation doesn't take these
  keys).
* Play/pause button (Space/K). Clicking the video surface also toggles play. The icon reflects the
  state.
* Volume: a mute button with a level-based icon (muted/low/high) plus a 72px horizontal slider that
  expands on hover or focus. It writes through the shared, remembered volume (`VIDEO_VOLUME_KEY`
  flow in x-video-playback.ts). `M` mutes.
* Time: `current / duration` in tabular numbers.
* The speed pill moves from the top bar into the right side of this bar, and its popover opens
  upward. Picture-in-picture appears only when `document.pictureInPictureEnabled`.
* GIF items: progress bar and play/pause only. No volume, speed or time.
* Auto-hide: the top bar, the bottom bar and the side buttons fade out (200 ms) after 2.5 s without
  pointer movement while playing, and the cursor hides too. They stay visible while paused, while the
  pointer is over a control, while a control has focus or a popover is open, and briefly after any
  keyboard action.
* Captions (for example Readomi) must stay readable. While the bar is visible, lift any caption layer
  inside the player by the bar height, using a CSS variable `--se-video-bar-height`. Don't cover the
  captions with the gradient.
