---
description: "TryHackMe SchemeCatcher — a home-made C2 whose beacon points at a hidden directory, a menu binary you defeat with the leakless House of Water (glibc 2.40, no output primitive at all), an SSH pivot out of a privileged container, and a backdoor kernel module you drive to root by overwriting a function pointer in its .data. Four wrong turns kept in, including one that burned 300 brute-force attempts."
---

# SchemeCatcher — the silent control system of the Jester

**TryHackMe · challenge: SchemeCatcher · target: `10.128.187.190`**

> **All four flags are redacted** here as `THM{[redacted]}`, and so is the base64 blob that decodes to
> one of them. Everything else is intact: every command with every flag explained, the packer, the
> full House of Water chain, the kernel-module reversing, and all four wrong turns.
>
> **What I kept and why:** the packer's XOR key, the hidden path baked into the beacon, the heap
> technique, the FSOP payload, the kernel-module ioctl numbers, and the exact offset-mapping method.
> Those are the lesson. The flag strings and the module's session key are just proof — you still run
> the chain to earn them.

The brief is pure theatre: a "silent control system", tasks that "appear, vanish, and reappear",
logs that "rewrite themselves", scripts that reply "a little too aware". Strip the costume and it is
a checklist: a home-made **command-and-control** (C2) system (so expect a custom network service and
downloadable agents), "several suspicious binaries" (a file is in scope, and binaries mean a local
privilege-escalation later), and "he never commits a single mistake" (a hint I noted and, as it
turned out, over-read).

A quick vocabulary note, because the room assumes none: a **port** is a numbered door on a machine
that a particular service answers on; **RCE** is remote code execution (running your commands on the
target); **ASLR/KASLR** is the randomisation of where code and data land in memory (user-space /
kernel); a **libc** is the C standard library every normal Linux program links against; and a
**kernel module** is code loaded into the operating system core itself, running with full privilege.

---

## 1. Recon — what is listening

