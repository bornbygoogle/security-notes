# Unpacking Tetrix — a beginner's walkthrough

**TryHackMe · Hackfinity Battle 2025 · challenge file: `Tetrix.exe`**

This guide assumes you have **never reverse-engineered a binary before**. Every command is
explained piece by piece, and every bit of jargon gets defined the first time it shows up.

---

## 0. What are we even doing?

The challenge says:

> *Cipher has gone dark, but intel reveals he's hiding critical secrets inside Tetris, a popular
> video game. Hack it and uncover the encrypted data buried in its code.*

We're given one file: a Tetris game for Windows. Somewhere inside it is a **flag** — a short secret
string in the format `THM{...}` that proves you solved the challenge. You paste it into TryHackMe to
score the point.

We are **not** going to run the game. We're going to read the file as *data* and pull the secret out.
That's called **static analysis** — studying a program without executing it. It's the safe default,
because running an unknown Windows binary on your machine is how people get infected.

**The answer, up front:**

```
THM{I_CAN_READ_IT_ALL}
```

Now let's understand how to find it — and, more interestingly, *why the challenge author thought you
couldn't*.

---

## 1. Setup

You're on Kali Linux, so you already have everything. On another distro, install:

```bash
sudo apt install binutils file unzip xxd binwalk python3-pip pv
pip install zstandard cryptography
```

| Tool | What it does |
|---|---|
| `file` | Guesses what kind of file something is |
| `strings` | Pulls readable text out of a binary file |
| `grep` | Searches text for a pattern |
| `xxd` | Shows raw bytes as hexadecimal ("hexdump") |
| `objdump` | Inspects the internal structure of programs |
| `binwalk` | Looks for known file types hidden inside other files |
| `python3` | For when we need to parse a format by hand |
| `pv` | Shows a live progress bar for slow commands |

Work on a **copy**, never the original download:

```bash
mkdir -p ~/work/tetrix && cd ~/work/tetrix
unzip -o ~/Downloads/Tetrix.exe-1741979048280.zip -x "__MACOSX/*"
```

- `-o` = overwrite without asking.
- `-x "__MACOSX/*"` = skip that folder. It's junk metadata created when someone zips a file on a Mac.
  It is **not** part of the challenge.

Record what you've got. Anytime you handle a sample, note its size and hash — a **hash** is a
fingerprint, so you can prove later you analysed exactly this file:

```bash
ls -l Tetrix.exe          # 93,021,728 bytes  (~93 MB)
sha256sum Tetrix.exe      # 64ba9f8a44b6d28026117497eedac76bf30189a09b5d8b7decf47fbd353ec96f
```

---

## 2. The 10-second solution

Let's be honest about this, because pretending otherwise would teach you the wrong habit. This
challenge falls to one command:

```bash
strings -a Tetrix.exe | grep "THM{"
```

Output:

```
THM{I_CAN_READ_IT_ALL}
```

**That's the flag. Done.**

### What that command actually did

A binary file is mostly machine instructions and compressed data — bytes that aren't text. But
programs also contain plenty of real text: menu labels, error messages, file paths. `strings` walks
the whole file looking for runs of printable characters and prints them.

- `strings` — extract readable text.
- `-a` — scan the **entire** file. Without it, `strings` only looks inside sections it thinks contain
  data, and it would **miss our flag**, because our flag isn't in a normal code section. Get in the
  habit of always using `-a`.
- `|` — the "pipe". Takes the output of the left command and feeds it as input to the right one.
- `grep "THM{"` — print only the lines containing `THM{`.

Why filter at all? Because:

```bash
strings -a Tetrix.exe | wc -l
# 1086260
```

Over a million lines of text. `grep` is what makes that searchable.

> **Newbie habit worth building:** on *any* CTF file, run `strings -a file | grep -i "flag\|THM{\|CTF{"`
> first. It costs five seconds. If it works, great. If it doesn't, you've lost nothing and you now
> know the flag is hidden more carefully.

### "Is it stuck?" — adding progress

That command prints **nothing at all** until it finishes. On a 93 MB file that's an uncomfortable
wait with no feedback, and your instinct is right to be suspicious — you should always be able to
tell a working command from a hung one.

First, find out how long it actually takes. Put `time` in front of anything:

```bash
time ( strings -a Tetrix.exe | grep "THM{" )
```

```
THM{I_CAN_READ_IT_ALL}
( strings -a Tetrix.exe | grep "THM{"; )  0.78s user 0.05s system 103% cpu 0.804 total
```

