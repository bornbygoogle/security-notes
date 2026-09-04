---
description: "TryHackMe Dev Diaries — an OSINT room that starts with one parked domain and ends inside a freelance developer's deleted source code. The apex has no A record and both subdomains are switched off, so every answer comes from records that outlived the servers: certificate transparency logs that still name subdomains whose DNS was deleted, Wayback Machine snapshots fetched with the id_ flag to get the developer's real HTML, and a git history where deleting a file removes nothing. Includes the missing positive control that made an entire DNS sweep uninterpretable, two archived pages that turned out byte-identical, and the archive endpoint that answers 'no results' with a web page."
---

# Dev Diaries — the code was deleted, the history wasn't

**TryHackMe · challenge: Dev Diaries · category: OSINT · no target machine, no VPN**

> **The flag is redacted** here as `THM{[redacted]}`, and so is the developer's email address. The
> flag is just proof you were there — publishing it hands the room's answer to the next person
> instead of letting them earn it. The email is redacted for a different reason: it is a live,
> contactable address, and a public page is not the place to leave one sitting for scrapers.
>
> **What I kept and why:** the subdomain, the GitHub username, the commit messages and every
> command stay in full. They are the trail the whole lesson is about — you cannot teach "follow the
> reference" while hiding the references. They are also already public: certificate transparency
> logs and a public repository are open by design, which is the room's entire point.

## The brief

A company launched a website built by a freelance developer. The source code was never handed over,
and the developer has since disappeared. Traces of the development process, and of earlier versions
of the site, may still exist online.

You get one thing: the domain **`marvenly.com`**.

Five questions:

1. What subdomain hosts the development version of the website?
2. What is the developer's GitHub username?
3. What is the developer's email address?
4. What reason did the developer give in the commit history for removing the source code?
5. What is the hidden flag?

**OSINT** is *open-source intelligence*: answering a question using only information that is already
public. No exploitation here, no shell, nothing sent to a target that changes anything. The entire
room is read-only, and the target is switched off anyway.

## The shape of it

Every answer in this room comes from a record that **outlived the thing it described**. The
developer deleted the site, deleted the DNS records, and deleted the code. All three deletions were
undone by systems that keep public logs on purpose:

| Deleted | Still public because |
|---|---|
| The web servers, and their DNS records | Every HTTPS certificate ever issued is published in an append-only log |
| The live pages | The Internet Archive captured them while they were up |
| The source code | Git stores every past state, not just the current one |

If you remember one sentence: **deleting something and un-publishing it are different operations,
and most people only do the first.**

---

## Step 1 — Ask DNS, and control the question

**What DNS is.** A hostname like `marvenly.com` means nothing to the network. Before a browser can
connect, the name has to be turned into a numeric address such as `104.20.23.154`. That translation
is the **Domain Name System**, DNS. `dig` ("domain information groper") asks a DNS server directly,
with no browser in the way.

```bash
dig +short qzx9nosuch4471.marvenly.com A   # the control, and it runs first
dig +short marvenly.com A
dig +short marvenly.com NS
dig +short marvenly.com TXT
dig +short marvenly.com MX
```

Every flag:

- `+short` — print the answer only, not the usual page of protocol detail.
- `A` — the record type that holds an IPv4 address. Literally "where does this name live?"
- `NS` — *name server*: which servers are authoritative for this domain's DNS.
- `TXT` — free-text records, usually carrying mail policy and ownership proofs.
- `MX` — *mail exchanger*: where email addressed to this domain gets delivered.

**Why the invented name goes first.** `qzx9nosuch4471.marvenly.com` cannot exist — I made it up.
Some domains are configured with a **wildcard**, where *every* conceivable subdomain answers with
the same address. On a wildcard domain, a list of "discovered" subdomains is worthless: they all
resolve because anything resolves. Asking the impossible name first, and reading its answer first,
is the cheapest possible test of whether the instrument can lie to me.

It returned nothing. No wildcard. Now the real answers mean something:

```
=== CONTROL (must NOT resolve) : qzx9nosuch4471.marvenly.com ===
=== marvenly.com A ===
=== NS ===
dns2.registrar-servers.com.
dns1.registrar-servers.com.
=== TXT ===
"v=spf1 include:spf.efwd.registrar-servers.com ~all"
=== MX ===
10 eforward1.registrar-servers.com.
...
```

**The important line is the empty one.** `marvenly.com` has **no A record at all**. There is no web
server at the domain you were given.

