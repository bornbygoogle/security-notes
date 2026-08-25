---
description: "A high port leaks a banner, the banner leaks credentials, the credentials open SSH. Full-port scanning and netcat banner grabbing, explained from zero, with the wrong turns kept in."
---

# TryHackMe — Nmap Challenge: from a high port to a shell

**Target:** `10.129.152.110`
**Date:** 2026-08-23
**Goal, as the room states it:** the box listens on a *high* port. Connect to it, read whatever it
tells you, and use that information to log in on a *low* port "commonly used for remote access."
Then find the flag.

These are running notes, written for someone who has never used any of these tools. Every command
appears exactly as it was run, in order, with every flag explained — including the attempts that
went nowhere. For the PT1 exam the dead ends are the part worth learning.

> **Flags are redacted in this write-up.** Every flag value is replaced with `[redacted]`. The
> commands, the reasoning and the dead ends are all intact — work the box and you get the real
> string, which is the only part of it that teaches you nothing anyway. The password below is a
> different matter: the target broadcasts it to anyone who connects, and it *is* the lesson, so it
> stays.

---

## Vocabulary — every term used here, defined once

Skip this if you already know it. If you do not, nothing below will make sense, and being handed a
command you cannot read teaches nothing.

**Host.** Any computer on a network. "The host" means the target machine.

**IP address.** The number identifying a machine on a network, like `10.129.152.110`.

**Port.** One machine runs many programs that all want the network at once — a web server, a mail
server, a remote-login server. A port is a numbered door on that machine, 1 to 65535, so arriving
data knows which program it is for. Web traffic conventionally uses door 80, encrypted web 443,
remote login 22. A port is **open** if a program is listening behind it, **closed** if nothing is,
and **filtered** if a firewall silently eats the knock so you cannot tell which.

**TCP.** Transmission Control Protocol — the rules for a reliable conversation between two machines.
Opening one is a three-step handshake: SYN ("can we talk?"), SYN-ACK ("yes"), ACK ("good"). If
nothing is listening, the machine replies RST ("reset" — go away). **That RST is what a port scanner
reads as "closed."**

**Service.** The program listening behind an open port.

**Banner.** Many services announce themselves the moment you connect — a line of text naming the
software and version. Reading it is **banner grabbing**, and it is the cheapest information in
penetration testing because you get it without sending anything.

**SSH.** Secure Shell — the standard way to log into a Linux machine over the network and get a
command prompt. Conventionally port 22, and encrypted, so the password is never visible on the wire.
Which matters here, because the password was leaking somewhere else entirely.

**Shell.** The program giving you a text command prompt, where you type `ls` and it lists files.
"Getting a shell" means reaching the point where you can run commands on the target. It is the usual
definition of "I am in."

**Nmap.** Network Mapper, the standard port scanner. It knocks on doors, reports which are open, and
can go further and identify what is behind them.

**Netcat (`nc`).** A tiny tool that opens a raw TCP connection and wires it to your keyboard and
screen. No protocol knowledge, no interpretation — whatever the service sends, you see.

**TTL.** Time To Live — a counter in every packet that drops by one at each router it crosses; at
zero the packet is discarded, which stops packets circling forever. Useful side effect: different
operating systems pick different starting values, so the value that arrives tells you both the OS and
how many routers you crossed.

**VPN.** Virtual Private Network — an encrypted tunnel into another network. The TryHackMe lab is not
on the public internet; you reach it through their VPN, and your machine grows a virtual interface
(`tun0`) for it.

**uid.** User ID — the number identifying an account on Linux. `0` is always `root`, the all-powerful
administrator. Ordinary accounts start at 1000. Knowing your uid is knowing how much power you have.

**Privilege escalation ("privesc").** Going from an ordinary account to `root`. A whole phase of a
pentest, and — spoiler — one this box does not need.

**Docker container.** A way of packaging a program with its own miniature filesystem so it runs
isolated from the rest of the machine. One box can run many. It matters here because it explains a
strange hostname.

---

## Step 0 — Scope: what "done" looks like

**Done =** I hold the flag string, **and** I can name the exact command that produced it.

That second half is the real bar. A flag with no reproducible path is a souvenir. The point of the
room is the chain of reasoning; the string at the end is just proof you were there.