Read the numbers: **`user 0.78s`** = time spent doing actual computation. **`103% cpu`** = it kept a
whole processor core busy. So this command is **CPU-bound** — the delay is `strings` inspecting
93 million bytes, not your disk being slow. On a slower laptop or a VM with few cores, the same work
can easily take several seconds.

#### Option 1 — `pv`, the progress bar for pipes

`pv` ("pipe viewer") copies data through a pipe while drawing a live progress bar. Put it at the
*start*, reading the file:

```bash
pv Tetrix.exe | strings -a | grep "THM{"
```

```
88.7MiB 0:00:00 [ 101MiB/s] [=========================>] 100%
THM{I_CAN_READ_IT_ALL}
```

You get bytes processed, elapsed time, throughput, a bar and an ETA. Install it with
`sudo apt install pv` if it's missing.

You can also measure the *output* side. `-l` counts **lines** instead of bytes:

```bash
strings -a Tetrix.exe | pv -l | grep "THM{"
```

```
1.09M 0:00:00 [1.32M/s] [ <=> ]
```

That's the 1,086,260 lines of text we counted earlier, flowing past in real time. There's no
percentage here because nothing knows the total in advance — but a moving counter still proves it's
alive.

#### Option 2 — rescue a command you already started

This is the one worth remembering. You launched something, it's been silent for a minute, and you
don't want to lose the work by killing it. You can attach to the **already-running process** and see
how far it got.

In a second terminal:

```bash
pgrep -a strings          # find the process id
pv -d 112431              # watch it  (-d = "watch this PID")
```

```
3:Tetrix.exe: 11.0MiB 0:00:00 [0.00 B/s] [>        ] 12% ETA 0:00:00
```

`pv -d` inspects which files the process has open and how far through them it has read. **12%** —
it's working, just quiet. No need to kill anything.

#### Option 3 — don't build the haystack in the first place

If all you want to know is *"does this file contain `THM{`?"*, you don't need `strings` at all.
`grep -a` searches the raw bytes directly:

```bash
time ( grep -a "THM{" Tetrix.exe )
```

```
( grep -a "THM{" Tetrix.exe; )  0.00s user 0.02s system 99% cpu 0.023 total
```

**0.023 seconds versus 0.804 — about 35× faster.** The catch is the output: `grep` prints the whole
"line" it matched, and in a binary a "line" is whatever sits between two newline bytes, so you get a
screenful of garbage around your flag.

Best of both — let `grep` find it fast, then clean up the result:

```bash
grep -ao "THM{[^}]*}" Tetrix.exe
```

```
THM{I_CAN_READ_IT_ALL}
```

`-o` prints **only** the matched part, not the whole line. `THM{[^}]*}` means: the text `THM{`, then
any number of characters that aren't `}`, then a `}`. Fast *and* clean.

#### Option 4 — make matches appear the moment they're found

For a genuinely long-running search, `grep` holds its output in a buffer and flushes it in chunks,
so results can appear late and in bursts. Force it to print each match immediately:

```bash
strings -a Tetrix.exe | grep --line-buffered "THM{"
```

This does **not** make the command faster — it changes *when* you see results, not how long the work
takes. Useful when you're grepping something slow (a huge log, a live capture) and want the first hit
the instant it exists.

> **The habit:** if a command might run long, either give it a progress indicator or know its
> expected runtime. "I can't tell whether this is working" is a real problem, not impatience — and
> it's how people kill jobs that were about to succeed.

### So why keep reading?

Because "it worked" is not the same as "I understand it." Three questions are still open:

1. **Where** in a 93 MB file did that text live?
2. The challenge said *"encrypted data"* — so what was encrypted, and why didn't it stop us?
3. What would I do if `strings` had found **nothing**?

The rest of this guide answers those. That's the part that transfers to the next challenge.

---

## 3. Vocabulary you'll need

Read this once; refer back as needed.

**Byte** — the basic unit of a file. A number from 0 to 255. A 93 MB file is ~93 million of them.

**Hexadecimal (hex)** — counting in base 16 instead of base 10, using digits `0-9` then `a-f`. One
byte = exactly two hex digits (`00` to `ff`). We write hex with a `0x` prefix. Binary people use hex
because it lines up neatly with bytes; decimal doesn't.

- `0x10` = 16 · `0xFF` = 255 · `0x5036600` = 84,108,800
- Convert anytime: `python3 -c "print(0x5036600)"`

**Offset** — a position in a file, counted in bytes from the very beginning. "Offset `0x5036600`"
means "84,108,800 bytes in from the start." Think of it as a page number for bytes.

