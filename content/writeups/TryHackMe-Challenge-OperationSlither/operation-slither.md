---
description: "TryHackMe — Operation Slither. A three-task OSINT chain that starts with one handle on a hacker forum and ends in a deleted terraform.tfstate inside a public GitHub repository. Includes the control that stops a username sweep from inventing seven accounts that do not exist, and the two hours of dead ends that came with it."
---

# Operation Slither — one handle, three operators, five kinds of leak

**TryHackMe · Hackfinity · category: OSINT**

> **The three flags are redacted** here as `THM{[redacted]}`, and so are the base64 strings that
> encode them — a base64 blob that decodes to a flag *is* the flag, so leaving it in while scrubbing
> the plaintext would be redaction theatre. Each one is shown truncated (`VEhNe3Ns…fQ==`) so you can
> still recognise the shape.
>
> **What I kept and why:** every handle, every platform, every URL, every command, and every wrong
> turn. In this room the *chain of identifiers* is the entire lesson — redacting the handles would
> leave a page about nothing. The flags teach you nothing; they are just proof you were there.

## The brief

Three forum posts leak over three tasks. A crew calling itself **Sneaky Viper** is running
**Operation Slither** against a telecom company. Each post is written by a different operator, and
each task asks you to identify the next one.

| Task | What you are given | What has to come out |
|---|---|---|
| 1 | The handle `v3n0mbyt3_`, said to be on Twitter/X | Which **other platform** they use, and a flag |
| 2 | Nothing — the account that posted was deleted. Bids go "on Threads via this handle: **HIDDEN**" | The **second operator's username**, and a flag |
| 3 | A post selling phishing infrastructure, contact `REDACTED@protonmail.com` | The **third operator's handle**, their **other platform**, and a flag |

There is no machine, no VPN, no scanning. Everything here is public and was published by the targets
themselves. That is what **OSINT** — **O**pen **S**ource **INT**elligence — means: intelligence built
from sources anyone can reach, without breaking into anything.

The room also ships a three-step "Reconnaissance Guide" per task. Read all nine steps together
before starting, because they are not decoration — they are a description of the chain:

1. *Broad search across common social platforms* → username enumeration.
2. *Correlate discovered profiles to confirm ownership* → never trust a matching name alone.
3. *Review interactions, posts, **and replies*** → the word "replies" is doing real work.
4. *Use related usernames or connections identified in earlier steps.*
5. *Enumerate additional platforms for linked accounts.*
6. *Follow **media or resource references** across platforms* → a link inside a caption, not a name.
7. *Identify secondary accounts through visible **interactions (likes, follows)***.
8. *Extend into **developer or technical platforms***.
9. *Analyse **activity history (repositories or commits)*** → git history, not current files.

---

## Step 0 — the instrument check, before any conclusion

Here is the single most important habit in this entire discipline, and it costs thirty seconds.

Before believing that a username does or does not exist somewhere, prove that your tool can tell the
difference. Ask each platform about **a username that certainly exists** and **a username that
certainly cannot**:

```
GET https://github.com/torvalds               -> 200
GET https://github.com/zzz-no-such-user-xyz9  -> 404
```

GitHub answers honestly. `200` means the account is real, `404` means it is not. On GitHub, a status
code is evidence.

Hold on to that, because most platforms do not behave this way, and the next section is why.

---

## Step 1 — the broad sweep, and why the first result was a lie

The professional tools for this are **Sherlock** and **WhatsMyName**: they hold a list of a few
hundred sites and the URL shape each uses for a profile — `https://github.com/<user>`,
`https://www.tiktok.com/@<user>`, `https://scratch.mit.edu/users/<user>/` — request every one, and
report which say the account exists. Neither was installed on this machine, so the same idea in about
thirty lines of Python: build the URL for eighteen platforms, request it with a normal browser
`User-Agent`, print the status code and the body length.

- A **User-Agent** is the string a client sends to identify itself. Sending Python's default
  (`Python-urllib/3.12`) gets you blocked or served a different page by most large sites, so sending
  a browser's is not a trick, it is the minimum for the request to be representative.