### The three load-bearing unknowns

A load-bearing unknown is a fact that, if wrong, makes everything built on top of it worthless.
Naming them before you start is how you avoid spending an hour on a beautiful, entirely fictional
result.

1. **Is my VPN actually routing `10.129.152.110`?** If not, every "port closed" result is a lie — the
   packets never left my machine. Biggest unknown, and also the cheapest to check, so it goes first.
2. **Which high port is open?** The room says there is one but not which.
3. **Which low port is the remote-access one?** Candidates: 21 (FTP, file transfer), 22 (SSH), 23
   (Telnet, ancient unencrypted remote login).

Attacked in that order — **cheapest probe of the biggest unknown first.** There is no point scanning
65535 ports if the tunnel is down.

### Methodology phases

Penetration testing is taught as a sequence of phases. Knowing which one you are in stops you
flailing, because each asks a different question.

| Phase | The question it asks | Where it happens here |
|---|---|---|
| Recon | Does this target exist and can I reach it? | Step 1 |
| Enumeration | What is running on it? | Steps 2–3 |
| Exploitation | How do I turn that into access? | Steps 4–5 |
| Post-exploitation | Now that I am in, what can I reach? | Steps 6–7 |

---

## Step 1 — Recon: am I on the network at all?

**What is about to happen, in plain words.** Before asking "which doors are open on that machine," I
need to be sure my knocks can physically reach it. My computer decides where to send traffic using a
**routing table** — a list saying "for addresses that look like *this*, send them out over *that*
interface." If the target's address is not in that table pointing down the VPN tunnel, my scan
traffic goes out my ordinary internet connection, reaches nothing, and every port comes back closed.

That failure mode is nasty precisely because it looks like a result. A scan saying "all ports closed"
and a scan that never left the building are indistinguishable on screen. A pentest that starts with a
misconfigured VPN produces a beautiful and entirely fictional report.

```bash
ip -brief addr show
ip route
```

- **`ip`** — the standard Linux tool for inspecting network configuration.
- **`addr show`** — list network interfaces and their addresses. An *interface* is one network
  connection: a Wi-Fi card, an Ethernet port, or a virtual one like a VPN tunnel.
- **`-brief`** — one line per interface instead of a five-line block. Same information, readable.
- **`route`** — print the routing table.

Relevant output:

```
tun0             UP             192.168.160.167/18
...
10.128.0.0/12 via 192.168.128.1 dev tun0 metric 200
```

**Line by line.** `tun0` is the VPN tunnel interface — `tun` for "tunnel," created by OpenVPN when
you connect. It says `UP`: it exists and is running. My address inside the lab is `192.168.160.167`.

The `/18` is a **netmask in CIDR notation**, saying how many of the address's 32 bits are the network
part rather than the machine part. You do not need the arithmetic, only the implication: addresses
sharing that prefix are local and reachable directly, everything else needs a router.

The second line is the one that matters. `10.128.0.0/12` is a block of addresses — the first 12 bits
fixed — covering `10.128.0.0` through `10.143.255.255`. The target `10.129.152.110` sits inside it.
The line says traffic for that block goes `via 192.168.128.1` (the router at the far end of the
tunnel) `dev tun0` (out the tunnel interface).

**So my packets will take the VPN.** Unknown #1 closed, at a cost of one second.

Now prove the host answers. `ping` sends a tiny "are you there?" message — an ICMP echo request,
Internet Control Message Protocol, the network's own diagnostic language, separate from TCP — and
waits for it to be echoed back.

```bash
ping -c 3 -W 2 10.129.152.110
```

- **`-c 3`** — send exactly 3 packets and stop. Without it, `ping` runs until interrupted.
- **`-W 2`** — wait at most 2 seconds per reply, so a dead host fails in 6 seconds instead of
  hanging.

```
64 bytes from 10.129.152.110: icmp_seq=3 ttl=62 time=19.1 ms
3 packets transmitted, 3 received, 0% packet loss
```

**Three readings out of two lines.**

**It is alive.** Obvious, and the least interesting part.

**`ttl=62` tells me the operating system.** TTL counts down one per router crossed, and the starting
values are conventions baked into each OS: **Linux starts at 64, Windows at 128**, some network gear
at 255. What reached me is 62. The nearest convention above it is 64, and 64 − 62 = 2, so: the box
set 64, the packet crossed two routers, and **the target is Linux**.

