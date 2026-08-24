# TryHackMe — Nmap Challenge: from a high port to a shell

**Target:** `10.129.152.110`
**Date:** 2026-08-23
**Goal (as given by the room):** the box listens on a *high* port. Connect to it, read whatever it
tells you, and use that information to log in on a *low* port "commonly used for remote access".
Then find the flag.

These are running notes. Every command is written down as it was run, in order, including the
attempts that went nowhere — for the PT1 exam the dead ends are the part worth learning.

> **Flags are redacted in this write-up.** Every flag value is replaced with `[redacted]`.
> The commands, payloads and dead ends are all intact — work the box and you get the real
> string, which is the only part of it that teaches you anything.

**Methodology phase mapping**

| Phase | What it means here |
|---|---|
| Recon | Is the box even up? Am I on the right network? |
| Enumeration | Full TCP port sweep, then service/version detection on what I find |
| Exploitation | Talk to the high port with netcat, harvest credentials |
| Post-exploitation | Log in over the low remote-access port, find the flag |

---

## Step 0 — Scope and what "done" looks like

Done = I hold the flag string, and I can name the exact command that produced it.

The load-bearing unknowns before I start:

1. Is my VPN actually routing `10.129.152.110`? (If not, every "port closed" result is a lie.)
2. Which high port is open? The room says there is one but not which.
3. Which low port is the remote-access one? Candidates: `21` (FTP), `22` (SSH), `23` (Telnet).

I attack them in that order — cheapest probe of the biggest unknown first. There is no point
scanning 65535 ports if the tunnel is down.

---

## Step 1 — Recon: am I on the network at all?

Before any scanning, confirm the routing. A pentest that starts with a misconfigured VPN produces
a beautiful, entirely fictional report.

```bash
ip -brief addr show
ip route
```

Relevant output:

```
tun0             UP             192.168.160.167/18
...
10.128.0.0/12 via 192.168.128.1 dev tun0 metric 200
```

Reading this: `tun0` is the OpenVPN tunnel interface and it is `UP`. My tunnel IP is
`192.168.160.167`. Critically, there is a route sending the whole `10.128.0.0/12` block — which
contains `10.129.152.110` — down `tun0`. So traffic to the target will take the VPN, not my home
default gateway. Unknown #1 resolved.

Now prove the host answers:

```bash
ping -c 3 -W 2 10.129.152.110
```

- `-c 3` — send 3 packets and stop, rather than pinging forever.
- `-W 2` — wait at most 2 seconds for each reply, so a dead host fails fast instead of hanging.

```
64 bytes from 10.129.152.110: icmp_seq=3 ttl=62 time=19.1 ms
3 packets transmitted, 3 received, 0% packet loss
```

Two things to read out of this, beyond "it's alive":

- **`ttl=62`.** Linux hosts start their TTL at 64; Windows starts at 128. 64 − 62 = 2, so there are
  two routing hops between me and the box, and the initial value of 64 says **Linux**. That is a
  free OS guess before I have sent a single TCP packet, and it shapes what I expect later — a Linux
  box with a "low port for remote access" almost certainly means SSH on 22.
- **~19 ms RTT.** Fast enough that I can scan aggressively without flooding the link.

Note that the first two ICMP packets were dropped (only `icmp_seq=3` came back). Normal for a
freshly-booted lab box that is still bringing services up — not a reason to panic.

---
## Step 2 — Enumeration: full TCP port sweep

The room says "a high port" without naming it. The default nmap scan only covers the 1000 most
common ports, and 31337-style ports are *not* in that list. So the first scan has to be the full
range or I will miss the whole challenge.

```bash
nmap -p- --min-rate 2000 -T4 -Pn -oN full-tcp.txt 10.129.152.110
```

Flag by flag, because this is exactly the muscle memory PT1 tests:

| Flag | Why it's there |
|---|---|
| `-p-` | Scan **all 65535** TCP ports, not nmap's default top-1000. Without this the high port is invisible. |
| `--min-rate 2000` | Send at least 2000 packets/second. On a ~19 ms lab link this turns a 20-minute scan into seconds. |
| `-T4` | Timing template "aggressive": shorter timeouts, more parallelism. `-T5` risks dropped packets and false negatives. |
| `-Pn` | Skip host discovery, treat the host as up. I already proved it's alive with ping; this stops nmap from wrongly writing the box off if it later ignores probes. |
| `-oN full-tcp.txt` | Save normal-format output. Always keep scan artefacts — reports need evidence, and re-scanning wastes lab time. |

Result, in **11.45 seconds**:

```
Not shown: 65532 closed tcp ports (reset)
PORT      STATE SERVICE
22/tcp    open  ssh
2222/tcp  open  EtherNetIP-1
31337/tcp open  Elite
```

Reading it properly:

- **"closed (reset)"** for the other 65532 ports means the box actively sent TCP RST rather than
  silently dropping. That tells me there is **no firewall filtering** in front of it — a filtered
  host would show `filtered` and the scan would have taken far longer. Good news: what I see is
  what is really there.
- **22/tcp — ssh.** This is the "low port commonly used for remote access" the room is pointing at.
  It matches the Linux guess from the TTL.
- **2222/tcp — labelled `EtherNetIP-1`.** That label is a *guess from a lookup table*, not a fact.
  Nmap maps port numbers to `/usr/share/nmap/nmap-services` names when it has not fingerprinted the
  service. 2222 is also a very common alternate-SSH port. I must not trust this label.
- **31337/tcp — labelled `Elite`.** Same caveat. 31337 is "eleet" in leetspeak, historically the
  Back Orifice backdoor port, and a traditional CTF joke port. This is almost certainly my "high
  port".

**Lesson worth internalising:** the `SERVICE` column of a plain `-p-` scan is a dictionary lookup,
nothing more. It has never spoken to the service. Never write it in a report as fact — confirm it
with `-sV` or by talking to the port yourself.

---
## Step 3 — Enumeration: what is *actually* on those ports

Never report the lookup-table name. Fingerprint the services:

```bash
nmap -sV -sC -p 22,2222,31337 -Pn -oN versions.txt 10.129.152.110
```

- `-sV` — **version detection**. Nmap opens the port, reads the banner, and if that is not enough it
  fires a library of probes and matches the replies against `nmap-service-probes`. This is what
  turns a guess into a fact.
- `-sC` — run the **default NSE script set** (equivalent to `--script=default`). Safe,
  non-intrusive scripts: SSH host keys, HTTP titles, anonymous FTP checks. Cheap extra information.
- `-p 22,2222,31337` — only the ports I already know are open. Re-scanning all 65535 with `-sV`
  would be enormously slower for zero extra information.

Result:

```
PORT      STATE SERVICE VERSION
22/tcp    open  ssh     OpenSSH 8.2p1 Ubuntu 4ubuntu0.4 (Ubuntu Linux; protocol 2.0)
2222/tcp  open  ssh     OpenSSH 8.2p1 Ubuntu 4ubuntu0.4 (Ubuntu Linux; protocol 2.0)
31337/tcp open  Elite?
Service Info: OS: Linux; CPE: cpe:/o:linux:linux_kernel
```

What changed versus Step 2, and why it matters:

- **2222 is not EtherNet/IP at all — it is a second SSH daemon.** Exactly the false label I warned
  about. `-sV` corrected it.
- The banner `OpenSSH 8.2p1 Ubuntu 4ubuntu0.4` pins the OS to **Ubuntu 20.04 LTS** (8.2p1 is the
  20.04 package version). My TTL-based Linux guess from Step 1 is now confirmed evidence, and
  `Service Info: OS: Linux` agrees.
- Ports 22 and 2222 present **different host keys** (`7d:dc:eb:90:…` vs `bb:8f:eb:d0:…`). Same
  software version, different key material — so these are two *separate* sshd instances, not one
  daemon bound twice. Worth noting; it may mean 2222 is a container or a differently-configured
  jail.