First pass on `v3n0mbyt3_` reported `200 OK` from **instagram, threads, tiktok, twitch, telegram,
steam, replit and scratch**.

Eight platforms. Every one of them a hit. That result is too good, and "too good" is a reason to
check, not to celebrate. So — the control that matters:

**Run the identical sweep for a username that cannot exist.**

| Platform | `qzx9nosuchuser4471` | `v3n0mbyt3_` | Verdict |
|---|---|---|---|
| instagram | 200, 612 659 B | 200, 612 639 B | identical shell — **proves nothing** |
| threads | 200, 259 783 B | 200, 261 716 B | shell, 2 KB apart — inconclusive |
| tiktok | 200, 366 672 B | 200, 365 494 B | shell — nothing |
| twitch | 200, 194 404 B | 200, 194 404 B | **byte-identical** — nothing |
| steam | 200, 26 916 B | 200, 26 900 B | shell — nothing |
| replit | 200, 101 756 B | 200, 101 757 B | shell — nothing |
| telegram | 200, 9 743 B | 200, 19 929 B | different — worth opening |
| scratch | **404** | 200, 38 993 B | honest 404 → account exists |

**Why this happens.** A modern site is a *single-page application*: the server ships the same
JavaScript bundle to every visitor, and only afterwards does the browser ask an API whether that
profile is real. The HTTP status describes the delivery of the app, not the existence of the user. A
naive sweep reads `200` as "found" and invents accounts.

Without the garbage-handle control this write-up would have claimed eight accounts, seven of them
imaginary. **Run the control first, every time.**

Two survivors, both opened by hand:

- **Telegram** served the generic `Telegram Messenger` landing page (`og:title` = *"Telegram – a new
  era of messaging"*). That is what `t.me` shows for an unclaimed handle. Not an account.
- **Scratch** was a real account — and a perfect trap. `scratch.mit.edu/users/v3n0mbyt3_`: joined six
  months ago, located in Armenia, bio *"I hack things. The answer to question 5 is 'Pineapple$' btw.
  Subscribe!"*, zero projects, one follower. That is a child on a children's coding site who picked
  an edgy handle. **Enumeration finds handles. Only reading finds people.**

The same trap sits on X: search engines offer `x.com/V3N0MBYT3` first, belonging to "Adam Stein", who
**joined in March 2016** and posts about comic books. The room's handle has a **trailing underscore**.
One character separates the persona from a stranger who has had that name for a decade.

---

## Step 2 — admitting the tool is blind

Instagram, Threads, TikTok and X all returned `200` with a JavaScript shell and **empty `<meta>`
tags**. Re-fetching changed nothing.

The honest reading of that evidence is *"I cannot see this platform"*, not *"nothing is there"*.
Writing "nothing found on Instagram" from a login wall would be a claim the evidence does not support.

The fix is to stop pretending a command-line fetcher is a browser and use one:

```bash
chromium --headless=new --remote-debugging-port=9222 \
         --user-data-dir=/tmp/scratch/chrome-prof about:blank
```

- `--headless=new` runs Chrome's real rendering engine with no visible window. It executes the
  JavaScript, so you get the page a human would see rather than the empty shell.
- `--remote-debugging-port=9222` opens the **CDP** (**C**hrome **D**ev**T**ools **P**rotocol) socket —
  the same channel the F12 developer tools use. It is what lets a script navigate the page, run
  JavaScript inside it and read the rendered result.
- `--user-data-dir` points at a throwaway profile, so it never touches your real browser's cookies.

**Whatever you start, you stop.** Record the PID now; it gets killed by number at the end.

The very first request through the browser changed the answer.

---

## Step 3 — Task 1: the leader's second platform

```
https://www.threads.com/@v3n0mbyt3_
```

Title: **`v3n0m (@v3n0mbyt3_) • Threads`**. Display name `v3n0m`, 101 followers, no bio, four public
posts from April 2024:

| Date | Post |
|---|---|
| 04/21/24 | lazy day 💤 |
| 04/18/24 | Just upgraded my workstation 💯 *(with a photo)* |
| 04/17/24 | lol people are going crazy with the heart animation |
| 04/15/24 | **Is this better than twitter? Seems cooler.** |

That last post is the corroboration the guide asked for — an account that talks about *arriving from
Twitter*, opened in April 2024, under the same handle. Two more independent checks, because one is
never enough:

- **X/Twitter**: `api.fxtwitter.com/v3n0mbyt3_` is a public read-only mirror of X that needs no
  login. It reports the account exists: display name **`v3n0m`**, id `1778796885953953792`, **joined
  12 April 2024**, 4 posts, 9 followers, 3 following, **empty bio, no banner**. Same display name,
  same month, deliberately empty — the X account is the starting point, not the prize.
- **Instagram** `@v3n0mbyt3_` exists too, with **0 posts and an empty bio**. That is the shell Meta
  creates because *a Threads account requires an Instagram account*. It is plumbing, not a platform
  the persona uses.

**Answer — task 1, question 1: `threads`.**

### The photo that led nowhere (and why that is worth a paragraph)

The "Just upgraded my workstation" post has an image, and an uploaded photo is normally a gift: EXIF
metadata can carry GPS coordinates, a camera model and a timestamp.

```bash
exiftool workstation.jpg
```

- **EXIF** is a block of metadata cameras and phones embed in a JPEG.
- `exiftool` reads it. It is the first thing to run on any image you acquire.

Result: **no GPS, no camera, no timestamps.** The only marker is Facebook's own `FBMD…` string, which
Meta stamps on every re-encoded upload. **Meta strips EXIF from everything.** So does X, so does
Discord. Check whether the *platform* destroys metadata before treating an uploaded image as a
metadata source.

Cropping and upscaling the wall behind the desk shows framed posters reading **"AXEL SMITH"** and
"ARWEE 2"; enlarging the monitors shows text-shaped smears that are not text. The picture is
AI-generated set dressing, and **AI image generators produce name-shaped noise**. Treat text inside a
generated image as noise until something independent corroborates it. Chasing "Axel Smith" would have
been hunting a person who does not exist.

---

## Step 4 — Task 1: the flag was one tab away

None of the four visible posts contains a flag, and neither does the photo. This is where the room
teaches its actual lesson, and it is one word in the guide: *"Review interactions, posts, **and
replies**."*

A Threads profile has four tabs — **Threads**, **Replies**, **Media**, **Reposts**. The default tab
shows only what the account *posted*. What it said inside *other people's* threads lives behind
`/replies`, and logged-out visitors can read it:

```
https://www.threads.com/@v3n0mbyt3_/replies
```

```
_myst1cv1x3n_   04/23/24   Replying to @v3n0mbyt3_
    I really can't get over with this one 🤪
    VEhNe3Ns…cyF9
```

That is **base64**. Base64 is not encryption — it writes arbitrary bytes using only 64 safe
characters (`A–Z a–z 0–9 + /`, padded with `=`) so they survive being pasted into a text field.
Anyone can reverse it.

**The tell:** any base64 string starting **`VEhN`** decodes to text starting **`THM`**, because those
four characters are exactly how the bytes `T`, `H`, `M` encode. Learn that prefix and you will spot a
TryHackMe flag at a glance for the rest of your career.

```bash
echo 'VEhNe3Ns…cyF9' | base64 -d
```

- `echo` prints the string, `|` pipes it into the next command, `base64 -d` decodes it.

Out comes `THM{[redacted]}` — and the plaintext inside the braces literally names the technique:
*slithery tweets and leaky **replies***.

**Answer — task 1, question 2: `THM{[redacted]}`.**

The same reply hands over the next task for free. The account that wrote it is **`_myst1cv1x3n_`**.

---

## Step 5 — Task 2: the second operator

**Answer — task 2, question 1: `_myst1cv1x3n_`.**

A name in one reply is a candidate, not a conclusion, so corroborate before moving on. The
conversation under `lazy day 💤` reads as two colleagues, not two strangers:

```
_myst1cv1x3n_  still recovering? 🤣
v3n0mbyt3_     Yea for sure. That last OP was wild.
_myst1cv1x3n_  I still can't believe that they are still not aware of us for weeks.
v3n0mbyt3_     🤣 time to harvest soon!
```

*"They are still not aware of us for weeks"* is the forum post's own boast — *"we've been hiding for
weeks in their network"* — told from the inside. Two independent sources agreeing is what "confirm
ownership and authenticity" means in practice.

Profile: `Mystic v1x3n`, bio *"Delightfully Chaotic xo"*, 52 followers, three posts. No flag in any
of them.

### The dead end: guessing the name

I ran the full sweep again for `_myst1cv1x3n_`, `myst1cv1x3n` and `myst1cv1x3n_`, control first.
**Nothing.** Only `pypi.org` answered `200` — and so did the control, so that is PyPI serving one
page to everybody, not a hit.

I then tried the obvious de-leetspeaked guesses, `mysticvixen` and `v1x3n`, which lit up GitHub,
YouTube, SoundCloud, Mastodon, Flickr and half a dozen more. **Every one of them is a stranger.**
Short ordinary handles are taken on every platform on earth. A hit on a *guessed* handle proves
nothing at all — and if one of those strangers' profiles had happened to look plausible, it would
have produced a confident wrong answer.

Ten minutes gone. The mistake was reading the guide's step 5 (*"enumerate additional platforms"*) and
ignoring step 6: *"**Follow media or resource references** across platforms."* A **reference**, not a
name.

---

## Step 6 — Task 2: the caption that leaks through the login wall

The Threads account is tied to an Instagram account, and *that* one is not empty:

```
https://www.instagram.com/_myst1cv1x3n_/
-> "29 Followers, 0 Following, 5 Posts - Mystic v1x3n (@_myst1cv1x3n_)"
```

Five posts. Instagram will not render them to a logged-out browser — but it **will** hand over each
post's caption in an Open Graph tag, because that is how link previews work in every chat app on
earth:

```python
UA = {"User-Agent": "Mozilla/5.0 (compatible; facebookexternalhit/1.1)"}
# then read  <meta property="og:description" content="...">
```

- **Open Graph** (`og:`) tags are `<meta>` tags a page publishes so other sites can render a title,
  description and thumbnail when someone shares the link. Their entire purpose is to be read by
  machines that are not logged in, so they are served to **anyone** — which is exactly why they leak
  content the login wall is otherwise hiding. This is one of the most reliable tricks in social-media
  OSINT and it is not a bug; it is the feature working as designed.

| Post | Caption |
|---|---|
| `C6BvsylPpp6` | "Surreal" |
| `C6Burv9vcWN` | "AI art for EDM is 🔥🔥🔥" |
| **`C6BuP1CNMCI`** | **"Been playing with EDM for a while now. Check the extended prototype here! 😊 https://soundcloud.com/v1x3n-195859753/prototype1"** |
| `C6Br-Apvr24` | "Last meetup" |
| `C6Brho7P94v` | "missing this place" |

There is the resource reference. The next platform is **SoundCloud**, and nobody could have guessed
the URL — `v1x3n-195859753` carries a numeric suffix SoundCloud generated automatically.

---

## Step 7 — Task 2: the flag in a track description

```
https://soundcloud.com/v1x3n-195859753          -> display name  v1x3n_ , 4 tracks, 11 followers
https://soundcloud.com/v1x3n-195859753/prototype2
```

SoundCloud publishes a track's description in the page source, no login required:

```html
<meta itemprop="description" content="VEhNe3Mw…ja30=" />
```

`VEhN…` again. Decoded, `THM{[redacted]}` — and the plaintext names the discipline you have been
practising: **SOCMINT** (social media intelligence, the branch of OSINT that works purely from social
platforms) plus an opsec finger-misclick. The in-story excuse for a secret pasted into a public field.

**Answer — task 2, question 2: `THM{[redacted]}`.**

> **A note on a spoiled room.** While reading that page I found a comment from **May 2026** in which a
> student had pasted **task 3's flag** in plaintext, with the words *"this is the third flag"*. I
> recorded it in the evidence file and did not use it. Task 3 below was solved from its own evidence,
> and the value I derived matched — which is the only reason the comment is worth mentioning at all.
> An answer you did not derive teaches you nothing, and a stranger's claim is a claim, not a fact.

---

## Step 8 — Task 3: the third operator, from a follower list

Guide: *"Identify secondary accounts through visible **interactions (likes, follows,
collaborations)**."* SoundCloud publishes follower lists to logged-out visitors:

```
https://soundcloud.com/v1x3n-195859753/followers
```

Eleven followers. Ten are ordinary account names — `El Pepe`, `jacky`, `Fathima Siraj`,
`Gamer Prajun`, `jesus gavancho` — the drive-by traffic any public track accumulates. One is not:

```
sh4d0wF4NG   ->   soundcloud.com/sh4d0wf4ng   (7 followers, bio "EDM / LOFI chill")
```

`sh4d0wF4NG` is *leetspeak* in precisely the register of `v3n0mbyt3_` and `_myst1cv1x3n_`: digits
substituted for letters (`4`=a, `0`=o, `3`=e), and a **fang** to go with the viper. The music bio
matches the crew's cover story.

**Answer — task 3, question 1: `sh4d0wF4NG`.**

---

## Step 9 — Task 3: the developer platform

Guide: *"Extend reconnaissance into **developer or technical platforms**."* Third sweep, control
first as always:

```
control (qzx9nosuchuser4471):  github 404   gitlab 403   dev.to 404   bitbucket 404   reddit 200 (!)
sh4d0wf4ng:                    github 200   reddit 200
```

Read the control row before the result row. **Reddit answers `200` for a user that cannot exist**, so
the Reddit "hit" means nothing — without the control it would have looked like a second account.
GitHub gave `404` for the fake handle and **`200` for `sh4d0wf4ng`**.