But it is not an abandoned registration either. It has name servers, a mail policy and mail
exchangers, all on `registrar-servers.com` — Namecheap's infrastructure — and the `TXT` record is
Namecheap's *email forwarding* service. Read together: **the domain is registered and parked. Email
forwarding is on; the website is gone.**

`curl https://marvenly.com/` agreed, with `Could not resolve host`.

That kills the obvious plan (fetch the live site, compare it to a dev version) on the first command.
It also turns one phrase in the brief from scene-setting into an instruction: *traces of the
development process and earlier versions of the website may still exist online.* If nothing is live,
everything must come from records of what used to be.

## Step 2 — Certificate transparency: names that outlive their servers

**The mechanism, because it is the key to the room.** Any site served over HTTPS needs a TLS
certificate from an authority like Let's Encrypt. Since 2018, browsers require that every
certificate issued be published to a public, append-only, tamper-evident log. This is **Certificate
Transparency (CT)**, and it exists so that a certificate issued fraudulently for your domain cannot
be used quietly — anyone can audit the log and see it.

The side effect is what we want here. Certificates contain the hostnames they are valid for, and the
log is permanent. **If a subdomain ever served HTTPS, its name is public forever — after the server
is switched off, after the DNS record is deleted, after the company forgets it existed.**

`crt.sh` is a free searchable mirror of those logs.

```bash
curl -sS --max-time 60 "https://crt.sh/?q=%25.marvenly.com&output=json" -o crtsh.json
jq -r '.[].name_value' crtsh.json | sort -u
```

- `%25` is the URL-encoded form of `%`, which is SQL's wildcard character. `%.marvenly.com` means
  "any name ending in `.marvenly.com`". (It has to be encoded because a bare `%` means something
  else inside a URL.)
- `output=json` asks for machine-readable data; `jq` extracts one field from it.
- `sort -u` sorts and drops duplicates — a name appears once per certificate ever issued for it.

```
admin.marvenly.com
marvenly.com
uat-testing.marvenly.com
www.marvenly.com
```

**Two subdomains nobody mentioned.** And the certificate covering both `admin` and `uat-testing` was
issued on **2026-01-19 at 15:19**, while the apex/`www` certificate dates from 2022.

Look at the name `uat-testing`. **UAT** is **User Acceptance Testing** — the industry's standard
term for the staging environment where a client reviews work before it goes live. That is a
development environment by definition. Held as a strong hypothesis, not yet an answer.

### Why CT logs instead of a subdomain wordlist

This is the one real methodology decision in the room, so it's worth being explicit.

The reflex is to take a wordlist of common subdomain names (`dev`, `test`, `staging`, `beta`, `api`)
and try each one against DNS. I've done that on a previous room, guessed `dev.`, `test.` and
`staging.`, found nothing, and concluded the box was walled — when the real subdomain was written in
a config file I could already read. The rule I wrote down afterwards was **follow the reference,
don't guess it**, and this is exactly that situation.

Beyond being the lesson, CT logs are simply better here:

| | Wordlist brute-force | Certificate transparency |
|---|---|---|
| Requests sent to the target | thousands | **zero** |
| Finds names nobody would guess | no | yes |
| Works after DNS is deleted | **no** | **yes** |
| Time | minutes | one request |

That last row decides it. Every subdomain in this room has had its DNS deleted. **A brute-force
sweep of this domain would have found nothing at all, no matter how good the wordlist was.**

## Step 3 — Wrong turn: I read silence as evidence

I resolved every candidate, real and invented:

```bash
for h in qzx9nosuch4471 dev staging test www admin uat-testing; do
  printf '%-34s -> %s\n' "$h.marvenly.com" "$(dig +short "$h.marvenly.com" A | tr '\n' ' ')"
done
```

**Every line came back empty** — including `admin` and `uat-testing`, which I had *just* proven hold
a valid TLS certificate.

The tempting read: "they're dead, dead end."

**That conclusion was not available to me, and it is worth being precise about why.** An empty result
from `dig` is what you get when the record does not exist. It is *also* what you get from a broken
resolver, a VPN routing the query somewhere useless, or a firewall eating it. Those are the same
output. Silence means *either* "not there" *or* "my question never arrived", and nothing
distinguishes them until you prove the channel works.

I had run a **negative** control — a name that must fail. I had never run a **positive** one — a name
that must succeed. Half a control is not a control.