- **31337 shows `Elite?` with a trailing question mark.** The `?` means nmap could not match it to
  any known service. Note it stayed `open`, not `open|filtered` — the port answered, nmap just did
  not recognise the protocol.

And then the actual prize, in the `fingerprint-strings` block:

```
| fingerprint-strings:
|   DNSStatusRequestTCP, ..., NULL, ..., X11Probe:
|     In case I forget - user:pass
|_    ubuntu:Dafdas!!/str0ng
```

**Why the credentials fell out of a version scan.** When `-sV` cannot identify a service it dumps
the raw responses so a human can identify it. Look at the probe list: `NULL`, `GetRequest`,
`Kerberos`, `X11Probe`, `LDAPBindReq` — nmap sent twenty-odd completely different protocol probes
and got the *same* 0x35-byte string back every time. A service that replies identically to every
input, including the `NULL` probe (which sends nothing at all), is not a protocol — it is a banner
printer that shouts its message at whoever connects and then hangs up.

That is a real finding in its own right, phrased for a report: **an unauthenticated network service
discloses valid SSH credentials in cleartext to any client that opens a TCP connection.** No
exploit, no auth, no crafted payload.

---

## Step 4 — Doing it the room's way: netcat

The room asks for netcat specifically, and it is worth doing by hand rather than letting `-sV` do
it for me — on a real engagement I want to see the raw conversation, not nmap's summary of it.

```bash
nc -nv 10.129.152.110 31337
```

- `-n` — no DNS resolution. Do not leak a lookup for the target to a DNS server, and do not stall
  waiting on reverse DNS that will never resolve for a lab IP.
- `-v` — verbose, so netcat prints whether the connection actually succeeded instead of sitting
  there silently.

```
(UNKNOWN) [10.129.152.110] 31337 (?) open
In case I forget - user:pass
ubuntu:Dafdas!!/str0ng
```

The service prints its note the instant the TCP handshake completes — I never sent a byte. It then
closes the connection. This confirms the read of the fingerprint data: a pure banner service.

**Credentials harvested:**

| Field | Value |
|---|---|
| Username | `ubuntu` |
| Password | `Dafdas!!/str0ng` |

Note the shape of that password — `Dafdas!!/str0ng` looks "strong" by every corporate complexity
policy: mixed case, digits, symbols, 15 characters. It would survive a password audit and it is
completely worthless, because it is being handed out for free on port 31337. Complexity rules
protect against guessing, not against disclosure. Good line for a report's remediation section.

---
## Step 5 — Exploitation: log in over SSH

The room's "low port commonly used for remote access" is **22/tcp**. I have a username and a
password. Straightforward:

```bash
ssh ubuntu@10.129.152.110
```

Interactively that prompts for the password and I paste `Dafdas!!/str0ng`. I needed it
non-interactively for these notes, which is where a small wrinkle appeared.

### Wrong turn #1 — reaching for `sshpass` that isn't installed

```bash
which sshpass
# sshpass not found
```

`sshpass` is the usual tool for feeding SSH a password from a script, but it is not installed here
and `apt install` needs root. Rather than change the machine's package state for one login, use the
mechanism OpenSSH already ships:

```bash
printf '#!/bin/sh\necho "Dafdas!!/str0ng"\n' > askpass.sh
chmod +x askpass.sh

SSH_ASKPASS="$PWD/askpass.sh" SSH_ASKPASS_REQUIRE=force \
  setsid -w ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null \
  ubuntu@10.129.152.110 'id; hostname; pwd; ls -la'
```

Why each piece is needed:

- **`SSH_ASKPASS`** points at a program SSH runs to *obtain* the password instead of reading the
  terminal. It was designed for graphical password prompts.
- **`SSH_ASKPASS_REQUIRE=force`** — by default SSH only uses the askpass helper when there is no
  controlling terminal. `force` makes it use the helper unconditionally. (OpenSSH 8.4+.)
- **`setsid -w`** detaches the command from the terminal into a new session, which is the classic
  way to satisfy the "no TTY" condition. `-w` waits for it to finish so I still see the output.