**Answer — task 3, question 2: `github`.**

```
https://api.github.com/users/sh4d0wf4ng
```

- The **GitHub API** is a machine-readable version of the site. Public data needs no token, and it
  hands over fields the web page buries.

```
login  sh4d0wF4NG    name  sdF4NG    bio  "Chillin"    created_at  2024-04-18    public_repos  3
```

| Repo | Fork? | What it is |
|---|---|---|
| `evilginx2` | fork | A man-in-the-middle phishing framework that steals **session cookies**, defeating most MFA |
| `gophish` | fork | An open-source phishing-campaign platform |
| **`red-team-infra`** | **original** | No description — and the only thing here they wrote themselves |

Compare against the task-3 sales post: *"Updated Google Phishlet (evilginx v3.0)"*, *"GoPhish
automation scripts"*, *"Terraform scripts for a resilient phishing infrastructure"*. Line for line,
this account **is** the seller.

---

## Step 10 — Task 3: a deleted file that was never deleted

Guide: *"Analyse **activity history (such as repositories or commits)** for embedded information."*
That is a precise instruction — look at the **history**, not at the current files.

**Why they are different.** Git does not store "the current state of the project". It stores every
commit ever made, each a full snapshot. Deleting a file in a later commit removes it from the working
tree; it does **not** remove it from the earlier commits, which are still in the repository and still
copied to anyone who clones it. **A secret committed once is public forever** unless the history
itself is rewritten.

```bash
git clone https://github.com/sh4d0wF4NG/red-team-infra.git
cd red-team-infra
git log --all -p | grep -inE 'THM\{|VEhN|password|secret|api[_-]?key|token'
```

- `git clone` copies the whole repository **including its full history**, not just the latest files.
- `git log --all -p` prints every commit on every branch **with its patch** (`-p`) — the actual added
  and removed lines.
- `grep`: `-i` ignores case, `-n` numbers the lines, `-E` enables the `|` alternation. Piping the
  entire history through it searches everything the repo has ever contained, in one pass.

The hit:

```
-    "shadow-password": {
-      "value": "VEhNe3No…cHd9"
```