Ping first, then a full port sweep. TryHackMe boxes often drop ping, so I scan with `-Pn` ("skip the
are-you-alive check, just scan"). Here ping actually worked (TTL 62 → a Linux host two hops away).

```bash
nmap -Pn -sT -p- --min-rate 1000 --open -oN allports.txt 10.128.187.190
```

- `-sT` is a full TCP connect scan. I used it deliberately: the default `-sS` (SYN scan) needs raw
  sockets and therefore root, and this attacker box had no `sudo`. `-sT` just uses the normal connect
  system call and works as any user.
- `-p-` is all 65535 ports. A home-made C2 will not sit on a default port, so scanning only the top
  1000 would miss it.
- `--min-rate 1000` sets a floor on packet rate so a full sweep finishes in seconds; `--open` hides
  closed ports from the output.

```
22/tcp   open  ssh
80/tcp   open  http
9004/tcp open  unknown
```

Port **9004** is the interesting one. A version/script scan (`-sV -sC`) can't fingerprint it but
prints what it says on connect:

```
Payload Storage Malhare's
Version 4.2.0
[1] C:
[2] U:
[3] D:
[4] E:
>>
```

A custom line-oriented menu: **C**reate / **U**pdate / **D**elete / **E**xit. Port 80 is a pastel
"Under Construction" page with nothing in the HTML.

## 2. Enumeration — the beacon and the hidden directory

A directory brute force on port 80, with a control path included so an empty result is interpretable:

```bash
ffuf -u http://10.128.187.190/FUZZ -w /usr/share/wordlists/dirb/common.txt -t 25 -fc 404
```

- `-fc 404` filters out "not found" responses. `-t 25` keeps concurrency low; a 1-vCPU lab VM falls
  over under `-t 80`, and then you are debugging your own traffic.
- I checked first that `index.html` is in the wordlist, so a hit on it proves the sweep really reaches
  the server. (An empty result otherwise means either "nothing there" or "my requests never arrived",
  and those look identical.)

One hit: **`/dev`**, a directory listing holding **`4.2.0.zip`** — same version string as the 9004
service. Inside: `latest/beacon.bin`, an ELF64.

### The beacon is packed

`strings beacon.bin` already contains a flag — **Question 1** — but the binary is more interesting
than that. Its section table has a non-standard **`.easter`** section marked `WAX` (writable, allocatable,
**executable**), and the ELF's entry point is *inside that section*, not at the usual `_start`. That
is a self-decrypting packer. The stub is trivial once you look:

```asm
movabs rsi, 0x401370          ; _start
movabs rdi, 0x401bc4          ; _fini
xor    BYTE PTR [rsi], 0x0d   ; decrypt every byte of .text with key 0x0d
inc    rsi
cmp    rsi, rdi
jne    ...
push   0x401370 ; ret         ; jump to the now-decrypted _start
```

So `.text` is XOR-encrypted with the single byte `0x0d`. Decrypt a copy and the real logic appears:
the beacon asks for a key, `strcmp`s it against `EastMass`, and on a match opens a shell server on
port 4444 that runs `system()` on command. The genuinely useful part is `payload_load()`, which
builds a URL out of two hardcoded 64-bit immediates:

```
0x58315a366e6c372f  ->  "/7ln6Z1X9EF"   (little-endian ASCII)
0x0000000000464539  ->  "9EF"           (continuation + NUL)
```

That is a **hidden web path** no wordlist could ever guess. Fetch it and you get another directory
listing: **`foothold.txt`** (Question 2) and **`4.2.0-R1-1337-server.zip`** — the port-9004 service,
shipped with its own `ld-linux-x86-64.so.2` and `libc.so.6`. That "here is the exact runtime" bundle
is the universal sign that you are meant to write a memory-corruption exploit.

## 3. The service is a leakless heap challenge

`server` is a PIE with Full RELRO, NX and a stack canary, built against **glibc 2.40**. Its four menu
options map to `create` / `update` / `delete`, backed by two global arrays and an index:

| symbol | address | entries |
|---|---|---|
| `chunks` | `0x4060` | 249 |
| `sizes`  | `0x4840` | 249 |
| `idx`    | `0x5008` | — |

Two bugs:

1. **`delete()` frees but never clears `chunks[i]`** — a use-after-free, and a second delete on the
   same index is a double free (that is what dropped my connection during the first probe).
2. **The arrays overlap `idx`.** `&sizes[249]` is exactly `&idx`, and `create()` bounds the index at
   `0xff` while the arrays only hold 249 slots. So creating while `idx == 249` writes the *size
   argument straight into the index* — arbitrary control over which slot the next operation touches.

The overlap looks like it also gives an arbitrary write (put a huge value in a `sizes[]` slot, then
`update` reads a near-infinite length into a chunk). It does not — see wrong turn #1. The real path is
the technique the binary is named after.

### Wrong turn #1 — the kernel refuses the "infinite" write

`update()` does `read(0, chunks[i] + offset, sizes[i] - offset)`. Aliasing a heap pointer into a size
field makes that length ~94 TB. But Linux checks `access_ok(buf, count)` *before* reading a byte, and
`buf + count` overflows past the top of the user address space, so the syscall returns `-EFAULT` and
writes nothing. Verified identically against the target. An "unbounded length" primitive is bounded
by the kernel. Lesson filed; move on.

### The intended technique: House of Water

The compilation unit in the (not-stripped) symbol table is literally `water.c`. That is the author
naming the solution: the **House of Water**, a *leakless* heap technique (Blue Water's `udp`,
PotluckCTF 2023). It fits because the service has **no output primitive at all** — `printf` is called
exactly once, with a constant string. Nothing ever prints memory, so the exploit must bootstrap
without knowing a single address.

The trick abuses the fact that `tcache_perthread_struct` lives at the *start of the heap* and its
`entries[]` array holds **unmangled** pointers (safe-linking only mangles the `fd` inside freed
chunks). By forging a chunk over that struct and splicing it into the unsorted bin with a two-byte
partial overwrite (a 4-bit brute force against heap ASLR), `malloc` hands back a pointer *into*
`entries[]`, and the unlink writes **libc pointers into the bins for free**. Confirmed locally — after
the House of Water, `entries[0]` and `entries[1]` hold live libc addresses I never had to leak.

### Wrong turn #2 — the textbook stdout leak returns nothing

The reference exploit then forces a libc leak by corrupting `stdout` with `_flags = 0xfbad3887` and a
null byte. Against this service it produced zero bytes, because `setup()` calls
`setvbuf(stdout, NULL, _IONBF, 0)` — the stream is **unbuffered**, so the flush length
`_IO_write_ptr - _IO_write_base` is zero and there is nothing to flush. The fix is two writes instead
of one: clear the `_IO_UNBUFFERED` flag first, then a **single-byte** partial overwrite of the low byte
of `_IO_write_ptr` (no guessing — libc is page-aligned, so the bottom 12 bits are known). The next
`puts()` then dumps 93 bytes of libc data down the socket, including `stdout->vtable`, and
`libc_base = leaked_vtable - offset`.

### Stage 3 — House of Apple 2

With libc known, point another tcache bin at `stdout`, take the whole FILE struct, and forge it so a
final `puts()` walks `_IO_wfile_overflow → _IO_wdoallocbuf → _IO_WDOALLOCATE` into
`system("  sh;")`, with the socket already on fds 0/1. The `"  sh;"` sits in the `_flags` field, whose
first six bytes are unused by the vtable dispatch — so it doubles as the string `system()` receives.

Local proof, six for six:

```
run 0: ok libc=0x7f6d91939000 ... run 5: ok libc=0x7fafb7b1c000
shells: 6/6
```

The chain is deterministic once the two 4-bit brute forces (heap nibble + libc nibble) line up, so a
remote run succeeds with probability 1/256 per connection, and the service spawns a fresh process per
connection. A three-worker driver retries until it wins.

### Wrong turn #3 — a sanity check that threw away a win

Around attempt 300 the driver logged `bad leak 0x7ca703e1fff0` and discarded it. That was not a
failure: `0x7ca703e1fff0 - offset` is a perfectly valid, page-aligned libc base. My own validator
insisted the base start with `0x7f` — true of every one of my local test runs, false in general. The
target had mapped libc at `0x7c...`. A validator written from observed samples encodes the samples,
not the invariant; the fix was one character (`0x7f...` → `0x70...`), and it cost ~300 wasted attempts.

The winning shell comes back as `uid=0(root)` — but on host `bb21200fff81`, a Docker container.

## 4. user.txt, and the pivot out of the container

Inside the container's `/home/srv`: `user.txt` (Question 3), the `server` bundle, and an **unencrypted
ed25519 SSH key** with comment `agent@tryhackme`. The container is *privileged* — `CapEff` has every
capability set — and shares the host kernel, which matters shortly.

The key logs into the real box as the `agent` user:

```bash
ssh -i id_rsa agent@10.128.187.190 id
# uid=1001(agent) ... on ip-10-128-187-190
```

`root.txt` is in `/root`, unreadable. What can `agent` do?

```
sudo -l
(root) NOPASSWD: /usr/sbin/modprobe -r kagent, /usr/sbin/modprobe kagent
(root) NOPASSWD: /bin/chmod 444 /dev/kagent
```

Load/unload a custom kernel module `kagent`, and make its device world-readable.

## 5. root — driving a backdoor kernel module

Pull `kagent.ko` (not stripped, with debug info) and reverse it. It registers `/dev/kagent` with three
ioctls:

- **`op_execute()`** = `commit_creds(prepare_kernel_cred(&init_task))` — an unconditional
  make-me-root. It is only reached through a **function pointer stored in the module's `.data`**,
  called by ioctl `0x00133703`. That pointer defaults to a harmless `op_ping`.
- **ioctl `0x40933702`** copies `0x90` bytes from userspace: the first 16 are a session key checked
  against a key the module loads from `/root/kkey` at init; the rest are a "config" blob `memcpy`'d
  into the same `.data` struct that holds the function pointer. So a valid key plus a long-enough
  config **overwrites the pointer with `&op_execute`**.
- ioctl `0x00133703` then calls it → root.

The session key is on disk in `/root/kkey`, unreadable as `agent`. But the module's live memory is
not — and this is where the privileged container pays off.

### Reading the live key without being root

A privileged container shares the host kernel, so container-root `/proc/kcore` *is* the host kernel's
memory, and `/sys/module/kagent/sections/*` gives the module's live section addresses (the host's own
`agent` user is blocked by `kptr_restrict=1`; container-root is not). Dumping the module's `.data`
from `/proc/kcore` shows the key sitting in the struct, the module `.text` base, and the current value
of the function pointer (`&op_ping`). `op_execute` is `.text + 0x330`.

