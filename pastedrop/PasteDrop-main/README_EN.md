# PasteDrop

Turn images in your clipboard directly into files.

`PasteDrop` is a lightweight Windows utility. When you press `Ctrl+V` on the desktop or inside File Explorer, if the clipboard currently contains an image, it will save that image as a PNG file in the current location instead of doing nothing.

It is useful for screenshot cleanup, asset collection, document illustrations, and any situation where you just want to quickly drop an image from the clipboard onto disk.

## Demo Video

<video src=".readme/Video_2026-04-24_194819.mp4" controls muted playsinline></video>

## Why Use It

- No need to open Paint, a screenshot tool, or a chat app as a workaround
- No need to manually click "Save As"
- Keeps the familiar `Ctrl+V` workflow
- Works on both the Windows desktop and in File Explorer
- Saves the image directly into the current target location

## What It Does

- Press `Ctrl+V` on the desktop: save the image to the desktop
- Press `Ctrl+V` in File Explorer: save the image to the current folder
- If the clipboard content is not an image: pass the original `Ctrl+V` through without breaking normal paste behavior
- Automatically generate a timestamp-based filename to avoid overwriting existing files

Default filename format:

```text
Pasted Image YYYY-MM-DD HH-MM-SS.png
```

If the name already exists, a numeric suffix is appended automatically.

## Quick Start

### Option 1: Use the Executable

1. Download the executable from [Releases](https://github.com/lanxiuyun/PasteDrop/releases)
2. Run it and keep it running in the background
3. Copy an image, then press `Ctrl+V` on the desktop or in File Explorer

If you want it to launch automatically on startup, place the executable in:

```text
C:\ProgramData\Microsoft\Windows\Start Menu\Programs\Startup
```

### Option 2: Run from Source

Install dependencies:

```bash
pip install pillow pywin32 loguru
```

Start the app:

```bash
python pastedrop.py
```

## How It Feels

You can think of it as a missing Windows feature that should have existed already:

- Take a screenshot, go to the desktop, press `Ctrl+V`, and it instantly becomes a file
- Open an asset folder, press `Ctrl+V`, and the image lands there without opening any editor
- Non-image clipboard content still pastes normally, so your existing habits do not change

There are no extra dialogs, no import flow, and no unnecessary confirmations.

## Behavior Notes

- Only intercepts `Ctrl+V` on the desktop and in File Explorer
- Paste behavior in other applications stays unchanged
- Stops listening when the program exits
- Marks its own simulated key events to avoid recursive triggering

## Typical Use Cases

- Organizing lots of screenshots
- Collecting images from web pages or chat tools
- Quickly dropping clipboard images into a project folder
- Using the desktop as a temporary image inbox

## Notes

- This tool relies on a global keyboard hook, so it is best run as a normal foreground script or a packaged EXE
- It only changes behavior for the desktop and File Explorer; other applications are not affected
- Some apps take over the clipboard format; if the copied result is not exposed as a standard image object, normal paste will continue instead

## Logs And Troubleshooting

The program uses `loguru` to print runtime logs to the console.

If you run into cases like "no file was created" or "it looks like nothing was triggered", check for these log messages:

- `Ctrl+V event#...`
- `Ctrl+V intercepted, WM_APP posted`
- `Received WM_APP_PASTE_IMAGE`
- `Resolved save directory`

## Known Bugs

- If you copied a normal image but it still refuses to paste, chances are you did nothing wrong and the software really does have a bug, haha.
- Copying files into the clipboard cannot be pasted correctly
- Images copied from WeCom / WeChat Work cannot always be pasted as files
