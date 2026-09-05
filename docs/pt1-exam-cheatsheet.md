# PT1 exam cheat-sheet — how to think, what to run, where to look

One page to keep open during the 48-hour exam. Built from your own `walkthrough/LESSONS.md`
(196 wrong turns already paid for), the `0xb0b` corpus (`docs/0xb0b-writeups-playbook.md`,
233 write-ups), and the exam facts in `content/pt1-course/`.

It is in three layers, and you use them in this order:

1. **The plan of attack** — what to do with the 48 hours before you touch a box.
2. **The logic** — THE FIVE. This is the "what is the logic to find out" part. It is not commands;
   it is the five questions that decide whether the next command is worth running.
3. **The phase playbook** — recon → web → network/privesc → AD → pivot → report, with the commands
   and the tells that tell you you're in a rabbit hole.

---

## Layer 1 — The plan of attack (read before the clock starts)

### What the exam is

| Fact | Detail |
|---|---|
| Format | 100% hands-on. You get a `.ovpn`, use your own Kali, no proctor. |
| Time | **48 hours.** The clock is the real adversary, not the boxes. |
| Score | **1000 pts**, need **750** to pass. Web **400** (40%), Network **360** (36%), AD **240** (24%). |
| Deliverable | A professional **pentest report** in an in-environment app (dropdown categories + text). **No report = no pass, even with every flag.** |
| Grader | **AI.** It rewards technical, keyword-dense write-ups and pasted evidence. It **penalises** management-fluff prose. Use the **predefined vuln categories** — custom ones score zero. A valid vuln reported **without its flag** loses the flag points. |
| Retake | One free retake. |

### The strategy that the score weights hand you

Difficulty and point-weight are inverted, and that gap is the whole game:

- **AD (240 pts) is the easiest** — a handful of classic misconfigs chaining to Domain Admin.
- **Network (360 pts) is very learnable** — boot2root boxes, reviewers clear them in 2–3 hours.
- **Web (400 pts) is the hardest** and where people fail — highest per-item value, most rabbit holes.

**So: bank Network + AD fast and completely (~600 of your 750 from the two easier sections), then
pour the rest of the 48 hours into Web.** Web and AD sections both contain web apps too — web skills
bleed into everything.

### Hour-zero routine

1. Connect the VPN, confirm you can reach a target (`ping`, or a TCP connect if ICMP is filtered).
2. **Start the report app in a tab now.** Write findings as you go, not at the end. Every box you
   root, paste the evidence and fill the category *before* moving on — the report is a graded
   deliverable, not cleanup.
3. Kick off **all** the recon scans in parallel (one per target), then work the fast points (Network/AD)
   while they run.
4. **Time-box every service to ~30 minutes.** No progress → note the tell, move on, come back. Tunnel
   vision on one Web vuln is the #1 way the 48 hours evaporates.

---

## Layer 2 — THE FIVE (the logic to find out)

This is the part that matters more than any command. 196 lessons, five causes. When a box is going
badly the question is never "what else can I try" — it is **"which of these five am I doing right now?"**

### 1. Act *after* you observe — the most expensive mistake

**Moment:** you're about to send a request to something you haven't read.

- A **filename is a claim about behaviour, not a promise.** `setup`, `install`, `reset`, `seed`,
  `migrate`, `delete`, `logout` are **writes**. A `GET` is not "safe" because the RFC says so.
- **Read every static file first** — `robots.txt`, every `.js`, every listing — *before* invoking any
  endpoint. Client-side JavaScript documents the API: endpoints, methods, headers, field names.
- **Strip destructive names from any wordlist before sweeping.** A content sweep issues a real GET to
  every path, on every re-run:
  `grep -viE '^(setup|install|reset|clear|block|seed|migrate|init|delete|drop|truncate|purge)$'`

### 2. Control before you believe — every clean result is a suspect

**Moment:** you're about to believe a result, *especially an empty or clean one.*

Every instance of this produced a **confident wrong answer, never an error** — that's what makes it
the dangerous class.

- Put a **positive control** (something you know is there) *and* a **negative control** (something
  that cannot be there) in the *same run*. **Read the control rows before the result rows.**
- For brute-forcers: an **inverted control** — a candidate that cannot succeed — must come back as a
  failure. If it comes back as a "hit", your discriminator is broken.
