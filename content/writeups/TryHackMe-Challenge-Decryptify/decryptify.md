---
description: "TryHackMe Decryptify — a PHP login panel where every gate is a broken piece of crypto. An obfuscated JavaScript file hides a 16-character key that is really the API-docs password; the docs leak a weak mt_rand() invite-code algorithm seeded from the email; an application log hands you a known (email, code) pair, which recovers the secret constant and forges a working invite code to log in. The dashboard runs a decrypted 'date' token as a shell command, and the app leaks a CBC padding error — a padding oracle that lets you forge a token decrypting to any command, with no key, for remote code execution. Every step, flag, and control explained for a total beginner."
---

# Decryptify — when every lock on the door is a broken cipher

**TryHackMe · challenge: Decryptify · target: `10.x.x.x` (the lab IP changes per lease)**

> **Both flags are redacted** here as `THM{[redacted]}`. Everything that teaches stays — every
> request, the deobfuscated key, the invite-code maths, the padding-oracle attack and the controls
> that prove each result. The flag strings themselves teach nothing; printing them just hands the
> room's answer to the next person.

**The brief.** *"Can you decrypt the secrets and get RCE on the system?"* — RCE is **remote code
execution**, running your own commands on the target machine. The word *decrypt* is the whole room.
There is no memory-corruption exploit and no password brute force. There are four separate places
where the site protects something with **weak or misused cryptography**, and each one breaks:

1. an **obfuscated** JavaScript file that hides a key,
2. a **predictable random-number** invite-code generator,
3. a value handed to you for free in a **log file**,
4. and a **padding oracle** that turns "I don't have the key" into "I don't need the key."

Two questions:

1. What is the flag shown after logging into the panel?
2. What is the content of **`/home/ubuntu/flag.txt`**?

Everything below was done from the command line with `curl`, `php`, `openssl` and a short Python
script. The reasoning is the lesson; the commands are just typing.

---

## 1. Recon — what is running?

A **port** is a numbered door on a machine; each network service listens on its own. We ask which
doors are open with **nmap**, the standard port scanner.

```bash
nmap -p- --min-rate 2000 -T4 10.x.x.x     # -p-  = all 65535 ports
nmap -sV -sC -p22,1337 10.x.x.x           # -sV  = version, -sC = default scripts
```

- `-p-` scans **all** ports, not just the common few, so nothing hides on an odd number.
- `-sV` fingerprints the software behind each open port; `-sC` runs nmap's safe default scripts.

Result: only two doors are open.

```
22/tcp    open  ssh     OpenSSH 8.2p1 Ubuntu
1337/tcp  open  http    Apache httpd 2.4.41 ((Ubuntu))
|_http-title: Login - Decryptify
```

Port **22** is SSH (remote login — no credentials yet). Port **1337** is a web server running a PHP
app titled *"Login - Decryptify."* The host is **Ubuntu**, which matters: the second flag lives at
`/home/ubuntu/flag.txt`, so "ubuntu" is the user whose files we ultimately want to read.

---

## 2. Read the app before touching it

The first rule of web work: **read every static file the page hands you before you start poking
endpoints.** A page's own HTML and JavaScript document how it works, for free.

```bash
curl -s http://10.x.x.x:1337/ -o index.html
```

The login page has **two** forms:

- **Login**: `username` + `invite_code`
- **Login with Invite Code**: `invite_username` (an email) + `invite_code`

and a footer link to `api.php` ("API Documentation"). The page loads one custom script, `/js/api.js`.
Read that next.

### 2.1 The obfuscated key

```bash
curl -s http://10.x.x.x:1337/js/api.js
```

```javascript
function b(c,d){...}const j=b;function a(){const k=['16OTYqOr','861cPVRNJ',
'474AnPRwy','H7gY2tJ9wQzD4rS1','5228dijopu', ... ];a=function(){return k;};return a();}
(function(d,e){ ... rotate the array until a checksum matches ... }(a,0xe43f0));
const c=j(0x169);
```

This is **javascript-obfuscator** output. It looks scrambled, but it is ordinary code — obfuscation
hides *intent*, not *behaviour*. The trick is that it defines a string array and then rotates it at
runtime; the value `c` is pulled out by index after the rotation, so you cannot just read it off the
page. So **run it** and print `c`. Node executes the same JavaScript your browser would, with no
network access:

```bash
cp api.js api-deob.js
printf '\nconsole.log("c =", c);\n' >> api-deob.js
node api-deob.js
# c = H7gY2tJ9wQzD4rS1
```

`c = H7gY2tJ9wQzD4rS1` — a **16-character** string. Sixteen characters is exactly an AES-128 key
length, and one entry in that array (`H7gY2tJ9wQzD4rS1`) is the only thing that looks like a secret;
the rest are obfuscator noise. This is the first "secret" the brief wants us to decrypt.

> **Treat a secret found in front-end code as a lead, not a fact.** It might be a decoy. We prove
> what it unlocks rather than assuming.

### 2.2 The key is the API-docs password

`api.php` shows a password box. The cheapest hypothesis: the 16-character key **is** that password.

```bash
curl -s -X POST http://10.x.x.x:1337/api.php \
     --data-urlencode "api_password=H7gY2tJ9wQzD4rS1"
```

It unlocks the documentation, which leaks the **invite-code algorithm** verbatim:

```php
function calculate_seed_value($email, $constant_value) {
    $email_length = strlen($email);
    $email_hex    = hexdec(substr($email, 0, 8));   // first 8 chars, hex digits only
    $seed_value   = hexdec($email_length + $constant_value + $email_hex);
    return $seed_value;
}
$seed_value  = calculate_seed_value($email, $constant_value);
mt_srand($seed_value);           // seed PHP's random generator
$random      = mt_rand();        // one "random" number
$invite_code = base64_encode($random);
```

Read what this really does. `mt_rand()` is **not** cryptographically random. Once you call
`mt_srand($seed)` with a known seed, the very next `mt_rand()` is **fully determined** — the same
seed always produces the same number. And the seed here is computed **only** from the email and a
fixed `$constant_value`. So the invite code for any email is not a secret at all; it is a pure
function of the email and one unknown constant. If we learn the constant, we can forge a code for any
account we like.

Two unknowns remain: **a valid email**, and **`$constant_value`**.

---

## 3. Enumerate — find the endpoints and a free gift

No backup/source files exist (`index.php.bak`, `.git/…`, etc. all return 404 — checked against a
positive control that does exist and a negative control that cannot, so the "not found" is real).
So we sweep for hidden paths with **ffuf**, a fast content fuzzer:

```bash
# strip destructive names from the wordlist first — a content sweep issues a real GET to every path
grep -viE '^(setup|install|reset|delete|drop|purge|logout)$' wordlist.txt > wl.txt
ffuf -u http://10.x.x.x:1337/FUZZ -w wl.txt -e .php -mc 200,301,302,403 -t 25
```

- `FUZZ` is where each word is substituted; `-e .php` also tries a `.php` extension.
- `-mc` lists which HTTP status codes count as a hit. Here 404 is a genuine "not found", so the
  defaults are fine (no catch-all page pretending everything exists).

Hits worth keeping:

| Path | Meaning |
|---|---|
| `dashboard.php` | 302 redirect → the panel you reach **after** login |
| `header.php` / `footer.php` | page include fragments |
| `/logs/` | a directory — **with listing enabled** |
| `/phpmyadmin` | a database admin tool (a tempting rabbit hole; we never need it) |

Open the log directory:

```bash
curl -s http://10.x.x.x:1337/logs/       # lists app.log
curl -s http://10.x.x.x:1337/logs/app.log
```

```
... (Invite created, code: MTM0ODMzNzEyMg== for alpha@fake.thm)
... POST to /dashboard.php (User alpha@fake.thm deactivated)
... POST to /dashboard.php (New user created: hello@fake.thm)
```

This one file hands us three things:

- the email **domain** is `fake.thm`,
- a **known (email, code) pair**: `alpha@fake.thm` → `MTM0ODMzNzEyMg==`,
- `alpha@fake.thm` was **deactivated**, but `hello@fake.thm` is an **active** account.

`MTM0ODMzNzEyMg==` is base64; decode it:

```bash
echo -n MTM0ODMzNzEyMg== | base64 -d      # 1348337122
```

So for `alpha@fake.thm`, `mt_rand()` returned **1348337122**. That is the missing crib.

> **Enumerate the cheap file read before the clever attack.** A log we could just download replaced
> a database break-in and a hostname guessing game in one request.

---

## 4. Recover the constant, forge an invite code, log in