That is a free operating-system fingerprint before a single TCP packet, and it shapes what I expect
next — a Linux box with a "low port commonly used for remote access" almost certainly means SSH on
22, not Windows Remote Desktop on 3389. I have not proved it. I have narrowed it, which is what recon
is for.

**~19 ms round-trip.** Fast, so I can scan aggressively without flooding the link. That directly
justifies the `--min-rate 2000` in the next step. At 300 ms I would have scanned far more gently.

One thing that looks like a problem and is not: only `icmp_seq=3` came back, so the first two packets
vanished. Normal for a freshly-booted lab box still bringing services up. Worth noticing, not worth
panicking about. Had *all three* dropped while routing was correct, that would mean ICMP is filtered
and I would go straight to `-Pn` scanning.

---

## Step 2 — Enumeration: full TCP port sweep

**What is about to happen.** Nmap will try to open a TCP connection to every one of the 65535 ports
and report which answer. This is the single most important command in the mission, and the reason is
one flag.

**Why not just run `nmap <ip>`?** Because plain `nmap` scans only the **1000 most common ports**. That
default exists for good reasons — roughly 65× faster, and it finds the vast majority of real
services. But the room said "a high port," and high joke ports are not in the top-1000. Run the
default here and the entire challenge is invisible: you see an SSH port, you have no credentials, and
you sit there with nothing.

```bash
nmap -p- --min-rate 2000 -T4 -Pn -oN full-tcp.txt 10.129.152.110
```

Flag by flag, because this is exactly the muscle memory PT1 tests:

| Flag | What it does, and why it is here |
|---|---|
| `-p-` | Scan **all 65535** TCP ports rather than the default top-1000. Shorthand for `-p1-65535`. **The whole room hinges on this flag.** |
| `--min-rate 2000` | Send at least 2000 packets per second. Nmap normally adapts to the network; on a ~19 ms lab link, forcing the floor up turns a 20-minute scan into seconds. Justified by the RTT measured in Step 1 — not a number to copy blindly onto a slow or production target. |
| `-T4` | Timing template "aggressive": shorter waits, more probes in flight. `-T5` ("insane") starts dropping packets and reporting open ports as closed, which is worse than slow. `-T4` is the standard working choice. |
| `-Pn` | Skip host discovery, assume the host is up. Nmap normally pings first and gives up on silent hosts; I already proved it alive, and this stops nmap writing the box off if it later declines a probe. |
| `-oN full-tcp.txt` | Write results to a file in **N**ormal (human-readable) format. Always keep scan artefacts: reports need evidence, and re-scanning burns lab time you may not have. |

Result, in **11.45 seconds**:

```
Not shown: 65532 closed tcp ports (reset)
PORT      STATE SERVICE
22/tcp    open  ssh
2222/tcp  open  EtherNetIP-1
31337/tcp open  Elite
```

**Reading it properly — including the line most people skip.**

**`Not shown: 65532 closed tcp ports (reset)`** is a finding, not filler. "Reset" means those ports
actively replied RST — "nothing here, go away." The alternative would be `filtered`, meaning a
firewall silently swallowed the probes and nmap could not tell open from closed. Reset means **there
is no firewall in front of this box**, so what I see is genuinely what is there, and the scan
finished in 11 seconds instead of grinding through timeouts. Worth stating in a report.

**`22/tcp open ssh`.** The "low port commonly used for remote access" the room pointed at. Matches
the Linux guess from the TTL. Unknown #3 provisionally closed.

**`2222/tcp open EtherNetIP-1`.** EtherNet/IP is an industrial control protocol — factory floor
equipment. Finding one here would be remarkable. **It is not there.** That label is a lookup in the
file `/usr/share/nmap/nmap-services`, which maps port numbers to whatever is conventionally on them.
Nmap has not spoken to this service. Port 2222 is also a very common alternate SSH port.

**`31337/tcp open Elite`.** Same caveat, same lookup table. 31337 is "eleet" in leetspeak (3=E, 1=L,
7=T), historically the Back Orifice backdoor port, and a traditional joke port in CTFs. Almost
certainly the "high port." Unknown #2 provisionally closed.