A leading `-` in a patch means **that line was removed** by the commit shown. So the value was
committed, then deleted. Which commits?

```bash
git log --all --oneline -S 'VEhNe3No'
```

- `-S <string>` is git's **pickaxe**. It lists only the commits where the *number of occurrences* of
  that string changed — that is, the one that introduced it and the one that removed it. It is the
  fastest way to date a leak.

```
90224ec  Created new gophish script / Fixed gitignore     <- removed it
78de1f1  Added automation for user                        <- added it
```

Now read the two commits' file lists in order, and the entire accident is visible:

```
78de1f1  Added automation for user            (2024-04-23 22:53:48)
         iam.tf                   |  25 +
         terraform.tfstate        | 225 +
         terraform.tfstate.backup | 531 +

90224ec  Created new gophish script
         Fixed gitignore                      (2024-04-23 22:55:25)
         .gitignore               |   2 +
         terraform.tfstate        | 745 -
         terraform.tfstate.backup | 536 -
```

**Ninety-seven seconds.** That is how long it took them to notice.

**Terraform** builds cloud infrastructure from configuration files. When it runs it writes
`terraform.tfstate`, a JSON record of everything it created — **including generated passwords in
plaintext**, because it has to remember them in order to manage them. Every Terraform guide on earth
says keep that file out of version control. `sh4d0wF4NG` committed it, realised, added it to
`.gitignore`, and deleted it.

**A `.gitignore` stops a file being committed *again*. It does nothing whatsoever about the commit
that already exists.** That single misunderstanding is one of the most common real-world credential
leaks there is, and this room reproduces it exactly.

Recover the file from the commit that still holds it:

```bash
git show 78de1f1:terraform.tfstate
```

- `git show <commit>:<path>` prints a file **as it existed at that commit**, even if it does not
  exist now.

```json
"outputs": {
  "shadow-password": {
    "value": "VEhNe3No…cHd9"
    "type": "string"
  }
}
```

and in `iam.tf`, the line that put it there in the first place:

```hcl
output "shadow-password" {
  value = aws_iam_user_login_profile.shadow_user_profile.password
}
```

Decoded: `THM{[redacted]}` — the AWS console password for the IAM user the phishing infrastructure
runs as. The plaintext reads *sharp fangs leaked bloody pw*.

**Answer — task 3, question 3: `THM{[redacted]}`.**

### The free confirmation nobody thinks about

The task-3 forum post ended *"Contact me on `REDACTED@protonmail.com`"*. **Every git commit carries
the author's email address**, and both the API and a local clone will print it:

```bash
git log --format='%an <%ae>'
```

```
sh4d0wF4NG <sh4d0wF4NG@protonmail.com>     (all 9 commits)
```

The redacted address is `sh4d0wF4NG@protonmail.com`. The forum seller and the GitHub account are the
same person, proved by a field almost nobody remembers is public. If you take one habit from this
room, take this one: **on any GitHub target, read the commit metadata before you read the code.**

---

## Answers

| Task | Question | Answer |
|---|---|---|
| 1 | Platform besides X/Twitter | `threads` |
| 1 | Flag | `THM{[redacted]}` — Threads **Replies** tab, base64 inside a reply |
| 2 | Second operator | `_myst1cv1x3n_` |
| 2 | Flag | `THM{[redacted]}` — SoundCloud **track description** of *Prototype2* |
| 3 | Third operator | `sh4d0wF4NG` |
| 3 | Other platform | `github` |
| 3 | Flag | `THM{[redacted]}` — deleted `terraform.tfstate` in the `red-team-infra` git history |

---

## The chain, in one line each