- **Detect success positively.** "The failure string is absent" is true of every error page on Earth.
- A **100% hit rate or a suspiciously clean sweep is a broken discriminator.** Verify by hand.

Known instrument traps that have all bitten:
- `ffuf` matchers are **OR**-ed; its default `-mc` **omits 404** (so a "404-with-a-body" endpoint is
  invisible — pair `-mc all` with `-fs <size-of-a-real-miss>`).
- Go/Python tools **canonicalise header names**; `curl` sends them exactly as typed.
- `grep -c` prints `0` **and exits 1**; `grep -E` alternation is `|` not `\|`.
- `pkill -f` **fails silently** — kill by PID.

### 3. Prove the channel before you trust silence

**Moment:** nothing came back and you're about to conclude "it isn't there".

Silence means *either* "not there" *or* "my request never arrived" — indistinguishable until you've
proven the channel works.

- **Never `2>/dev/null` a tool you haven't yet proven works.** Silence the noise *after* you trust it.
- Prefer a success signal you can read through a **channel you already control** (app state you can
  see), not an inbound callback.
- **Before waiting on any inbound callback, your own firewall is part of the channel.** Kali ships
  `ufw` active + DROP by default:
  `systemctl is-active ufw` · `grep DEFAULT_INPUT_POLICY /etc/default/ufw` · `dmesg | grep 'UFW BLOCK'`.
  **Blocked SYNs from the target are positive proof the exploit worked.** A `curl http://<my-tun0-ip>/`
  self-test goes over *loopback*, which ufw always accepts — it's a control that cannot fail, so it
  proves nothing.

### 4. Re-decide after every result — the anomaly is the finding

**Moment:** a result just came back and you're reaching for the next planned step.

- Ask every single time: **does this result confirm the plan, or change it?**
- **Two failed attempts at the same fix means the diagnosis is wrong.** Count *assumptions*, not
  patches — two different-looking fixes usually rest on one untested premise. Name it aloud, then find
  the cheapest observation that could *falsify* it.
- **The anomaly you explain away is the finding.** When two inputs of the same class disagree, stop and
  explain the disagreement before enumerating anything else. (`1'` → 400 while `1' OR '1'='1` → 404
  *was* the SQL injection, sitting in the output for hours while 21,039 route names got swept around it.)

### 5. Multiply out the cost before you start anything long

**Moment:** you're about to launch a scan, spray, or crack.

- Compute `candidates × time ÷ threads` and **say the finishing time out loud first.** Read the tool's
  own throughput line. (Hydra at 72 tries/min against SSH = 3320 hours. An 8×220k content sweep = 1.76M
  requests, abandoned after 10 minutes, proving nothing.)
- **Password cracking is the LAST thing you do, never the next thing.** Worst move on the
  information-per-cost scale: hours of CPU to test one hypothesis that's usually false in a designed
  room, and its negative result teaches you nothing. Exhaust the cheap, high-information avenues first:
  static files and client-side JS, every oracle the app leaks, the **other HTTP method** on every
  endpoint, any discovered secret **replayed against every endpoint**, auth-logic flaws, and the
  unexplained anomaly. If a cracker must run, it runs **in the background** while cheaper work continues.
- **Prefer offline over online.** `john` on a stolen `id_rsa` ran ~360,000× faster than `hydra` on the
  live SSH login. Grab the file, crack it locally.

**Two-line version:** *Read before you invoke. Control before you believe. Prove the channel before you
trust silence. Re-decide after every result. Multiply out the cost before you start.*

---

## Layer 3 — The phase playbook

Methodology phase order: **recon → enumeration → exploitation → post-exploitation → report.**

### Phase 1 — Recon (every domain, every box)

Fast ports first, then the expensive scan on only what's open:

```bash
# fast: find open ports
nmap -p- --min-rate 1000 -Pn -oN nmap-allports.txt <IP>
# or, if you have rustscan (0xb0b's default shape):
rustscan -b 500 -a <IP> --top -- -sC -sV -Pn

# deep: scripts + versions on the open ports only
nmap -p<comma,list> -sC -sV -Pn -oN nmap-deep.txt <IP>
```

- `-p-` = all 65535 ports. `-sC` = default scripts. `-sV` = version fingerprint. `-Pn` = skip the ping
  check (lab hosts drop ICMP; without `-Pn` nmap calls them down and scans nothing).
