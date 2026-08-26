---
description: "TryHackMe CheckMate — five levels, five different password attacks: vendor defaults, contextual keywords, an OSINT wordlist, a SHA256 preimage, and a rule-based list against SSH. Includes the auth bypass that made three of them moot, and the 325,000 wrong guesses that came before the right tool."
---

# CheckMate — five ways to break a password, and one way to skip them all

**TryHackMe · room: CheckMate ("Operation Checkmate") · target: `10.128.134.177`**

> **All five passwords are redacted here** as `[redacted]`. They are the room's five submitted
> answers and nothing else — pure prize. Every command, wordlist, config value, tool flag, error
> message and wrong turn is intact, because those are what teach.
>
> **What I deliberately kept, and why:** the usernames, Marco's leaked personal details (`marky`,
> `14021995`), the company keyword list, the SHA256 hash of the avatar filename, Marco's published
> password rule, the cookie names, and the *shape* of the level 3 answer. Those are method. The hash
> is the puzzle, not the solution — you can crack it yourself in ten seconds, which is the point of
> the level. The bypass cookie is a real vulnerability that belongs in any honest report.
>
> **One honest caveat:** levels 1 and 2 are solved from *candidate lists* — 22 documented vendor
> defaults, and seven keywords printed on the target's own homepage. Those lists are the entire
> technique, so they stay in full, which means each necessarily *contains* its answer. Censoring
> one entry out of a standard default-credentials list would teach nothing and fool no one. You
> still have to run them against the box to know which one it is — which is the exercise.

Marco Bianchi is a sysadmin who deployed four services under deadline pressure and reused weak,
predictable passwords across all of them. The room walks you through five *different classes* of
password attack, in order. That structure is the real content:

| Level | Attack class | What it teaches |
|---|---|---|
| 1 | Default credentials | The vendor's password, never changed. No cracking at all. |
| 2 | Contextual keywords | A wordlist built from the target's own vocabulary. |
| 3 | OSINT / profiling | Personal details mechanically expanded into candidates. |
| 4 | Hash preimage | A hash of a small, human-chosen input is not a secret. |
| 5 | Rule-based generation | Knowing the *pattern* beats having a bigger list. |

**Written for a beginner.** If you have never run `nmap`, never seen an HTTP cookie and do not know
what a hash is, this is for you. Every flag gets explained. The wrong turns stay in — there are
three, and the third one cost about 325,000 failed guesses and is by far the most useful thing here.

---

## Recon

### What is on the box

```bash
nmap -sT -p- -T4 -Pn --open -oN nmap-full-tcp.txt 10.128.134.177
```

A **port** is a numbered door on a machine; the program listening behind one is a **service**. There
are 65535 TCP ports.

- `-sT` — TCP connect scan, completing a normal connection to each port. The faster `-sS` needs root,
  which this session did not have.
- `-p-` — scan **all** 65535, not nmap's default top-1000.
- `-T4` — aggressive timing, fine on a lab VM.
- `-Pn` — skip host discovery; `ping` already proved it was up.
- `--open` — hide the 65530 closed ports.
- `-oN file` — save the output as evidence while it is produced.

```
22/tcp   open  ssh
5000/tcp open  upnp
5001/tcp open  commplex-link
5002/tcp open  rfe
5003/tcp open  filemaker
```

**Those service names are wrong, and it matters that you know why.** Without `-sV`, nmap does not ask
the service what it is — it prints whatever `/usr/share/nmap/nmap-services` says *usually* sits on
that port number. Port 5003 is registered to FileMaker, so nmap guesses "filemaker". There is no
FileMaker here. **A port number is a label, not an identification.**

```bash
nmap -sT -sV -p22,5000,5001,5002,5003 -Pn -oN nmap-services.txt 10.128.134.177
```

`-sV` probes each service and fingerprints it properly:

```
22/tcp   OpenSSH 9.6p1 Ubuntu
5000/tcp Werkzeug httpd 3.1.6 (Python 3.12.3)
5001/tcp Werkzeug httpd 3.1.6 (Python 3.12.3)
5002/tcp Werkzeug httpd 3.1.6 (Python 3.12.3)
5003/tcp Werkzeug httpd 3.1.6 (Python 3.12.3)
```

**Werkzeug** is the library Flask (a Python web framework) uses for its development server. So: four
separate Flask apps plus SSH — matching the brief's "console, employee portal, social platform, and
access to critical infrastructure".

### The front page hands over the whole room

```bash
curl -sS -i http://10.128.134.177:5000/ -o 5000-root.html -w 'status=%{http_code} bytes=%{size_download}\n'
```

`-sS` is "silent, but still show errors" — plain `-s` hides failures too, which makes a request that
never left your machine look identical to one that returned nothing. `-i` includes response headers.

8519 bytes, and the entire challenge is described in it — including an inline `<script>` at the
bottom. **Read the client-side JavaScript first; it documents the back-end.** Here it gives up the
API in five lines:

```javascript
fetch("/check",{
  method:"POST",
  headers:{"Content-Type":"application/json"},
  body:JSON.stringify({ level:level, password:document.getElementById("input"+level).value })
})
```

So scoring is `POST /check` with JSON `{level, password}`, and `GET /state` returns progress. The JS
tests success with `data.message.includes("Granted")` and rate-limiting with `.includes("Too many")`.

The page also states the rules:

> Focus on the intended techniques and clues provided throughout the room. **Blind brute-forcing
> against this main application on port 5000 is out of scope** and may trigger a temporary cooldown.

Taken seriously throughout: **port 5000 is the answer box, not a target.** I only ever submitted
passwords I had already recovered elsewhere, or a small number of specifically *derived* hypotheses.
Ports 5001–5003 and SSH are the actual targets.

A note on the cookie jar, needed from here on:

```bash
curl -c session.txt -b session.txt ...
```

`-c` **saves** cookies to a file, `-b` **sends** them. Progress lives server-side against a session,
so without this the server sees a new anonymous visitor on every request and progress never advances.

---

## Level 1 — default credentials

> "Marco deployed a firewall at firewall.thm:5001 but kept default credentials."

Port 5001 is "FirewallOS — Sign in", a form posting `username` and `password` to `/login`. The
username field's placeholder is `admin` — a hint left in the markup.

### First, learn what failure looks like

This is the step people skip, and skipping it is how you stare at responses unable to tell which one
is different.

```bash
curl -sS -i -X POST http://10.128.134.177:5001/login \
     -d "username=admin&password=ZZdefinitely-not-the-password-9931"
```

`-d` supplies form fields. The password is deliberate nonsense — nobody's default is that.

```
status=200, 3129 bytes
<div class="alert alert-danger py-2 small mb-3">Invalid credentials.</div>
```

**Failure = HTTP 200, 3129 bytes, the string `Invalid credentials.`** Everything from here is
measured against that baseline.

### Then try the documented defaults

"Default credentials" are what a device ships with from the factory — printed in the vendor's manual,
published online, identical on every unit. They are meant to be changed on first login. Very often
they are not.

This is **not** brute forcing. It is a short list of documented facts:

```
admin:admin      admin:password   admin:admin123   admin:1234     admin:12345
admin:123456     admin:changeme   admin:default    admin:firewall admin:pfsense
admin:cisco      admin:fortinet   admin:sonicwall  admin:letmein  admin:secret
admin:root       admin:firewallos admin:Password1  root:root      root:admin
root:toor        administrator:administrator
```

22 pairs, tested with a loop that reports only status code, size and whether the failure string was
present — comparing against the baseline instead of eyeballing HTML:

```bash
while IFS=: read -r u p; do
  resp=$(curl -sS -X POST http://10.128.134.177:5001/login -d "username=$u&password=$p" \
         -w '\n__CODE__%{http_code}__SIZE__%{size_download}')
  ...
done < defaults.txt
```