### Wrong turn #4 — three offset mistakes, fixed by measuring

Deriving offsets from the `.ko` relocations alone was wrong three times:

1. Tried the module's *default* key — rejected. `/root/kkey` exists, so the default is not live.
2. Tried the real key at the reloc offset — rejected. The live struct sits **+4 bytes** from where the
   relocations point (struct padding), so the key and the function pointer are 4 bytes further along
   than the object file implies.
3. Once the key matched, the config write did nothing — my "map the offsets" ramp began with a `0x00`
   byte, and the copy is bounded by `strnlen(config)`, so a leading NUL truncated it to zero length.

The fix for all three: stop subtracting, and **measure**. Write a ramp of non-NUL bytes
(`config[i] = 0x41 + i`) through the real ioctl after a successful auth, then read `.data` back from
`/proc/kcore`. It shows the copy actually lands at `.data + 0x40`, so `config[0x20]` is exactly what
overwrites the function pointer. One live read beats three careful-but-wrong derivations.

### Root

Authenticate with the real key, place `&op_execute` at config offset `0x20`, fire `0x133703`, drop a
shell:

```
uid=0(root) gid=0(root) groups=0(root)
/root/root.txt -> THM{[redacted]}
/root/kkey     -> [the module's session key]
```

`commit_creds(prepare_kernel_cred(&init_task))` reached through a writable function pointer in a
module's `.data` is the entire escalation — the key-and-config wrapper around it is just theatre.