- **No sudo?** `-sS` (SYN scan) needs raw sockets and dies instantly — use `-sT` (TCP connect).
- **Keep threads ~25 against lab VMs.** `-t 80` knocks over a 1-vCPU box and then you're debugging your
  own traffic. If the target slows mid-engagement, suspect your own traffic first — but *check* that
  something of yours is still running (`ps`) before blaming it; a THM lease expiring looks identical.
- **Always `-oN`** to a file in your evidence folder — you'll paste this into the report.

Web content and vhosts (the single highest-yield web recon step in the corpus):

```bash
feroxbuster -w /usr/share/seclists/Discovery/Web-Content/common.txt -u http://<IP>/
ffuf -w /usr/share/seclists/Discovery/DNS/subdomains-top1million-110000.txt \
     -H "Host: FUZZ.target.thm" -u http://target.thm -fw 3
```

- A **vhost** is a second site on the same IP, selected by the `Host:` header — invisible to a port
  scan and to directory brute-forcing. `-fw 3` filters the default "not found" page (3 words) so only
  real vhosts survive. **28 of 233 boxes turned on a vhost.** Put the IP in `-u` and the hostname in a
  `-H "Host:"` header — `ffuf` has no `--resolve` and a hostname in `-u` dies at DNS silently.
- `feroxbuster` recurses into directories it finds. `common.txt` first, `directory-list-2.3-medium.txt`
  when it comes up empty.
- **When a wordlist finds nothing, suspect the wordlist before the app.** Generate `verb_noun.php`
  names from the app's own vocabulary — `edit_leaderboard.php`, `update_profile.php` are in no standard
  list.

For SMB / AD (netexec is the workhorse):

```bash
nxc smb <IP> -u guest -p '' --shares                    # what can an unauth guest read?
nxc smb <IP> -u guest -p '' --rid                       # RID brute → full user list
nxc smb <IP> -u guest -p '' --generate-hosts-file hosts # Kerberos breaks on IPs — you need this
```

Anonymous/guest SMB works more often than you'd think — try it first on any AD box.

### Phase 2 — Web exploitation (400 pts, ordered by how often it recurs)

You'll be handed a list of **candidate vulnerabilities** with ~4 flags. Work the list; the categories
you report against are predefined.

**SQL injection → login bypass (46/233).** Read the *difference* between responses, not the error:

```
' AND 1=1-- -   → normal results
' AND 1=2-- -   → no results        ← boolean-based injection confirmed
```

Login-bypass payloads that land: `admin' -- -`, `' or 1 or '`, `admin' AND 1=1 -- -`. Keyword filter?
Try versioned comments `/*!50000SELECT*/` and doubled keywords `SSELECTELECT` (defeats a filter that
strips the word once). **The verbose error is often the real prize** — it can leak the DB connection
string directly.
- **Fingerprint the DB before concluding "no injection" from sleep payloads.** `SLEEP()`, `pg_sleep()`,
  `WAITFOR DELAY` all return baseline against **SQLite**, which has none of them. Confirm the engine
  with `sqlite_version()` / `@@version` / `version()` (no time primitive needed) first.
- **A doubled response time** (5s SLEEP costing 10s) means the app runs the query twice — predicts a
  second lookup that makes UNION values render empty.
- Take the **read-only route** when one exists: read live passwords through the UNION instead of
  DROPping the users table (which trashes a shared box).

**IDOR / broken access control.** Change the `id`. An auth cookie whose value is a literal `1`
(`fw_authed=1`) is **forgeable** — the server trusts client data; guess the name and send it before
attacking the login at all.