```bash
cat /etc/resolv.conf                        # which server am I even asking?
dig +short example.com A                    # POSITIVE control: this MUST return an IP
dig +short @1.1.1.1 marvenly.com A          # and ask a public resolver instead of the local one
dig +short @8.8.8.8 marvenly.com A
```

`@1.1.1.1` points `dig` at Cloudflare's public DNS rather than whatever the local network handed me.
That separates "my network is broken" from "this record genuinely does not exist" — two different
worlds that produce identical blank output.

```
example.com  -> 104.20.23.154 172.66.147.243      <- the resolver works fine
marvenly.com -> (empty, from 1.1.1.1 and 8.8.8.8) <- the record really is gone
```

The channel was fine; the silence was real. **The certificates outlived the DNS records.** The
servers are gone and their DNS entries were deleted, but the certificates issued to them are still
in a public log — which is precisely why CT enumeration found names no live scan ever could.

**The rule:** put the positive and negative control in the *same* command, and read both before any
result row. I ran half of one, and paid for the other half with a wasted hypothesis.

## Step 4 — Earlier versions: the Wayback Machine

Both subdomains are unreachable, so the only place their pages can still exist is an archive. The
Internet Archive's **Wayback Machine** has been saving copies of web pages since 1996. Its **CDX
index** is a queryable list of every snapshot it holds.

```bash
curl -sS "http://web.archive.org/cdx/search/cdx?url=marvenly.com&matchType=domain\
&output=text&fl=timestamp,original,statuscode,mimetype&collapse=urlkey&limit=500"
```

- `matchType=domain` — **the flag that makes this query worth running.** It returns snapshots of the
  domain *and every subdomain of it*, rather than just the exact URL. Ask for one URL and you learn
  about one URL; ask for the domain and the archive volunteers everything it has.
- `fl=` — which columns to return: capture time, original URL, the HTTP status the server gave at
  capture time, and the content type.
- `collapse=urlkey` — one row per distinct URL rather than one per capture.

```
20260317170825 https://admin.marvenly.com/            200 text/html
20260317170825 https://admin.marvenly.com/favicon.ico 404 text/html
20260119163109 https://uat-testing.marvenly.com/      200 text/html
20260119163110 https://uat-testing.marvenly.com/favicon.ico 404 text/html
```

Both dead subdomains were captured while they were alive. The timestamp is `YYYYMMDDhhmmss`, so
`20260119163109` is 2026-01-19 16:31:09. `200` is the HTTP status meaning "here is the page"; `404`
means "no such file" — the missing favicon is normal and irrelevant.

## Step 5 — Reading the archived development page

```bash
curl -sS --compressed \
  "https://web.archive.org/web/20260119163109id_/https://uat-testing.marvenly.com/" \
  -o uat-testing-archived.html
```

Two details in that URL do real work:

**`id_` after the timestamp** means "identity": give me the bytes the original server sent, *without*
the navigation toolbar and rewritten links the Wayback Machine normally injects into archived pages.
Without `id_` you are reading the archive's rendering of the page. With it you are reading the
developer's actual HTML. When you are doing source-code archaeology, that distinction is the whole
job — an injected toolbar can bury the one comment you came for.

**`--compressed`** earned itself immediately. Without it, the download was 3 219 bytes of binary
noise. The archive stores each response exactly as the server sent it, and this server had
**gzip-compressed** the page. `--compressed` tells `curl` to decompress before writing to disk.
13 638 bytes of readable HTML followed.

> Worth internalising: binary garbage from a URL you know serves HTML almost always means a content
> encoding you didn't ask to have decoded. It is not corruption, and it is not a failed download.

The page is a "Marvenly — Professional Services" landing page: hero image, About, Services, Contact.
Ordinary small-business brochureware. The last lines of the body are not ordinary:

```html
    <footer>
        <div class="container">
            <p>&copy; 2026 Marvenly. All rights reserved.</p>
            <p>Website developed by notvibecoder23</p>
        </div>
    </footer>
```

**`notvibecoder23`.** A developer credit in the footer — the freelancer's signature on their own
work.

This is the pivot of the whole room, and note *how* it arrived: I did not guess a username or run a
sweep across a hundred social platforms. The name was written in a document I could already read. If
there is one habit worth taking from this write-up, it is that **references beat guesses, every
time.** Read what you already have before generating candidates.

## Step 6 — The anomaly I didn't shrug off

I fetched `admin.marvenly.com`'s snapshot too. Both files came out **exactly 13 638 bytes with the
same MD5 hash**, and `diff` reported them identical.

