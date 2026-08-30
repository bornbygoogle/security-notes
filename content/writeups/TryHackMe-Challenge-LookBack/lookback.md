# TryHackMe — LookBack (Exchange ProxyShell)

**Flags are redacted here.** Every command, payload, offset and dead end is intact; only the flag
strings are replaced with `Flag{[redacted]}`. The flag proves you were there — it teaches nothing,
and publishing it just hands the room's answer to the next person.

> *"The Lookback company has just started the integration with Active Directory. Due to the coming
> deadline, the system integrator had to rush the deployment of the environment. Can you spot any
> vulnerabilities?"*
>
> *"Sometimes to move forward, we have to go backward. So if you get stuck, try to look back!"*

Three flags to find: a **service user** flag, a **user** flag, and a **root** flag.

The short version: the box is a Microsoft Exchange 2019 server that was never patched, so it is
vulnerable to **ProxyShell** — a pre-authentication chain that gives remote code execution as the
most powerful account on the machine. The same rushed deployment also left a debug "log analyzer"
web app running with the password `admin`/`admin`. Either flaw alone owns the box.

The long version explains what Exchange is, what each of the three CVEs actually does, why the first
web shell came back as garbage, and the one filter mistake that hid the third flag for far too long.

---

## 1. Recon — what is even open?

The task warns the machine does not answer **ping**. Ping uses ICMP, a different protocol from the
TCP that applications talk over, and Windows blocks ICMP by default — so "no ping reply" tells you
nothing about whether the box is up. The real test is to try opening a TCP connection. `bash` can do
that with no tools at all:

```bash
IP=10.129.134.26
for p in 53 88 135 139 389 445 3389 5985; do
  timeout 4 bash -c "echo > /dev/tcp/$IP/$p" 2>/dev/null && echo "OPEN $p" || echo "closed $p"
done
```

- A **port** is a numbered door; each service listens on its own number. These eight are what a
  Windows **Domain Controller** (the server running Active Directory) normally exposes.
- `echo > /dev/tcp/$IP/$p` — bash opens a TCP connection; success means something is listening.

Only **3389** answered. The box is alive but the usual Active Directory ports are shut. Now the full
scan:

```bash
nmap -sT -Pn -p- -T4 --open -oN nmap-allports.txt 10.129.134.26
```

- `-sT` — **TCP connect scan**. The faster default (`-sS`) forges packets and needs root; on a box
  without passwordless `sudo` it just dies, so use `-sT`, which makes ordinary connections.
- `-Pn` — don't ping first (this host never replies to ping).
- `-p-` — all 65,535 ports. `--open` — only show open ones.

Three ports, total:

```
80/tcp   open  http     Microsoft IIS httpd 10.0
443/tcp  open  https
3389/tcp open  ms-wbt-server (RDP)
```

**This changes the plan.** There is no SMB, no LDAP, no Kerberos to attack from outside — only a web
server and remote desktop. So the way in is the web server.

## 2. Fingerprint the web server

Fetch both web roots (`-i` shows headers, `-k` accepts the self-signed certificate):

```bash
curl -sS -i    http://10.129.134.26/     # 403 Forbidden, empty
curl -sS -i -k https://10.129.134.26/     # 302 -> /owa/ , header: x-feserver: WIN-12OUO7A66M7
```

`/owa/` is **Outlook Web Access** and `x-feserver` ("front-end server") is a header only **Microsoft
Exchange** emits. This is a mail server — and Exchange has a famous history of pre-authentication
remote code execution. Before RDP even shows a login it also volunteers, over its NTLM handshake, who
it is:

```bash
nmap -sT -Pn -p3389 --script rdp-ntlm-info 10.129.134.26
#   NetBIOS_Domain_Name: THM
#   DNS_Computer_Name: WIN-12OUO7A66M7.thm.local
```

The domain is **`thm.local`** and the computer is **`WIN-12OUO7A66M7`** — the *default* name Windows
generates when nobody types one in. A real production server is essentially never left with that
name. First hard sign of the "rushed deployment" from the brief.

## 3. Which Exchange build? (this decides everything)

Exchange exploits are build-number specific — a chain that works on one update is patched in the
next. Two unauthenticated endpoints leak the number. The OWA logon page has the first three parts:

```bash
curl -sS -k "https://10.129.134.26/owa/auth/logon.aspx?url=...&reason=0" -o owa-logon.html
grep -oE '/owa/auth/[0-9.]+/' owa-logon.html      # -> /owa/auth/15.2.858/
```

The ClickOnce manifest for the eDiscovery export tool leaks the full number, no login needed:

```bash
curl -sS -k ".../ecp/Current/exporttool/microsoft.exchange.ediscovery.exporttool.application" \
  -o exporttool.application
grep -oE 'version="[0-9.]+"' exporttool.application  # -> version="15.2.858.2"
```

**Build `15.2.858.2`** = Exchange 2019 **CU9** (CU8 was 15.2.792), base cumulative update with **no
security update** on top. That matters:

| Fix | Patched at | Is 858.2 vulnerable? |
|---|---|---|
| ProxyLogon (CVE-2021-26855) | 15.2.858.5 | **Yes** (858.2 < 858.5) |
| ProxyShell (CVE-2021-34473 / 34523 / 31207) | 15.2.858.15 | **Yes** (858.2 < 858.15) |

So the "rushed deployment" is concrete: Exchange 2019 CU9 was stood up and never given a single
security update. dev's own `TODO.txt`, found later, literally lists *"Install the Security Update for
MS Exchange [TO BE DONE]"*.

**Chosen exploit: ProxyShell**, a pre-authentication chain of three bugs:

- **CVE-2021-34473** — a URL-rewrite confusion in Autodiscover lets an unauthenticated request reach
  the internal **PowerShell back end** as if it were already authenticated (a Server-Side Request
  Forgery, SSRF — making the server send a request on your behalf to somewhere you cannot reach).
- **CVE-2021-34523** — the smuggled request runs with the powers of the Exchange service context.
- **CVE-2021-31207** — `New-MailboxExportRequest` writes a "mailbox export" to any path with any
  extension; point it at the web root with an `.aspx` name and web-shell content inside.

## 4. Firing ProxyShell with a web shell instead of a callback

Metasploit's `exchange_proxyshell_rce` confirms the target vulnerable, but its default payload is a
**reverse** shell — the target connects *back* to me. I chose not to depend on a callback at all and
drove an **HTTPS web shell I fetch myself** instead. An outbound, same-origin channel is the cleaner
option here: its success signal comes back through a channel I already control, with no dependency on
inbound reachability, my host firewall, or the target's egress rules. (A *bind* shell would fail
regardless, since only 80/443/3389 are reachable on the target.)

> A note on rigour, because the mistake is instructive: I first justified the web shell by claiming
> my host firewall "drops every callback." That was an **unverified inference** — I had only read the
> `ufw` *default* input policy (`deny incoming`). Listing the actual rules (`ufw status verbose`)
> told a different story: the default is deny, but there are explicit `ALLOW IN` rules for
> `80/tcp on tun0` and `31400–31409/tcp`. So a reverse shell to my VPN IP on **port 80** (the usual
> TryHackMe port) would have worked — only an arbitrary port like `4444` would have been dropped.
> The default policy is not the verdict; the allow rules are. The web-shell choice stands on its own
> merits (no inbound dependency at all); the firewall rationale did not.

I drove the chain from Python (on top of `dmaasland`'s `proxyshell-poc`). The pieces:

1. **SSRF + forged identity.** Autodiscover leaks the mailbox `LegacyDN`; the MAPI endpoint turns it
   into the account's **SID**. `Administrator@thm.local` returns a SID ending in **-500** — the
   built-in domain administrator. With that SID I forge an `X-Rps-CAT` token whose group list
   contains `S-1-5-32-544` (local Administrators), so the PowerShell back end treats me as admin.

2. **Write the web shell.** The Exchange PowerShell runspace is **restricted** — Exchange cmdlets
   only, no `Get-Content`, no variables. But `New-MailboxExportRequest` exports a mailbox to a file
   at any path. So: create a **draft email** whose attachment body is web-shell code, then export
   just the Drafts folder to
   `...\FrontEnd\HttpProxy\owa\auth\<name>.aspx`. IIS serves that file and runs the
   `<script runat="server">` block inside it. The draft is created over **EWS**
   (`/ews/exchange.asmx`) with a `SerializedSecurityContext` carrying the SID, reached through the
   same SSRF.

3. **The PST encoding trap.** My first export wrote the `.aspx`, but requesting it returned **raw
   binary** starting `!BDN` — the magic bytes of a PST file — instead of running. Cause: Exchange
   stores PST data under a "compressible encryption" permute cipher, so the literal `<script>` bytes
   were scrambled and ASP.NET never found a script block. The fix is to **pre-encode** the payload
   with the inverse 256-byte permute table, so that after Exchange permutes it, it lands as
   plaintext. With that applied:

   ```
   GET /owa/auth/<shell>.aspx?<param>=whoami   ->   nt authority\system
   ```

**Remote code execution as `NT AUTHORITY\SYSTEM`.** (The response appends leftover PST bytes after
the command output, so wrap each command as `echo S..S& <cmd> & echo E..E` and read between the
markers; for quotes/pipes use `powershell -enc <base64-UTF16LE>` over POST, since GET hits the IIS
URL-length cap.)

## 5. The three flags

The host is both the Exchange server and the Domain Controller
(`whoami /fqdn` → `...,OU=Domain Controllers,DC=thm,DC=local`), and I am SYSTEM, so every file is
readable.

**Root flag** — `C:\Users\Administrator\Documents\flag.txt`:

```
Flag{[redacted]}
```

**User flag** — `C:\Users\dev\Desktop\user.txt`, next to a `TODO.txt` that is the whole story:
*"Remove the log analyzer [TO BE DONE]"*, *"Install the Security Update for MS Exchange [TO BE
DONE]"*, *"Setup LAPS [TO BE DONE]"*:

```
Flag{[redacted]}
```

**Service user flag** — this one hid, and the hunt is the lesson. A full-disk content search for
`THM{` in text files returned only the two flags above. It missed the third because my extension
filter did not include `.aspx`. (When a filter finds nothing, suspect the filter before the target.)
The find came from enumerating IIS instead:

```bash
# app-pool identity — stored in cleartext because the app pool runs as a specific user
appcmd list apppool DefaultAppPool /text:*
#   identityType:"SpecificUser"  userName:"admin"  password:"admin"

# the sites and their folders on disk
appcmd list site /config /xml
#   <application path="/test" applicationPool="DefaultAppPool">
#     <virtualDirectory path="/" physicalPath="C:\inetpub\wwwroot\devel" />
```

There is a custom app at **`/test`** (folder `C:\inetpub\wwwroot\devel`) whose app pool runs as the
local user **`admin`** with the password **`admin`**, stored in cleartext in
`applicationHost.config`. The app is `default.aspx`, a "**LOG ANALYZER**" — exactly the *"Remove the
log analyzer"* line in dev's TODO — and the flag is printed right on the page:

```html
<asp:Label id="L_f" ...>Flag{[redacted]}</asp:Label>
<asp:Label id="L_flag" ...>LOG ANALYZER</asp:Label>
...
myProcessStartInfo.Arguments = "Get-Content('C:\" & xlog.text & "')"
```

`admin` is the **service user**, so this is the service user flag. Confirmed the intended way —
`GET /test/default.aspx` with HTTP Basic auth `admin:admin` returns `200` and renders it:

```
Flag{[redacted]}
```

## 6. The intended path, and the "look back" hint

I went straight to SYSTEM with ProxyShell and read all three flags. The room's *designed* path climbs
from small to big, and it is what the "**look back**" hint points at:

1. **Service user** — find `/test`, log in `admin:admin`, read the service user flag off the LOG
   ANALYZER page.
2. **User** — the LOG ANALYZER runs `Get-Content('C:\' + <your input>)` with no sanitisation. Feed it
   `..\..\Users\dev\Desktop\user.txt` — literally **looking *back* up the directory tree**, the hint
   — to read the user flag, and a crafted input turns the file-read into command execution as
   `admin`.
3. **Root** — the `admin` app-pool identity holds `SeImpersonatePrivilege`, so a "Potato" token
   impersonation attack elevates to SYSTEM / Administrator and the root flag.

Both routes are the same root cause the brief names: a rushed deployment with an unpatched Exchange
(ProxyShell) **and** a debug web app left on with hardcoded `admin:admin`.

## 7. What the defender should have done

- **Patch Exchange.** 858.2 → 858.15 or later closes ProxyShell and ProxyLogon. This one fix removes
  the pre-auth RCE entirely.
- **Never run an app pool as a real user with a weak, cleartext password.** Use a managed service
  account, or `ApplicationPoolIdentity`, and never `admin`/`admin`.
- **Remove debug apps before production.** The LOG ANALYZER page even says so:
  *"This interface should be removed on production!"*
- **Sanitise input.** `Get-Content('C:\' + userInput)` with no validation is both a path traversal
  and a command-execution primitive.
- **Rename the machine, apply LAPS, restrict OWA/ECP exposure.** Every item on dev's TODO was a real
  control left switched off.

---

### Teardown

Both ASPX web shells were removed and confirmed gone (the URL now returns **404**); the two mailbox
export requests and the draft emails I created were deleted; the temp files were removed; the `nmap`
and metasploit processes were stopped and verified with `pgrep`. The `admin:admin` app-pool
credential and the `/test` app are the room's own weaknesses and were left as found.