> **The lesson to internalise.** The `SERVICE` column of a plain `-p-` scan is a dictionary lookup and
> nothing more. It has never exchanged a byte with the service. **Never write it in a report as
> fact.** Confirm it with `-sV`, or by talking to the port yourself. Had I written "the target exposes
> an industrial control protocol" from that line, I would have shipped a fabricated finding to a
> client — the worst kind, because it is specific and confident.

---

## Step 3 — Enumeration: what is *actually* on those ports

**What is about to happen.** Nmap will now actually *talk* to the three open ports and work out what
is really behind each, instead of guessing from the number.

```bash
nmap -sV -sC -p 22,2222,31337 -Pn -oN versions.txt 10.129.152.110
```

- **`-sV`** — **version detection**. Nmap opens the port, reads whatever banner comes back, and if
  that is not conclusive it fires a library of protocol probes and matches the replies against its
  `nmap-service-probes` database. This is the step that turns a guess into a fact.
- **`-sC`** — run the **default NSE script set** (Nmap Scripting Engine), equivalent to
  `--script=default`. Safe, non-intrusive scripts: fetch SSH host keys, grab web page titles, test
  for anonymous FTP. Cheap extra information at no extra risk. There are intrusive script categories
  too; `-sC` is not one of them, which is why it is the default.
- **`-p 22,2222,31337`** — only the three ports already known open. Re-scanning all 65535 with `-sV`
  would take enormously longer for exactly zero extra information. **Narrow after you sweep.**

Result:

```
PORT      STATE SERVICE VERSION
22/tcp    open  ssh     OpenSSH 8.2p1 Ubuntu 4ubuntu0.4 (Ubuntu Linux; protocol 2.0)
2222/tcp  open  ssh     OpenSSH 8.2p1 Ubuntu 4ubuntu0.4 (Ubuntu Linux; protocol 2.0)
31337/tcp open  Elite?
Service Info: OS: Linux; CPE: cpe:/o:linux:linux_kernel
```

**Four things changed versus Step 2.**

**2222 is not EtherNet/IP at all — it is a second SSH daemon.** Precisely the false label I warned
about, corrected by one flag. (A *daemon* is a program running in the background waiting for
connections; `sshd` is the SSH daemon.)

**The version string pins the operating system.** `OpenSSH 8.2p1 Ubuntu 4ubuntu0.4` is the exact
package version Ubuntu ships in **20.04 LTS**. My TTL guess from Step 1 is now confirmed by a second,
independent source, and `Service Info: OS: Linux` agrees. Two independent sources agreeing is what
turns a guess into evidence.

**22 and 2222 present different host keys** (`7d:dc:eb:90:…` versus `bb:8f:eb:d0:…`, courtesy of the
`-sC` SSH host-key script). A *host key* is the unique cryptographic identity a server proves itself
with. Same software version, different key material means these are two **separate sshd instances**,
not one daemon listening twice. A real structural fact about the box, and it matters in Step 7.

**31337 shows `Elite?` — note the question mark.** The `?` means nmap could not match the responses
to any service in its database. It stayed `open`, not `open|filtered`: the port definitely answered,
nmap just did not recognise the language it answered in.

### The credentials, sitting in the block everybody scrolls past

When `-sV` fails to identify a service it does not stay quiet. It dumps the raw responses so a human
can identify what it could not:

```
| fingerprint-strings:
|   DNSStatusRequestTCP, ..., NULL, ..., X11Probe:
|     In case I forget - user:pass
|_    ubuntu:Dafdas!!/str0ng
```

**Why credentials fell out of a version scan.** Look at the probe names on that middle line:
`DNSStatusRequestTCP`, `NULL`, `GetRequest`, `Kerberos`, `X11Probe`, `LDAPBindReq`. Nmap sent
twenty-odd completely different protocol probes — a DNS query, an HTTP request, a Kerberos ticket
request, an X11 handshake — and got the **same 0x35-byte string back every single time**.

Sit with that, because the deduction is the whole lesson. A service that replies identically to twenty
different inputs is not parsing them. Including the `NULL` probe, **which sends nothing at all** — and
still got the same reply. A thing that answers the same way when you say nothing is not a protocol. It
is a banner printer: it shouts its message at whoever connects, then hangs up.

