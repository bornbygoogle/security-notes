---
description: "TryHackMe CyberHeroes — a login page that never talks to the server. The whole room is one inline <script> on /login.html: authenticate() compares your input against two literals written into the page you were just given, so the browser decides whether you are allowed in. The password is stored backwards and reversed at runtime by a function whose name is misspelled RevereString. The real finding is not the credential though, it is what the success branch does with it: instead of setting a session it BUILDS the flag's URL out of the username and password, and that file is a plain static file on Apache with no authorization of any kind. Confidentiality rests entirely on nobody knowing a path that is published in a page linked from the homepage navbar. No shell, no exploit, no code execution — the flag is a file read. Every command and flag explained for a total beginner, with the wrong turns kept in, including the one where I deleted my own evidence and then the lab box expired before I could re-capture it."
---

# CyberHeroes — the login that never asks the server

**TryHackMe · challenge: CyberHeroes · target: `10.x.x.x` (the lab IP changes per lease)**

> **The flag is redacted in this write-up.** Every command, payload, dead end and piece of reasoning
> is here — those are what teach. The flag string itself teaches nothing; it is just proof you were
> there, and publishing it hands the room's answer to the next person instead of letting them earn
> it.

| # | question | answer |
|---|---|---|
| 1 | the flag | `flag{[redacted]}` — a single unauthenticated `GET`, no shell, no code execution |

**What I kept and why.** The username `h3ck3rBoi`, the stored literal `54321@terceSrepuS`, the
password `SuperSecret@12345`, and the full flag path are all kept. Every one of them **is** the
technique: the entire finding is that these values are hardcoded in a page anyone can read, and that
the flag's filename is *constructed out of them*. Redact them and this write-up becomes "I logged in
and got a flag", which teaches nothing. They are also not secrets I am leaking — they are sitting in
the room's own published page source. The flag value is pure prize, and it is the one thing removed.

---

## What you need to know before we start

- A **port** is a numbered door into a running service on a machine. There are 65 535 TCP doors and
  almost all are shut. Port 80 is the usual web door; port 22 is **SSH**, a remote command line.
- **HTTP** is the language browsers speak to web servers. You send a request naming a path like
  `/login.html`; the server sends back a **status code** and usually a body. `200` means "here it
  is", `404` means "no such thing", `403` means "it exists but you may not have it". That difference
  between 403 and 404 matters later.
- **Client-side vs server-side.** Code that runs *server-side* runs on the target machine, where you
  cannot see or change it. Code that runs *client-side* runs in **your own browser**, on a copy the
  server handed you. You can read it, edit it, and ignore it. Putting a security decision
  client-side is like mailing someone the answer key and asking them to mark their own exam.
- **JavaScript** is the language that runs client-side in the browser. If a login is written in
  JavaScript and nothing is sent to the server, then no server ever checks your password.
- **A cookie** is a small token the server gives your browser to remember that you logged in. The
  header that sets one is `Set-Cookie`. **No `Set-Cookie` anywhere is a strong hint that there is no
  server-side application at all.**
- **Recon → enumeration → exploitation** is the order of work. Recon finds out what exists;
  enumeration maps it in detail; exploitation uses it. Most beginners rush to exploitation and skip
  the reading that makes it unnecessary.

---

## Phase 1 — recon: what is actually listening?

Before touching the web, prove the box is reachable and that packets are going where you think.

```bash
ping -c 2 -W 2 10.x.x.x
```

- `-c 2` — send 2 packets then stop (otherwise it runs forever).
- `-W 2` — wait at most 2 seconds for each reply.

Two replies came back at about 17 ms. The box is alive. This sounds trivial and it is not: it means
that if something later times out, you know the difference between "the box is gone" and "my request
never left".

Now knock on every door:

```bash
nmap -sS -p- --min-rate 2000 -oN nmap_full.txt 10.x.x.x
```