## 6. Answers

| # | Question | Answer |
|---|---|---|
| 1 | Flag in the file | `THM{[redacted]}` — `strings` on the XOR-`0x0d`-packed `beacon.bin` |
| 2 | `foothold.txt` | `THM{[redacted]}` — at `/7ln6Z1X9EF`, the path hardcoded in the beacon |
| 3 | `user.txt` | `THM{[redacted]}` — leakless House of Water RCE on the port-9004 service |
| 4 | `root.txt` | `THM{[redacted]}` — SSH pivot + `kagent.ko` function-pointer overwrite → `op_execute` |

## 7. What it taught

- Read the brief as recon: "C2", "binaries", and "never commits a mistake" each pointed at a real part
  of the box (a custom service, a pwn, a directory listing) — but "commits" was a red herring, there
  was no exposed `.git`. Themed hints supplement enumeration, they don't replace it.
- A "huge length" write is bounded by `access_ok`; the compilation-unit name (`water.c`) named the
  intended technique; the `_IONBF` stream broke the textbook leak; a validator built from samples
  threw away a real win; and a privileged container is a window into the host kernel's live memory.
- When an object file's section offsets disagree with the struct's runtime layout, dump the live bytes
  and map the primitive empirically. One `/proc/kcore` read is worth three wrong subtractions.
