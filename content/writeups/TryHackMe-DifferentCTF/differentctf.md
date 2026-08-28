---
description: "TryHackMe Different CTF (Adana) — steghide to FTP to phpMyAdmin, then the twist: the FTP tree is a decoy served on a second vhost whose name is hidden in the decoy database. Includes the long, honest rabbit hole where I declared the box unsolvable while the answer sat in a column I never read."
---

# Different CTF (Adana) — read what the decoy points at

**TryHackMe · room: Adana ("Different CTF") · target: `10.130.148.206` · vhosts `adana.thm`, `subdomain.adana.thm`**

> **Every flag is redacted** here as `THM{[redacted]}`, and so is every real password value (the FTP
> password, the two `su` passwords, the SUID binary's secret string, and the hex blob that decodes to
> root's password). What stays is the whole technique: the port count, the secret directory, the
> stego → FTP → phpMyAdmin chain, **the decoy-database subdomain trick**, the `123adana…` password
> shape, the parallel-`su` brute, the SUID binary's `ltrace`, and the CyberChef `From Hex → To Base85`
> recipe. The flag and password strings are just proof — you still run the chain to earn them.
>
> The room's own words are the theme: *"what we see is not what we think, and if you go beyond the
> purpose, you will disappear in the room, fall into a rabbit hole."* It is not decoration. There are
> at least three decoys, and I fell into the biggest one for a long time. That wrong turn is in here
> on purpose — it is the most useful thing in this write-up.

## The whole chain, forwards

1. Two open ports: FTP (21) and HTTP (80, WordPress).
2. A directory sweep finds **`/announcements`** — an open listing with an image and a `wordlist.txt`.
3. The `wordlist.txt` is rockyou's first 50 000 words with **one word swapped in**. That one word is
   the **steghide passphrase** for the image; extracting gives **FTP credentials**.
4. FTP logs in — but the tree you land in is a **decoy** WordPress, not the live site. Its
   `wp-config.php` hands you **phpMyAdmin credentials**.
5. phpMyAdmin is full DBA. The live site uses one database; the decoy uses another. **The decoy
   database's `siteurl` names a second vhost, `subdomain.adana.thm`, whose web root *is* the
   FTP-writable tree.** Upload a PHP web shell over FTP, browse it through that vhost → **www-data RCE**.
6. `www-data` → `hakanbey`: the password is `123adana` + a `wordlist.txt` word; brute `su` → **user**.
7. `hakanbey` → `root`: a SUID binary reveals a secret string via `ltrace`, copies `root.jpg` out; the
   bytes at hex offset `0x20` decode **From Hex → To Base85** to root's password → `su root` → **root**.

---

## Recon — count the ports first, because the question does

A **port** is a numbered door on a machine; a service listens behind each open one. The first room
question asks *how many ports are open*, which is a hint that the answer isn't the default. `nmap`
only scans the top 1000 ports unless told otherwise, so scan all 65535:

```bash
nmap -sT -p- 10.130.148.206
```

- `-sT` is a **TCP connect** scan (it completes a normal three-way handshake). The faster `-sS`
  ("SYN"/half-open) scan needs raw-socket access, i.e. root; on a box with no `sudo` it fails
  instantly, so `-sT` is the safe default when you're unprivileged.
- `-p-` means **every port, 1–65535**, not just the top 1000.

```
21/tcp open  ftp     vsftpd 3.0.3
80/tcp open  http    Apache httpd 2.4.29 (Ubuntu) — WordPress 5.6
```

**Two open ports.** Anonymous FTP is refused (`530`), so port 21 needs credentials we don't have yet.

## The web layer — read the page before the wordlist

Fetch the homepage and read its source. Every link points at the hostname **`adana.thm`**, not the
IP — the WordPress "site URL" is set to that name, so its redirects go there. Put it in `/etc/hosts`
(or pin it in your HTTP client) so links resolve.

Then a directory sweep. A **directory sweep** asks the server for many paths from a wordlist and keeps
the ones that exist. The trap here is that this app answers `404` for missing paths, and `ffuf`'s
default matcher *doesn't include 404* — so measure a known-missing path first and filter by its exact
body size, and match all codes:

```bash
# baseline: what does a definitely-missing path return? (status AND size)
# then sweep, matching everything and filtering that baseline size:
ffuf -u http://10.130.148.206/FUZZ -H "Host: adana.thm" \
     -w /usr/share/wordlists/dirb/common.txt -mc all -fs <baseline-size> -t 25
```

Among the WordPress paths, one stands out: **`/announcements`** — that's the second room answer.

```
/announcements/
├── austrailian-bulldog-ant.jpg   (an ant photo)
└── wordlist.txt                  (394 KB, 50 000 lines — a rockyou subset)
```

## The steganography step — but first, is the wordlist even rockyou?

An image plus a password list *screams* "steghide brute-force." Look at the picture first (sometimes
the answer is painted right on it) — here it's just an ant. So it is real steganography, and the
`wordlist.txt` is the passphrase list.

Before trusting any brute-force result, ask a cheaper question: **is this list exactly rockyou, or was
it tampered with?**

```bash
diff <(head -50000 rockyou.txt | sort -u) <(sort -u wordlist.txt)
```

**Exactly one line differs** — one rockyou word removed, one new word inserted. That inserted word is
the planted passphrase. steghide extracts a short base64 note:

```bash
steghide extract -sf austrailian-bulldog-ant.jpg -p '<the planted word>'
base64 -d steghide.out
```

```
FTP-LOGIN
USER: hakanftp
PASS: <redacted>
```

> **Wrong turn #1 (cheap, but a repeat offender).** My first brute-force reported *no hit* across
> "50 000" candidates. It was a lie: `xargs` aborts on a rockyou entry that contains an unmatched
> quote, and I had piped its error to `/dev/null`, so a run that tried only 22 % of the list looked
> like a clean, complete negative. **Never silence a tool's stderr until you've watched it work**, and
> make a brute-forcer *count its own attempts* — if it claims 50 000, it must have made 50 000.

## FTP — you're inside, but not where you think

The credentials log in. The listing looks exactly like a WordPress web root (`index.php`, `wp-admin`,
`wp-config.php`, `/announcements`), so the obvious move is to upload a PHP shell and browse to it:

```bash
# upload a webshell over FTP...
# ...then visit http://adana.thm/shell.php   ->   404. Every vhost. Every path.
```

It 404s. This is the room's **"what we see is not what we think."** Three independent facts prove the
FTP tree is **not** the live web root:

- A file uploaded to the FTP root is not served on `adana.thm`, the IP, or `localhost`.
- The FTP `wp-config.php` names database **`phpmyadmin1`**; the *live* site (proved later) reads a
  **different** database, `phpmyadmin`.
- Renaming the FTP tree's `announcements/` doesn't change what `/announcements/` serves on the web.

So the FTP tree is a **decoy WordPress in a user's home directory**. What it *does* give you, in its
root-owned `wp-config.php`, is a working **phpMyAdmin login**:

```
DB_NAME     phpmyadmin1
DB_USER     phpmyadmin
DB_PASSWORD <redacted>
```

There are also worthwhile breadcrumbs in the home: a `.bash_history` that ends with `su root`, telling
you the endgame is *become a user, then `su`*.

## phpMyAdmin — full DBA, and the long rabbit hole

`http://adana.thm/phpmyadmin` with those credentials logs straight in with
`GRANT ALL PRIVILEGES ON *.* WITH GRANT OPTION` — full database administrator. The obvious next step
is the textbook phpMyAdmin-to-shell: write a PHP file into the web root with SQL.

**And here is where I disappeared into the room for a long time.** Every standard technique is walled,
and each wall is real — I verified all of them:

- `SELECT … INTO OUTFILE '/var/www/html/x.php'` → `#1290 secure-file-priv` (writes are confined to
  `/var/lib/mysql-files/`, which Apache doesn't serve and www-data can't even enter).
- The `general_log` web-shell trick *does* write a `.php` into the web root — but the file lands
  `mysql:mysql` mode `0640`, and **www-data isn't in the `mysql` group**, so Apache returns `500`
  "can't open script." (A plain `.txt` written the same way returns `403` while a normal file returns
  `200` — that's how you *prove* it's a permission wall, not an Apache rule.)
- The WordPress theme/plugin editor is read-only (`wp-content` is root-owned).
- Media upload works, but WordPress only ever writes a non-executable `.jpg`.
- No local-file-include in WordPress 5.6 or phpMyAdmin 4.6.6; the theme-`template` LFI is blocked
  because `mysql-files` is `0770`; egress is blocked so reverse shells and OOB XXE are dead too.

I confirmed all of that rigorously and wrote "this instance is walled, redeploy it." **I was wrong.**

> **Wrong turn #2 — the expensive one, and the whole point of this write-up.** I had *full database
> read* and never selected one column. The live site reads DB `phpmyadmin`; I checked *its* `siteurl`
> (`http://adana.thm`) and moved on. I never read the **decoy** database's `siteurl`:
>
> ```sql
> SELECT option_value FROM phpmyadmin1.wp_options WHERE option_name = 'siteurl';
> -- http://subdomain.adana.thm
> ```
>
> **`subdomain.adana.thm` is a second Apache vhost, and its DocumentRoot is the FTP-writable tree.**
> The whole "it's walled" conclusion evaporated the moment I read that row. The rule I broke:
> *follow the reference, don't guess it* — I had guessed `dev.`, `ftp.`, `test.` as subdomains and
> given up, while the decoy config named the real one for me. When you hold a decoy's configuration,
> **read what it points at before you declare a dead end.**

## Foothold — web shell over FTP, served on the subdomain

Add `subdomain.adana.thm` to `/etc/hosts`, upload a tiny command web shell over FTP (the tree is
writable), and request it through that vhost:

```bash
# upload shell.php via FTP to the decoy home root, then:
curl 'http://subdomain.adana.thm/shell.php?cmd=id'
# uid=33(www-data) gid=33(www-data) ...   pwd=/var/www/subdomain
```

Command execution as **www-data**. A web shell (command in, output out over HTTP) needs no outbound
connection, which matters because this box blocks egress — a reverse shell would never call home.

**Web flag** — it's a world-readable file in the *main* site's root (`/var/www/html`):

```bash
curl 'http://subdomain.adana.thm/shell.php?cmd=cat+/var/www/html/wwe3bbfla4g.txt'
# THM{[redacted]}
```

## www-data → hakanbey — brute `su` against a shaped wordlist

`find` is unusable as www-data (`/usr/bin/find` is `root:hakanbey`, mode `750` — no execute for
others), which is why a SUID sweep as www-data comes back empty. The escalation target is user
**`hakanbey`** (uid 1000).

Look at the passwords we've already seen: the FTP password and the stego passphrase both start
**`123adana`**. So `hakanbey`'s password is almost certainly `123adana` + one of the `wordlist.txt`
words. Build the candidates and brute `su`:

```bash
sed 's/^/123adana/' wordlist.txt > candidates.txt   # 50 000 candidates
```

`su` deliberately sleeps ~2 seconds after a **wrong** password (`pam_faildelay`), which makes a naive
serial brute take hours. Two ways past it: the classic tool `sucrack` (many parallel `su` workers), or
a small parallel **PTY** brute-forcer that feeds the password, watches briefly for a success marker,
and **kills each child before its fail-delay fires** — so a wrong guess costs ~0.4 s instead of 2 s.
(`su` needs a real terminal; you drive it through a `pty.fork()`, not a pipe.) Either way it lands
quickly:

```
hakanbey : 123adana<redacted>     # 123adana + an ordinary rockyou word
```

```bash
su hakanbey        # (feed the password through a PTY)
cat /home/hakanbey/user.txt
# THM{[redacted]}
```

## hakanbey → root — a SUID binary, ltrace, and CyberChef

Now `find` works. There's a custom SUID-root binary:

```bash
find / -perm -4000 -type f 2>/dev/null
# ... /usr/bin/binary
```

`-perm -4000` matches the **SUID** bit — a program that runs as its *owner* (root) regardless of who
launches it. Run it and it demands a "correct string." Don't guess: `ltrace` shows every library call,
and this binary literally assembles the expected string with `strcat` right in front of you, then
`strcmp`s it against your input:

```bash
echo test | ltrace /usr/bin/binary 2>&1 | grep -E 'strcat|strcmp'
# strcat("<frag>", "<frag>") = "<partial>"     <- the secret assembles piece by piece
# strcat(...)                = "<the secret>"
# strcmp("test", "<the assembled secret>") = ...   <- your input vs the secret
# strcat("pkill", " -9")     = "pkill -9 -t pts/0" <- WRONG answers run this: it kills your terminal
```

That `pkill -9 -t pts/0` on a wrong answer is the room's *"you will disappear in the room"* — a literal
trap that kills your session. Feed it the **correct** assembled string and it copies `/root/root.jpg`
into `hakanbey`'s home and prints a hint:

```
Hint! : Hexeditor 00000020 ==> ???? ==> /home/hakanbey/root.jpg (CyberChef)
```

The bytes at **hex offset `0x20`** (16 bytes) are the payload. The room's root-flag hint —
**From Hex → To Base85** — is a CyberChef recipe: take those 16 bytes as a hex string, `From Hex` to
turn it back into raw bytes, then `To Base85` (Ascii85). The output is literally:

```
root:<redacted>
```

```bash
su root            # (again, via a PTY)
cat /root/root.txt
# THM{[redacted]}
```

Root.

---

## What the room was teaching (and what it cost me)

Three decoys, each dressed as the obvious path:

- The **FTP tree** looks like the web root. It's a separate site on a hidden vhost.
- **phpMyAdmin** looks like your shell (it's full DBA), and every textbook phpMyAdmin RCE is
  deliberately walled off — so you burn hours there if you insist on it.
- The **SUID binary** looks like it wants a password; a wrong one deletes your terminal.

The single lesson worth carrying out of this box: I had every fact I needed — full database read —
and still declared the target unsolvable, because I **guessed** subdomains instead of **reading** the
one the decoy database named in its own `siteurl`. When a box hands you a decoy's configuration, the
decoy is not just noise to step around; it's a map. Read where it points before you conclude there's
nowhere to go.

*(Everything on the target that this exercise created — the web shell, the temporary files, the
database changes made while probing — was removed afterward and the removals verified; the write-up's
private notes keep the full teardown record.)*
