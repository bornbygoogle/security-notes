---
description: "TryHackMe challenge #20 (Order) — a repeating-key XOR cipher broken with a known-plaintext crib. Every message starts with the same six-character header, and XOR hands you the key the moment you know any plaintext. Includes the control that caught three different key lengths all scoring a perfect 100% on the wrong acceptance test."
---

# Order — the header that gave away the key

**TryHackMe · challenge #20 · category: cryptography**

> **The flag is redacted** here as `THM{[redacted]}`, and so is the target name — because in this
> challenge the target name *is* the flag's contents, so printing it would be redaction theatre.
>
> **What I kept and why:** the recovered key `SNEAKY`, every command, and the full reasoning — the
> technique is the whole lesson. The intercepted message is two 31-byte blocks: block 1 carries the
> `ORDER:` header the crib attack needs, block 2 carries the flag.
>
> **Block 2 is truncated here** (`1a0d0c302d3b…`) on purpose. Ciphertext-plus-key would otherwise
> reproduce the flag one XOR apart, so this page keeps everything that teaches the attack — the key,
> the crib, block 1 in full, the first six bytes of block 2 for the length analysis — while eliding
> the bytes that spell the answer. Solve the room yourself for the full message.

The brief:

> We intercepted one of Cipher's messages containing their next target. They encrypted their message
> using a repeating-key cipher. However, they made a critical error — every message always starts
> with the header: `ORDER:`
> Can you help void decrypt the message and determine their next target?

And the intercepted message:

```
1c1c01041963730f31352a3a386e24356b3d32392b6f6b0d323c22243f6373
1a0d0c302d3b…                        # flag-bearing bytes redacted
```

That sentence — *"every message always starts with the header `ORDER:`"* — is not flavour text. It
is the entire vulnerability, handed to you in the brief. By the end of this page you will see why
it collapses the whole cipher in one line of arithmetic.

This one is solved entirely offline. No target machine, no VPN, no scanning. 62 bytes of hex and a
Python interpreter.

---

## The background you need first

If you already know what XOR and hex are, skip to *Step 1*. If not, read this — the rest of the
page depends on it and it takes two minutes.

### Bytes and hex

A computer stores everything as **bytes**. One byte is a number from 0 to 255. Text is stored by
agreeing on which number means which letter — that agreement is called **ASCII**. Capital `A` is 65,
capital `B` is 66, lowercase `a` is 97, a space is 32.

Writing bytes as decimal numbers is clumsy, so we write them in **hexadecimal** ("hex") — base 16,
using the digits `0`–`9` and then `a`–`f` for 10–15. One byte is always exactly **two hex
characters**. So `41` in hex is 65 in decimal, which is the letter `A`.

That is what the intercepted message is: a run of two-character chunks, each one a byte.
`1c` `1c` `01` `04` `19` `63` and so on.

### XOR

**XOR** (exclusive or, written `^`) is an operation on two bits — a bit being a single 0 or 1.
The rule is: **the answer is 1 when the two inputs are different, and 0 when they are the same.**

| a | b | a ^ b |
|---|---|-------|
| 0 | 0 | 0 |
| 0 | 1 | 1 |
| 1 | 0 | 1 |
| 1 | 1 | 0 |

To XOR two whole bytes you line up their 8 bits and apply that rule to each column.

XOR has one property that makes it popular for cheap ciphers, and the same property is what
destroys it. **XOR is its own inverse.** Applying the same value twice gets you back where you
started:

```
(P ^ K) ^ K = P
```

So encryption and decryption are literally the same operation. Encrypt with key `K`, and to decrypt
you XOR with `K` again. That is convenient. It is also the flaw, because rearranging the same
equation gives:

```
C = P ^ K        (encrypting: ciphertext = plaintext XOR key)
P = C ^ K        (decrypting: plaintext = ciphertext XOR key)
K = C ^ P        (attacking:  key = ciphertext XOR plaintext)   <-- this one
```

Read that third line again. **If you know any stretch of the plaintext, XORing it against the
matching stretch of ciphertext gives you the key bytes underneath it.** Not a hint about the key.
The key itself.

### "Repeating-key"

A one-byte XOR key is trivially breakable — there are only 256 of them, you try all 256. So people
use a longer key, a word like `SNEAKY`, and wrap it around: byte 0 of the message is XORed with
`S`, byte 1 with `N`, … byte 5 with `Y`, byte 6 with `S` again, and so on forever. This is the byte
version of the classical **Vigenère** cipher.