```
admin  admin       code=200 size=3129  invalid
admin  password    code=200 size=3129  invalid
admin  changeme    code=200 size=3129  invalid
admin  [redacted]  code=302 size=189   >>> DIFFERENT <<<
...   (all 21 others: 200 / 3129 / invalid)
```

(The winning pair is shown out of list order here so the redaction actually holds — in the real run
it sat among the others.)

**One line differs, and in the way a success should.** HTTP **302** is a redirect — the server saying
"you're done here, go elsewhere". A login form that returns 200 with the form still on it has not
logged you in; one that redirects you away has. The 189-byte body is just Flask's "Redirecting…"
boilerplate. The real content is in the headers:

```
Location: /
Set-Cookie: fw_authed=1; HttpOnly; Path=/
```

**Remember that cookie value. It is the whole game later.**

Following the redirect with the cookie gives "FirewallOS — Dashboard":

```
Appliance: FW-EDGE-01 • Policy set: Marco_Default
Welcome Marco! Firewall is operational.

System Messages
  Deployment  2h ago — "Initial deployment completed with default admin credentials."
  Reminder    1h ago — "Secure internal employee portal next."
```

The box confirms the finding in its own words and points at the next level.

**Level 1 answer: `[redacted]`, with `admin` as the username** — one of the 22 documented default pairs above.

---

## Level 2 — the company's own vocabulary

> "Marco built an internal Employee Login panel on jobs.thm:5002 and used common company keywords."

Port 5002 is "Engineering Careers" for *MHT Labs*, with an **Employee Login** link to `/login` whose
username placeholder is `marco`.

### The wordlist is printed on the page

```
Build the future with Engineering
Innovation. Excellence. Security. Digital transformation. Cloud-first teams.

[innovation] [excellence] [security] [digital] [cloud] [future] [talent]
```

Seven words, rendered as badges. **That is the wordlist.** This is what "common company keywords"
means — not `rockyou.txt`, but the organisation's own slogans, product names and departments. A
targeted list of seven beats fourteen million generic entries, because the target picked their
password from *this* vocabulary.

Baseline first (200, 2310 bytes, `Invalid credentials.`), then the seven words in lower case and
capitalised — 14 requests:

```
innovation     code=200 size=2310   invalid
security       code=200 size=2310   invalid
digital        code=200 size=2310   invalid
[redacted]     code=302 size=203    >>> DIFFERENT <<<
[Redacted]     code=200 size=2310   invalid     <-- the SAME word capitalised FAILS
```

(Again reordered so the redaction holds.)

The capitalised form of the winning word **fails**. Passwords are case-sensitive and this app does
not normalise — worth knowing before generating variants later.

```
Location: /profile
Set-Cookie: jobs_authed=1; HttpOnly; Path=/
```

**Level 2 answer: `[redacted]` — one of the badge words, lower case.**

### The real prize is `/profile`

```
Marco Bianchi — IT Operations — Active employee

Employee Details
  First Name            Marco
  Surname               Bianchi
  Nickname              marky
  Birthdate (DDMMYYYY)  14021995
```

An HR portal handing a staff member's nickname and date of birth to anyone who guesses a seven-word
password. That is the actual vulnerability, and it is extremely realistic. Note the label spells out
the format — **DDMMYYYY**, so 14 February 1995.

This is the raw material for level 3.

---

## Level 3 — OSINT profiling (and 325,000 wrong guesses)

> "Navigate to social.thm:5003 and derive Marco's password from personal info."

The social login page states the method itself: *"Hint: Use the details from jobs.thm to generate
Marco's password."* Baseline: 200, 3101 bytes, `Invalid credentials.`

I will tell this in the order it happened, because the order is the lesson.

### Attempt 1 — 324 candidates

```python
bases = ["marky","Marky","MARKY","marco","Marco","bianchi","Bianchi","marcobianchi","MarcoBianchi"]
dates = ["14021995","1402","1995","95","140295","19951402"]
seps  = ["","_","."," ","@","-"]
```