- `nmap` — the port scanner.
- `-sS` — a **SYN scan**. A normal TCP connection opens with a three-step handshake: you send `SYN`,
  the server replies `SYN/ACK`, you reply `ACK`. `-sS` sends only the first step and never finishes,
  which is faster and lighter. The catch: it needs raw network access, so it needs **root**. Without
  `sudo` it fails instantly and you want `-sT` (a full connect scan) instead. Find out which you have
  *before* you queue a long scan behind it.
- `-p-` — **all** ports, 1 to 65535. The default is only the most common 1 000, and a service parked
  on a high port would be invisible.
- `--min-rate 2000` — at least 2 000 packets per second, so a 65 535-port sweep finishes in minutes.
- `-oN nmap_full.txt` — save the output to a file. **Always save scans to a file.** Terminal
  scroll-back is not evidence, and you will want to re-read this later.

Result: **2 ports open out of 65 535.** Now get versions, but only for those two:

```bash
nmap -sCV -p22,80 -oN nmap_sv.txt 10.x.x.x
```

- `-sV` — talk to each open port and work out what software and version it is.
- `-sC` — also run nmap's default set of safe informational scripts.
- `-p22,80` — only the ports already known to be open. Never re-scan all 65 535 just to get versions;
  you already paid for that information.

```
22/tcp open  ssh     OpenSSH 8.2p1 Ubuntu 4ubuntu0.4 (Ubuntu Linux; protocol 2.0)
80/tcp open  http    Apache httpd 2.4.48 ((Ubuntu))
|_http-title: CyberHeros : Index
```

Two doors: SSH and a web server. The page title confirms the room (note the room itself spells it
`CyberHeros`, missing the second `e`).

**A word about port 22, because this is where rooms eat your afternoon.** SSH is open, and in a
moment we will find a perfectly good-looking username and password. The reflex is to throw them at
SSH, or worse, to start a password-cracker against it. Resist it. Password guessing is the *worst*
move available on an information-per-cost basis: it burns hours and CPU to test one hypothesis that
is usually false in a designed room, and if it fails you have learned nothing about the target. In a
previous room I measured a cracker running at 72 attempts per minute against SSH — the wordlist
would have taken **3 320 hours**, and "no result" would have been indistinguishable from "the
password isn't in my list". **Exhaust the cheap reading first.** Here the cheap reading solves the
entire room, and SSH is never touched.

---

## Phase 2 — enumeration: establish a control before you believe anything

Fetch the homepage:

```bash
curl -sS -i -m 15 http://10.x.x.x/ -o root.html -D root.hdr
```

- `curl` — fetch a URL from the command line.
- `-sS` — silent, **but still show errors**. This is the important nuance. Plain `-s` hides failures
  too, and `2>/dev/null` is worse: it turns a tool that was never working into a clean-looking "no
  results". Never silence a tool you have not yet proven works.
- `-i` — include the response headers in the output.
- `-m 15` — give up after 15 seconds.
- `-o root.html` / `-D root.hdr` — write the body to one file and the headers to another.

```
HTTP/1.1 200 OK
Server: Apache/2.4.48 (Ubuntu)
Last-Modified: Wed, 02 Mar 2022 19:07:59 GMT
Content-Length: 6568
Content-Type: text/html
```

Two things to notice. `Last-Modified` is 2022, and it is the same across every file on the box — one
frozen deployment, nobody has touched it. And there is **no `Set-Cookie` header**. No cookie means no
session, which means there is probably no server-side application here at all. Hold that thought.

### The control comes first

Before you believe any status code, find out what the server does with a path that **cannot** exist:

```bash
curl -sS -o /dev/null -w '%{http_code} %{size_download}\n' -m 15 \
  'http://10.x.x.x/control_nonexistent_zzq91.txt'
curl -sS -o /dev/null -w '%{http_code} %{size_download}\n' -m 15 \
  'http://10.x.x.x/nonexistdir_zzq91/'
```