Repeating the key is what makes it attackable, because the same key byte lands on many different
message positions. Normally you break it by working out the key *length* first (Kasiski examination,
or index-of-coincidence scoring) and then solving each position by frequency analysis.

**We do not have to do any of that here**, because the brief handed us known plaintext.

### Crib

A stretch of plaintext you know in advance is called a **crib** — the term comes from Bletchley
Park, where German weather reports reliably contained the word `WETTER` and message headers
reliably contained `KEINEBESONDERENEREIGNISSE` ("nothing to report"). Predictable, repeated
formatting is a cryptanalyst's best friend, and it still is. Cipher's mistake here is exactly the
Enigma operators' mistake: every message opens with the same fixed header.

A **known-plaintext attack** is any attack that uses a crib. Against repeating-key XOR it is not
merely helpful — it is a complete break, in one step.

---

## Step 1 — save the message and count the bytes

Before anything clever, know how much data you have. Guessing at the shape of your input is how you
waste an hour later.

```bash
cat > ciphertext.hex <<'EOF'
1c1c01041963730f31352a3a386e24356b3d32392b6f6b0d323c22243f6373
1a0d0c302d3b…                        # flag-bearing bytes redacted
EOF
```

`cat > file <<'EOF'` is a **heredoc**: it writes everything up to the closing `EOF` line into
`ciphertext.hex`. The quotes around `'EOF'` stop the shell from trying to interpret anything inside
as a variable — with hex data that hardly matters, but it is the habit you want when the content is
attacker-supplied and might contain `$` or backticks.

Now count:

```bash
python3 -c "
h = open('ciphertext.hex').read().split()
print('lines:', len(h))
for i, l in enumerate(h):
    print(f'  line{i+1}: {len(l)} hex chars -> {len(l)//2} bytes')
print('joined:', len(''.join(h))//2, 'bytes')
"
```

`python3 -c "..."` runs the code in the quotes instead of a script file. `.read().split()` reads the
file and splits it on whitespace, which conveniently gives one list entry per line. `len(l)//2` is
integer division — two hex characters per byte, as established above.

```
lines: 2
  line1: 62 hex chars -> 31 bytes
  line2: 62 hex chars -> 31 bytes
joined: 62 bytes
```

Two lines of 31 bytes each. **Is this one 62-byte message wrapped for display, or two separate
31-byte messages?** It matters: if they are two messages, each starts with `ORDER:` and each gets
attacked separately. 31 is a prime number and an unremarkable message length, which makes me lean
toward "one wrapped message" — but leaning is not knowing. Hold the question open; step 3 answers it
for free.

## Step 2 — decide what cipher this actually is

The brief says "repeating-key cipher". That phrase covers two different things:

- **Vigenère proper**, which shifts *letters* through the alphabet and produces letters as output.
- **Repeating-key XOR**, which XORs *bytes* and produces arbitrary bytes as output.

Look at the data to decide. It contains `01`, `0d`, `04`, `19` — byte values below 32, which are
control characters, not letters. Alphabetic Vigenère cannot produce those; it only ever outputs
letters. Arbitrary byte values plus a hex encoding (you need hex precisely *because* the output is
not printable text) means **repeating-key XOR**.

This is a small thing but it is the difference between reaching for the right tool and the wrong
one. Read the data before choosing the attack.

## Step 3 — spend the crib

Here is the whole break. The header `ORDER:` is 6 known plaintext bytes sitting at offset 0.
`K = C ^ P`, so XOR them against the first 6 ciphertext bytes and the key falls out.

I ran it against **both** lines, which simultaneously answers the open question from step 1: if line
2 is a separate message it also starts with `ORDER:`, so it must yield the same sensible key.

```bash
python3 - <<'PY'
lines = open('ciphertext.hex').read().split()
crib = b"ORDER:"
for i, l in enumerate(lines):
    ct = bytes.fromhex(l)
    k = bytes(a ^ b for a, b in zip(ct[:6], crib))
    print(f"line{i+1} first6 = {ct[:6].hex()}  XOR 'ORDER:' -> {k.hex()}  ascii={k!r}")
PY
```

