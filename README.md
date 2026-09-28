# Ketik — Typing Trainer

A typing speed trainer built with **vanilla HTML, CSS and JavaScript**. It has no framework,
no build step and no dependencies. Open `index.html` and start typing.

*Ketik* is Indonesian for "type". The app has English and Bahasa Indonesia word lists.

## Why this exists

Plenty of typing tests tell you how fast you are. Ketik also works out **which keys you
keep missing**, then builds practice around those keys. Every keystroke is compared with
the character that was expected, so after a few tests the app has a miss rate for each
key. The *weak keys* mode uses those rates to pick words that contain the letters you
struggle with.

## Features

| | |
|---|---|
| **Two test modes** | `time` (15 / 30 / 60 / 120 s) or `words` (10 / 25 / 50 / 100) |
| **Two languages** | English and Bahasa Indonesia |
| **Live feedback** | Correct, wrong and extra letters are colored; mistyped words are underlined; a smooth caret scrolls the text by line |
| **Results** | Net WPM, raw WPM, accuracy, consistency, a character breakdown, and a chart of speed over the test with error markers |
| **Key heatmap** | A keyboard shaded by miss rate, for each test and for all time |
| **Weak-key practice** | Unlocks after about 300 keystrokes. Words are picked with a weighting that favors your most-missed letters |
| **Stats page** | WPM trend with a 10-test rolling average, personal bests for each setup, and recent history |
| **Themes** | Light and dark, following the system setting, with a manual toggle |
| **Mobile** | Works with on-screen keyboards, and the layout fits phone screens |

## Keyboard shortcuts

| Key | Action |
|---|---|
| `Tab` / `Esc` | Restart, or go to the next test from the results screen |
| `Ctrl` + `Backspace` | Delete the current word |
| `Backspace` on an empty word | Go back into the previous word, only if it has a mistake |

## How the numbers are calculated

- **WPM (net):** characters in fully correct words plus their spaces, divided by 5, per minute. A word with a mistake adds nothing.
- **Raw WPM:** every character typed, divided by 5, per minute.
- **Accuracy:** correct keystrokes ÷ all keystrokes. A mistake still counts after you fix it.
- **Consistency:** `100 × (1 − σ/μ)` of the raw speed for each second. 100% means perfectly even pace.
- **Miss rate for each key:** how often you typed something else when that key was expected. For weak-key practice, each rate is shrunk toward your overall miss rate, so a key you've only typed three times can't top the list.

## Project structure

```
.
├── index.html   markup for the test, results and stats views
├── styles.css   design tokens (light/dark), layout, heatmap ramp
├── words.js     English and Indonesian word lists
└── app.js       typing engine, scoring, SVG charts, heatmap, storage
```

## Running it

Open `index.html` in a browser. If you want a local server:

```bash
npx serve .
```

## Privacy

Test history and settings are saved in your browser's `localStorage`. Nothing is sent
anywhere. To wipe your history, use **Stats → clear history**.

## Ideas for next steps

- Punctuation and number modes
- Quote mode with real sentences
- Export and import history as JSON
- Finger heatmap that groups keys by the finger that should press them