- `-o /dev/null` — throw the body away; we only want the measurement.
- `-w '%{http_code} %{size_download}'` — print the status code and the number of bytes received.
  Reading numbers beats eyeballing a page.

Both answer **404 at exactly 275 bytes** — one for a made-up file, one for a made-up directory.

**Why bother?** Because some servers answer `200 OK` to *everything*, serving a friendly "page not
found" page instead of a real 404. That is called a **soft 404**, and it silently destroys your
results: every path you try looks like a hit. By establishing that this server gives a genuine, hard,
275-byte 404, you have earned the right to treat a `200` later as real signal — and to treat a `403`
as meaningfully different from a `404`. Without this step, the flag's `200` would be a guess.

### What is there

| path | status | size | note |
|---|---|---|---|
| `/control_nonexistent_zzq91.txt` | 404 | 275 | **control** — cannot exist |
| `/nonexistdir_zzq91/` | 404 | 275 | **control** — cannot exist |
| `/`, `/index.html` | 200 | 6568 | homepage; navbar links `login.html` |
| `/login.html` | 200 | 5753 | **the whole room is in here** |
| `/assets/` | 200 | 1498 | directory listing is switched on |
| `/assets/js/main.js` | 200 | 6100 | template JavaScript, no secrets |
| `/changelog.txt` | 200 | 2756 | identifies the template and version |
| `/server-status` | 403 | 278 | **not a 404 — see below** |
| `/.htaccess`, `/.htpasswd`, `/.hta` (+12 variants) | 403 | 278 | uniform Apache deny |
| `/robots.txt`, `/sitemap.xml` | 404 | — | not present |

A content brute-force also ran:

```bash
gobuster dir -u http://10.x.x.x/ -w /usr/share/wordlists/dirb/common.txt \
  -x txt,html,php -t 40 -q --no-error
```

- `dir` — brute-force directory and file names.
- `-w` — the **wordlist**, a file of candidate names, one per line. `common.txt` holds about 4 600.
- `-x txt,html,php` — also try each name with each extension, so roughly four times the requests.
- `-t 40` — 40 requests in flight at once.
- `-q --no-error` — quiet, and don't print a line for every failure.

**Two honest notes on that command.** First, `-t 40` is too high for a lab VM. My own standing rule
is **about 25 threads**; in an earlier room `-t 80` knocked a single-CPU box over and I spent fifteen
minutes debugging what turned out to be my own traffic. It caused no harm here — this box is Apache
serving a handful of static files — but it was a deviation, not a decision.

Second, and more useful: **it found nothing new, and it never could have.** Look ahead at the flag's
filename. No English wordlist on earth contains
`RandomLo0o0o0o0o0o0o0o0o0o0gpath12345_Flag_h3ck3rBoi_SuperSecret@12345.txt`. When a filename is not
a word, more wordlist is not the answer — **find the file that *names* it.** That file is
`/login.html`, and it was sitting in the navbar the whole time.

### The one lead left unresolved

`/server-status` returns **403**, not 404. That is worth stopping on. Apache's `mod_status` module
publishes a live page of current requests, client IP addresses and server statistics. If the module
is **not loaded**, asking for that path gives you a `404` — nothing is registered there. A `403`
means the handler **is** registered and is merely refusing *you*, which is what `Require local` does:
serve it only to requests that appear to come from the machine itself.

We know this is real and not noise precisely because of the control from earlier: the 404 baseline is
a clean 275 bytes, and this is a 278-byte 403 on that exact path. So `mod_status` is loaded and
scoped.

I did not pursue it — no header spoofing, no `X-Forwarded-For`, nothing. It would have been outside
read-only probing, and the room was already solved by then. But it is the kind of thing that becomes
a real finding the moment you have any way to make a request look local: a proxy, an SSRF
(Server-Side Request Forgery, where you trick the server into making requests for you), or any
foothold on the box. Recording an unresolved lead as unresolved is part of the work.

