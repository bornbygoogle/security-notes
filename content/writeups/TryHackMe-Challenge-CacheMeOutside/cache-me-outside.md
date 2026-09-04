---
description: "TryHackMe Cache Me Outside — an OSINT room that starts with a screenshot of a chat and one route-planning profile, and ends at a named tram stop in a Romanian city. No machine, no VPN, no shell. The chain runs komoot bio → GitHub → git commit metadata → Threads → a photograph with a country-code domain painted on a wall → a shop's contact page → OpenStreetMap's Overpass API. Every wrong turn kept: a username sweep that returned 200 OK for a handle that cannot exist, a geolocation field in the profile JSON that was my own IP rather than the target's, a supermarket join that could not decide anything, and an off-by-one in a stop name that only a pixel-counted answer mask caught."
---

# Cache Me Outside — he traded hacking for hiking, and left a trail

**TryHackMe · challenge: Cache Me Outside · category: OSINT · no target machine, no VPN**

> **The five answers are redacted** here — the name, the email address, the phone number, the city
> and the tram stop all appear as `[redacted]`. Two different reasons. The email and the phone are
> **live contact details**, and a public page is not a place to leave those sitting for scrapers.
> The other three are simply the strings you would paste into the answer box, and publishing them
> hands the room to the next person instead of letting them earn it.
>
> **What I kept and why:** the whole method, every command, every control, every wrong turn — and
> the intermediate artefacts that are *not* answers: the komoot profile the room itself hands you,
> the account handle, the company whose name is painted on a wall in his photograph, the Overpass
> queries, the tram line number. Those are the lesson. A determined reader can re-derive all five
> answers from what is kept here, and that is fine — re-deriving is the exercise; copying is not.

A vocabulary note first, because this room assumes none.