That is a real finding on its own, before I even use it: **an unauthenticated network service
discloses valid SSH credentials in cleartext to any client that opens a TCP connection.** No exploit,
no authentication, no crafted payload. Just connecting.

---

## Step 4 — Doing it the room's way: netcat

**What is about to happen.** I already have the credentials from nmap's output. I am going to get them
again by hand anyway.

**Why bother?** Two reasons, both habits worth building. The room asks for netcat specifically. And on
a real engagement I want to see the *raw conversation*, not a tool's summary of it — nmap's
fingerprint block is nmap's interpretation, and interpretations are where misunderstandings hide.

```bash
nc -nv 10.129.152.110 31337
```

- **`nc`** — netcat. Opens a raw TCP connection and wires it to your terminal.
- **`-n`** — no DNS resolution. Two benefits: no lookup for the target leaks to a DNS server (on a
  real engagement that leak tells someone what you are looking at), and no stalling on a reverse
  lookup that will never resolve for a lab IP.
- **`-v`** — verbose, so netcat prints whether the connection actually succeeded instead of sitting
  silently and leaving you unsure whether it connected or hung.
- The two bare arguments are **target then port**, in that order.

```
(UNKNOWN) [10.129.152.110] 31337 (?) open
In case I forget - user:pass
ubuntu:Dafdas!!/str0ng
```

The first line is netcat's own `-v` report: connection opened. The next two came from the service. **I
never typed a byte.** The text appeared the instant the TCP handshake completed, and then the
connection closed. That confirms the read of the fingerprint data exactly: a pure banner service.

**Credentials harvested:**

| Field | Value |
|---|---|
| Username | `ubuntu` |
| Password | `Dafdas!!/str0ng` |

Look hard at that password, because it is the room's actual point compressed into 15 characters.
`Dafdas!!/str0ng` has upper case, lower case, digits, symbols and length. It passes every corporate
complexity policy ever written. It would sail through a password audit.

**And it is worth nothing**, because it is being handed out for free to anyone who connects to port
31337. **Complexity rules protect against guessing. They do nothing whatsoever against disclosure.**
That sentence belongs in the remediation section of a report, because the natural client reaction —
"we will enforce stronger passwords" — would fix precisely nothing here.

---

## Step 5 — Exploitation: log in over SSH

The room's "low port commonly used for remote access" is **22/tcp**. I have a username and a password.
The straightforward version is one command:

```bash
ssh ubuntu@10.129.152.110
```

That prompts for the password interactively and I paste it. Done. But I needed it
**non-interactively** for these notes — a command that runs and returns its output rather than
dropping me into a session — and that is where a wrinkle appeared.

### Wrong turn #1 — reaching for `sshpass` that isn't installed

**The symptom:**

```bash
which sshpass
# sshpass not found
```

`sshpass` is the usual tool for feeding SSH a password from a script. SSH deliberately refuses to read
a password from a pipe — a security decision, to stop exactly the automation that makes credential
stuffing easy — and `sshpass` works around it by faking a terminal.

**The real cause:** it is not installed here, and installing it needs `root`, which I do not have.

**Why not just install it?** Because changing a machine's package state for one login is a bad trade.
On a client engagement you are often contractually forbidden from installing software on the testing
host, and "I needed a package" is a poor reason to modify a system. There is almost always a mechanism
already present.

**The rule that avoids it:** *use what the tool already ships before installing anything.*

OpenSSH has a password-supply mechanism built in, designed for graphical desktops:

```bash
printf '#!/bin/sh\necho "Dafdas!!/str0ng"\n' > askpass.sh
chmod +x askpass.sh

SSH_ASKPASS="$PWD/askpass.sh" SSH_ASKPASS_REQUIRE=force \
  setsid -w ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
  ubuntu@10.129.152.110 'id; hostname; pwd; ls -la'
```

Piece by piece, because every part is load-bearing:

- **`printf '#!/bin/sh\necho "..."\n' > askpass.sh`** — write a two-line shell script. The first line
  `#!/bin/sh` is a *shebang*, telling the system which interpreter runs the file. The second prints
  the password to standard output. `>` redirects that into the file.