- **`-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`** — accept the unknown host key
  without an interactive yes/no prompt, and do not pollute `~/.ssh/known_hosts` with a lab box whose
  IP gets recycled to a different machine tomorrow. **Only ever acceptable in a lab.** On a real
  engagement, verifying the host key is the defence against someone MITM-ing your own session.

Keep the askpass script in a scratch directory, never in a repo, and delete it afterwards — it is a
plaintext credential on disk.

**It worked:**

```
uid=1000(ubuntu) gid=1000(ubuntu) groups=1000(ubuntu)
f518fa10296d
/home/ubuntu
```

Two observations before going flag-hunting:

- **`uid=1000`, no `sudo` group.** I am an unprivileged user. Whatever the flag is, I probably need
  it to be readable by `ubuntu`, or I need a privilege escalation step.
- **The hostname is `f518fa10296d`** — twelve hex characters. That is the shape of a **Docker
  container ID**, not a hostname anyone types. Combined with the two independent sshd instances on
  22 and 2222 from Step 3, the picture is: the "machine" is a set of containers, and port 22 and
  port 2222 very likely land me in *different* ones.
- `ls -la` on the home directory shows only stock dotfiles — `.bashrc`, `.profile`, `.bash_logout`,
  and a `.cache`. **No flag here.** The obvious place is empty, so I have to go looking.

---
## Step 6 — Post-exploitation: finding the flag

The home directory was empty, so search the filesystem rather than guessing paths:

```bash
find / -iname "*flag*" -not -path "/proc/*" -not -path "/sys/*" \
       -not -path "/usr/src/*" -not -path "/usr/include/*" 2>/dev/null
```

- `-iname "*flag*"` — case-**i**nsensitive name match, so `FLAG.txt` and `flag.txt` both hit.
- `-not -path "/proc/*" -not -path "/sys/*"` — these are kernel pseudo-filesystems full of noise
  that is not really files. Excluding them keeps the search fast and the output readable.
- `-not -path "/usr/src/*" -not -path "/usr/include/*"` — kernel headers and C headers are full of
  legitimate matches like `waitflags.ph`. Pure noise for this purpose.
- **`2>/dev/null`** — the important one. As an unprivileged user, `find` hits hundreds of
  "Permission denied" errors on directories I cannot read. Sending stderr to `/dev/null` leaves only
  the actual results. Without it the real hit scrolls off the screen.

Signal, after the perl/dpkg noise:

```
/home/user/flag.txt
```

A *second* user's home directory — I had only looked in my own. Check the permissions before
assuming I can read it:

```bash
ls -la /home/user/
-rw-rw-r-- 1 root root 38 Mar  2  2022 flag.txt
```

`-rw-rw-r--` owned by `root:root`. The final `r--` is the **other** permission bit: any user on the
box can read it. So no privilege escalation is needed — which is the point of this room. It teaches
the enumeration chain, not privesc.

```bash
cat /home/user/flag.txt
```

## 🚩 Flag

```
flag{[redacted]}
```

**Verification status:** read directly off the target filesystem with `cat`, output shown above.
The file is 38 bytes, matching the `ls -la` size, so nothing was truncated. I have **not** submitted
it to the TryHackMe answer box, so it is evidence-backed but not yet confirmed-correct by the
platform.

---

## Step 7 — Loose end: what is on port 2222?

Port 2222 was the one nmap initially mislabelled as `EtherNetIP-1`, and Step 3 showed it as a second
sshd with a *different host key*. Leaving an open port unexplained is how findings get missed, so
check whether the same credentials work there.

```bash
ssh -p 2222 -o NumberOfPasswordPrompts=1 ubuntu@10.129.152.110
```

- `-p 2222` — target port. Easy to forget; without it SSH silently goes to 22 and you "succeed" on
  the wrong service and draw the wrong conclusion.
- `-o NumberOfPasswordPrompts=1` — fail after one rejected password instead of three. Keeps a failed
  attempt from looking like a hang, and keeps noise out of the target's auth log.