We know the exact algorithm and one true output. Brute-force the only unknown, `$constant_value`,
until PHP reproduces `1348337122` for `alpha@fake.thm`. PHP's `mt_rand()` with no arguments is stable
across every modern PHP version for a given seed, so a local PHP reproduces the server exactly — and
if our reproduction is even slightly wrong, **it will never match the log**, which makes this a
built-in correctness check.

```php
<?php
function seed($email,$c){ return hexdec(strlen($email) + $c + hexdec(substr($email,0,8))); }
for ($c = -1000000; $c <= 1000000; $c++) {
    mt_srand(seed("alpha@fake.thm", $c));
    if (mt_rand() === 1348337122) { echo "constant = $c\n"; break; }
}
```

A subtlety worth knowing: PHP's `hexdec()` **ignores non-hex characters, including a minus sign**.
That means two different constants (`99999` and `-187567`) both reproduce alpha's number, because the
sum only differs by sign. A crib satisfies a key **by construction** — reproducing the one value we
already knew proves nothing about a *different* email. So we generate `hello@fake.thm`'s code for
**both** candidate constants and test each against the live login:

```php
$e = "hello@fake.thm";
foreach ([99999, -187567] as $c) {
    mt_srand(seed($e, $c));
    echo "$c => " . base64_encode(mt_rand()) . "\n";
}
```

```bash
# try each forged code against the invite login
curl -s -c jar -X POST http://10.x.x.x:1337/index.php \
     --data-urlencode "invite_username=hello@fake.thm" \
     --data-urlencode "invite_code=<forged>" -D -
```

Constant **99999** wins — its code returns `Location: dashboard.php` and sets a session. `-187567`
returns *"Invalid invite code."* Testing against a second email is what separated the true constant
from the impostor.

Follow the redirect with the session cookie:

```bash
curl -s -b jar http://10.x.x.x:1337/dashboard.php
```

```
Welcome, hello@fake.thm! - Flag: THM{[redacted]}
Username        Role
hello@fake.thm  user
admin@fake.thm  admin
```

**Flag 1 is on the dashboard.** `THM{[redacted]}` — the real value is in the panel, redacted here.

The table also shows `admin@fake.thm` is an admin. Forging *its* invite code (same constant) is
rejected — admins do not authenticate through the invite path, and, as we are about to see, we never
need to be admin at all.

---

## 5. The RCE lever: an encrypted `date` token

Look at the dashboard's HTML, not just the rendered page. Hidden in the footer:

```html
<form method="get">
  <input type="hidden" name="date" value="jgx5S0R7hbTPvspCvkV4mLmFZalYP0OQquceAZjm1ZA=">
</form>
```

A base64 `date` value submitted back to `dashboard.php` by GET. Two observations:

- **It changes on every page load** — same meaning, different bytes each time. That is the signature
  of a **random IV** (initialisation vector), i.e. **CBC-mode** encryption where a fresh random block
  is prepended so identical plaintext encrypts to different ciphertext.
- The footer already prints "&copy; 2026" — hold that thought.

Poke the sink with obvious garbage and read the error:

```bash
curl -s -b jar "http://10.x.x.x:1337/dashboard.php?date=notbase64!!"
```

```
Warning: openssl_decrypt(): IV passed is only 6 bytes long, cipher expects an IV
of precisely 8 bytes ... in /var/www/html/dashboard.php on line 28
... Padding error: ... wrong final block length
```

Two gifts from one bad request:

1. **The IV is 8 bytes.** AES uses a 16-byte IV; an **8-byte IV means an 8-byte-block cipher** —
   Blowfish, DES, CAST5 or similar. The token is therefore `base64( IV[8] + ciphertext )`.
2. **The app prints a distinct "Padding error"** when decryption's padding is wrong.

We try the 16-character key against every 8-byte-block cipher — and it decrypts **nothing** to
readable text. The key from the JavaScript was the *API password*; the token uses a **different**
key we do not have.

> **A key that unlocks one thing is not the app's only key.** Chasing the wrong key here was the
> main wrong turn; the error message telling us the block size, and the padding error, are what got
> us back on track.

### 5.1 Why the padding error is fatal

That "Padding error" is a **padding oracle**. When a CBC message is decrypted, the last block must
end in valid **PKCS7 padding** (if the last *n* bytes each equal *n*). If we tamper with the
ciphertext and the app tells us — even indirectly — whether the padding came out valid, we can, one
byte at a time:

- **decrypt** any block without the key, and
- **encrypt** any plaintext of our choosing without the key.

Confirm the oracle is real and byte-precise. We flip single bytes of a valid token and watch the
response:

| We flip | Result | Why |
|---|---|---|
| last ciphertext byte | **Padding error** | breaks the final padding byte |
| 2nd-last ciphertext byte | **Padding error** | the real padding is longer than one byte |
| a byte of the IV | **OK** | changes plaintext, but not the padding |

Clean, deterministic, one bit at a time. That is everything a padding-oracle attack needs.

### 5.2 Decrypt the real token — the sink is a shell

A small Python script implements the standard attack: to learn a ciphertext block, submit a
two-block message (`chosen_previous_block` + `target_block`) and brute the last byte of the chosen
block until the padding comes out valid; that reveals the cipher's internal value for that byte, and
XOR-ing with the real previous block gives the plaintext.

Run it on a live token:

```
block 0: b'date +%Y'
block 1..2: padding
PLAINTEXT: 'date +%Y'
```

The token decrypts to **`date +%Y`** — a **shell command** that prints the current year. And the
footer showed **2026**. The app is literally running the decrypted string as a system command and
printing its output. That is the whole game: forge a token that decrypts to **our** command, and its
output appears in the footer.

### 5.3 Encrypt our own command — RCE without the key

Padding-oracle *encryption* runs the decrypt trick backwards. Pick an arbitrary final ciphertext
block; recover its internal value with the oracle; XOR the plaintext block we want to get the
*previous* ciphertext block; repeat back to the IV. The result is a token that decrypts to exactly
the bytes we chose — **no key required.**

First a cheap proof with `id` (prints the current Linux user):

```python
tok, html = run_cmd(b"id")     # forge a token decrypting to "id", submit it
# footer: uid=33(www-data) gid=33(www-data) groups=33(www-data)
```

Command execution as **www-data**. Now read the target file:

```python
run_cmd(b"cat /home/ubuntu/flag.txt")
# footer: THM{[redacted]}
```

**Flag 2** drops out of the footer. `THM{[redacted]}` — the real value is on the box, redacted here.

We never needed to become admin, and we never needed the token's encryption key. The padding oracle
sidestepped both.

---

## 6. The chain, end to end

1. **Obfuscated JS** → deobfuscate → 16-char key `H7gY2tJ9wQzD4rS1`.
2. Key is the **API-docs password** → docs leak the **`mt_rand()` invite-code** algorithm.
3. **`/logs/app.log`** hands over a known (email, code) pair and an active account, `hello@fake.thm`.
4. Recover the seed **constant (99999)**, **forge** the invite code, log in → **Flag 1**.
5. Dashboard runs a decrypted **`date`** token as a shell command; the app leaks a **padding error**.
6. **CBC padding-oracle** → forge a token decrypting to `cat /home/ubuntu/flag.txt` → **Flag 2 (RCE)**.

Four broken uses of cryptography, in a row: obfuscation mistaken for encryption, a predictable PRNG,
a secret written to a log, and a cipher whose error messages leak. "Decrypt the secrets" was the
literal instruction the whole time.

## 7. Fixes

- **Never put secrets in client-side code.** Obfuscation is not encryption; anything the browser can
  run, an attacker can read. Gate the API docs server-side with a real, hashed password.
- **Use a cryptographically secure generator for tokens** (`random_bytes()`), never `mt_rand()`, and
  never seed it from attacker-influenced input. An invite code should be an unguessable random value
  stored server-side, not a pure function of the email.
- **Do not serve `/logs/` from the web root**, and do not log secrets (invite codes, credentials).
- **Never run a decrypted value as a shell command.** If you must accept an encrypted parameter, use
  **authenticated encryption** (AES-GCM), which rejects any tampered ciphertext outright and gives an
  attacker no padding oracle — and never pass user-influenced strings to `system()`.

## 8. Teardown

Nothing was left on the target. The command execution was through GET parameters only — no web shell
uploaded, no files written, no SSH key added, and the invite login does not create accounts, so no
junk users. Local scanners (`nmap`, `ffuf`) and the Python oracle all finished. The only lasting
artefacts are notes and captures on the attacker box.