```
forum post: @v3n0mbyt3_
  -> X/Twitter @v3n0mbyt3_ ......... exists, deliberately empty                      (starting point)
  -> Threads  @v3n0mbyt3_ .......... the "other platform"                            [TASK 1 Q1]
     -> /replies tab ............... base64 reply by _myst1cv1x3n_                   [TASK 1 FLAG]
        -> _myst1cv1x3n_ ........... the second operator                             [TASK 2 Q1]
           -> Instagram @_myst1cv1x3n_ (captions via og:description)
              -> caption links SoundCloud v1x3n_
                 -> track "Prototype2", description field = base64                   [TASK 2 FLAG]
                 -> public follower list -> sh4d0wF4NG                               [TASK 3 Q1]
                    -> GitHub sh4d0wF4NG                                             [TASK 3 Q2]
                       -> repo red-team-infra
                          -> 78de1f1 added terraform.tfstate
                          -> 90224ec deleted it and fixed .gitignore
                          -> the value is still in the history                       [TASK 3 FLAG]
                          -> commit author email = the REDACTED@protonmail.com
```

Every hop is a **different kind** of leak, and that is the design of the room:

1. a profile tab most people never open;
2. an Open Graph tag that ignores the login wall;
3. a free-text description field on a music site;
4. a public follower list;
5. a git commit that outlived the file it touched.

None of them is a vulnerability. All of them are features, used by someone who did not think about
who else can read them.

---

## Wrong turns, kept in

A clean narrative would be a lie about how this went.

1. **Believed `200 OK` meant the account existed.** The first sweep reported eight platforms. Seven
   were single-page-application shells that answer `200` to any username. The garbage-handle control
   caught it before any of it became an answer. *Cost: none, because the control ran first. Without
   it: seven fabricated findings.*
2. **Chased the workstation photo.** Downloaded it, ran `exiftool`, cropped and upscaled the wall
   hunting a poster that reads "AXEL SMITH". Meta had stripped the EXIF and the picture is
   AI-generated. *Cost: ~10 minutes.* **Rule:** check whether the platform destroys metadata before
   treating an upload as a metadata source, and treat text inside a generated image as noise until
   something else corroborates it.
3. **Chased the Scratch account.** It was the only honest `404`/`200` pair in the first sweep, which
   made it look like the strongest hit in the table. It is a child in Armenia with an edgy handle.
   *Cost: ~5 minutes.*
4. **Tried to guess the second operator's other platform by name.** Swept four spellings across
   eighteen sites. The exact handle hit nothing; the short guesses hit a dozen strangers. The link
   was never in the *name* — it was in a *caption*. *Cost: ~10 minutes, and a real risk of a
   confident wrong answer.*
5. **Assumed a command-line fetcher was a browser.** Four platforms returned `200` with an empty
   shell. The honest reading is "I cannot see this", not "nothing is there". Headless Chromium
   changed the result on the first request. *Cost: ~15 minutes — and what caught it was comparing
   byte counts against a username that cannot exist.*
6. **Chromium could not load `x.com` at all**, while plain Python fetched it fine, and
   `syndication.twitter.com` answered `Rate limit exceeded`. Rather than fight it, I went round it:
   `api.fxtwitter.com` is a public read-only mirror that serves the profile as JSON with no login.
   **Two tools failing on one host is a routing problem, not a reason to give up on the fact.**

---

## What this room actually teaches

- **Run the negative control before you believe a sweep.** Ask each platform about a username that
  cannot exist. Whatever it answers to *that* is your definition of "not found". Everything else is
  guesswork wearing a status code.
- **A matching username is a candidate, not a person.** Corroborate with a second, independent link:
  the same display name, a cross-reference in a post, a timeline that fits.
- **Read the tabs nobody reads.** Replies, likes, followers, reposts. The default view is what
  someone chose to present; the other tabs are what they forgot they were publishing.
- **Follow references, not names.** A link inside a caption beats any amount of clever spelling.
- **Login walls leak through their own preview machinery.** Open Graph tags exist to be read by
  strangers.
- **On any git target, the history is the target.** `git log -p`, `git log -S`, `git show <sha>:<path>`,
  and `git log --format='%ae'`. A `.gitignore` added after the fact protects nothing.

## Teardown

The headless Chromium started in step 2 was killed by PID and the kill verified — `ps` shows no such
process and nothing listens on port 9222 any more. Nothing was uploaded, modified or left behind
anywhere: this engagement was entirely read-only, against pages the targets published themselves.