Also note the `.ht*` rows: all twelve permutations return a **byte-identical** 403/278. That is
Apache's stock `<FilesMatch "^\.ht">` deny rule, and it means I **cannot tell** whether `.htaccess`
or `.htpasswd` actually exist on disk. That is absence of evidence, not evidence of absence — do not
write it down as "no `.htpasswd`".

---

## Phase 3 — exploitation: read the login page

```bash
curl -sS -i -m 15 http://10.x.x.x/login.html
```

5 753 bytes: a username box, a password box, and an inline `<script>`. Here is the line that is the
entire room:

```js
if (a.value=="h3ck3rBoi" & b.value==RevereString("54321@terceSrepuS"))
```

Read it slowly.

**Nothing is sent to the server.** A normal login posts your username and password to the server, the
server checks them against its database, and the server decides. The browser is just a messenger.
Here, the comparison happens **in JavaScript, in your own browser**, against two values written into
the page the server already handed you. The server is never asked. There is no database, no session,
no cookie — which is exactly what that missing `Set-Cookie` header was telling us back in phase 2.

So the "password" was never a secret. You were given it, in the page source, before you typed
anything. **Press Ctrl+U in any browser** (view source) and it is right there.

Three details:

1. `a.value=="h3ck3rBoi"` — the username, as a plain string: **`h3ck3rBoi`**.
2. `RevereString("54321@terceSrepuS")` — the password is not written out directly. It is stored
   **backwards** and flipped at runtime by a helper. Note the function name is misspelled:
   **`RevereString`**, not `ReverseString`. Useful to know if you ever search the page for
   "reverse" and come up empty.
3. `&` instead of `&&` — that is the **bitwise** AND, not the logical one. In JavaScript, `&&` stops
   as soon as the left side is false; `&` always evaluates both sides and converts the results to
   numbers. Here it happens to behave correctly, so it is **incidental and not needed** — but it is
   the flavour of sloppiness that elsewhere turns into a timing side-channel or a type-juggling bug.
   Spot it, note it, move on.

Flip the string. Do it **offline**:

```bash
python3 -c "print('54321@terceSrepuS'[::-1])"
```

- `python3 -c "…"` — run one line of Python and exit.
- `[::-1]` — Python slice syntax meaning "from start to end, stepping backwards", i.e. reverse it.

```
SuperSecret@12345
```

Doing this locally rather than by typing into the browser is the right instinct: it costs one
command, it sends **zero** packets to the target, and it leaves nothing in the server's logs. When
you can answer a question without touching the target, answer it without touching the target.

So: username `h3ck3rBoi`, password `SuperSecret@12345`.

---

## Phase 4 — the part that is actually the vulnerability

Now the interesting bit, and the reason this room is worth writing up at all.

When the comparison succeeds, `authenticate()` does **not** unlock a page or set a cookie. It
**builds a URL out of the credentials** and sends your browser there:

```
'RandomLo0o0o0o0o0o0o0o0o0o0gpath12345_Flag_' + username + '_' + password + '.txt'
```

Substitute the two values:

```
/RandomLo0o0o0o0o0o0o0o0o0o0gpath12345_Flag_h3ck3rBoi_SuperSecret@12345.txt
```

The flag file's **name contains the username and the password**. The login is pure theatre: a
client-side string comparison whose only real effect is to compute a filename you could have
computed yourself.

And that file is an ordinary static text file on Apache with **no authorization at all** — no cookie
check, no `Referer` check, no session, nothing. You do not have to visit `/login.html` first. You do
not have to send anything. Its confidentiality rests *entirely* on nobody knowing the path, and the
path is published, in the page source, in a page linked from the homepage navbar.

That is the finding, and it is worth stating precisely: this is not **weak** access control, it is
the **absence** of access control. The property the designer seems to have wanted — "only someone who
logged in can read the flag" — does not exist at any layer of this application. The long random-looking
filename is **security by obscurity**, and obscurity that is published is not obscurity.