Two different hosts serving byte-identical pages is odd enough to be either a genuine finding or a
flaw in my method. Specifically: the archive might have redirected me to the same snapshot twice, in
which case I had never actually seen `admin`'s content and anything I said about it would be
fiction. So I checked, rather than explaining it away.

```bash
curl "http://web.archive.org/cdx/search/cdx?url=uat-testing.marvenly.com\
&output=text&fl=timestamp,original,statuscode,digest,length"
```

`digest` is a hash of the captured content **computed by the archive itself**. That is what makes
this a real check: it is an authority I did not generate, rather than my own `curl` restating itself.

```
20260119163109 https://uat-testing.marvenly.com/ 200 AR5LTDFC3KHTMXQUMW2DZOXLMZKRDLUZ 3891
20260318003731 https://uat-testing.marvenly.com/ 200 AR5LTDFC3KHTMXQUMW2DZOXLMZKRDLUZ 3905
20260317170825 https://admin.marvenly.com/       200 AR5LTDFC3KHTMXQUMW2DZOXLMZKRDLUZ 3899
```

Same digest on all three. The identity is genuine: **one application, deployed under both names** —
which the shared certificate had already hinted at. It changes no answer, but it is now *known*
rather than assumed, and it matters in Step 10 when the two names have to be told apart.

> **A trap worth naming:** two of these CDX queries returned an `Internet Archive: Temporarily
> Offline` **HTML page** instead of data. A tool that can answer with a web page rather than an error
> status will silently become "no results found" for any script that doesn't check what it got. I
> retried until it actually answered. Always look at what came back, not just whether something did.

## Step 7 — The GitHub account, with a control

```bash
curl -o /dev/null -w '%{http_code}\n' https://api.github.com/users/qzx9nosuchuser4471dev  # control
curl https://api.github.com/users/notvibecoder23
```

- `-o /dev/null` throws the response body away; `-w '%{http_code}'` prints only the numeric HTTP
  status. The cheapest existence test there is.
- The control username is invented and must return **404** ("not found").

**Why bother controlling something as boring as a profile lookup.** On a previous OSINT room, six
social platforms returned `200 OK` for a username that did not exist. Modern single-page apps ship
the same JavaScript bundle to every visitor and only decide *in the browser* whether the profile is
real — so the status code describes delivery of the app, not existence of the user. Without the
control, that room would have produced seven confidently reported accounts belonging to nobody.
GitHub's REST API is better behaved than that, but "better behaved" is a belief until it's measured,
and measuring costs one request.

```
control          -> 404          <- the discriminator works
notvibecoder23   -> {"login": "notvibecoder23", "id": 253521273, "email": null,
                     "public_repos": 1, "created_at": "2026-01-07T14:33:09Z"}
```

Control 404s, target returns data: **`notvibecoder23` is real. Question 2 answered.**

Two things to notice in that response. The account is nine weeks old with exactly one public
repository — a throwaway freelance identity, not someone's main account. And **`"email": null`** —
the profile deliberately hides the address. Question 3 will not be answered here.

```bash
curl https://api.github.com/users/notvibecoder23/repos
```

One repository: **`marvenly_site`**, created `2026-01-19T16:33:44Z`, last pushed `16:39:13Z`.

Now the timeline interlocks, and this is what ties the account to *this* client rather than to a
coincidentally similar name:

| Time (2026-01-19, UTC) | Event |
|---|---|
| 15:19 | TLS certificate issued for `uat-testing` + `admin` |
| 16:31 | Wayback captures `uat-testing.marvenly.com` |
| 16:33 | GitHub repository `marvenly_site` created |
| 16:39 | Final push |

Eighty minutes. One project.

## Step 8 — Commit metadata before commit content

```bash
git clone https://github.com/notvibecoder23/marvenly_site.git
cd marvenly_site
git log --all --format='%H%n  date: %ad%n  author: %an <%ae>%n  subject: %s'
```

**What git is, briefly.** Git is a version control system. It does not store the current state of a
project — it stores *every state the project has ever been in*, as a chain of **commits**. Each
commit records what changed, when, who made the change, and a message saying why.

- `--all` — every branch, not just the one checked out.
- `--format=` — a template. `%H` the full commit hash (its unique ID), `%ad` author date, `%an`
  author name, `%ae` **author email**, `%s` the subject line of the message.

**Read the metadata before the code.** It is one command, it is free, and it routinely answers
questions people expect to find by reading source. Here it answers two of them outright:

```
7a7090d  2026-01-20 00:38:53 +0800  notvibecoder23 <[redacted]@gmail.com>
         Parking the domain until the issue is solved
88baf1d  2026-01-20 00:33:16 +0800  notvibecoder23 <[redacted]@gmail.com>
         The project was marked as abandoned due to a payment dispute
33c59e5  2026-01-20 00:32:28 +0800  notvibecoder23 <[redacted]@gmail.com>
         Removed my signature, ready for deployment
e9ce1ce  2026-01-20 00:12:43 +0800  notvibecoder23 <[redacted]@gmail.com>
         Initial commit of the landing page
```

**Question 3 is answered by `%ae`.** The GitHub profile hid the email; every single commit carries
it. That is not carelessness so much as how git works: **your email address is stamped into every
commit object you author, and pushing publishes all of them.** Hiding it on your profile page
afterwards changes nothing about the commits already on the internet. (The address is redacted here;
it is a plain `@gmail.com` one and the command above is exactly how you get it.)

Two free bonuses in that output. `+0800` is the timezone offset of the developer's machine — eight
hours ahead of UTC, the same instant as 16:33 UTC. And the *shape* of the history reads as a story
before you have opened a single file.

**Question 4 is answered by `%s`:** commit `88baf1d`, **"The project was marked as abandoned due to a
payment dispute."** The next step confirms this is the commit that actually removed the code, rather
than one that merely sounds like it.

## Step 9 — Recovering what was deleted, and the flag

```bash
git log --all --reverse --format='COMMIT %h  %s' --name-status
```

`--name-status` lists the files each commit touched, tagged `A` (added), `M` (modified) or `D`
(deleted).

```
COMMIT e9ce1ce  Initial commit of the landing page                            A  index.html
COMMIT 33c59e5  Removed my signature, ready for deployment                    M  index.html
COMMIT 88baf1d  The project was marked as abandoned due to a payment dispute  M  index.html
COMMIT 7a7090d  Parking the domain until the issue is solved                  M  index.html
```

No `D` anywhere. And the current checkout is 46 bytes:

```html
<html>
<body>
DOMAIN FOR SALE
</body>
</html>
```

So the "removal" was never a deleted file — it was a commit that emptied one:

```bash
git show 88baf1d --stat -- index.html
#  index.html | 464 +----------------------------------------
#  1 file changed, 2 insertions(+), 462 deletions(-)
```

**462 lines deleted, in the commit that blames a payment dispute.** Question 4's answer is not just a
plausible-sounding message picked out of a list; it is attached to the commit that did the deleting.

### The point of the room

Removing a file in a later commit **does not remove it from the repository**. Every earlier commit
still contains it, and anyone who clones gets the whole chain. The same applies to a secret you
committed and deleted a minute later, and to a `.gitignore` you added afterwards — the commit that
already exists still carries the file to everyone who clones.

```bash
git log --all -p | grep -inE 'THM\{|flag\{|FLAG|secret|token'
```

- `-p` — print the full **patch** (the actual line-by-line changes) of every commit on every branch.
  Piping that into `grep` searches the entire history, deleted content included.
- `-i` case-insensitive, `-n` line numbers, `-E` extended regular expressions.
- Several markers rather than just `THM{`, so a differently-formatted secret isn't missed.

```
491:-  <!-- removed the signature, but I'm leaving something as my hidden signature THM{[redacted]} -->
513:+  <!-- removed the signature, but I'm leaving something as my hidden signature THM{[redacted]} -->
```

**Question 5 answered.** It appears twice because a patch shows every line as removed (`-`) in one
commit and added (`+`) in another.

Pinning exactly when it entered and left:

```bash
git log --all --oneline -S 'g1t_h1st0ry...'
# 88baf1d The project was marked as abandoned due to a payment dispute   <- removed it
# 33c59e5 Removed my signature, ready for deployment                     <- added it
```

`-S <string>` is git's **pickaxe** search: show only the commits where the *number of occurrences* of
that string changed. It is the precise tool for "when did this appear, and when did it disappear",
and far better than eyeballing every commit.

The diff of `33c59e5` tells the story in two lines:

```diff
-            <p>Website developed by notvibecoder23</p>
+            <!-- removed the signature, but I'm leaving something as my hidden signature THM{[redacted]} -->
```

The developer stripped their visible credit before handing the site over, and replaced it with an
**HTML comment** — invisible in a rendered browser page, plainly visible in the source. Then the
payment dispute happened and the entire file went. Both actions are still in the history, and the
flag's own text is the lesson: git history never forgets.