- **`chmod +x askpass.sh`** — mark it executable. Without this the system refuses to run it and SSH
  reports a confusing failure rather than a clear one.
- **`SSH_ASKPASS=…`** — an environment variable naming a program SSH should run to *obtain* the
  password instead of reading the terminal. Built for graphical pop-ups; it does not care that ours is
  a script that just prints.
- **`$PWD`** — the shell's current-directory variable, making the value an absolute path. SSH runs the
  helper from an unpredictable working directory, and a relative path fails silently here.
- **`SSH_ASKPASS_REQUIRE=force`** — by default SSH only uses the helper when there is **no**
  controlling terminal. `force` makes it use the helper unconditionally. OpenSSH 8.4+.
- **`setsid -w`** — run the command in a brand-new session with no controlling terminal, the classic
  way to satisfy the "no TTY" condition on older SSH. **TTY** = teletype, the historical Unix name for
  an interactive terminal. `-w` waits for it to finish so I still see the output.
- **`-o StrictHostKeyChecking=no`** — accept the unknown host key without an interactive yes/no
  prompt.
- **`-o UserKnownHostsFile=/dev/null`** — do not record that key in `~/.ssh/known_hosts`. `/dev/null`
  is the system's bin; anything written there is discarded. Lab IPs get recycled to different machines
  tomorrow, and a stale entry then produces a scary mismatch warning for no reason.
- **The quoted string at the end** — commands to run on the remote machine and then exit, instead of
  opening an interactive session.

> **Both `-o` flags are lab-only, and this matters.** Host-key verification is the *entire* defence
> against someone sitting between you and the server impersonating it. Turning it off in a lab where
> the IP is disposable is fine. Turning it off on a real engagement means your own session can be
> intercepted, with your client's credentials inside it. Never carry this habit across.

Keep the askpass script in a scratch directory, never in a repo, and delete it afterwards — it is a
plaintext credential sitting on disk.

**It worked:**

```
uid=1000(ubuntu) gid=1000(ubuntu) groups=1000(ubuntu)
f518fa10296d
/home/ubuntu
```

**Three reads before going flag-hunting.** This is the discipline that separates enumeration from
flailing: when you land on a box, spend thirty seconds understanding *where* you landed.

**`uid=1000`, and no `sudo` group.** uid 1000 is the first ordinary user account; `root` is uid 0. I
am unprivileged, and the group list has no `sudo`, so I cannot borrow administrator rights either. The
flag therefore has to be readable by `ubuntu`, or I need a privilege escalation step. Better to know
that before I start looking than after.

**The hostname is `f518fa10296d`** — twelve hexadecimal characters, no vowel pattern, nothing a human
would type. That is the shape of a **Docker container ID**. Combined with the two independent sshd
instances from Step 3, the picture assembles: the "machine" is a set of containers, and ports 22 and
2222 very likely land in *different* ones. (A hypothesis, never tested — see the honest scorecard.)

**`ls -la` shows only stock dotfiles** — `.bashrc`, `.profile`, `.bash_logout`, a `.cache` directory.
(`ls` lists files, `-l` in long form with permissions and sizes, `-a` including hidden files, which on
Linux are the ones whose names start with a dot.) **No flag here.** The obvious place is empty, so I
have to go looking properly.

---

## Step 6 — Post-exploitation: finding the flag

**What is about to happen.** Rather than guessing paths one at a time, ask the filesystem to find every
file with "flag" in its name.

```bash
find / -iname "*flag*" -not -path "/proc/*" -not -path "/sys/*" \
       -not -path "/usr/src/*" -not -path "/usr/include/*" 2>/dev/null
```

- **`find`** — walk a directory tree and report entries matching conditions.
- **`/`** — start at the root of the filesystem: search everywhere.
- **`-iname "*flag*"`** — match on name, case-**i**nsensitively, so `FLAG.txt`, `Flag.TXT` and
  `flag.txt` all hit. The `*` are wildcards meaning "any characters," so this matches the word anywhere
  in the name. The quotes stop the *shell* expanding the `*` before `find` ever sees it — forget them
  and you get baffling results.
- **`-not -path "/proc/*" -not -path "/sys/*"`** — skip these two. They look like directories but are
  **kernel pseudo-filesystems**: windows into live kernel state, not real files on disk. Full of noise,
  and reading some entries can block.