```
ubuntu@10.129.152.110: Permission denied (publickey).
```

Read that error precisely — it is more informative than it looks. The parenthesis lists the
authentication methods the server was **willing to accept**, and it says `publickey` *only*. The
server never even offered password authentication, so this is not "wrong password" — it is
`PasswordAuthentication no` in that daemon's `sshd_config`.

So the two SSH services are configured differently: **22 accepts passwords, 2222 requires a key.**
Without a private key there is no way in on 2222, and nothing here suggests one is available. Dead
end, correctly identified and closed rather than left hanging.

Amusingly, port 2222 is the *securely* configured one. The box would have been safe if 22 had been
set up the same way — the weakness was never SSH itself.

---

## Summary — the attack chain

| # | Phase | Action | Result |
|---|---|---|---|
| 1 | Recon | `ping` + route check | Host up, Linux (TTL 62), VPN routing confirmed |
| 2 | Enumeration | `nmap -p- --min-rate 2000` | 22, 2222, 31337 open; no firewall filtering |
| 3 | Enumeration | `nmap -sV -sC` | 2222 is SSH not EtherNet/IP; 31337 leaks credentials |
| 4 | Exploitation | `nc -nv <ip> 31337` | `ubuntu:Dafdas!!/str0ng` in cleartext, no auth |
| 5 | Exploitation | `ssh ubuntu@<ip>` | Shell as uid 1000 in a Docker container |
| 6 | Post-exploitation | `find / -iname "*flag*"` | `/home/user/flag.txt`, world-readable |
| 7 | Enumeration | `ssh -p 2222` | Key-only auth, no way in — dead end closed |

## What this room actually teaches

**The default nmap scan would have failed this box.** Port 31337 is not in nmap's top-1000, so
without `-p-` the entire challenge is invisible and you are left staring at an SSH port with no
credentials. Scan the full range before concluding anything.

**The `SERVICE` column is a guess until `-sV` runs.** Port 2222 was labelled `EtherNetIP-1` — an
industrial protocol — purely because of a line in `/usr/share/nmap/nmap-services`. It was SSH. Had
this been a real report, "the target exposes an industrial control protocol" would have been a
fabricated finding.

**`-sV` output is worth reading in full, not just the version column.** The credentials arrived in
the `fingerprint-strings` block, which most people scroll past because it is ugly. Nmap prints the
raw service responses precisely so a human can read what it could not parse.

**A service that answers every probe identically is a banner, not a protocol.** Twenty-odd
different probes — `NULL`, `Kerberos`, `X11Probe`, `LDAPBindReq` — got byte-identical replies. That
pattern is the fingerprint of something that just prints text on connect.

## Findings, phrased for a report

| Severity | Finding | Remediation |
|---|---|---|
| **Critical** | An unauthenticated service on 31337/tcp discloses valid SSH credentials in cleartext to any client that completes a TCP handshake. | Remove the service. Rotate the exposed credentials — they must be treated as public. |
| **High** | SSH on 22/tcp permits password authentication with a credential known to be disclosed. | Set `PasswordAuthentication no` and use keys, matching the config already in use on 2222. |
| **Low** | `/home/user/flag.txt` is world-readable (`-rw-rw-r--`), letting any local user read another user's data. | Restrict to `0600` and the owning user. |
| **Info** | Two SSH daemons with inconsistent authentication policies (22 password-enabled, 2222 key-only). | Standardise on the stricter policy across all instances. |

The password `Dafdas!!/str0ng` is the lesson in miniature: 15 characters, mixed case, digits and
symbols — it passes every complexity policy ever written, and it protected nothing, because it was
being given away on another port. **Password complexity defends against guessing. It does nothing
against disclosure.**

## Note on scope

All activity was against `10.129.152.110`, a lab machine provided by the room, over its VPN. The
credential in this document is a disposable lab credential that the target itself broadcasts to
anyone who connects — it is not a real-world secret.