Fetch it — with the control in the same breath, so the `200` means something:

```bash
# CONTROL: a path that cannot exist
curl -sS -o /dev/null -w 'status=%{http_code} bytes=%{size_download}\n' \
  'http://10.x.x.x/control_nonexistent_zzq91.txt'
→ status=404 bytes=275

# ACTION: the constructed path
curl -sS --path-as-is -o flag.txt -D flag.hdr \
  -w 'status=%{http_code} bytes=%{size_download} ctype=%{content_type}\n' \
  'http://10.x.x.x/RandomLo0o0o0o0o0o0o0o0o0o0gpath12345_Flag_h3ck3rBoi_SuperSecret@12345.txt'
→ status=200 bytes=123 ctype=text/plain
```

- `--path-as-is` — stop curl from "tidying" the path before sending it. By default curl collapses
  `/./` and `/../` sequences. This path contains none, so it changes nothing here — but get into the
  habit: **when the path is the payload, you want the bytes you typed on the wire**, not curl's
  cleaned-up opinion of them.
- `-D flag.hdr` — keep the headers. They are evidence.

```
HTTP/1.1 200 OK
Server: Apache/2.4.48 (Ubuntu)
Last-Modified: Wed, 02 Mar 2022 19:07:58 GMT
ETag: "7b-5d940ffe6bf80"
Content-Length: 123
Content-Type: text/plain
```

Small consistency check worth doing: the `ETag` starts `7b-`, and `0x7b` in hexadecimal is **123** —
matching `Content-Length: 123`. There is no `Set-Cookie` and no `WWW-Authenticate`, which confirms in
the response itself that **no authentication was ever demanded**.

The body, 123 bytes:

```
Congrats Hacker, you made it !!
Go ahead and nail other challenges as well :D

    flag{[redacted]}
```

No shell. No exploit code. No privilege escalation. The flag was a **file read**, which is how most
flags actually are — ask "do I need to run code on this box?" before reaching for a shell, and the
answer is usually no.

### Verify it properly

One fetch is not verification. Fetch it **twice** and compare:

```bash
curl -sS -o flag2.txt '…same URL…'
cmp flag.txt flag2.txt && echo "byte-identical"
```

- `cmp` — compare two files byte by byte; silent and exit 0 if identical.

Byte-identical. That rules out a **one-shot** flag (some rooms serve a value once, or burn a token on
first read, or increment a counter) and proves the retrieval changed nothing on the server. Combined
with `Last-Modified` staying at `2022-03-02 19:07:58 GMT`, there is positive evidence the box's state
is exactly as it was before.

---

## Wrong turns

A clean narrative that hides the mistakes teaches nothing and is a lie about how the work went.

### I believed an empty search result

At one point I needed to find a directory on my own machine and ran a `find` with several filters,
including a time filter. It returned nothing, so I wrote down that the directory did not exist and
that the work in it was lost.

It existed the whole time, with 421 KB of files in it. A plain `ls -lt` found it instantly. My `find`
had a wrong filter and returned a **confident empty answer rather than an error**, which is the most
dangerous kind of tool failure: it does not look like a failure.

**The rule:** when a search comes back empty, re-run it with a **control you know is present** before
you report the absence. An empty result means "not there" *or* "my probe was wrong", and those two
look identical from the outside. This applies just as much to `gobuster` finding no directories as
to `find` finding no files.

### I read an exit code through a pipe

I ran a long job as `some-command 2>&1 | tail -120` and later checked whether it had succeeded. The
exit code was `0`, so I reported success. The job had actually crashed with a Python traceback.

**A pipeline's exit status is the status of the *last* command in it** — and the last command was
`tail`, which succeeded at printing the crash message. The real exit code was discarded.