- **`-not -path "/usr/src/*" -not -path "/usr/include/*"`** — kernel and C source headers, stuffed with
  legitimate matches like `waitflags.ph`. Pure noise for this purpose.
- **`2>/dev/null`** — **the flag that makes this command usable.** As an unprivileged user, `find` hits
  hundreds of directories it cannot read and prints "Permission denied" for each. Those go to *stderr*,
  stream 2. `2>` redirects stream 2, and `/dev/null` discards it. Without this the one real result
  scrolls off the screen inside a wall of errors.

> **A caveat that cuts both ways.** Never `2>/dev/null` a command you have not yet confirmed works —
> silence then turns a total failure into a clean-looking "no results," and the two are
> indistinguishable. It is safe here because `find` is a known quantity and its errors are known noise.
> Silence the noise *after* you trust the tool, never before.

Signal, once the perl/dpkg noise is gone:

```
/home/user/flag.txt
```

**A second user's home directory.** I had only ever looked in my own, `/home/ubuntu`. Nothing told me
another account existed; the search found it.

Check the permissions before assuming I can read it:

```bash
ls -la /home/user/
# -rw-rw-r-- 1 root root 38 Mar  2  2022 flag.txt
```

**How to read a Unix permission string.** `-rw-rw-r--` is ten characters. The first is the file type
(`-` = ordinary file, `d` = directory). The remaining nine are three groups of three — read, write,
execute — for the **owner**, the **group**, and **everyone else**, in that order.

- owner (`root`): `rw-` — read and write
- group (`root`): `rw-` — read and write
- **everyone else: `r--` — read**

That final `r` is the whole story: **any user on the box can read this file.** No privilege escalation
needed — which is the point of this room. It teaches the enumeration chain, not privesc. Had that last
group been `---`, this would have been a completely different mission.

```bash
cat /home/user/flag.txt
```

### 🚩 Flag

```
flag{[redacted]}
```

**Verification status, stated honestly.** Read directly off the target filesystem with `cat`, output
captured. The file is 38 bytes and the flag string is 38 characters, matching the `ls -la` size
exactly, so nothing was truncated. But it was **never submitted to the TryHackMe answer box**. So it is
**evidence-backed, not platform-confirmed** — two different claims, and collapsing them is how a
write-up ends up being wrong with confidence.

---

## Step 7 — Loose end: what is on port 2222?

**Why bother when I already have the flag?** Because leaving an open port unexplained is how real
findings get missed. Port 2222 was mislabelled by the first scan, corrected by the second, and shown to
carry a *different host key*. On a client engagement, "there was another service and I did not look at
it" is not an acceptable line in a report.

The obvious hypothesis: same credentials, second door.

```bash
ssh -p 2222 -o NumberOfPasswordPrompts=1 ubuntu@10.129.152.110
```

- **`-p 2222`** — connect to port 2222. Easy to forget, and forgetting it is genuinely dangerous: SSH
  silently defaults to 22, you "succeed," and you conclude something false about a service you never
  touched.
- **`-o NumberOfPasswordPrompts=1`** — give up after one rejected password instead of the default
  three. Two reasons: a failed attempt then looks like a failure instead of a hang, and it keeps noise
  out of the target's authentication log. On a real engagement, keeping your footprint small in the
  logs is part of the job.

```
ubuntu@10.129.152.110: Permission denied (publickey).
```

**Read that parenthesis precisely — it is far more informative than it looks.** The list inside is
**the authentication methods the server was willing to accept**, and it contains `publickey` and
nothing else. The server never offered password authentication at all.

So this is **not** "wrong password." It is `PasswordAuthentication no` in that daemon's `sshd_config`.
The distinction matters: "wrong password" invites you to try more passwords; "password auth is
disabled" tells you that entire approach is closed and you should stop.

**Conclusion.** The two SSH services are configured differently: 22 accepts passwords, 2222 requires a
key. Without a private key there is no way in on 2222, and nothing on the box suggests one is
available. **Dead end, correctly identified and closed** — which is a result, not a failure.

There is a nice irony worth putting in the report: **port 2222 is the securely configured one.** The
box would have been safe if 22 had been set up the same way. The weakness was never SSH.

