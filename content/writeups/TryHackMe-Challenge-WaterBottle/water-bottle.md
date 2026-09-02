---
description: "TryHackMe Water Bottle — an OSINT room with no machine, no port and no shell: find a water refilling station near Boni Avenue in Mandaluyong that closed around 2014, from nothing but a phone-number prefix. The answer is painted on a shopfront that no longer exists, so the whole room is Google Street View's historical imagery — reached here without a browser, by calling the two undocumented endpoints Maps itself uses, stitching the panorama out of raw tiles, and un-warping the sphere into flat views so OCR can read the signs. Every wrong turn kept: two geocoders that confidently pointed at the wrong building, a 2.6-hour sweep of the wrong street launched because I read 'near Boni Avenue' as 'on Boni Avenue', an OCR pass that returned pure garbage until a control explained why, and a phone number I nearly attributed to the wrong business because grep found it on the page."
---

# Water Bottle — finding a shop that isn't there any more

**TryHackMe · challenge: Water Bottle · category: OSINT · no target machine, no VPN**

> **The flag is redacted** here as `THM{[redacted]}`. This room is unusual: the flag *is* the
> answer — the station's name and its phone number, joined by an underscore. So both halves are
> redacted, not just a token. Everything that teaches stays in full: the endpoints, the exact
> commands, the controls that caught two broken instruments, and every wrong turn.
>
> **What I kept and why:** the street, the address, the panorama IDs and the whole method stay,
> because they *are* the lesson. Redacting them would leave an article about nothing. What is
> removed is the one string you would paste into the answer box.

A vocabulary note first, because this room assumes none.