**The rule:** never read an exit status through a pipe. Use `set -o pipefail`, or check
`${PIPESTATUS[0]}` in bash / `$pipestatus[1]` in zsh, or simply don't pipe when you need the status.
Piping to `tail` also threw away all interim output, so I had no visibility into the job while it ran
— doubly bad for anything long.

### I deleted my own evidence, and then the box expired

This is the expensive one, and it is the reason this write-up is missing files.

During cleanup I deleted the raw copy of the flag response I had captured, treating it as a temporary
file. It was not temporary — it was **evidence**. About seven hours later I went back to capture the
raw responses properly into my evidence folder, and all six requests timed out after 20 seconds.

Before concluding anything, I proved the channel, because a timeout is ambiguous — it means "the box
is gone" *or* "my connection is broken", and you cannot tell which from the timeout alone:

```bash
ip -brief addr show tun0          # VPN interface still UP, same address
ip route get 10.x.x.x             # still routes via the VPN gateway
ping -c 2 -W 3 <vpn-gateway>      # 2/2 received, 15 ms   ← the control
ping -c 3 -W 3 10.x.x.x           # 100% packet loss      ← the target
```

That third line is the one that makes the diagnosis. The **VPN gateway answered**, so my tunnel was
healthy and my packets were leaving. The target answered nothing on ICMP and nothing on either port.
The lab machine had **expired** — these boxes are leased for a few hours and then destroyed.

So the raw `login.html` is gone for good, which is why this write-up quotes only the fragment of
`authenticate()` that was recorded verbatim at the time and does not reconstruct the rest. I will not
invent the parts I did not keep.

**The rule, and it is the most practical thing in this entire document:** a response body is evidence
from the moment it arrives. **Copy every artefact — scan output, response bodies, headers,
downloaded files — into a permanent folder the instant it exists**, not at the end of the session.
Use `-oN` for scans and `-o`/`-D` for curl so the file exists without a second thought. Your `/tmp`
can be wiped without warning, and **the target itself has a shorter fuse than that.** Cleanup
deletes scratch; it never deletes captures.

---

## What was NOT tested

An unstated gap reads as a cleared one, so here they are:

- **Whether the flag path is findable from a cold start.** I did not brute-force my way to it — I
  *derived* it from `login.html`, which is the room's intended route. So "an attacker who never read
  that page could find this file" is **unproven**, and as discussed, a wordlist almost certainly
  cannot.
- **SSH (22/tcp) entirely** — banner only. No login attempt, no reuse of the recovered credentials,
  no key or user enumeration. Deliberate.
- **`/server-status`** — identified as a registered-but-restricted handler, no bypass attempted.
- **UDP** — not scanned at all.
- **Apache 2.4.48 / OpenSSH 8.2p1 known CVEs** — versions noted, nothing exercised.
- **`/assets/vendor/`, `/css/`, `/img/`, `/js/`** — not walked recursively.
- **Whether `.htaccess` or `.htpasswd` exist** — permanently masked by the uniform 403.
- **Backup files** (`.bak`, `.old`, `.swp`, `~`, `.zip`) — no sweep run.
- **Anything server-side** — there is no server-side input to test. The only form never reaches the
  server, which is the whole point of the room.

---

## The lesson, in one line

**Read the page before you attack it.** The entire room is one `<script>` tag in a file linked from
the homepage, and every tool I pointed at the box afterwards — a 65 535-port scan, 18 000-odd
brute-forced paths — found strictly less than pressing Ctrl+U would have. When a login works without
the network, the server is not involved in deciding who you are. And when a secret URL is built out
of values printed in the page, it was never secret.

## Teardown

Nothing was left on the target, because nothing was ever put there. Every request was a `GET`;
nothing was uploaded, written, or changed, and the byte-identical second fetch plus the unchanged
`Last-Modified` prove it. Scans were finished rather than abandoned mid-run. The only trace left
behind is the entries my requests made in the server's own access log, which cannot be removed
without write access to the box — worth naming rather than pretending otherwise.