**Magic bytes / signature** — most file formats begin with a fixed marker so programs can recognise
them. PNG images start with `\x89PNG`. ZIP files start with `PK`. This is how `file` and `binwalk`
guess file types — and how *we* will find things hidden inside a bigger file.

**PE (Portable Executable)** — the format of Windows `.exe` files. A `.exe` isn't one solid lump;
it's a container divided into **sections**, each with a name and a job (`.text` = the actual code,
`.rdata` = constants, and so on).

**Game engine** — games are almost never written from scratch. Developers use an engine (Unity,
Unreal, Godot, GameMaker) that handles graphics, sound and physics. **This matters enormously:** if
you identify the engine, its file formats are publicly documented, and "reverse-engineer a mystery
binary" turns into "read a format spec." That's a hundred times easier.

**Asset archive** — engines bundle all the game's art, sound, levels and scripts into one archive
file, like a ZIP. In Godot it's called a **PCK**.

**Encryption vs. compression** — encryption scrambles data so only someone with the **key** can read
it. Compression shrinks data; anyone can undo it, no key needed. **Both produce random-looking
bytes**, which is a trap we'll walk into deliberately later.

---

## 4. The proper investigation

### Step 1 — Ask the file what it is

Never open a big unknown binary in a disassembler as your first move. Ask cheap questions first.

```bash
file Tetrix.exe
```

```
Tetrix.exe: PE32+ executable for MS Windows 5.02 (GUI), x86-64 (stripped to external PDB), 13 sections
```

Translated:

- **PE32+** — a 64-bit Windows executable.
- **GUI** — it opens a window (as opposed to a console app).
- **x86-64** — built for normal Intel/AMD 64-bit processors.
- **stripped** — the debug symbols (human-readable function names) were removed. Normal for a
  shipped game.
- **13 sections** — the container has 13 internal compartments.

Now, one observation that should nag at you: **the file is 93 MB.** Hand-written game code is
*never* that big. A Tetris clone is maybe a few thousand lines. So the vast majority of this file
must be **data** — art, music, levels. That's a strong hint before we've looked at a single
instruction.

### Step 2 — Look at the compartments

```bash
objdump -h Tetrix.exe
```

`-h` means "show me the section headers" — the table of contents.

```
Idx Name          Size      File off
  0 .text         03ee1650  00000400
  1 .data         0004a5c0  03ee1c00
  2 .rdata        00da4400  03f2c200
  3 pck           00000008  05036600     ←  interesting
  ...
```

`.text`, `.data`, `.rdata` are standard names you'll see in every Windows program. But **`pck` is
not standard.** Somebody added that. Unusual names are where you look first.

> **Checkpoint:** you should now be able to say — this is a 64-bit Windows game, most of it is data
> rather than code, and there's a non-standard section called `pck`.

### Step 3 — Fingerprint the engine

This is the most important skill in the whole guide, so we'll go slowly.

#### 3.0 — What "fingerprinting" means

**Fingerprinting = working out what something was built with, by finding traces the builder left
behind.**

An analogy. You're handed an unlabelled car. You don't know the manufacturer. But you open the
bonnet and find a part stamped *"Bosch"*, the manual in the glovebox says *"© Volkswagen"*, and the
tyre size matches a Golf. You never needed a badge on the front — the car told you what it is.

Software is the same. When a developer builds a game, their few thousand lines of code get merged
with **millions of lines of engine code**. All of that engine code brings its own text along:

- error messages (*"A Bone2D only works with a Skeleton2D…"*)
- internal class names (`GodotArea2D`, `GodotBodyPair3D`)
- copyright and licence text
- even the engine's list of contributors

The game developer never sees these strings and has no easy way to strip them. **That's our
fingerprint.**

#### 3.1 — Why we bother

Because it changes the entire difficulty of the challenge:

| Without fingerprinting | With fingerprinting |
|---|---|
| "A mystery 93 MB binary. I'll open a disassembler and read x86 assembly." | "A Godot 4.3 game. Godot is open source — I'll read the documented file format." |
| Weeks | Minutes |

Identifying the engine converts *reverse engineering* into *reading a spec*. That's the whole game.

#### 3.2 — Method A: let the file talk (when you know nothing)

You don't need a memorised list of signatures. You can **discover** the answer. Start naively and
watch it fail, because the failure teaches you something.

**Naive attempt — what text appears most often?**

```bash
strings -a -n 8 Tetrix.exe | sort | uniq -c | sort -rn | head -5
```

Piece by piece: `-n 8` = only text at least 8 characters long · `sort` = group identical lines
together · `uniq -c` = collapse duplicates and prefix each with its count · `sort -rn` = sort by
that count, highest first · `head -5` = show the top 5.