**OSINT** stands for *open-source intelligence*: answering a question using only information that is
already public — profiles, photos, maps, commit histories, company registries. There is no
exploitation in this room. No **port** (a numbered door a service listens on), no **shell** (a
command prompt on someone else's machine), no payload. The only skill under test is whether you can
turn one published link into a chain of facts, and whether you can tell a fact from a plausible
guess.

## The brief

A retired hacker has scattered pieces of his identity across the open internet. You are given a
screenshot of a conversation between two people:

- **`WKM1337?`** — a friend, asking questions
- **`JJ ^_^`** — the subject

The conversation, in substance:

> **WKM1337?**: yo man, you still alive?? haven't heard from you since the forum got taken down lool
> **JJ ^_^**: yeee still here, been trying to lay low for awhile. honestly i'm kind of done with all that scene 👀
> **JJ ^_^**: idk man, got into hiking and cycling. started going outside more after all those years staring at screens doing sketchy stuff, feels way better...
> **JJ ^_^**: i use komoot, it's sick for logging routes and plannew new ones. here's my profile if you wanna see my trails or follow me
> **`https://www.komoot.com/user/5667624959835`**

Five questions:

1. What is the retired hacker's full name?
2. What email address did he accidentally expose?
3. What is his phone number?
4. In which city is he located?
5. Submit the name of the tram station where he got off on the 7th of May, 2026.

**komoot** is a route-planning app for hiking and cycling. People record "Tours" — GPS tracks of
where they walked or rode — and public profiles can be read without an account.

### Read the answer masks. They are evidence.

TryHackMe prints an *answer format* under each box, one asterisk per character:

| Question | Mask | What it constrains |
|---|---|---|
| 1. Full name | `*** ***` | two words, 3 and 3 |
| 2. Email | `****************.***` | 20 characters total |
| 3. Phone | `*** *** *** ***` | 12 digits, with a country-flag selector |
| 4. City | `*********` | 9 characters |
| 5. Tram station | `***** ******** **********` | three words, 5 / 8 / 10 |

Treat these as a **checksum**. A candidate answer that does not fit the mask is wrong no matter how
convincing the story around it is. Later in this room that rule catches a genuine error that nothing
else would have. It is worth counting the asterisks properly rather than eyeballing them — I show
how at the end, because eyeballing them is exactly how you talk yourself into a near-miss.

### One sentence in the brief that changes the plan

The room says, before you start:

> "This task includes an example of **active OSINT**. In the real world, interacting with discovered
> infrastructure or accounts can be risky, may alert the target, and should only be done with proper
> authorisation. For this room, the interaction and response are part of the controlled challenge
> setup."

**Passive OSINT** means only reading what is already public. **Active OSINT** means touching
something belonging to the subject that can notice you — sending an email, requesting a password
reset, connecting to a server. The room is telling you in advance that one of the five answers
cannot be read; it has to be *provoked*. Keep that in your pocket. It turns out to be question 3,
and it is the last thing you should do, not the first.

## Step 1 — read the profile, and control the instrument first

The room gives one URL. Fetch it with `curl` — a command-line program that requests a URL and prints
what comes back.

The important habit is what goes *around* the request. Three fetches in one run, not one:

```bash
UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"

# positive control — a URL that MUST work
curl -sS -A "$UA" -o control-positive.html -w 'http=%{http_code} bytes=%{size_download}\n' \
     'https://www.komoot.com/'

# the target
curl -sS -A "$UA" -L -o profile.html -w 'http=%{http_code} bytes=%{size_download}\n' \
     'https://www.komoot.com/user/5667624959835'

# negative control — a user id that CANNOT exist
curl -sS -A "$UA" -L -o control-negative.html -w 'http=%{http_code} bytes=%{size_download}\n' \
     'https://www.komoot.com/user/000000000000'
```

Flag by flag:

- **`-sS`** — `-s` is *silent* (no progress bar); `-S` puts error messages back. Use them together.
  Plain `-s` alone hides failures too, and then a request that never left the machine looks exactly
  like a page that came back empty.
- **`-A "$UA"`** — sets the **User-Agent**, the string a client uses to introduce itself. Sites serve
  different content to different agents; this matters enormously later.
- **`-o file`** — write the body to a file. Save every fetch. You will want to re-read them.
- **`-L`** — follow redirects. A redirect (`301`/`302`) is the server saying "the thing you asked
  for lives over there".
- **`-w 'http=%{http_code} bytes=%{size_download}\n'`** — print the **status code** and the body size
  after the transfer. The status code is a three-digit number: `200` = here it is, `404` = no such
  thing, `403` = exists but you may not.

Results, and **read the control rows before the result row**:

| Request | HTTP | Bytes |
|---|---|---|
| komoot homepage (positive control) | 200 | 775 130 |
| **`/user/5667624959835`** (target) | **200** | **368 158** |
| `/user/000000000000` (negative control) | **404** | 12 993 |

Why bother? Because on a great many modern sites, *every* profile URL returns `200 OK` — the server
ships the same JavaScript bundle to everyone and only the browser afterwards asks whether the
profile exists. On such a site, "I got a 200" means nothing at all. Here the negative control comes
back `404`, which proves komoot really does distinguish a real user from a fake one, which in turn
makes the target's `200` meaningful. One extra request bought that.

### The whole profile is in the page source

The rendered page shows very little. The **source** contains the entire profile as **JSON**
(JavaScript Object Notation — a text format of keys and values) inside a call to
`kmtBoot.setProps("…")`. This is normal for single-page apps: the server embeds the data the
JavaScript will need, and that embedded blob routinely carries more fields than the page ever draws.

Pull it out and read it:

```python
import re, json
h = open('profile.html', encoding='utf-8', errors='replace').read()
i = h.index('kmtBoot.setProps(')
# the argument is a JSON *string literal*; walk it, respecting backslash escapes
start = h.index('"', i); j = start + 1; out = []
while True:
    c = h[j]
    if c == '\\': out.append(h[j:j+2]); j += 2; continue
    if c == '"': break
    out.append(c); j += 1
props = json.loads('"' + ''.join(out) + '"')   # unescape, giving the inner JSON text
data  = json.loads(props)
```

What it holds:

- `display_name`: **`[redacted]`** — two words, 3 letters and 3 letters. **That is question 1's mask
  exactly.** Candidate answer, not yet confirmed; one source is not confirmation.
- `content_link`: **`https://github.com/jiml33t`** — a link he published himself.
- `content_text` (the bio), verbatim:

  > "I'm an ex-hacker trying to turn my life around. Lately, I've been focusing on becoming more
  > active, spending more time outdoors, and getting into running. **I've also started my own
  > company** as part of building a better path for myself."

- `followers`: 396. `following`: 0.
- `tours_summary`: **0 recorded, 0 planned**. Highlights 0, collections 0.

Two things to do with that. First, the GitHub link is the pivot — and note *how* we got it. We did
not guess that he might have a GitHub and go looking for likely usernames. **Follow references, not
names.** Guessing handles finds strangers who happen to share a name; following a link the subject
published finds the subject.

Second, the zero tours contradicts the obvious plan.

### Wrong turn #1 — a field in the JSON that is about *me*, not about him

The same JSON contains:

```json
"geolocation": { "lat": 45.748, "lng": 4.85 }
```

Coordinates, sitting in the profile data of a man whose city you have been asked to name. It is very
tempting.

Those coordinates are **Lyon, France** — and they are *my own machine's* location, derived from the
IP address that made the request. komoot serves that field to whoever loads the page. It says
nothing whatsoever about the subject.

The tell was free: question 4's mask is **9 characters**, and "Lyon" is four. The shape check killed
it instantly. Without the mask I might have spent an hour on the wrong country.

The general rule, and it comes up again in this room: **a value found on a page is not a value about
the subject.** Before you attribute any field to a person, ask what independently ties it to them.

### The anomaly: zero tours

The plan was "find the tour recorded on 7 May 2026 and read where its track starts". A profile with
zero tours has no track to read. When a result contradicts your plan, stop and settle it — do not
carry on executing a plan that the last result already invalidated.

komoot has a public API (**Application Programming Interface** — a URL that returns data instead of
a web page). Ask it directly, with the same control discipline:

```bash
curl -sS -A "$UA" -w 'http=%{http_code}\n' 'https://www.komoot.com/api/v007/users/5667624959835/tours/?limit=50'
curl -sS -A "$UA" -w 'http=%{http_code}\n' 'https://www.komoot.com/api/v007/users/000000000000/tours/?limit=50'
```

Both return **`403 AccessDenied`**, byte-for-byte identical bodies. The endpoint refuses anonymous
clients for *any* user, real or invented. So the `403` says nothing about this account. Without the
control I would have written "his tours are private" — a confident claim the evidence does not
support.

And the three profile tabs?

```
/user/5667624959835/tours        200   368158 bytes
/user/5667624959835/highlights   200   368158 bytes
/user/5667624959835/collections  200   368158 bytes
```

**Byte-for-byte identical.** They are the same JavaScript shell; the tabs are drawn in the browser.
`curl` cannot see them.

**Conclusion: komoot is a signpost, not a destination.** Its entire payload is the bio and the link.
That is a perfectly good result — the room's first hop is meant to be a hop.

## Step 2 — GitHub, and the email hiding in plain sight

Fetch the API rather than the web page; it is cleaner and it is documented. Control included:

```bash
curl -sS 'https://api.github.com/users/jiml33t'                # -> 200
curl -sS 'https://api.github.com/users/qzx9nosuchuser4471zz'   # -> 404   (control: the oracle works)
```

The interesting fields:

```json
{
  "login": "jiml33t",
  "name": null,
  "company": "[redacted] Security Consulting",
  "location": null,
  "email": null,
  "bio": "Currently starting my security consulting firm | Ex-Hacker | Avid Runner",
  "public_repos": 1,
  "created_at": "2026-04-16T07:24:48Z"
}
```

Three things.

**One — the name is confirmed.** `company` contains the same two-word name as the komoot
`display_name`. That is a second, independent source, and the bios corroborate each other ("ex-hacker",
"running"), which ties the two accounts to one person rather than to two men who share a common name.
Question 1 is now evidence-backed rather than a guess.

**Two — `email` and `location` are `null`.** He has deliberately hidden both. That is not a dead end;
it is a signpost. When someone has hidden a field on a profile, go and look at the places the same
data gets written *automatically*.

**Three — one public repository.** Which brings us to the answer.

### The email: `git log --format='%ae'`

**git** is the version-control system GitHub is built on. A **commit** is one saved change, and every
commit permanently records the author's name, the author's **email address**, and a timestamp —
inside the commit object itself. Hiding the email on your profile page does absolutely nothing to
commits you have already pushed. Everyone who clones the repository gets them.

```bash
git clone https://github.com/jiml33t/jiml33t.git
cd jiml33t
git log --all --format='%H | %an <%ae> | %ad | %s' --date=iso
```

- **`--all`** — every branch, not just the one checked out.
- **`--format='…'`** — choose the fields: `%H` full commit hash, `%an` author name, **`%ae` author
  email**, `%ad` author date, `%s` subject line.
- **`--date=iso`** — print dates in ISO form (`2026-04-16 03:27:19 -0400`) rather than git's default.

Output — one commit:

```
7b2c8e0a540c36f2e09da5945066020621d6a059 | [redacted]-cell <[redacted]@gmail.com> | 2026-04-16 03:27:19 -0400 | Initial commit
```

There is **question 2**, and it fits the 20-character mask exactly.

*Why is this "accidentally exposed"?* Because he hid the field on the profile and the metadata leaked
it anyway. This is one of the most reliable findings in real OSINT work, and it costs one command.
On any GitHub target, **read the commit metadata before you read the code**.

There is a second, independent tie confirming the address belongs to *this* account rather than
merely appearing near it. The repository's `README.md` is GitHub's default profile template, and the
template text still names the repository by its **original** owner — `<local-part>-cell/<local-part>-cell`.
That is the account's first username, later renamed to `jiml33t`, and it matches the commit author
name. So the account is literally named after the address. Two fields, matching independently.

*(A detail worth noticing and then discarding: the commit timezone is `-0400`, a US Eastern-style
offset. It is wrong — he is in Europe. Timestamps in commits come from whatever the committer's
machine claims. Weak signals are fine to collect; just never promote one to a conclusion.)*

## Step 3 — hunting the handle, and a sweep that proved nothing

Now there are two handles: `jiml33t` and the email's local part. Check them across social platforms.

This is where most write-ups quietly go wrong, so here is the wrong turn in full.

### Wrong turn #2 — a sweep that returns 200 for a user that cannot exist

First attempt: fetch each profile URL with an ordinary browser User-Agent and record status, size and
`og:title`. **`og:` tags** are Open Graph metadata — the `<meta>` tags a site puts in a page so that
chat apps can render a link preview.

Crucially, the sweep included a third handle: **`qzx9nosuchuser4471zz`**, a name that cannot exist.

```
jiml33t               threads   http=200  bytes=270420  og:title=[]
[local-part]          threads   http=200  bytes=272338  og:title=[]
qzx9nosuchuser4471zz  threads   http=200  bytes=270410  og:title=[]   <-- CONTROL
```

Instagram, Threads, Reddit and TikTok: **`200 OK` for all three handles**, empty metadata for all
three, sizes within a few hundred bytes of each other. The control is indistinguishable from the
targets.

That result is not "he has accounts everywhere". It is **"this instrument cannot measure anything"**.
The status code describes delivery of the JavaScript app, not the existence of a user. Had I run
only the two real handles, I would have written down eight accounts, all fabricated.

**Every existence check gets a name-that-cannot-exist alongside it, in the same run, and you read the
control row first.**

### The fix, part one: ask as a crawler

A login wall leaks through its own preview machinery. Link previews have to work for people who are
not logged in, so Meta serves real Open Graph metadata to a crawler. Change one flag:

```bash
UA="facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"
curl -sS -A "$UA" -L 'https://www.threads.com/@jiml33t' | grep -oiE '<meta[^>]+og:(title|description)[^>]*>'
```

| Handle | Threads | Instagram |
|---|---|---|
| `jiml33t` | **`[redacted] (@jiml33t) • Threads` — 19 Followers, 3 Threads** | **25 Followers, 6 Following, 0 Posts** |
| email local-part | "Threads • Log in" (generic) | "Instagram" (generic) |
| **control** | "Threads • Log in" (generic) | "Instagram" (generic) |

Now the control and the non-existent handle look alike, and `jiml33t` looks different. *Now* the hit
means something. And notice the display name in the title is the same name again — a third
independent source for question 1.

### The fix, part two: render the page

The crawler trick returns *metadata*, not *content*. To read the actual posts you need a browser. You
do not need a graphical one:

```bash
chromium --headless --disable-gpu --no-sandbox \
         --virtual-time-budget=15000 \
         --dump-dom 'https://www.threads.com/@jiml33t' > threads-dom.html
```

- **`--headless`** — run the browser with no window.
- **`--disable-gpu` / `--no-sandbox`** — make it work in a plain terminal environment.
- **`--virtual-time-budget=15000`** — fast-forward the page's internal clock by 15 000 ms so its
  JavaScript finishes fetching and rendering, without actually waiting 15 seconds.
- **`--dump-dom`** — print the **DOM** (the page as it exists *after* scripts have run) rather than
  the HTML the server sent. This is the whole point: the served HTML is an empty shell.

Three posts appear:

| Date | Content |
|---|---|
| 05/07/26 | "Just finished my last run before the big day, hopping on the tram for my well-deserved coffee at my favourite **French supermarket**." |
| 04/28/26 | *(no text — an image only)* |
| 04/16/26 | "Just finished a 10km run in 1337 seconds, that must be a world record." `#1337runner` |

`05/07/26` in month/day/year order is **7 May 2026** — the exact date in question 5.

The `/replies` tab, which on many platforms is where the good material hides, is empty here ("No
replies yet"). Worth checking every time; not everything pays out.

### Read the sentence, not the gist

> "hopping **on** the tram for my well-deserved coffee at my favourite French supermarket"

The question asks where he **got off**. Boarding and alighting are different stops. It is very easy
to skim this, decide "the tram stop is the one in the photo", and answer the wrong end of the line.

Also note what "**French** supermarket" implies. You do not call a supermarket French when you are in
France; everything there is French. He is somewhere *else*, shopping at a French chain — Carrefour,
Auchan, Cora, E.Leclerc. That single adjective is a geographic constraint, and it is doing real work.

## Step 4 — the photograph, and a country in two letters

The 7 May post carries an image (1080x1440): a wide road at golden hour, traffic lights, a queue of
cars, power lines, and on the left a low building.

First, check the metadata — and expect nothing:

```bash
exiftool -a -G1 photo.jpg
```

**EXIF** (Exchangeable Image File Format) is the block of metadata a camera writes into a photo: the
model, the timestamp, and sometimes GPS coordinates. Here there is none. All that remains is:

```
[IPTC]  Special Instructions : FBMD2300094602...
```

`FBMD` is **Meta's own marker**. Instagram and Threads re-encode every upload, which destroys the
original metadata and stamps their own. So on any Meta-hosted image, plan to geolocate from **content**,
never from EXIF. (This is worth knowing generally: the platform decides whether metadata survives, and
most large ones strip it.)

So: read the picture. Crop the interesting region and enlarge it:

```python
from PIL import Image
im = Image.open('photo.jpg')
c = im.crop((0, 900, 420, 1070))                       # left-hand building
c = c.resize((c.width*4, c.height*4), Image.LANCZOS)   # 4x, smooth interpolation
c.save('sign.png')
```

Painted across the building, in large letters: a company name ending in **`.RO`**.

`.ro` is the **ccTLD** — *country-code top-level domain* — for **Romania**. And it is painted on the
premises, not printed on a roadside advertising hoarding, which means the business is physically
*here*, not merely advertising here. One country, derived from the subject's own photograph.

Now the second half of the trick: that domain is a real, working website, and Romanian businesses put
their address on their contact page. Fetch it and **read it off the page** — not out of a search
engine's AI summary, which routinely asserts things the cited page does not contain:

```bash
curl -sS -A "$UA" -L -o contact.html 'https://<company>.ro/index.php?route=information/contact'
```

The page says, in the shop's own words (Romanian):

> *"Adresa: Calea Buziasului nr. 13 … Magazinul este situat in **[redacted]**, pe Calea Buziasului,
> in Ciarda Rosie, **la capatul liniei Tramvaiului 4** si autobuzului Expres 2, prima casa pe partea
> stanga, **in dreptul semaforului**."*

Translated: the shop is in **[the city]**, on Calea Buziașului, in the Ciarda Roșie district, **at the
terminus of tram line 4**, first house on the left, **level with the traffic light**.

Every clause cross-checks against the photograph: a traffic light is in frame, the building is the
first on that side, the road is a wide arterial. And the city name is **nine characters** — question
4's mask.

**Question 4 answered**, and answered from his own photograph rather than from a guess about where
Europeans go running.

Better still, the contact page hands over the next fact for free: this spot is **the terminus of tram
line 4**. That is why "hopping on the tram" appears in the same post as this photograph.

## Step 5 — the tram stop, from map data rather than intuition

Do **not** ask a geocoder "what is near these coordinates". A geocoder returns the nearest thing it
can match to your text and never replies "I'm not sure" — it will confidently place a name on the
wrong corner. Instead, query the map database directly.

**OpenStreetMap** is a public, editable world map, and **Overpass** is its query API. Public-transport
stops are stored as real objects with names, so you can *ask* rather than infer.

First, the route:

```
[out:json][timeout:60];
area["name"="<city>"]["boundary"="administrative"]->.a;
relation(area.a)["type"="route"]["route"="tram"]["ref"="4"];
out tags;
```

Reading that: `[out:json]` asks for JSON; `area[...]->.a` finds the city boundary and stores it as
`.a`; `relation(area.a)[...]` finds route relations inside it — a **relation** is OSM's way of
grouping many road segments and stops into one logical thing, like a tram line; `["ref"="4"]` is the
line number; `out tags;` prints their tags.

```bash
curl -sS --data-urlencode "data@query.txt" https://overpass-api.de/api/interpreter
```

Two relations, one per direction. The southern terminus is a three-word name beginning `Piața…`
(Romanian for "square"), and its coordinates put it at the Ciarda Roșie end of Calea Buziașului —
**exactly where the shop said it would be, and exactly where the photograph was taken.**

Then pull line 4's 22 stops with coordinates, and every French-brand supermarket in the city:

```
[out:json][timeout:90];
area["name"="<city>"]["boundary"="administrative"]->.a;
(
  nwr(area.a)["shop"~"supermarket|convenience|department_store|mall"]
             ["brand"~"Carrefour|Auchan|Cora|Leclerc|Intermarché",i];
);
out center tags;
```

(`nwr` = nodes, ways and relations; `~` is a regular-expression match; `,i` makes it
case-insensitive; `out center` gives one representative coordinate for shapes that are not single
points.) Then join the two lists with the haversine formula — great-circle distance between two
latitude/longitude pairs:

```
     106 m  Carrefour Market   nearest line-4 stop: Balta Verde
     124 m  Carrefour Market   nearest line-4 stop: Sala Olimpia
     133 m  Carrefour Market   nearest line-4 stop: Coriolan Brediceanu
     239 m  Auchan             nearest line-4 stop: [the terminus]
     ...
```

### Wrong turn #3 — the join that could not decide

Here is the honest bit. **That table does not answer the question.** Three Carrefour Markets sit
*closer* to a line-4 stop than the Auchan does. If I had gone in expecting the terminus and read this
table as agreement, I would have been fitting the evidence to a conclusion.

What actually decides it is three independent things, none of which depend on the distance ranking:

1. The photograph he posted **on that date** is on Calea Buziașului, beside that company's building.
2. That company's own website places the building **at the terminus of tram line 4**, by the traffic
   light — and the traffic light is in his photograph.
3. The terminus has an **Auchan** 239 m away. Auchan is the French *hypermarket* — a big store with
   a café in it. "Carrefour Market" branches are small city-centre convenience shops; you do not go
   there for a well-deserved coffee.

The supermarket join is corroboration, not proof. Saying "the Auchan is closest, so that's the stop"
would have been false, and it would have happened to give the right answer, which is worse — it
teaches you to trust a method that did not work.

## Step 6 — count the mask in pixels, and catch an off-by-one

The OSM name for that terminus is three words of **5, 8 and 9** characters.

The mask is **5, 8, 10**.

At this point you can shrug — diacritics, transliteration, close enough — and submit. Don't. I had
been counting the asterisks by eye all room, which is exactly the sort of sloppiness that turns a
checksum into a rubber stamp. So I counted them in pixels instead, and **calibrated the counter on
the two masks whose answers I already knew**:

```python
from PIL import Image
import numpy as np
a  = np.array(Image.open('mask-crop.png').convert('L')).astype(float)
bg = np.median(a)
m  = a > bg + 60                       # ink is brighter than the background
col = m.sum(axis=0)                    # ink pixels per column
# contiguous runs of inked columns = glyphs; wide gaps = spaces
```

| Question | Counted | Already known | Verdict |
|---|---|---|---|
| Q1 name | `[3, 3]` | `*** ***` | counter is honest |
| Q3 phone | `[3, 3, 3, 3]` | 12 digits | counter is honest |
| Q2 email | 20 | the address found = 20 | ✔ |
| Q4 city | 9 | the city found = 9 | ✔ |
| **Q5 station** | **`[5, 8, 10]`** | — | the test |

A control that reproduces two known answers is a control you can believe. So the `[5, 8, 9]` name is
genuinely **wrong by one character**, and a filter across all 76 distinct tram-stop names in the city
returned **no** name matching `[5, 8, 10]`.

The resolution: **OpenStreetMap is crowd-maintained, and its `name` tag is not the transport
operator's official name.** Go to the operator. Their line-4 page prints the terminus verbatim, and
the surname carries a final letter that OSM drops:

```
Linia 4 Tramvai Calea Torontalului (Ciocanul) - Piața Gh. [redacted] (AEM)
```

Expand the abbreviated forename and the three words are **5, 8 and 10**. Exact match. **Question 5
answered.**

That is the whole argument for the mask. Nothing else in the chain would have caught a one-character
error, and I would have submitted a near-miss with complete confidence.

## Step 7 — the phone number, and the line where passive stops

Question 3 is the one the brief warned about. Before doing anything active, exhaust the passive
routes — and give each one a control, so that "nothing found" means something:

| Attempt | Result | Control |
|---|---|---|
| **Gravatar** profile for `md5(email)` | `404` | a known Gravatar address → `200`, so the lookup works |
| DNS for four plausible company domains | all empty | `dig +short example.com A` → an address, so DNS works |
| Web search for the consultancy's website | nothing real | — |
| A LinkedIn profile matching the name | **a different person** — based in Taipei | a nonexistent LinkedIn slug → `404`, so the oracle works |

**Gravatar** is a service that maps an email address to an avatar via the MD5 hash of the address —
worth a try on any email you find, and free. `dig` is the DNS lookup tool; `+short` prints just the
answer.

That LinkedIn row deserves a sentence. It is a real person with the right name in the wrong country.
Matching on a *name* is not identification. A record belongs to your subject only when a **second,
independent field** also matches — and his second field (the city) says no. Name-only matches are the
most common way an OSINT report ends up about a stranger.

So the number is not published anywhere readable. But we know exactly where it lives, because the
comment thread under the 7 May post contains a screenshot posted by another reader: an **out-of-office
auto-reply** from the subject.

> "Good day, I will be absent from the office while I prepare for a marathon. **You can contact my on
> my phone for anything urgent.** Best Regards,"

…followed by a signature card: the name, `// CYBERSECURITY CONSULTANT`, an email, **a phone number**,
and the consultancy's name. A nice touch: the avatar tile in the signature reads `0x4A4C`, which is
hexadecimal for the ASCII bytes `J` and `L` — his initials, written the way a hacker would.

**That is the active OSINT step.** Mail the address; the auto-responder mails the signature back,
and the signature carries the number. It matches the `*** *** *** ***` mask as four groups of three
— the leading `+` counting as one of the first group's three characters — and its country code
independently corroborates the country I had derived from a domain painted on a wall. It also prints
the email address in clear, confirming what the commit object gave.

### The first attempt got nothing, and what that did and did not prove

The first message sent to that address produced no reply at all. It is worth being precise about what
that silence could mean, because there were three live possibilities and no way to separate them from
one observation:

- the responder had expired (the screenshots of other people's replies were three months old);
- Gmail's vacation responder replies **at most once every four days to the same sender**, so a
  previous message from that address would suppress a second reply;
- the message was filed as spam on one side or the other, and Gmail never auto-replies to spam.

I wrote down "probably expired" as the leading hypothesis — **and it was wrong**. A second attempt,
from a different address and with a subject and body that explicitly asked for the number, got the
reply within minutes.

But notice the mistake in that second attempt: **two things changed at once**, the sender *and* the
content. So it does not establish which mattered — whether the responder reads the message and
ignores generic mail, or whether the four-day rule was simply lifted by the new address. One cause at
a time, and I did not. It is recorded here as unresolved rather than dressed up as "asking directly
is what triggers it", because a confident wrong explanation is worse than an honest gap.

What the episode *does* establish is worth more than the mechanism: **"no reply" is not "no
responder".** Silence is an ambiguous result, and an ambiguous result is not a finding. Had I reported
"the number is not obtainable", it would have been wrong — and it would have looked exactly like
diligence.

### The part that is not a technique

Everything up to here was reading. This step *writes*: it puts your address in someone else's
mailbox, it is logged, it cannot be recalled, and in a real engagement it can tip off the subject and
land you outside your authorisation. TryHackMe says explicitly that the interaction here is part of
the controlled setup — that permission is what makes it acceptable, and it is exactly the permission
you would not have in the wild.

Do it last, deliberately, and know what you are sending before you send it. The order matters:
everything passive first, then one considered active step, never the reverse.

### A note on the comment thread

Those comments are not the subject's friends. They are other people solving this room, arguing with
each other, and one of them names the city outright. I quarantined that and derived the city from the
photograph anyway. Two reasons: a stranger's comment is a claim, not a verified fact — and taking it
skips the half of the room that teaches anything. When it later matched what I derived, it became a
confirmation instead of a source, which is the only useful thing it could have been.

## One last trap: the right answer, spelled wrong

The city answer was **rejected** on the first submission — even though it was the correct city, found
by the method above and independently corroborated.

The cause was not the research. It was the string. The city is Romanian, and I submitted the **ASCII
transliteration**; the checker wants the form with its diacritic. Same nine characters, same city,
different bytes.

And there is a sharper trap underneath that one. Romanian `ș` and `ț` exist in **two Unicode forms**
that render near-identically in most fonts:

| Glyph | Codepoint | Name | Correct? |
|---|---|---|---|
| `ș` | U+0219 | latin small letter s with **comma below** | yes — modern Romanian |
| `ş` | U+015F | latin small letter s with **cedilla** | legacy (Turkish), still common on the web |
| `ț` | U+021B | latin small letter t with **comma below** | yes |
| `ţ` | U+0163 | latin small letter t with **cedilla** | legacy |

So text copied from a page that uses the cedilla variant fails a literal comparison against the
comma-below variant *while looking identical on screen*. If an answer is refused and you are sure of
it, check the bytes before you re-open the investigation:

```bash
python3 -c "import unicodedata as u; print([(c, u.name(c)) for c in 'șşțţ'])"
# ('ș', 'LATIN SMALL LETTER S WITH COMMA BELOW')   <- Romanian
# ('ş', 'LATIN SMALL LETTER S WITH CEDILLA')       <- not Romanian, looks the same
# ('ț', 'LATIN SMALL LETTER T WITH COMMA BELOW')
# ('ţ', 'LATIN SMALL LETTER T WITH CEDILLA')
```

**The generalisable bit:** the tram-stop answer — which only exists in that one city — had already
been **accepted** when the city was refused. A dependent answer being accepted is a *control*: it
proves the finding is right and the encoding is wrong. Re-deriving the geolocation would have been
hours of wasted work on a problem that lived entirely in one codepoint.

Carry the target language's own spelling as your primary value from the start. I had the correct form
sitting in my own notes — in a parenthesis, next to the ASCII one I actually submitted.

## The answers

| # | Question | Answer | How |
|---|---|---|---|
| 1 | Full name | `[redacted]` | komoot `display_name`, GitHub `company`, and the Threads title — three independent sources |
| 2 | Exposed email | `[redacted]@gmail.com` | `git log --format='%ae'` — hidden on the profile, stamped on every commit |
| 3 | Phone number | `[redacted]` | the out-of-office auto-reply's signature — the one active step |
| 4 | City | `[redacted]` | a `.ro` domain painted on a wall in his 7 May photo → that firm's contact page — **submit it with its Romanian diacritic, not the ASCII transliteration** |
| 5 | Tram station | `[redacted]` | line 4's terminus via Overpass, spelling taken from the operator, verified against the 5/8/10 mask |

## What this room actually teaches

- **Follow references, not names.** Every hop here was a link the subject published: komoot's bio to
  GitHub, GitHub's company field to a persona, the bio's own words to a photograph. Not one came from
  guessing a username. Guessing finds strangers with the same name — as the Taipei LinkedIn shows.
- **Hidden fields leak through automatic ones.** He hid `email` and `location` on GitHub. The email
  was in the commit metadata anyway, because git writes it into every commit and pushing publishes it.
- **A control belongs in every run, and you read it first.** A username sweep returned `200 OK` for a
  handle that cannot exist; a tours API returned `403` for a user that cannot exist. Both would have
  become confident false findings. Controls are cheap and they are the only defence against an
  instrument that answers even when it cannot see.
- **The status code describes delivery, not existence.** Three profile tabs came back byte-for-byte
  identical. If a page is drawn by JavaScript, `curl` sees a shell — switch to a crawler User-Agent
  for metadata, or render it headless for content.
- **A value on a page is not a value about the subject.** The `geolocation` field in his profile JSON
  was my own IP's city.
- **Photographs geolocate through content, not metadata.** Meta strips EXIF from every upload. Two
  letters of a domain painted on a wall gave up the country, and that company's own contact page gave
  up the city, the street and the tram line.
- **Read the preposition.** "Hopping *on* the tram" is not "got *off*". Two different stops.
- **The answer mask is a checksum — count it properly.** It killed a four-letter city in one second,
  and it caught a one-character error in a stop name that every other line of evidence agreed with.
- **Do the passive work first, then one deliberate active step.** And notice which of the two you are
  doing, every time.
- **An answer can be right and still be rejected.** When a *dependent* answer has already been
  accepted, that acceptance is a control proving your research is sound and the problem is in the
  string — check the codepoints before you re-open the investigation.
- **Silence is not a finding.** The first email got no reply, and "the responder has expired" was a
  comfortable, plausible, *wrong* conclusion. A second attempt answered in minutes. Before reading
  nothing as evidence of nothing, list what else could produce the same silence — and change **one**
  variable at a time when you retry, which is exactly what I failed to do.