**OSINT** is *open-source intelligence* — answering a question using only information that is
already public: maps, photos, business directories, archived web pages. There is nothing to hack
here. No **port** (a numbered door a service answers on), no **shell** (a command prompt on someone
else's machine), no exploit at all. The only skill being tested is whether you can find a fact that
is public but not indexed, and whether you can tell a fact from a plausible guess.

**Street View** is Google's collection of 360° photographs taken from a car. The part that matters
here: Google keeps the *old* ones. Any spot photographed repeatedly has a date slider, so you can
stand on the same metre of pavement in 2014 and in 2026 and compare. That is the entire room.

**A panorama ID** (Google calls it a `panoid`) is a 22-character string naming one specific 360°
photo, e.g. `l_zS5ziNSvqY8ZP7rLEhvQ`. Once you have one you can ask for its pixels and its metadata
directly.

---

## The brief

> After returning to my hometown, I needed a water refill from a station I frequently used until
> 2014, but I've forgotten its name and contact number. I only remember that it is a twelve-digit
> contact number starting with 63922.
>
> While driving near Boni Avenue, I noticed a new water refilling establishment now stands where
> the original station used to be. Can you help me find the name and contact number of the original
> water station?
>
> Flag format: `{Water Station name in lowercase + _ + Contact Number}` — e.g. `THM{happystation_12345678}`

## Reading the brief properly, before touching anything

Three facts are handed over, and each one is doing work.

**"twelve-digit contact number starting with 63922"** decodes completely. `63` is the international
dialling code for the Philippines. `922` is a mobile prefix belonging to Globe Telecom. So the
number is a Philippine *mobile*, written internationally without the `+`:

```
63  922  XXX XXXX      = 12 digits
^   ^    ^
|   |    +-- 7 subscriber digits
|   +------- Globe Telecom mobile prefix
+----------- Philippines
```

The same number written the local way is `0922 XXX XXXX`. **Both spellings have to go in every
search**, or you will miss the answer while believing you looked.

**"Boni Avenue"** + a Philippine mobile prefix pins the city: Boni Avenue, **Mandaluyong City,
Metro Manila**.

**"until 2014" + "a new establishment now stands where the original used to be"** is the room
telling you where the evidence lives. A small water refilling station that shut a decade ago has no
website and no reviews. What it has is a **painted signboard**, and in the Philippines those
signboards carry the shop name and the owner's mobile number in half-metre letters. The only place
a 2014 shopfront still exists is Street View's historical imagery.

So the plan wrote itself, and it went into the notes before the first command ran:

1. Prove I actually have internet (an OSINT room with no network is not "no results", it is "no channel").
2. Pin the geography.
3. Cheap text search first — directories, Facebook, archived pages.
4. Street View historical imagery, which is where the answer almost certainly is.
5. Cross-check name and number against a second, independent source.

And one rule fixed up front, which ended up doing all the work:

> **The number is the discriminator, not the name.** A candidate whose number is not `63922…` is
> wrong, however perfectly its story fits. Names are easy to rationalise; a prefix is not.

---

## Step 1 — Prove the channel before believing any silence

The very first search is not for the answer. It is to check the instrument.

```
Boni Avenue Mandaluyong water refilling station
```

Real, geographically coherent results came back — Waze, Facebook and Yelp entries for actual shops
on Boni Ave. That is the **positive control**: the tool can find things, so a later empty result
means "not there" rather than "no network".

This sounds like ceremony. It is not. Later in this room I ran a detector that returned zero hits on
a question whose answer I already knew existed — and *only* because I had a control did I read that
zero as "my detector is broken" instead of "the thing isn't there". Silence means either "not there"
or "my request never arrived", and the two are indistinguishable until you have proved the channel.

That first search also produced the candidate pool of water businesses currently on Boni Ave:
Hydroyal (614), Qwynn (617), Grandeur (705), Aqua Safe (450), and one at 31 Mayon St.

**None of these is the answer by itself.** The room asks for the station that is *gone*. One of
these addresses is where it stood.

## Step 2 — Text search, and the first candidate killed by the discriminator

Searching for a `0922` number attached to a Boni Ave water station turned up
**Blue Cube Water Re-Filling Station**, 425 Pulog St cor. Boni Ave — listed on Foursquare since
**2012**, so a business of exactly the right age, on exactly the right corner. It felt right.

Rather than trust the search engine's summary, I pulled the directory page itself and extracted the
numbers with a regex, so the claim rests on the page and not on a summariser:

```bash
curl -sL "https://www.puertoparrot.com/service/show/metro-manila/mandaluyong-city/23583/blue-cube-water-re-filling-station" \
  | sed 's/<[^>]*>/ /g' \
  | grep -oiE '(\+?63[- ]?9[0-9]{2}|09[0-9]{2})[- ]?[0-9]{3}[- ]?[0-9]{4}|\(02\)[- ]?[0-9 -]{7,}'
```

Flag by flag:

- `curl -sL` — fetch the page. `-s` silent (no progress bar cluttering the output), `-L` follow
  redirects, because directory sites bounce you around.
- `sed 's/<[^>]*>/ /g'` — delete every HTML tag, so the regex sees human text instead of markup.
- `grep -oiE` — `-o` print *only* the matching part rather than the whole line, `-i` ignore case,
  `-E` extended regular expressions. In extended regex, alternation is written `|`; writing `\|`
  there is a real mistake that has cost this notebook a mission before.
- The alternation covers all three ways a Philippine number gets written: `+63 9XX` (international
  mobile), `09XX` (the same mobile, local form), `(02) XXXXXXX` (a Metro Manila landline).

Output:

```
(02) 497 2712
```

One number, and it is a **landline**. Blue Cube is out.

This is worth sitting with, because it is the whole discipline of the room in one move. The name fit
the story, the street fit, the dates fit — and the number said no. Later the same test killed
*Water Market Water Station* at 481 Boni Ave (`(02) 8531 8776`) and *Grandeur* at 705 Boni Ave
(`(02) 533 4069`). Three plausible candidates, three landlines, three eliminations that cost one
command each.

### A trap in how search results are presented

The search tool returns a *written summary* on top of the raw links, and that summary confidently
asserted numbers that the linked pages do not show. Every single number in this write-up was
re-read from the page it supposedly came from. **A summary of sources is not a source.**

---

## Step 3 — Street View history, without a browser

Text search was not going to produce a shop that closed in 2014. Time to read the signboard.

You can do this by hand: open Google Maps, drop into Street View, click the clock icon, drag the
date slider back. It works. But it is a lot of clicking to check dozens of locations, and it cannot
be scripted. Maps' own front-end talks to two undocumented endpoints, and neither needs an API key.

**Endpoint 1 — "what panorama is nearest this point?"**

```
https://maps.googleapis.com/maps/api/js/GeoPhotoService.SingleImageSearch?pb=!1m5!1sapiv3...!3d<LAT>!4d<LNG>!2d<RADIUS>...
```

The `pb` parameter is Google's compact way of packing a nested structure into a URL: `!3d` carries
latitude, `!4d` longitude, `!2d` the search radius in metres. It answers with a `panoid`.

**Endpoint 2 — "tell me everything about this panorama"**

```
https://www.google.com/maps/photometa/v1?authuser=0&hl=en&gl=us&pb=...!2s<PANOID>...
```

This returns the **date slider as JSON** — every other date this same spot was photographed, each
with its own panoid. That is the room's entire mechanism, available as data.

### Controls first — both directions

Before pointing any of this at Mandaluyong:

| Probe | Expected | Got | Verdict |
|---|---|---|---|
| Eiffel Tower (48.8584, 2.2945) | a panoid | `Xta4ugN_QRTIo3XDFLujgw` | it can say yes |
| Mid-Pacific (0, −160) | nothing | 60 bytes, no panoid | **it can say no** |
| Boni Ave (14.5744, 121.0446) | a panoid | `iXJKF3SWk2Z6fjLcEkOYZw` | the street is covered |

The **negative** control is the one people skip, and it is the one that matters. An endpoint that
returned a panoid for the middle of the ocean would be returning *something* for everything, and
every later "no imagery here" would be meaningless.

### Wrong turn: my date parser found zero dates

My first pass looked for two-element arrays `[index, [year, month]]` and found **none** — at a spot
I could see in the Maps interface has many captures. Because a control told me dates *had* to be
there, I read that empty result as a broken parser rather than as an answer. The real entries have
six elements:

```
[24,[2022,4],null,null,null,2]
[25,[2021,1],null,null,null,2]
```

Had I trusted the empty result, I would have concluded Street View history was unavailable and
abandoned the only approach that works. **A detector that finds nothing has two explanations, and
"there is nothing" is the less likely one until you have proved the detector.**

### Wrong turn: the 2014 photo is stamped ©2017

The first stitched panorama carried a "©2017 Google" watermark while my code labelled it 2014-04.
An anomaly you explain away is a finding you threw out, so I asked each panorama for *its own* date:

```
claimed 2014-04  kn5fy_xb31EiWIjlPaXc4A  self-date=[2014, 4]
claimed 2017-03  DI7Bldpgg50mkb0LhRVupA  self-date=[2017, 3]
   ... all seven matched ...
```

The mapping was right. The watermark is Google's copyright year on re-rendered tiles, not the
capture date. Cost: one command. Value: certainty about every date claim in this article.

### Wrong turn: two geocoders, two wrong buildings

To know *where* to look, I asked geocoders for the water shops' coordinates.

- OpenStreetMap put **"Aqua Safe, 450 D Boni Avenue"** at 14.5838, 121.0278. Both the 2024 and the
  2014 panoramas there show a **Motolite car-battery shop**.
- A directory listed **a water company** at *31 Mayon Street* and OSM listed **North Haven Water Station**
  at *31 Mayon Street*. Two names at one address — exactly the shape of a replacement. I checked it,
  saw an engineering office, and moved on.

**A geocoder returns the nearest thing it can match to your text, not the thing you asked for, and
it never says "I'm not sure".** Confirm a location against imagery before building on it.

(Hold that second one. I dismissed it for a reason that turned out to be my own mistake, and it was
the answer.)

### The thumbnail that shows one direction

There is a convenient endpoint that returns a panorama as a single image:

```
https://geo0.ggpht.com/cbk?cb_client=maps_sv.tactile&output=thumbnail&panoid=<ID>&w=2048&h=1024
```

It is a trap. Despite the 2:1 aspect ratio it returns **the default view, not the sphere** — so
"there is no water station here" from a thumbnail means only "not in this one direction". That is
precisely how I wrongly cleared 31 Mayon Street.

The real panorama comes from raw tiles:

```
https://streetviewpixels-pa.googleapis.com/v1/tile?cb_client=maps_sv.tactile&panoid=<ID>&x=<X>&y=<Y>&zoom=<Z>
```

Each tile is 512×512 pixels. Zoom 3 is a 7×4 grid → 3328×1664; zoom 4 is 13×7 → 6656×3328, enough to
read a phone number across a street. Since this is mechanical work repeated dozens of times, it
became a small script (`sv.py`) with four verbs: `hist`, `pano`, `persp`, `crop`.

One detail that bites: the tile grid is *larger* than the sphere. Zoom 3 fills 3584×2048 of tiles but
the actual image is 3328×1664, so the extra strip is padding. Crop it off, or every angle you compute
from the image is skewed.

### OCR, and the control that stopped a doomed sweep

The idea: let the computer read the shopfronts. Stitch every 2014 panorama, OCR it, keep only the
ones mentioning water. Run against a panorama whose signs I could read with my own eyes — a big red
MOTOLITE board, ACHIEVERS SALES CORPORATION — OCR returned:

```
<i Sa — % [a oF ee ey | &. ~ 0 i OL = YA. ity 1.74
```

Pure garbage. **Why:** an equirectangular panorama is the sphere flattened, which bends every
straight sign into a curve. OCR cannot follow a bent baseline.

Had I skipped that control and swept 158 panoramas first, I would have gotten zero hits and
concluded there was no water station on the street.

The fix is to undo the projection — reproject the sphere into a flat *rectilinear* view, the same
transform the Street View viewer applies when you look around. That is a gnomonic projection, about
fifteen lines of numpy: for each output pixel build a direction vector, rotate it by the heading and
pitch you want, convert to longitude/latitude, and sample the panorama there. Re-run on the same
control:

```
heading 300: ... ACHIEVERS SALES ... COUNCILOR ELTON ...
```

Readable. **Only now is the sweep worth running.**

### Wrong turn: 2.6 hours of the wrong street

I launched the sweep with `--psm 11` (Tesseract's sparse-text mode) and 4 workers on a 4-core box.
Under that contention a single OCR pass took 20–80 seconds: 158 panoramas × 6 views ≈ **2.6 hours**.
I had not multiplied that out before starting, which is the one arithmetic you always owe yourself
before a long job:

```
candidates × time per candidate ÷ workers = finishing time
```

Killed it — and killing the parent process left **three orphaned `tesseract` children still burning
CPU**. `kill <parent>` reports success, `ps -p <parent>` confirms it is gone, and the children run on.
`ps --ppid` found them and they were killed by PID and verified gone. Re-measured on an idle box,
the honest cost was **4 seconds per panorama**, about 5 minutes total.

But the sweep was still the **wrong instrument**, and for a reason that has nothing to do with
tuning. The brief says *"driving **near** Boni Avenue"*. I had silently rewritten that as *"on Boni
Avenue"* and built a 2.5 km sweep of the avenue itself. The station is on **Mayon Street**, one turn
off it. No amount of optimisation saves a search of the wrong street.

---

## Step 4 — The find

The lead came from a contradiction sitting in the directory data the whole time — the same one I had
dismissed. Two sources, two different business names, one address:

- OpenStreetMap: `North Haven Water Station, 31 Mayon Street`
- contact.page: `[redacted] - Mandaluyong, Boni, Unit D, Villa Maria Apartment, 31 Mayon Street`

Two names at one address is the literal shape of *"a new establishment stands where the original used
to be"*. I had checked this address earlier and cleared it — **from a thumbnail**, which shows one
direction. Re-checked as a full 360° panorama, both epochs, the same shopfront reads:

| Capture | panoid | Sign above the shop |
|---|---|---|
| **2014-04** | `l_zS5ziNSvqY8ZP7rLEhvQ` | **the original water station**, with `DELIVERY: 531-6570 · 0917-XXXXXXX` |
| 2018-03 | `UWFD8c3ctWV_oNo35KWSKw` | `ALKAFRESCO` |
| 2019-10 | `tRIJ3zOLpNwTVYvH2Y4gdQ` | `ALKAFRESCO — PURIFIED·MINERAL·ALKALINE` |
| **2026-03** | `QFHi8TVIMwpTEEQAXfPMRA` | **NORTH HAVEN WATER STATION** |

That is the brief exactly: a water station photographed in April 2014, and a *new water refilling
establishment* standing on the same spot today. (A small bonus lesson: the unit has been a water
station three separate times. "The new one replaced the old one" was not a single swap.)

To read the sign, fetch that panorama at zoom 4 and crop:

```bash
python3 sv.py pano l_zS5ziNSvqY8ZP7rLEhvQ 4 sign-z4.jpg
python3 sv.py crop sign-z4.jpg 0.630 0.330 0.170 0.090 signboard.jpg 2.2
```

`crop` takes fractions of the image rather than pixels (left, top, width, height) and a final scale
factor, so the same numbers work at any zoom level.

## Step 5 — The number, and exactly how much it is worth

Here is where an honest write-up has to slow down.

**The 2014 signboard does not carry the answer.** It shows a landline (`531-6570`) and an `0917`
mobile. Neither starts `63922`. If the room expected you to read the number off the building, the
number would start `0922`. It does not.

The `63922` number is in the **directory record for the same business**, which lists three numbers:

```
[redacted] - Mandaluyong, Boni      Unit D, Villa Maria Apartment, 31 Mayon Street, Boni
  63 2 531 6**XX          <-- landline: MATCHES the 531-6570 painted on the 2014 sign
  63 916 414 1**XX
  63 922 872 1**XX        <-- Globe mobile -> the answer
```

**The landline match is the join.** It is what proves this directory record describes *the shop in
the 2014 photograph* rather than one of the hundreds of other branches of the same chain. Without
that check, "a directory has an entry with an 0922 number" would be worth nothing at all.

### The trap I nearly walked into

An earlier grep of that same page pulled out `63 922 872 1…` and I almost attributed it to the
business on the spot. But the page's structured data gives `"telephone": "+63 2 531 6570"` — the
landline. The `0922` value sits in a *list* of several numbers, and a regex over a whole page
returns every number that appears on it, attached to nothing.

> **Grepping a page for a phone number tells you a number is *on* the page. It never tells you
> *whose* it is.**

It survived only because the landline cross-check independently tied the record to the shop.

## The answer

```
THM{[redacted]}
```

- name: the station on the 2014 signboard, lowercased — 8 characters
- number: 12 digits, `63` (Philippines) + `922` (Globe Telecom) + 7 subscriber digits

### Verified, assumed, and unconfirmed — stated separately

- **Verified from primary imagery:** the original station stood at 31 Mayon Street, Boni in April
  2014; a different water station stands there now; the 2014 sign carries the landline `531-6570`;
  the directory record for that address carries the same landline.
- **Assumed:** that the directory's Globe mobile is the number the room wants. It is displayed
  partially masked, and it is not on the building.
- **Not verified:** the flag was **never submitted**. No TryHackMe session was used in this
  engagement, so this is evidence-backed, not confirmed. Saying "solved" here would be a lie about
  the only check that actually counts.

---

## What this room actually teaches

**Pick the discriminator before you start looking.** "Twelve digits starting 63922" is a test any
candidate either passes or fails in one command. Four plausible stations — right street, right era,
right business — were eliminated for a total of about four commands, because the test was chosen
first and applied without sentiment. Without it I would still be arguing with myself about which
name felt most like a shop somebody remembered from 2014.

**Every instrument gets a control, in both directions.** A geocoder that always answers, a search
tool that summarises sources it did not read, an OCR pass that returns nothing, a date parser that
finds no dates — all four of those *lied without erroring*. Not one of them produced a stack trace.
The only thing standing between me and four confident wrong answers was a known-good input and a
known-bad input run through the same path.

**Read the brief's own words.** "Near Boni Avenue" is not "on Boni Avenue", and the entire expensive
detour in this room traces to that one silent substitution. When a search fails, re-read the
question before optimising the search.

**A thumbnail is one direction.** "It isn't here" from a partial view is not evidence of absence. I
cleared the correct address early and lost hours to it.

**Multiply out the cost before you press enter.** `candidates × time ÷ workers`, said out loud,
turns "this should be quick" into "this is 2.6 hours" *before* you spend them.

**And check what your kill actually killed.** Killing a parent process leaves its children running.
`kill` returning 0 is not evidence; `ps` showing nothing is.