Reading that code: `bytes.fromhex(l)` turns the hex text into real bytes. `zip(ct[:6], crib)` pairs
up the first 6 ciphertext bytes with the 6 crib bytes. `a ^ b` XORs each pair. `b"ORDER:"` is a
*bytes* literal rather than a string — in Python 3 you cannot XOR text, only bytes, and mixing the
two is the single most common beginner error in this kind of script.

```
line1 first6 = 1c1c01041963  XOR 'ORDER:' -> 534e45414b59  ascii=b'SNEAKY'
line2 first6 = 1a0d0c302d3b  XOR 'ORDER:' -> 555f48757f01  ascii=b'U_Hu\x7f\x01'
```

Line 1 gives `534e45414b59`, which is ASCII for **`SNEAKY`** — clean uppercase letters, obviously a
word, obviously the key.

Line 2 gives bytes including `\x7f` (delete) and `\x01` (start-of-heading). No key word contains
control characters. **So line 2 is not a message that starts with `ORDER:`** — which settles step
1's question: this is one 62-byte message, wrapped across two lines by the challenge text. The
question got answered for free by an experiment run for a different reason, which is what happens
when you run the check against every candidate rather than only the one you expect to work.

Key: `SNEAKY`, 6 bytes.

## Step 4 — decrypt

Same operation as encryption, since XOR is its own inverse.

```bash
python3 - <<'PY'
ct = bytes.fromhex("".join(open('ciphertext.hex').read().split()))
key = b"SNEAKY"
pt = bytes(c ^ key[i % len(key)] for i, c in enumerate(ct))
printable = sum(32 <= b < 127 for b in pt)
print(f"printable: {printable}/{len(pt)} = {printable/len(pt):.0%}")
print(pt.decode('latin1'))
PY
```

`key[i % len(key)]` is the repeating key, expressed in one operator. `%` is modulo — the remainder
after division. At position 0 that is `0 % 6 = 0` (key byte `S`), at position 6 it is `6 % 6 = 0`
(`S` again), at position 7 it is `1` (`N`). The key wraps automatically.

`enumerate(ct)` gives `(index, byte)` pairs so the loop knows *where* it is, which it must, because
the key byte depends on position.

`.decode('latin1')` turns bytes into text. Latin-1 rather than UTF-8 deliberately: Latin-1 maps
every one of the 256 possible byte values to some character and therefore never throws an error,
so if the key were wrong I would see garbage rather than an exception. When you do not yet trust
your data, choose the decoder that shows you what is there instead of the one that refuses.

```
printable: 62/62 = 100%
ORDER: Attack at dawn. Target: THM{[redacted]}.
```

Every byte lands in printable ASCII, and it reads as English. The header matches the brief.

## Step 5 — verify it properly (and the trap this caught)

Getting readable output feels like the end. It is not the check.

**Check one — the round trip.** If `SNEAKY` is genuinely the key, re-encrypting the recovered
plaintext must reproduce the original ciphertext byte-for-byte:

```bash
re_ct = bytes(p ^ key[i % len(key)] for i, p in enumerate(pt))
print("re-encrypt == original:", re_ct == ct)
```

```
re-encrypt == original ciphertext: True
```

**Check two — the control.** Here is the part worth the whole page. I had assumed "all 62 bytes are
printable ASCII" was a decent acceptance test for a candidate key. So I tested it: derive a key of
length L from the crib for L = 2 through 8, decrypt with each, and score them.

```bash
python3 - <<'PY'
ct = bytes.fromhex("".join(open('ciphertext.hex').read().split()))
for L in (2,3,4,5,6,7,8):
    k = bytes(a ^ b for a, b in zip(ct[:L], (b"ORDER: Attack")[:L]))
    p = bytes(c ^ k[i % L] for i, c in enumerate(ct))
    ok = sum(32 <= b < 127 for b in p)
    print(f"keylen {L}: key={k!r} printable {ok}/62 -> {p[:30].decode('latin1')}")
PY
```

(The crib is extended to `ORDER: Attack` here only so that key lengths above 6 have known plaintext
to derive from. Output truncated to the first 30 characters, which is where the interesting part is
and which keeps the flag out of this page.)