```
  17707 AWAVAUATUWVSH
  13163 [^_]A\A]A^A_
   5063 AUATUWVSH
   3711 AVAUATUWVSH
   2043 H[^_]A\A]A^A_
```

Useless. **Why?** Those aren't words — they're *machine code that happens to look like letters*.
The byte `0x41` means "push register R8" to the processor, but `strings` sees the letter `A`.
Every function in the program starts with a similar burst, so they dominate the count.

> **Lesson:** `strings` cannot tell text from coincidence. Never trust raw frequency on a binary.

**Better attempt — filter for text that looks like real human sentences:**

```bash
strings -a -n 25 Tetrix.exe | grep -E "^[A-Za-z][A-Za-z0-9 ,.'()-]+$" | sort -u | head
```

`-n 25` = at least 25 characters (accidental text is rarely that long) · the `grep -E "..."` keeps
only lines made entirely of letters, digits, spaces and basic punctuation, starting with a letter ·
`sort -u` = sort and remove duplicates.

```
AABB size is negative, this is not supported. Use AABB.abs() to get an AABB with a positive size.
Aaron Franke (aaronfranke)
A Bone2D only works with a Skeleton2D or another Bone2D as parent node.
Abort on graphics API usage errors (usually validation layer errors)...
```

Now we're getting somewhere. These are **engine error messages** and what looks like a **list of
people's names**. A Tetris clone doesn't have contributors — an open-source engine does.

**Targeted attempt — go straight for the credits.**

Almost every serious library embeds a copyright line, and they nearly all share the same shape:
*a year, a dash, another year (or the word "present"), a comma, then names.* Search for that shape:

```bash
strings -a -n 10 Tetrix.exe | grep -iE "[0-9]{4}(-present|-[0-9]{4}), " | sort -u
```

The pattern in `grep -E "..."` reads as: `[0-9]{4}` = exactly four digits (a year) · `( … | … )` =
either of two options · `-present` or `-[0-9]{4}` = a dash then "present" or another year · `, ` =
followed by a comma and a space.

That returns **66 lines** — the program's complete bill of materials. An excerpt:

```
1995-2024, Jean-loup Gailly and Mark Adler          ← zlib (compression)
1995-2024, The PNG Reference Library Authors.       ← libpng (images)
1996-2023, David Turner, Robert Wilhelm, ...        ← FreeType (fonts)
2002-2015, Xiph.org Foundation                      ← Ogg/Vorbis (audio)
2007-2014, Juan Linietsky, Ariel Manzur             ← ***
2014-present, Godot Engine contributors             ← ***
2014-2024, Valve Corporation
2019-2022, NVIDIA Corporation
```

**There it is, stated in plain English:**

```
2014-present, Godot Engine contributors
```

And the line above it — *Juan Linietsky, Ariel Manzur* — are the two people who created Godot. Two
confirmations in adjacent lines.

Notice what else this gave us for free: zlib, libpng, FreeType, Ogg/Vorbis. That explains the
compressed, random-looking data we'll meet in section 6, and in real security work this same command
is how you spot outdated, vulnerable libraries bundled inside a program.

> **Why this beats memorising signatures:** you didn't need to know anything about Godot in advance.
> You asked "who wrote the code in this file?" and the file answered.

#### 3.3 — Method B: test a checklist (confirming a suspicion)

Once you suspect an engine, confirm it against a list of known markers. Here is a starter table
worth keeping:

| If you find… | It was built with |
|---|---|
| `GDPC`, `godot`, `GDScript` | **Godot** |
| `UnityPlayer`, `MonoBleedingEdge`, `Assembly-CSharp` | **Unity** |
| `UE4`, `UnrealEngine`, `.pak` | **Unreal Engine** |
| `PyInstaller`, `MEIPASS`, `python3xx.dll` | **Python** bundled with PyInstaller |
| `GameMaker`, `YoYo Games` | **GameMaker Studio** |
| `Electron`, `node_modules`, `app.asar` | **Electron** (a web app in a desktop wrapper) |
| `UPX!` | not an engine — the file is **packed/compressed** |

Test them all at once:

```bash
for m in GDPC godot UnityPlayer MonoBleedingEdge PyInstaller GameMaker; do
    echo "$m: $(grep -a -c "$m" Tetrix.exe)"
done
```

**Reading this line by line — it's simpler than it looks:**

- `for m in A B C; do … done` — a loop. Run the middle part once per item, each time putting the
  current item into a variable named `m`.