## Step 10 — Proving the repository is *this* site

A repository with a matching name is circumstantial. Here is the proof:

```bash
diff <(git show e9ce1ce:index.html) uat-testing-archived.html
# 332a333
# >
```

`git show <commit>:<path>` prints a file exactly as it existed at that commit. `<( ... )` is a
process substitution — it hands the output of a command to `diff` as though it were a file, so
nothing has to be written to disk.

The only difference between the developer's initial commit and the page the Internet Archive
captured from `uat-testing.marvenly.com` is **one trailing blank line** (`diff -w -B` calls them
identical). The repository is the source of the archived development site. Not inferred — measured.

## Step 11 — Which subdomain is "the development version"?

`admin` and `uat-testing` both existed, and Step 6 established they served byte-identical content.
So the phrase "development version" has to discriminate between them. I grepped the whole git
history for any hostname and found none, so there is no reference to follow here — this one is a
judgement, and it should be labelled as one:

- **`uat-testing`** — UAT is User Acceptance Testing, the standard name for a pre-production
  environment. Its certificate, its first archive capture, and the GitHub repository's creation all
  fall within eighty minutes of each other on 2026-01-19. This is the name that was live *while the
  development was happening*.
- **`admin`** — names an administrative panel, not a development build, and was first captured two
  months later, on 2026-03-17.

**Answer: `uat-testing.marvenly.com`.**

## The five answers

| # | Question | Answer | How it was obtained |
|---|---|---|---|
| 1 | Development subdomain | `uat-testing.marvenly.com` | Certificate transparency (`crt.sh`), since DNS was deleted |
| 2 | GitHub username | `notvibecoder23` | Footer credit on the archived dev page |
| 3 | Developer's email | `[redacted]@gmail.com` | `git log --format='%ae'` — hidden on the profile, stamped on every commit |
| 4 | Reason for removing the source | "The project was marked as abandoned due to a payment dispute" | Subject of commit `88baf1d`, which deleted 462 of 464 lines |
| 5 | Hidden flag | `THM{[redacted]}` | HTML comment added in `33c59e5`, deleted in `88baf1d`, recovered with `git log --all -p` |

Answers 1–5 are each backed by a saved artefact. None were submitted to TryHackMe's answer box in
this session, so they are **evidence-backed, not platform-confirmed** — a distinction worth keeping
honest.

## What went wrong, kept in

| Symptom | Real cause | The rule |
|---|---|---|
| Every subdomain resolved empty, including ones holding a valid certificate | No **positive** control had been run — an empty `dig` result and a broken resolver produce identical output | Put the positive and negative control in the same command; read both before any result |
| Two archived subdomains returned byte-identical pages; nearly dismissed as a fetch artefact | Genuine — one app deployed under both names on one certificate | Check the anomaly against an authority you didn't generate (the archive's own content digest) before moving past it |
| First archive fetch was 3 219 bytes of binary noise | The archive stores responses gzip-compressed exactly as sent | Use `--compressed`. Binary noise from an HTML URL means encoding, not corruption |
| Two CDX queries "returned nothing" | The service was flapping and answered with an HTML *page*, not an error status | A tool that can answer with a web page needs its output checked, or it silently becomes "no results" |

And one plan correction, made before it cost anything: the plan opened with "fetch the production
site and compare it against the dev version". That died on the first command, when the apex turned
out to have no A record at all. Rewriting the plan at that moment — instead of pressing on to step 2
of a plan step 1 had already killed — is what turned the brief's "earlier versions may still exist
online" from background colour into the actual method.

## What to take away

**For the exam, and for real work:**

1. **A deleted thing and an un-published thing are different.** DNS records, web pages and source
   files were all deleted here. All three were recoverable from public logs that exist precisely
   because permanence is the point.
2. **Enumerate subdomains passively first.** CT logs cost one request, send nothing to the target,
   and — decisively — still work after DNS is gone. A brute-force sweep of this domain would have
   returned nothing at all.
3. **Read the metadata before the content.** `git log --format='%ae'` answers "what is their email"
   in one command, on a profile that deliberately hides it.
4. **Follow references; don't generate candidates.** The GitHub username was written in a page I had
   already downloaded. Guessing would have been slower and less certain.
5. **Silence is not a result until you've proven the channel.** Every negative control needs a
   positive one beside it, in the same run.

**And if you write code for a living:** your email is in every commit you have ever pushed, an HTML
comment is not hidden, and deleting a file in a new commit publishes the deletion, not the secret.