---

## Summary — the attack chain

| # | Phase | Action | Result |
|---|---|---|---|
| 1 | Recon | route check + `ping` | Host up, Linux (TTL 62), VPN routing confirmed |
| 2 | Enumeration | `nmap -p- --min-rate 2000` | 22, 2222, 31337 open; no firewall filtering |
| 3 | Enumeration | `nmap -sV -sC` | 2222 is SSH not EtherNet/IP; 31337 leaks credentials |
| 4 | Exploitation | `nc -nv <ip> 31337` | `ubuntu:Dafdas!!/str0ng` in cleartext, no auth |
| 5 | Exploitation | `ssh ubuntu@<ip>` | Shell as uid 1000 inside a Docker container |
| 6 | Post-exploitation | `find / -iname "*flag*"` | `/home/user/flag.txt`, world-readable |
| 7 | Enumeration | `ssh -p 2222` | Key-only auth, no way in — dead end closed |

## What this room actually teaches

**The default nmap scan would have failed this box.** Port 31337 is not in nmap's top-1000, so without
`-p-` the entire challenge is invisible and you are left staring at an SSH port with no credentials.
Sweep the full range before concluding anything.

**The `SERVICE` column is a guess until `-sV` runs.** Port 2222 was labelled `EtherNetIP-1` — an
industrial protocol — purely because of a line in `/usr/share/nmap/nmap-services`. It was SSH. In a
real report, "the target exposes an industrial control protocol" would have been a fabricated finding.

**`-sV` output is worth reading in full, not just the version column.** The credentials arrived in the
`fingerprint-strings` block, which most people scroll past because it is ugly. Nmap prints the raw
service responses precisely so a human can read what it could not parse.

**A service that answers every probe identically is a banner, not a protocol.** Twenty-odd different
probes — `NULL`, `Kerberos`, `X11Probe`, `LDAPBindReq` — got byte-identical replies. That pattern is
the fingerprint of something that just prints text on connect.

## Findings, phrased for a report

| Severity | Finding | Remediation |
|---|---|---|
| **Critical** | An unauthenticated service on 31337/tcp discloses valid SSH credentials in cleartext to any client that completes a TCP handshake. | Remove the service. Rotate the exposed credentials — they must be treated as public. |
| **High** | SSH on 22/tcp permits password authentication with a credential known to be disclosed. | Set `PasswordAuthentication no` and use keys, matching the config already running on 2222. |
| **Low** | `/home/user/flag.txt` is world-readable (`-rw-rw-r--`), letting any local user read another user's data. | Restrict to `0600`, owned by the using account. |
| **Info** | Two SSH daemons with inconsistent authentication policies (22 password-enabled, 2222 key-only). | Standardise on the stricter policy across all instances. |

The password `Dafdas!!/str0ng` is the lesson in miniature: 15 characters, mixed case, digits and
symbols — it passes every complexity policy ever written, and it protected nothing, because it was
being given away on another port. **Password complexity defends against guessing. It does nothing
against disclosure.**

## Honest scorecard — what was verified, what was assumed

| Claim | Status |
|---|---|
| The flag was read off the target with `cat` | **Verified** — output captured, byte count matches |
| The flag is the answer TryHackMe expects | **Assumed** — never submitted to the platform |
| 31337 is a banner service, not a protocol | **Verified** — identical replies to 20+ different probes, including `NULL` |
| The box is Ubuntu 20.04 | **Verified** — two independent sources (TTL, OpenSSH package version) |
| 22 and 2222 land in different containers | **Assumed** — the hostname shape and the two host keys point at it, but it was never tested. One command would have settled it: log in on each and compare `/proc/1/cgroup`. |
| `askpass.sh` was deleted afterwards | **Assumed** — the rule was stated at the time; the deletion was not recorded |

## Note on scope

All activity was against `10.129.152.110`, a lab machine provided by the room, over its VPN. Nothing
was written to the target: every command run on the box was a read (`id`, `hostname`, `pwd`, `ls`,
`find`, `cat`). No shell was uploaded, no key added, no file modified. The credential in this document
is a disposable lab credential that the target itself broadcasts to anyone who connects — it is not a
real-world secret.