324 combinations, all with `username=marco`. **Every one rejected.**

### Wrong turn #1 — sweeping one axis with the other frozen

I had covered the *password* space. I had not touched the *username* space — I held `marco` constant
through all 324 attempts without ever testing it. The field says **"Email or username"**, and this is
a social platform, where people use handles.

**With two unknowns, a negative result over one axis is meaningless while the other is an untested
assumption.** Sweep the matrix, not the line.

Could the app tell me the username? No — and that is good security on its part:

```
marco / marky / marco.bianchi / marco@social.thm / mbianchi / admin / nonexistentuser99
→ all identical: 200, 3101 bytes, "Invalid credentials."
```

An app that answers identically for a nonsense username is correctly refusing to leak which accounts
exist. (**Username enumeration** is when "no such user" and "wrong password" look different — it lets
an attacker build a valid user list for free.) So I had to search both axes at once:

```bash
hydra -L users.txt -P candidates.txt 10.128.134.177 -s 5003 \
      http-post-form "/login:username=^USER^&password=^PASS^:Invalid credentials." -t 16 -f
```

The `http-post-form` argument is dense and is the part people get wrong. Three colon-separated fields:

1. **`/login`** — the path to POST to.
2. **`username=^USER^&password=^PASS^`** — the POST body. `^USER^` and `^PASS^` are the placeholders
   hydra substitutes. These names must match the form's real `name=` attributes.
3. **`Invalid credentials.`** — the **failure condition**. If this string is in the response, the
   attempt counts as a failure; anything without it is reported as a hit.

That third field is why the known-bad baseline mattered: it *is* the detection mechanism.

2,268 attempts. Nothing.

### Proving the tool works before believing the zero

An empty result from an unverified tool is worthless. I had a **known-good credential** on port 5002,
so I ran it through the identical module and failure string:

```bash
hydra -l marco -p [level-2-password] 10.128.134.177 -s 5002 \
      http-post-form "/login:username=^USER^&password=^PASS^:Invalid credentials." -t 4
→ 1 valid password found
```

The instrument works. So the zero on 5003 is a real negative — my *generation* is wrong, not my
tooling. That distinction cost one command and shaped everything after it.

### Attempts 3 through 8 — bigger and bigger lists