- `$m` — "the value currently in `m`".
- `$( … )` — "run this command and paste its output right here".
- `grep -a` — `-a` forces grep to treat a binary file as text. Without it grep just prints
  *"Binary file matches"* and gives you no number.
- `grep -c` — count instead of printing the matches.

Result:

```
GDPC: 4
godot: 248
UnityPlayer: 0
MonoBleedingEdge: 0
PyInstaller: 0
GameMaker: 0
```

**How to read that:** Unity, Python and GameMaker are flat zero — definitively not those. `godot`
appears on 248 lines. `GDPC` appears on 4.

> **A precision detail people get wrong:** `-c` counts matching **lines**, not matching
> **occurrences**. One line can hold the word several times. To count real occurrences use `-o`
> (print each match on its own line) piped into `wc -l` (count lines):
>
> ```bash
> grep -a -o "godot" Tetrix.exe | wc -l     # 787 actual occurrences, not 248
> ```
>
> For fingerprinting the exact number doesn't matter — **zero vs. non-zero** is the whole signal.

#### 3.4 — Method C: cross-check against structure

A good fingerprint is confirmed from more than one direction. We already have two other pieces of
evidence pointing the same way:

1. `objdump -h` showed a **non-standard section named `pck`** — and PCK is Godot's archive format.
2. The very last 4 bytes of the file are `GDPC` (we'll confirm this in Step 4).

Three independent signals — readable copyright text, `grep` counts, and the file's own structure —
all say **Godot**. That's a conclusion, not a guess.

#### 3.5 — Telling a real hit from a false one

Signatures produce false positives constantly. Apply three tests:

1. **Is it plausible?** Would this kind of file *reasonably* contain that? (An ESP32 firmware
   header inside a Tetris game: no. See section 6.)
2. **How long is the marker?** Short markers appear by chance. In 93 MB of data, any given 4-byte
   sequence turns up roughly 350 times by pure luck. `GDPC` is only convincing because it also sits
   *exactly* where the format says it should.
3. **Does anything else agree?** One signal is a guess. Three independent signals is an
   identification.

#### 3.6 — If nothing matches

Work down this ladder:

1. `strings -a file | less` and simply **read**. Look for file paths (`C:\Users\dev\...` leaks the
   developer's project name), URLs, product names, error messages.
2. Search any distinctive string you find on the web — someone has usually met that framework.
3. Check for **packing**: run `binwalk -E file` (entropy). If entropy is uniformly ~8.0 across the
   *whole* file including where code should be, it's compressed or encrypted — look for `UPX!` and
   try `upx -d file`.
4. Check the file's tail and head for appended archives (`PK` = ZIP, `7z¼¯'` = 7-Zip).
5. Only then reach for Ghidra or radare2.

> **Checkpoint:** you should now be able to take any unknown binary and answer *"what was this built
> with?"* using two independent methods — reading its embedded text, and testing a signature list.

Godot is free and open source, which means **its file formats are fully documented and its source
code is public.** So we can simply look up how a PCK archive is laid out — which is exactly what we
do next.

### Step 4 — Find the archive

Here's how Godot's single-file export works: it takes the game engine `.exe` and **staples the asset
archive onto the end of it.** At startup the program reads the last 12 bytes of itself to find out
where its own archive begins.

Look at those last 12 bytes:

```bash
xxd -s -12 Tetrix.exe
```

`-s -12` means "start 12 bytes before the end."

```
058b6614: 1400 8800 0000 0000 4744 5043   ........GDPC
```

Reading right to left:

- `4744 5043` — that's `G`,`D`,`P`,`C` in ASCII. The marker.
- `1400 8800 0000 0000` — an 8-byte number giving the archive's size. It's stored
  **little-endian**, meaning the bytes are in reverse order, so you read it backwards:
  `0x0000000000880014` = **8,912,916 bytes**.

> **Little-endian** trips up every beginner. Intel processors store multi-byte numbers
> least-significant-byte-first. The bytes `14 00 88 00` mean `0x00880014`, not `0x14008800`. Just
> remember: *reverse the byte pairs, then read normally.*

So the archive starts at: `file size − 12 − 8,912,916`.

```bash
python3 -c "print(93021728 - 12 - 8912916, hex(93021728 - 12 - 8912916))"
# 84108800 0x5036600
```

**`0x5036600`.** That's the exact offset `objdump` showed for the `pck` section. Two completely
independent methods agreeing — that's how you know you're right, rather than hoping.

### Step 5 — Read the archive header (and hit the wall)

```bash
xxd -s 0x5036600 -l 112 Tetrix.exe
```

```
05036600: 4744 5043 0200 0000 0400 0000 0300 0000  GDPC............
05036610: 0000 0000 0300 0000 3017 0000 0000 0000  ........0.......
05036620: 0000 0000 0000 0000 0000 0000 0000 0000  ................
...
05036660: 4600 0000 28a9 95f8 be6a b5a2 7715 71f9  F...(....j..w.q.
```

Godot's documented header, field by field (remember: reverse each 4-byte group):

| Bytes | Meaning | Value |
|---|---|---|
| `4744 5043` | magic | `GDPC` |
| `0200 0000` | format version | 2 |
| `0400 0000` | Godot major version | 4 |
| `0300 0000` | Godot minor version | 3 |
| `0000 0000` | Godot patch version | 0 |
| `0300 0000` | **pack flags** | **3** |
| `3017 ...` | where file data starts | `0x1730` |
| 64 bytes of zeros | reserved for future use | — |
| `4600 0000` | **number of files** | `0x46` = **70** |

So: **Godot 4.3.0, 70 files inside.**

Now look at what comes right after `4600 0000`:

```
28a9 95f8 be6a b5a2 7715 71f9 ...
```

Random noise. That's supposed to be the **directory** — the list of "filename → where it is → how
big it is" for all 70 files. It's unreadable because of that `pack flags = 3`.

Flags are read as individual bits. `3` in binary is `11`, so two switches are on. Godot's source
tells us bit 0 means **`DIR_ENCRYPTED`**.

**The directory is encrypted with AES-256** — a strong, standard encryption algorithm. Without the
key, you cannot list the archive's contents. And this is exactly where every off-the-shelf Godot
unpacking tool (`godotpcktool`, *Godot RE Tools*) gives up.

> **Checkpoint:** the game's asset archive is at `0x5036600`, holds 70 files, and its table of
> contents is encrypted. If you stopped here you'd conclude the challenge is hard.

### Step 6 — The insight: what does that encryption actually protect?

Here is the whole trick of this challenge, and it's a genuinely valuable security lesson.

> **Think of a library.** The card catalogue tells you which shelf each book is on. The author of
> this challenge wrote the **catalogue** in secret code.
>
> But the **books on the shelves are still in plain English.** Nobody encrypted those.

Encrypting the index hides **where things are**. It does not hide **what they are**. The file
contents inside this archive were never encrypted at all.

So we stop trying to read the index — and go hunting for the files directly by their own magic bytes.

Godot's two signatures:
- `RSRC` — a Godot resource (scenes, themes, settings)
- `GDSC` — a compiled GDScript file (the game's actual code)

```bash
grep -aob 'GDSC' Tetrix.exe | head
grep -aob 'RSRC' Tetrix.exe | head
```

`-b` prints the **byte offset** of each match.

```
GDSC → 11 hits, all inside the archive region
RSRC → 32 hits
```

Eleven compiled scripts. And Godot's project settings (which *are* readable, further into the file)
list exactly eleven script files: `Board`, `GUI`, `StoreSettings`, `Utils`, plus one for each of the
seven Tetris pieces. **The numbers match.** We've recovered the file list without ever breaking the
encryption.

### Step 7 — Read the game's code

Godot 4.3 stores compiled scripts as: the text `GDSC`, then a version number, then the code
**compressed with zstd** (a compression algorithm — no key required, just decompress it).

Save this as `dump_scripts.py`:

```python
#!/usr/bin/env python3
import struct, zstandard

DATA = open("Tetrix.exe", "rb").read()

def u32(b, o):
    return struct.unpack_from("<I", b, o)[0]      # "<I" = little-endian 4-byte number

def read_variant(b, o):
    """Read one Godot value (a 'Variant'). Returns (value, new_offset)."""
    t = u32(b, o); o += 4
    big, t = t >> 16, t & 0xFFFF
    if t == 0: return None, o                                     # null
    if t == 1: return bool(u32(b, o)), o + 4                      # true/false
    if t == 2:                                                    # integer
        f = "<q" if big & 1 else "<i"
        return struct.unpack_from(f, b, o)[0], o + (8 if big & 1 else 4)
    if t == 3:                                                    # decimal
        f = "<d" if big & 1 else "<f"
        return struct.unpack_from(f, b, o)[0], o + (8 if big & 1 else 4)
    if t == 4:                                                    # text
        n = u32(b, o); o += 4
        s = b[o:o+n].decode("utf8", "replace")
        return s, o + n + ((4 - n % 4) % 4)                       # padded to 4 bytes
    return f"<type {t}>", o

# the archive lives at the end; the last 12 bytes say where it starts
assert DATA[-4:] == b"GDPC", "no Godot archive found"
pck_start = len(DATA) - 12 - int.from_bytes(DATA[-12:-4], "little")

# find every compiled script INSIDE the archive, by its magic bytes.
# (searching the whole file would also match the word "GDScript" in the engine's text)
offsets, i = [], pck_start
while True:
    i = DATA.find(b"GDSC", i, len(DATA) - 12)
    if i < 0: break
    if u32(DATA, i + 4) == 100:          # tokenizer version for Godot 4.3
        offsets.append(i)
    i += 1

print(f"archive at 0x{pck_start:x}; found {len(offsets)} compiled scripts\n")

for off in offsets:
    size = u32(DATA, off + 8)
    try:
        code = zstandard.ZstdDecompressor().decompress(
            DATA[off+12: off+12+2_000_000], max_output_size=size)
    except zstandard.ZstdError:
        continue                          # not a real script header, skip it

    # header = five counts, then the name pool, then the value pool
    n_names, n_values = u32(code, 0), u32(code, 4)
    o = 20

    names = []
    for _ in range(n_names):
        length = u32(code, o); o += 4
        chars = struct.unpack_from(f"<{length}I", code, o); o += 4 * length
        names.append("".join(chr(c ^ 0xB6B6B6B6) for c in chars))   # each char is XOR-scrambled

    values = []
    for _ in range(n_values):
        v, o = read_variant(code, o)
        values.append(v)

    print(f"--- script at 0x{off:x} ---")
    print("  names :", ", ".join(names[:18]))
    print("  values:", values, "\n")
```

Run it:

```bash
python3 dump_scripts.py
# archive at 0x5036600; found 11 compiled scripts
```

> **Why the script checks `== 100` and searches only inside the archive:** the word `GDScript`
> appears all over the engine's own text — and `GDScript` *starts with* `GDSC`. Searching the whole
> file would return dozens of false matches. We limit the search to the archive and require the
> version field to be 100 (Godot 4.3's). This is the same false-positive problem as binwalk in
> section 6 — **a magic-byte match is a candidate, not a conclusion.**

The interesting one is the game's interface script, `GUI.gdc`:

```
names : Control, change_game_state, restart_game, current_block, _ready,
        CenterContainer, GameOverLabel, visible, PauseLabel,
        _on_Board_update_score, score, lines, ContainerScore, ScoreValue, text
values: [False, 999999, 'PAUSE', 'CONTINUE', True,
         'change_game_state', 'res://TitleScreen.tscn', 'restart_game']
```

Read that carefully. The script:

- has a function called when your score changes (`_on_Board_update_score`),
- contains the number **`999999`**,
- and knows about a label it can make `visible`.

**That's the win condition.** Score more than 999,999 and something hidden gets shown.

> **What's `^ 0xB6B6B6B6`?** Godot lightly scrambles the names using XOR — a reversible operation
> where applying the same value twice returns the original. It is *not* encryption; there's no
> secret. It only stops casual `strings` snooping. XOR-with-a-fixed-value is extremely common in
> malware and CTFs, so it's worth recognising.

### Step 8 — Read the level file and take the flag

The scripts told us *when* the secret appears. The **scene file** (`Game.scn` — the game's screen
layout) holds *what it says*. Scene files store all their text as plain, readable UTF-8.

```bash
strings -a -n 4 Tetrix.exe | grep -B4 -A2 "THM{"
```

`-B4` = show 4 lines before the match, `-A2` = 2 lines after.

```
LINES
RETRY
PAUSE
QUIT
THM{I_CAN_READ_IT_ALL}
GAME OVER
```

Look at the company it keeps: `LINES`, `RETRY`, `PAUSE`, `QUIT`, `GAME OVER`. These are all
**on-screen text labels**. The flag is simply one more label — one that starts out invisible.

Elsewhere in the same scene there's another label reading `"Score more than\n999999"` (`\n` = a line
break). That's the hint shown to players.

Its exact position:

```bash
grep -aob "THM{" Tetrix.exe
# 93001116:THM{
python3 -c "print(hex(93001116))"
# 0x58b159c
```

**So the full picture is:** the game displays a hidden text label containing the flag once your score
passes 999,999. A player earns it. We just read it out of the file instead — which is exactly what
the flag's wording, *"I can read it all"*, is teasing.

```
THM{I_CAN_READ_IT_ALL}
```

---

## 5. What the author was trying to do

Worth understanding, because you'll meet this pattern again:

| The defence | What it stops | What it doesn't stop |
|---|---|---|
| Encrypting the PCK **directory** | Every automated Godot unpacker. You can't cleanly extract 70 named files. | Reading the file *contents*, which were never encrypted. |
| XOR-scrambling script names | A lazy `strings` scan of the code | Anyone who XORs it back — no key involved |
| Compiling GDScript to bytecode | Reading the source directly | Decompressing it and reading the text constants |

The flag was **never encrypted at all**. The challenge title says "uncover the encrypted data", and
there genuinely is encrypted data — but it's the table of contents, not the secret.

**The transferable lesson:** when you meet a security control, ask precisely *what* it covers. The
gap is usually right beside it. A lock on the index is not a lock on the content.

---

## 6. A trap to avoid

Two things looked like evidence of encryption but weren't. Both are classic beginner traps.

**Trap 1 — binwalk's confident nonsense.** `binwalk` scans for known signatures. Run it here and it
reports:

```
269219   0x41BA3   ESP Image (ESP32): segment count: 8, flash mode: QUIO ...
1862599  0x1C6BC7  bix header, header size: 64 bytes, created: 1978-01-05 ...
```

There is no ESP32 firmware in a Tetris game. Those signatures are only a few bytes long, so in a
93 MB file they appear by pure chance. **Automated tools produce false positives.** Always sanity-
check a finding against context: does it make sense that *this* file contains *that*?

**Trap 2 — "high entropy means encrypted."** Entropy measures how random data looks, on a scale to
8.0. I measured the archive in 64 KB blocks: nearly every block scored ~7.9, which screams
"encrypted!"

It wasn't. It was **OGG music and PNG textures** — already compressed, and compressed data looks just
as random as encrypted data. High entropy is a *hint*, never a verdict. Confirm with a magic-byte
signature or by successfully parsing the format.

---

## 7. Honest scorecard

Good practice in security work: separate what you **proved** from what you **assumed**.

**Verified — I ran these and watched them work**

- Godot 4.3.0, 70 files, directory encrypted — all read from the PCK header bytes.
- Archive location confirmed twice, independently (EOF trailer and PE section table).
- All 11 scripts decompressed and their names and values decoded.
- Exactly **one** `THM{...}` string exists in the whole 93 MB file.

**Not verified — stated so you don't over-trust this**

- I never recovered the AES key, so the encrypted directory was never decrypted. It turned out to be
  unnecessary, since no file *content* was encrypted.
- I could not submit the flag to TryHackMe to see it accepted. The evidence is the single well-formed
  flag string, wired to the game's own win condition.
- The Windows binary was **never executed** — static analysis only.

---

## 8. Practise the reflexes

Next CTF binary you get, in this order:

1. `file target` — what am I holding?
2. `sha256sum target` — record it.
3. `strings -a target | grep -iE "flag|THM\{|CTF\{"` — the free win.
4. `strings -a target | less` — skim for URLs, paths, odd messages.
5. `objdump -h target` — any non-standard section?
6. **Fingerprint it** — two ways: read its embedded text
   (`strings -a f | grep -iE "copyright|engine|version [0-9]"`), then test a signature checklist
   (`GDPC`, `UnityPlayer`, `PyInstaller`, `UPX!`, `PK\x03\x04`).
7. Search the file for magic bytes of things that might be embedded.
8. Only now consider a disassembler (Ghidra, radare2).

Steps 1–7 solve a surprising share of challenges, and all of them are cheap.

## Glossary

| Term | Meaning |
|---|---|
| **AES-256** | A strong standard encryption algorithm. Needs a key to reverse. |
| **Asset archive** | One bundle holding a game's art, sound, levels and code. Godot's is a PCK. |
| **Big/little-endian** | Byte ordering for multi-byte numbers. Intel is little-endian: reverse the bytes to read. |
| **Bytecode** | Code compiled into a compact machine-ish form, not human source. |
| **Entropy** | A 0–8 measure of randomness. High = compressed *or* encrypted. |
| **Flag** | The secret string proving you solved a CTF challenge. |
| **Hash (SHA-256)** | A fingerprint of a file's exact contents. |
| **Hex** | Base-16 counting. One byte = two hex digits. |
| **Magic bytes** | A fixed marker at the start of a file format, used to identify it. |
| **Offset** | A byte position, counted from the start of the file. |
| **PE** | Portable Executable — the Windows `.exe` format. |
| **Section** | A named compartment inside an executable (`.text`, `.data`, …). |
| **Static analysis** | Studying a program without running it. The safe default. |
| **XOR** | A reversible bit operation. Applying the same value twice undoes it. Obfuscation, not encryption. |
| **zstd** | A compression algorithm. Reversible by anyone, no key needed. |
