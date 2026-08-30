# TryHackMe — Flip (AES-CBC bit-flip)

**Flags are redacted here.** Every command, byte offset and dead end is intact; only the flag
string is replaced with `[redacted]`. The flag proves you were there — it teaches nothing, and
publishing it just hands the room's answer to the next person.

> The room gives you a Python file (`app.py`) that runs a small TCP service on port 1337, sends
> you the AES-CBC encryption of `access_username=<your-username>&password=<your-password>`, and
> then accepts a ciphertext of your choice and decrypts it with the same key. The flag is returned
> if the decrypted plaintext (after PKCS#7 unpad) **contains** the 25-byte substring
> `admin&password=sUp3rPaSs1`. The literal `admin` / `sUp3rPaSs1` pair is rejected up front; the
> substring has to be **produced by the decryption**, not typed in.

This is a textbook **AES-CBC bit-flip**. The room's name tells you so.

---

## 1. Read the source

`app.py` is short and the interesting part is the check:

```python
def decrypt_data(encryptedParams, key, iv):
    cipher = AES.new(key, AES.MODE_CBC, iv)
    paddedParams = cipher.decrypt(unhexlify(encryptedParams))
    if b'admin&password=sUp3rPaSs1' in unpad(paddedParams, 16, style='pkcs7'):
        return 1
    else:
        return 0
```

Two things matter:

1. **The check is `in`.** The server accepts any plaintext that *contains* the 25-byte target
   substring. The rest of the plaintext is ignored.
2. **Same key and IV** are used for encrypt and decrypt. Whatever ciphertext the server leaks is
   encrypted with the exact same key/iv the server will use on my reply.

No MAC, no IV change, no per-direction key schedule. CBC with no integrity = malleable.

---

## 2. The math of a CBC bit-flip

A reminder of the property we are abusing. For ciphertext block `C[i]` and plaintext block
`P[i+1]`:

```
P[i+1] = D(C[i+1]) XOR C[i]
```

If I change `C[i]` to `C[i]'`, the new plaintext is:

```
P[i+1]' = D(C[i+1]) XOR C[i]' = (D(C[i+1]) XOR C[i]) XOR (C[i] XOR C[i]') = P[i+1] XOR (C[i] XOR C[i]')
```

So: **to turn `P[i+1]` into the byte I want at offset `j`, XOR the corresponding byte of
`C[i-1]` with `P[i+1][j] XOR P[i+1][j]_desired`**. (We flip the *previous* block's byte, not the
current one — the current one would garble `P[i]` instead.)

Two honest disclaimers:

- Modifying `C[i-1]` garbles `P[i-1]`. I don't care — I have no use for the garbled block.
- The last block of the ciphertext holds PKCS#7 padding. I do not touch it, so unpad still
  works.

---

## 3. Construct inputs that put the target one byte away

I want the decrypted plaintext to contain `b'admin&password=sUp3rPaSs1'` (25 bytes) but the
*original* plaintext (before my flip) to be the same string **with one byte different**. That
gives me a single-byte flip and the rest of the math falls out for free.

Username = `admin&password;sUp3rPaSs1` (24 bytes)
- This is the target string with `;` (0x3B) at offset 14 instead of `=` (0x3D).

Password = `x` (1 byte)

Full plaintext the server will build:
```
access_username=admin&password;sUp3rPaSs1&password=x
```

That's 52 bytes. PKCS#7 pads to 64 bytes (4 AES blocks). Block layout:

| Block | Bytes | Content |
|---|---|---|
| `P[0]` | 0–15   | `access_username=` (the prefix; will be garbled by the flip) |
| `P[1]` | 16–31  | `admin&password;s` (contains the `;` at offset 14 of this block) |
| `P[2]` | 32–47  | `Up3rPaSs1&passwo` (intact) |
| `P[3]` | 48–63  | `rd=x` + 12 bytes of `\x0c` (intact PKCS#7 padding) |

The target byte is at **plaintext offset 30**, which is **byte 14 of `P[1]`**. To control that
byte I flip the **same offset** in `C[0]` (the previous ciphertext block). The mask is
`0x3B XOR 0x3D = 0x06` — one byte, single XOR.

After the flip:

- `P[0]` becomes random — discarded
- `P[1]` becomes `admin&password=s` (the `;` is now `=`) — the first 16 bytes of the target
- `P[2]` is `Up3rPaSs1&passwo` — the next 9 bytes are the rest of the target
- `P[3]` is intact padding — unpad strips the 12 `\x0c` bytes, leaving 52 bytes

The 25-byte target substring is now contiguous across `P[1]` and `P[2]`, the `in` check passes,
the flag is returned.

---

## 4. Validate locally before sending anything to the server

A pure-crypto attack is fully reproducible without the network. I built a local validator that
runs the exact `encrypt_data` / `decrypt_data` primitives on identical inputs and confirms the
bit-flip produces the target substring after unpad. The script is the same code the server runs;
the only difference is the server also prints the flag.

```python
# from evidence/flip_local_validate.py
USERNAME = "admin&password;sUp3rPaSs1"
PASSWORD = "x"
plaintext = f"access_username={USERNAME}&password={PASSWORD}"
assert b"admin&password=sUp3rPaSs1" not in plaintext.encode()  # pre-filter would reject

ct = bytes.fromhex(encrypt_data(plaintext, key, iv))
ct[14] ^= 0x06       # flip the ';' to '=' by toggling C[0][14]

recovered = decrypt_data(ct.hex(), key, iv)
assert b"admin&password=sUp3rPaSs1" in recovered   # ← this is the success condition
```

Run output (abbreviated; full file in `evidence/flip_local_validate.out`):

```
[+] Plaintext length: 52 bytes
[+] Plaintext: 'access_username=admin&password;sUp3rPaSs1&password=x'
[+] Pre-filter check: PASS (forbidden substring NOT in plaintext)
[+] Ciphertext: 4 blocks (64 bytes)
    P[0]: b'access_username='
    P[1]: b'admin&password;s'
    P[2]: b'Up3rPaSs1&passwo'
    P[3]: b'rd=x\x0c\x0c\x0c\x0c\x0c\x0c\x0c\x0c\x0c\x0c\x0c\x0c'
[+] Target byte at plaintext index 30
[+] In block P[1], byte 14
[+] Mask: 0x3b XOR 0x3d = 0x06
[+] Recovered (52 bytes): b'...\xfaadmin&password=sUp3rPaSs1&password=x'
    P[0]: b'...'      # garbled, irrelevant
    P[1]: b'admin&password=s'
    P[2]: b'Up3rPaSs1&passwo'
    P[3]: b'rd=x'
[+] ATTACK VALIDATED LOCALLY
```

Two things to look at:

- `Pre-filter check: PASS` — the server will not reject the chosen inputs upfront.
- `P[1]: b'admin&password=s'` — after the flip, block 1 of the recovered plaintext contains the
  first 16 bytes of the target. Block 2 already holds the next 9 bytes. The 25-byte target
  substring is contiguous.

**The math is verified; the live run is just sending it over TCP.**

---

## 5. Live execution

The exploit is a pwntools-based TCP client in `evidence/flip_exploit.py`. The flow:

1. Connect to the service.
2. Read the banner and the `Leaked ciphertext: ...` line.
3. Modify one byte of the leaked ciphertext: `C[0][14] ^= 0x06`.
4. Send the modified ciphertext back when prompted.
5. Read the server's response.

Live transcript (from the session chat log, 2025-08-29):

```
Leaked ciphertext: cd20fcfb7982539b1a7118c416592f11c4c7240ff3ace3a51c27f8ddd73d27cf4e7a4e854ae6b42a251a695120e922b28319f5742b8fe02289f3368bcfbe7c85

Modified ciphertext: cd20fcfb7982539b1a7118c416592911c4c7240ff3ace3a51c27f8ddd73d27cf4e7a4e854ae6b42a251a695120e922b28319f5742b8fe02289f3368bcfbe7c85

Server response:
No way! You got it!
A nice flag for you: [redacted]
```

One byte changed in the hex (offset 30 of the ciphertext). Everything else is the same. The
server decrypted the modified ciphertext, found the target substring, and returned the flag.

---

## 6. What I ruled out along the way

| Hypothesis | Result |
|---|---|
| Use a different username/password shape that *literally* contains the substring | the pre-filter rejects the literal `admin&password=sUp3rPaSs1` anywhere in the input — the substring has to be produced by decryption |
| Use CBC's two-block "set both target blocks independently" approach | requires editing two non-adjacent ciphertext blocks and still leaves a garbled block in the middle; the single-byte flip is strictly simpler |
| ECB bit-flip (the more famous textbook example) | this is CBC, not ECB — different math |
| Brute-force the key from the leaked ciphertext | no useful key signal in CBC ciphertext; key+IV change per connection anyway |
| Pad the username so the `;` falls at a 16-byte boundary (no flip needed) | same complexity; the single-flip approach is the cleanest |

---

## 7. Wrong turns, and the rule each one earns

1. **I tried a 2-block flip first** (set both `admin&password=s` and `Up3rPaSs1` via two
   ciphertext-block edits), then realised that editing the *current* block garbles the *previous*
   plaintext block. The single-byte approach is strictly cleaner and was in front of me from
   the start.
   → **Read the math, not just the goal. The number of edits you need is the number of
   well-separated `goal-byte XOR desired-byte` masks, not the number of goal-bytes.**

2. **I almost miscounted the target length** (it's 25 bytes, not 16 or 32). I wrote the
   validator, ran it, and the recovered block 1 was `admin&password=s` plus 9 bytes of the target
   in block 2 — exactly the right split. The local run caught the error before I burned a
   connection.
   → **Validate the math locally before paying the network round trip. A pure-crypto attack
   has no excuse to skip a one-script local check.**

---

## 8. What the developers should have done

- **Add a MAC.** With AES-GCM or any AEAD construction, modifying a single ciphertext byte
  invalidates the authentication tag. The flag check is never reached.
- **Parse the decrypted plaintext, don't substring-match.** If the protocol expects
  `access_username=<user>&password=<pass>`, split on `&`, validate each part, reject the request
  if the structure is wrong. A bit-flipped ciphertext won't parse, so the failure is detected
  before the substring check.
- **Don't echo the user's input back as a leaked ciphertext.** That's a debug aid turned into
  an oracle. A real protocol keeps the encryption internal.

---

## 9. Answers

| Question | Answer |
|---|---|
| Flag | `[redacted]` |

The flag was returned by the live server on 2025-08-29. Verified locally by
`evidence/flip_local_validate.py`. The lab was not re-attacked for this writeup (TryHackMe lab
offline as of 2025-08-29).