| Attempt | Method | Candidates | Result |
|---|---|---|---|
| 3 | attempt-1 list through `john --rules=best64` | 17,741 | 0 |
| 4 | company keyword × date fragment | 15,876 | 0 |
| 5 | my own CUPP-style date-fragment expansion | 23,541 | 0 |
| 6 | wide token set (company, job title, Valentine's Day, zodiac) | 60,237 | 0 |
| 7 | exhaustive name × 18 fragments × 8 separators × 16 suffixes | 140,368 | 0 |
| 8 | camelCase forms | 9,101 | 0 |

A note on attempt 3, because rule-based generation is a genuinely useful technique:

```bash
john --wordlist=candidates.txt --rules=best64 --stdout | sort -u > mangled.txt
```

A **rule** is a scripted transformation applied to every word: append a digit, capitalise, add `!`,
reverse it. `best64` is a well-known set of 64 such rules. `--stdout` prints the results instead of
cracking anything — john as a wordlist generator.

And I sized every run before starting it:

```
-t 16 : 200 tries in 5s = 40/sec
-t 48 : 200 tries in 3s = 66/sec       (~6,600/min once warm)
```

**Read the throughput and multiply out the finish time before walking away from a brute force.**
"It's running" is not "it will finish."

### Wrong turn #2 — an oracle aimed at the wrong directory

Meanwhile I tried to solve level 4 without logging in. Static files give a free **oracle** — a
yes/no answer from the server. Guess a filename, hash it, request `/static/<hash>.png`, and let the
404 or 200 tell you whether it exists. I verified the oracle honestly first:

```
/static/bootstrap.min.css              → 200
/static/definitely-not-here-8811.png   → 404
```

Then tested 1,323 candidate filenames. Zero hits, zero network errors.

**The oracle was sound. The directory was wrong.** Avatars live under `/uploads/`, which I only
learned later. Every one of those requests asked a perfectly-formed question about the wrong place.

**A working oracle proves your mechanism, never your assumption about where to point it.** And note
what did *not* help: `/static/uploads/` returned 404, which is not evidence either way — a directory
with listing disabled returns 404 whether or not files sit inside it.

### The breakthrough — forging the session cookie

After roughly 115,000 rejected guesses I stopped adding words and went back to the premise under all
of them: **that the only way past the login is the password.**

The evidence against it was already in my notes. Both apps I had beaten issued this:

```
Set-Cookie: fw_authed=1;   HttpOnly; Path=/     (firewall, 5001)
Set-Cookie: jobs_authed=1; HttpOnly; Path=/     (jobs,     5002)
```

Look at the *value*. Not a signed token, not a random session ID — the literal character `1`. The
server is not remembering who logged in; it is trusting the browser to tell it. And **a cookie is
client-controlled data** — I can send any cookie I like without ever visiting a login form.

If the third app follows the convention, its cookie is `social_authed=1`:

```bash
curl -sS -H "Cookie: social_authed=1" http://10.128.134.177:5003/
→ 200, 9171 bytes        (the login page is 3004 bytes)
```

**Authentication bypass. No password.** Marco's full feed, profile and posts.

I confirmed the cookie name was the real check rather than a catch-all by testing four alternatives
— `authed=1`, `social_auth=1`, `logged_in=1`, `socialthm_authed=1` — all returned the login page.
Only `social_authed=1` worked.

**Why this is a genuine finding, not a trick:** a session cookie must be unguessable and
integrity-protected. Flask ships signed sessions (`flask.session`) for free; these apps invented a
flag any visitor can set, which makes the password decorative. This is **CWE-565, "Reliance on
Cookies without Validation and Integrity Checking"**, and it is the most serious vulnerability on the
box. In a real report it outranks all five weak passwords, because it defeats authentication
entirely rather than merely making it cheap to guess.

The feed contained levels 4 and 5 — the page's own HTML comments label them:

```html
<!-- Post: Password Rule Hint (Level 5) -->
<!-- Post: Profile picture stored filename (Level 4) -->
```

It also confirmed Marco's handle is **`@marco`** — so `marco` was the right username all along, and
the username axis had never been the problem.

### Wrong turn #3 — five wordlists, one unexamined *shape*

Even with the feed open, level 3's password still had to be found. Attempts 6, 7 and 8 all failed.
The tally: **~325,000 candidates across eight hand-built lists, zero hits.**

The assumption under every one of them: that a password derived from a name and a birthdate looks
like `base + ONE fragment + optional suffix`. I varied tokens, separators, case, suffixes and
ordering — but never the *shape*. I was searching a space that did not contain the answer, faster
and faster each time.

So I stopped generating and fetched the tool the room was pointing at all along. **CUPP** (Common
User Passwords Profiler) is the standard tool for turning personal details into a wordlist. It is not
installed on this machine and I had no `sudo` to install it, but it is a single Python file:

```bash
curl -sS -o cupp.py  https://raw.githubusercontent.com/Mebus/cupp/master/cupp.py
curl -sS -o cupp.cfg https://raw.githubusercontent.com/Mebus/cupp/master/cupp.cfg
```

**Read `cupp.cfg` before running it** — the tool documents its own limits:

```ini
[nums]      from=0  to=100      # numbers appended to every word
wcfrom=5    wcto=12             # DISCARD anything shorter than 5 or longer than 12 characters
[leet]      a=4 i=1 e=3 t=7 o=0 s=5 g=9 z=2
[specialchars] chars=!,@,'#',$,%%,&,*
```

`wcto=12` is quietly devastating. The single most "obvious" candidate — nickname plus full birthdate
— is **13 characters**, so real cupp never emits it. The first thing I tried by hand is a thing the
standard tool would never suggest.

Run it non-interactively by piping answers to its prompts:

```bash
printf 'marco\nbianchi\nmarky\n14021995\n\n\n\n\n\n\n\nmhtlabs\ny\nsecurity,excellence,innovation,digital,cloud,future,talent\ny\ny\ny\ny\n' \
  | python3 cupp.py -i
```

The blank lines are partner/child/pet fields I had no data for; the trailing `y`s enable special
characters, random numbers and leet mode. Output: **28,307 candidates** — the *smallest* list I ran
after the first two.

```bash
hydra -l marco -P marco.txt 10.128.134.177 -s 5003 \
      http-post-form "/login:username=^USER^&password=^PASS^:Invalid credentials." -t 48 -f
→ [5003][http-post-form] login: marco   password: [redacted]
```

**Why cupp found it and 325,000 of my candidates did not.** Look at what it generates around the
answer:

```
Bianchi24        <- surname + a number from the 0..100 pool
Bianchi2402      <- ...then a birthdate fragment glued straight onto that
Bianchi2414
Bianchi24[..]    <- the answer: TWO numeric fragments concatenated after the word
```

**Two fragments, back to back.** My templates all had exactly one slot for a number. No quantity of
extra tokens would ever have produced this shape — the answer was structurally outside my search
space, and every bigger list was a faster way of not finding it.

**The rule I took away: when a generated wordlist fails repeatedly, stop adding tokens and go read
what the standard tool actually generates.** cupp exists because someone already enumerated the
shapes humans use. Re-implementing it from memory reproduced *my* assumptions instead of the tool's
coverage. The five-minute check that would have caught this: run the real tool and diff its output
against mine.

A smaller, invisible lesson from attempt 8: Python's `str.capitalize()` **lowercases the rest of the
string**, so `"marcobianchi".capitalize()` is `Marcobianchi` — never `MarcoBianchi`. My generator
could not emit camelCase at all and never said so. **A generator's blind spots do not announce
themselves.**

### Verifying the hit, with a control

A hydra hit can be a false positive: a rate-limit page or an error page contains no
`Invalid credentials.` either, and would be reported as success. So — by hand, plus a deliberate
near-miss one digit away:

```
marco / [redacted]        → 302, Location: /, Set-Cookie: social_authed=1
marco / [redacted+1]      → 200, "Invalid credentials."
```

Opposite outcomes one character apart. That rules out "the app started saying yes to everything".

**Level 3 answer: `[redacted]` — surname, capitalised, followed by two concatenated numeric
fragments (a small number and the two-digit birth year).**

### The three controls that kept 325,000 negatives honest

Through all of it I never concluded "the tool is broken", "the app is locked", or "the password does
not exist" without testing it:

1. **Positive control on a known-good credential** (level 2's, on port 5002) through the identical
   hydra module → found. The tool and syntax are correct.
2. **Inverted control on the actual target** — hydra against 5003 with a failure string that can
   never appear (`ZZZNEVERAPPEARSZZZ`) → every attempt reported as a hit. This proved hydra was truly
   parsing *5003's* responses, which control 1 could not, because it ran against a different app.
3. **Post-run baseline** after each sweep → still `200 / 3101 / "Invalid credentials."`, identical to
   before, so no silent lockout had swallowed the run.

Control 2 is the one that mattered and the one I nearly skipped, because control 1 felt like enough.
*A control that only tests negatives cannot detect a filter that eats positives.*

---

## Level 4 — reversing a hash of a filename

> "The platform automatically renames uploaded files to the SHA256 hash of the original filename and
> saves them as (SHA256).png. Identify the original filename."

From the feed's HTML:

```html
<img class="avatar-img" src="/uploads/d34a569ab7aaa54dacd715ae64953455d86b768846cd0085ef4e9e7471489b7b.png">
```

A **hash** is a one-way function: trivial to compute forwards, infeasible to reverse. You cannot
"decrypt" that string. What you *can* do is guess candidate inputs, hash each, and compare — and that
works here because the space of names people give photos is tiny and human-chosen.

```bash
echo d34a569ab7aaa54dacd715ae64953455d86b768846cd0085ef4e9e7471489b7b > hash.txt
hashcat -m 1400 -a 0 hash.txt rockyou.txt -r ext.rule -O
```

- `-m 1400` — hash type SHA2-256.
- `-a 0` — straight wordlist attack.
- `-r ext.rule` — my rule file: each word unchanged, and with `.png`, `.jpg`, `.jpeg`, `.gif`
  appended, plus capitalised and upper-case forms. The task says the *original filename* was hashed
  and it was not obvious whether that included an extension, so I covered both.
- `-O` — optimised kernels.

`rockyou.txt` is the standard wordlist: 14,344,399 real passwords from a 2009 breach. On Kali it
ships gzipped and needs `gunzip -k /usr/share/wordlists/rockyou.txt.gz` first.

```
Status...........: Cracked
Speed.#01........: 478.0 kH/s
d34a569a...89b7b:[redacted]
```

Verified independently rather than trusting the tool:

```bash
$ printf '%s' "[redacted]" | sha256sum
d34a569ab7aaa54dacd715ae64953455d86b768846cd0085ef4e9e7471489b7b  -
```

Byte-for-byte match with the filename on the server.

**Level 4 answer: `[redacted]` — a single common English word, no extension.** It is a `rockyou`
entry, which is exactly why a wordlist found it and my 1,323 hand-written guesses (`profile`,
`avatar`, `selfie`, `IMG_0001`…) never would have, even aimed at the right directory.

**The lesson: hashing a filename is not privacy.** If the input space is small and human-chosen, the
hash is reversible in practice. The same failure sinks "anonymised" email addresses, phone numbers
and postcodes — there are only so many of them, and you can hash them all.

---

## Level 5 — rule-based generation against SSH

> "Marco has revealed his password pattern on social.thm:5003... generate a targeted wordlist and
> brute-force the SSH service with username marco."

Marco's public post:

> My tip for strong passsord: I take a **company keyword**, **capitalize** it, then append the
> **year** like 2024 or any other number and an **exclamation mark**.
>
> `security` `excellence` `innovation` `digital` `cloud`

He has published his own password *generation rule* and the vocabulary it draws from. So generate
exactly that, rather than reaching for a big list:

```python
kw   = ["security","excellence","innovation","digital","cloud","future","talent"]
nums = [2015..2026] + [0..100] + ["1995","123","1234","12345","007","01","001","000"]
candidates = [f"{k.capitalize()}{n}!" for k in kw for n in nums]      # 861 candidates
```

**861 candidates against `rockyou`'s 14,344,399 — the rule shrinks the search space by a factor of
about 16,000.** At SSH's ~230 attempts per minute that is the difference between four minutes and
fifty days. *That* is the point of the level: knowing the pattern beats having a bigger list.

```bash
hydra -l marco -P pattern.txt -t 16 -f ssh://10.128.134.177
→ [22][ssh] host: 10.128.134.177   login: marco   password: [redacted]
```

It was the 10th candidate. **Level 5 answer: `[redacted]` — a capitalised company keyword, a
four-digit year, and `!`.**

### Why SSH brute force is so much slower than cracking a hash

| | rate | what limits it |
|---|---|---|
| `hashcat` vs the SHA256 (level 4) | **478,000/sec** | my own CPU, nothing else |
| `hydra` vs SSH (level 5) | **~230/min** | the target's crypto handshake and network latency |

Roughly a **125,000× difference**. Every SSH attempt is a TCP connection plus a public-key handshake
across the network, and the target sets the pace. Offline cracking has no network and no rate limit.
This is why a leaked hash is so much worse than it looks — rate limiting and lockout protect the
front door, and none of it applies to a copy of the hash on the attacker's laptop.

### Confirming with a shell

```bash
ssh marco@10.128.134.177
uid=1001(marco) gid=1001(marco) groups=1001(marco),100(users)
tryhackme-2404
```

The four Flask apps are visible, all running as the `ubuntu` user from `/home/ubuntu/lab/`:

```
ubuntu  /usr/bin/python3 social_app.py
ubuntu  /usr/bin/python3 level_app.py
ubuntu  /usr/bin/python3 jobs_app.py
ubuntu  /usr/bin/python3 firewall_app.py
```

I tried to read `level_app.py` — it holds the answer key and would have ended level 3 instantly.
Not possible as `marco`, and I am recording the attempts rather than quietly dropping them:
`/home/ubuntu` is `drwxr-x---` owned by `ubuntu` so the path cannot even be traversed; `marco` has no
`sudo`; `/proc/<pid>/cwd` is unreadable; SUID binaries, file capabilities and cron showed nothing
unusual; `/var/log/cloud-init.log` was world-readable but contained no provisioning detail, and
`user-data.txt` is root-only. I also tested the custom `/uploads/<file>` route for **path traversal**
(`../social_app.py` plus five encoded variants) — Flask's `send_from_directory` correctly rejected
every one. This box simply is not built for privilege escalation, which is the right call for a
password-focused room.

---

## Answers

| Level | Attack class | Answer |
|---|---|---|
| 1 | Default credentials on FirewallOS (`admin` / :5001) | `[redacted]` |
| 2 | Company keyword from the careers page (`marco` / :5002) | `[redacted]` |
| 3 | cupp wordlist from leaked HR details (`marco` / :5003) | `[redacted]` |
| 4 | SHA256 preimage of the avatar filename | `[redacted]` |
| 5 | Rule-based wordlist vs SSH (`marco`) | `[redacted]` |

All five were submitted to the room's `/check` endpoint and returned `Access Granted ✅`; the final
state was `{"progress":6}`.

---

## What was actually wrong here

Ranked by severity, which is *not* the order the room presents them:

1. **Unsigned, guessable session cookies on all three web apps** (`fw_authed=1`, `jobs_authed=1`,
   `social_authed=1`). Anyone can set them; the passwords are decorative. **CWE-565.** Fix: use the
   framework's signed sessions. Flask has them built in.
2. **An HR portal exposing full date of birth and nickname** behind a seven-word password. That data
   is the input to every profiling attack in this room, and it is also regulated personal data. Fix:
   do not expose DOB in an employee directory at all.
3. **Marco publishing his own password-generation rule on social media.** A single post cut the
   search space by ~16,000×. Fix: this is an awareness problem, not a technical one.
4. **Default credentials left on an internet-facing management console.** Fix: force a change at
   first login; never ship a working default.
5. **Passwords drawn from the company's own marketing copy.** Fix: block contextual words in the
   password policy — the company name, product names, slogans.
6. **Hashing a filename and treating it as private.** Fix: use a random identifier, not a hash of
   something guessable.
7. **Password reuse across four systems by one administrator.** Fix: a password manager, and unique
   credentials per system.

Note that the room's five levels are all item 4–7 territory, while the most serious finding — item 1
— is not a level at all. That is realistic: the flashy misconfiguration and the fatal one are rarely
the same thing.

---

## Verification status

- **Platform-confirmed:** all five answers were submitted and accepted by the room's own scorer
  (`Access Granted ✅`, final `progress: 6`). This is stronger than "I found a string that looks
  right" — the room agrees.
- **Verified by direct observation:** every port, every response code and byte count, the auth
  bypass (including four control cookie names that failed), the SHA256 preimage (re-hashed by hand),
  and `uid=1001(marco)` from a real SSH session.
- **Attempted and failed, recorded honestly:** reading `level_app.py` (permissions), path traversal
  on `/uploads/` (correctly blocked), privilege escalation to `ubuntu` (no vector found).