```
keylen 2: key=b'SN'       printable 59/62 -> ORRJJ- Ab{ytk w{8sawx!8Carqjl-
keylen 3: key=b'SNE'      printable 60/62 -> ORDWW& Atfdk af%xawn<%Hargwq&
keylen 4: key=b'SNEA'     printable 59/62 -> ORDEJ-6Nb{o{k at8swxx!.Largel-
keylen 5: key=b'SNEAK'    printable 62/62 -> ORDER0=Jp~yt}/of%xsrx!.Lyola~(
keylen 6: key=b'SNEAKY'   printable 62/62 -> ORDER: Attack at dawn. Target:
keylen 7: key=b'SNEAKYS'  printable 61/62 -> ORDER: \pkqa=w{.|y`x<%Hsw{wl-
keylen 8: key=b'SNEAKYSN' printable 62/62 -> ORDER: Ab{o{s7w{8swx`68Carget:
```

**Three different key lengths score a perfect 62/62.** Had "100% printable" been my acceptance
test, I would have had three winners and no way to choose between them.

Why the false positives happen: this plaintext is almost all lowercase letters and spaces — byte
values clustered in a narrow band around 0x61–0x7a and 0x20. XOR a narrow band against a *nearly*
correct key and the result usually still lands somewhere inside printable ASCII. Printability is a
weak signal on short, low-entropy English.

Key length 8 is the nastiest of the three. Its first 8 bytes are correct **by construction** —
they were derived from the crib — so it opens with a perfectly believable `ORDER: Ab` before
decaying. A candidate that looks right exactly where you cribbed it and wrong everywhere else is
what a wrong key length always looks like, and it is why *"the header decodes correctly"* proves
nothing at all. The header was guaranteed to decode correctly. You built it that way.

**The discriminator is English, not printability.** Print the candidates and read them; the
ambiguity vanishes on sight.

For longer messages where reading dozens of candidates is impractical, the automated version of
"is this English" is **frequency scoring** — compare the letter distribution of each candidate
against normal English (`e` ~12.7%, `t` ~9.1%, space most common of all) and rank by how close it
sits. That is exactly what `xortool` does when it guesses a key length, and it is the right tool if
you meet this cipher without a crib.

## The answer

- **Key:** `SNEAKY` (6 bytes, ASCII)
- **Plaintext:** `ORDER: Attack at dawn. Target: THM{[redacted]}.`
- **Next target:** redacted — it is the contents of the flag, so naming it would hand over the answer

**Verified vs assumed:** the decryption is verified — the round trip reproduces the ciphertext
exactly, all 62 bytes are printable, and the text is grammatical English with the expected header.
The flag was **not** submitted to the TryHackMe platform in this session, so it is evidence-backed
rather than platform-confirmed. That distinction matters: deriving a plausible answer and having a
scoreboard accept it are two different claims.

## Doing it without Python

Two alternatives worth knowing, because the exam does not care which tool you reach for.

**CyberChef** (browser, no install): paste the hex, add a *From Hex* operation, then an *XOR*
operation with key `SNEAKY` in UTF-8 mode. Good for a fast look; awkward when you want to script a
sweep over candidate key lengths.

**xortool** (for when there is no crib):

```bash
xortool -c 20 ciphertext.bin
```

`-c 20` tells it the most common plaintext byte is `0x20`, the space — a safe bet for English prose.
It guesses the key length by scoring, then solves each key position. Worth practising on this
challenge *pretending you never read the header*, because in the real world the brief does not
usually hand you a crib.

## What to take from this

**For the cipher itself:** repeating-key XOR is not encryption, it is obfuscation. Any known
plaintext gives up the key bytes underneath it directly, and predictable message formatting —
headers, greetings, file magic bytes, XML declarations, `PK` at the start of a zip — is known
plaintext. Cipher's protocol mandated a fixed 6-byte header and used a 6-byte key. The header alone
was enough to reveal the entire key.

**For the method, which is the part that generalises:**

- Read the brief for the vulnerability. *"Every message always starts with `ORDER:`"* was not
  scene-setting, it was the answer.
- Look at the data before picking the attack. Control bytes in the ciphertext ruled out alphabetic
  Vigenère in about five seconds.
- Run the check against every candidate, not just the one you expect to work. Testing the crib on
  line 2 was meant to confirm the key; it settled the one-message-or-two question instead.
- **Test your acceptance test.** "All printable" felt like a solid check and turned out to admit
  three answers on a 62-byte message. The cheap control that exposed it took one command. If you
  never test the check, a wrong answer that passes it looks exactly like a right one.