**XSS (32/233).** Reflected/stored/DOM. Stored/blind XSS to steal an admin cookie where a bot visits
submitted content. Build one payload whose success signal needs **neither JavaScript in the victim's
browser nor egress to your host** — same-origin, readable in app state you already control (see THE FIVE
#3).

**File upload bypass (13).** Test the endpoint the form **actually posts to**, not the one whose source
you read. Reproduce the server's check locally — `getimagesize()` and `finfo` disagree; run a
one-variable-at-a-time differential. Verify payload bytes with `xxd <file> | head -1` before sending,
and confirm the upload dir is actually served before crafting a polyglot for it.

**LFI → RCE (31).** `file://` through a URL param; read `/proc/self/environ` and `/proc/self/cmdline`
to learn *what the app is and where it lives* before guessing source paths; `....//` defeats a filter
that strips one `../`; PHP filter chains; log poisoning.

**SSTI (17).** Confirm with `{{7*7}}` → `49`; `{{7*'7'}}` → `7777777` proves Jinja2. Case bypass:
`{{ ENV }}` where `{{ env }}` is blocked.

**Command injection.** Use **command substitution** — `date$(...)` — because `;`, `|`, `&` are the
chars filters block first. Fingerprint the output channel before reading "no output" as "command
failed" (a narrow sink like a `date`/TZ echo can still exfiltrate a whole file via `base32`).

**SSRF (19).** The bridge to something internal: cloud metadata `169.254.169.254`, a localhost-only
admin endpoint, internal vhost enumeration. A hostname allow-list is not a fix if the allowed name
resolves to loopback.

**Others worth knowing:** JWT forgery (`alg:none`, or crack the key — hashcat `-m 16500`); mass
assignment (add `role=admin` to a profile update the app blindly binds); exposed `.git`
(`git-dumper`, then `git log -p` for secrets committed then "deleted").

### Phase 3 — Network privilege escalation

**Enumerate first:** `linpeas.sh` and `pspy` on Linux (pspy shows other users' processes without root —
that's how you find crons). `whoami /priv` and `PrivescCheck.ps1`/`SharpUp` on Windows.

**Linux, ranked by what actually escalated:**
- **`sudo -l` → GTFOBins.** Check it on *every* foothold. `sudo find . -exec /bin/sh \; -quit`, editor
  shell escapes, `systemctl --no-pager`. Read the whole sudo/SUID chain as a story — each step names
  the next.
- **Cron writing/reading a file you control.** Symlink tricks; a writable root-run script; **tar
  wildcard injection** (files named `--checkpoint=1` and `--checkpoint-action=exec=sh x.sh` in a dir a
  `tar czf *` cron runs — check the glob order first).
- **The `disk` group** → `debugfs -w /dev/sdaN`, read `/root/root.txt` straight off the filesystem.
  **The `docker` group** → `docker run -v /:/mnt --rm -it alpine chroot /mnt sh`.
- **SUID binaries — reverse them, don't guess.** `system()` in a SUID binary isn't automatically
  exploitable: dash/bash drop the effective UID unless invoked with `-p`. Test it. Ask what the program
  *lets you do*, not what it was *meant* to do — the boring documented feature (a file copy running as
  another user) is often the escalation.
- **Credential reuse, over and over:** `.bash_history`, `config.php`, saved browser passwords, KeePass
  `.kdbx` (`keepass2john` + john).
- **Check both `/root/root.txt` and `/root/flag.txt`** — THM is inconsistent.

**Windows:**
- **`SeImpersonatePrivilege` → SYSTEM** via the potato family (PrintSpoofer, GodPotato, EfsPotato). If
  you land as `iis apppool\*` or `nt service\mssql*`, check `whoami /priv` *first*.
- Weak service permissions → rewrite `binPath`, restart; unquoted service paths; DLL hijacking.
- Creds on disk: `Unattend.xml` in `C:\Windows\Panther\`, WinLogon autologon registry, browser stores.

### Phase 4 — Active Directory (240 pts, easiest — run the loop)

```
get any identity → BloodHound collect → find an ACL/attribute to abuse
       ↑                                          ↓
       └──────── new identity ← abuse it ←────────┘
```

**A clean BloodHound graph is not a dead end — it means you haven't collected enough identities yet.**
Number your collection runs (I, II, III) and re-run after *every* new credential.

**First identity with nothing:**
- guest/anonymous SMB, then `--rid` brute for the user list.
- **AS-REP roasting** (pre-auth disabled): `GetNPUsers.py`, crack `-m 18200`.
- **Kerberoasting** (any account with an SPN): `GetUserSPNs.py -request`, crack `-m 13100`.
- NTLM coercion (`ntlm_theft.py`, catch with `responder -I tun0`); `xp_dirtree` from a reachable MSSQL.

**ACL abuses** (`bloodyAD` does nearly all of it — `get writable` is the underrated one that saves
boxes when BloodHound shows nothing):

```bash
bloodyAD --host <DC> -d <domain> -u <u> -p <p> get writable
bloodyAD --host <DC> -d <domain> -u <u> -p <p> set owner <target> <you>
bloodyAD --host <DC> -d <domain> -u <u> -p <p> add genericAll <target> <you>
```

Chain: `WriteOwner` → take ownership → `GenericAll` → `ForceChangePassword` → next identity. Or
`GenericWrite` → **targeted Kerberoasting** (`targetedKerberoast.py`) or **Shadow Credentials**
(`certipy shadow auto`) — both non-destructive, prefer them over password resets.

**ADCS:** `certipy find`, then abuse by ESC number (ESC1 most common — template lets you specify any
subject).

**End it:** DCSync with `secretsdump.py` once you hold `GetChanges`/`GetChangesAll`, then pass-the-hash:
`evil-winrm -i <DC> -u Administrator -H '<hash>'`.

### Phase 5 — Pivoting

**ligolo-ng** makes the whole internal subnet routable (no proxychains):

```bash
sudo ip tuntap add user root mode tun ligolo && sudo ip link set ligolo up
sudo ip route add <internal-subnet> dev ligolo
# run the agent on the compromised host, `start` the tunnel on the proxy
```

Add `/32` routes for individual hosts to avoid loops when the pivot host is inside that subnet.
Fallbacks: `chisel`, `ssh -L`/`-D`, `sshuttle`. The best tool is the one that survives the network
you're on — SSH local forwarding is sometimes more stable than either.

### Phase 6 — Report (the pass/fail gate)

The AI grader is the actual boss fight. It scores each finding on flag + category + CVSS + write-up +
remediation.

- **Use the predefined vulnerability categories.** Custom ones score zero.
- **Technical and keyword-dense.** Paste evidence: the exact command, the exact response, the flag.
  Management-style prose is *penalised*.
- **Every finding needs its flag** or it loses the flag points.
- Write findings **as you go**, per box, not at the end.
- Structure each finding: what was vulnerable → how you exploited it (command + evidence) → impact →
  remediation. Steal 0xb0b's habit: name sections after the identity gained ("Shell as www-data"), and
  open with a one-paragraph summary of the whole chain.
- **Separate verified from assumed.** A flag you never actually submitted is evidence-backed, not
  confirmed — but on the exam, submit and confirm.

---

## Quick reference

### Hashcat modes to memorise

| Mode | What |
|---|---|
| `13100` | Kerberoast TGS-REP |
| `18200` | AS-REP roast |
| `1400` | raw SHA-256 |
| `1420` | salted SHA-256 |
| `16500` | JWT HS256 |
| `5600` | NetNTLMv2 |

### The rabbit-hole tells (from 196 real wrong turns)

- **"It looks like a static site"** appeared 39 times in the corpus and was almost always the way in.
  It's the tell for *I looked, saw nothing, kept going anyway.* Follow-up: fuzz vhosts, dump `.git`,
  read the JS, read the error log.
- **A clean scan is a claim about your tool, not the target.** wpscan reported no plugins on a site that
  had a vulnerable one; forcing enumeration found it.
- **A generic login error doesn't mean no user enumeration** — try response length and timing.
- **Read the whole output.** The connection string was already in the error log; the brute-forced
  filename was already in a dumped DB column.
- **Read the exploit before you run it.** Adapt public PoCs to your target and network (email→username
  login, hardcoded→CLI args, add a base64 reverse shell to dodge escaping).
- **Confirm what an error/status code *means*** with known-good vs known-bad input before acting. The
  same `400` meant "wrong key" in one context and "SQL error" in another.

### Teardown (before you call the report done)

Track every artefact as you create it; a cleanup that removes one thing is not a teardown.

| Started | Stop it | Verify |
|---|---|---|
| nmap/ffuf/hydra/hashcat | kill the **PID** | `ps` shows it gone |
| web shell on target | `rm` it | re-fetch the URL → 404 (an `rm` that "returned nothing" is not proof) |
| SSH key you added | strip your line | `ssh -o BatchMode=yes` → denied |
| `/etc/hosts` vhost lines | delete the line | `grep <target> /etc/hosts` → nothing |
| files in `/tmp` scratchpad | copy to `evidence/` | `/tmp` is destroyed without warning |

Remove your own root access **last** — you need it to clean up everything else.

---

*Sources: `walkthrough/LESSONS.md`, `docs/0xb0b-writeups-playbook.md`, `content/pt1-course/`. Keep this
growing — every box you do, add the tell that would've saved you an hour.*
