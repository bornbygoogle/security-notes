---
description: "TryHackMe DigDug — a DNS server that only answers for one domain nobody on the internet has heard of. The 'special type of request' in the room text turns out not to be a rare record type: the server sends the flag back as a TXT record for any question about givemetheflag.com, even when you asked for an A record. The real trick is the @ in dig @server, which sends the question to the target instead of your own resolver. Every command and flag explained for a beginner, with the controls that prove the answer isn't an echo, and the wrong turns kept in: a zsh loop that silently asked about a name with a space in it, a hint that pulled the plan toward exotic record types, and an ANY query that fails in a way still unexplained."
---

# DigDug — ask the right server, and the flag is just a TXT record

**TryHackMe · challenge: DigDug · target: `10.x.x.x` (the lab IP changes per lease)**

> **Flags are redacted in this write-up.** The commands, outputs, dead ends and reasoning are all
> here — those are what teach. The flag string itself teaches nothing; it is just proof you were
> there, and publishing it hands the room's answer to the next person instead of letting them earn
> it. The domain name `givemetheflag.com` is kept, because the room gives it to you and the method
> doesn't work without it.

| # | question | answer |
|---|---|---|
| 1 | retrieve the flag from the DNS server | `flag{[redacted]}`, the TXT record for `givemetheflag.com` |

The whole solve is one command:

```bash
dig @10.x.x.x givemetheflag.com TXT
```

The rest of this page is about why that works, how to be sure the answer is real, and what didn't
work on the way.

**Methodology phase:** this room is all **recon and enumeration**. There's no exploitation step and
nothing to escalate. The skill being tested is knowing which server to ask and how to read its answer.

---

## What you need to know before we start

- An **IP address** identifies a machine on the network, like a street address identifies a house.
- A **port** is a numbered door into one program on that machine. Port **53** is the standard door
  for DNS.
- **UDP vs TCP** are two ways of talking through a port. **TCP** sets up a connection first, like a
  phone call. **UDP** sends one packet and waits for one back, like a postcard. Normal DNS questions
  use UDP. DNS uses TCP for very large answers and for **zone transfers** (below).
- **DNS (Domain Name System)** is the internet's phone book: give it a name, it gives you back facts
  about that name.
- A **record type** says which fact you want:
  - `A`: the name's IPv4 address. This is what you get if you don't ask for a type.
  - `TXT`: a free-text note on the name. Real-world uses include SPF (Sender Policy Framework) mail
    rules. CTFs hide flags in it.
  - `MX` (mail server), `NS` (name server), `SOA` (the zone's admin record).
  - `ANY` (type number 255): "everything you've got for this name".
  - `AXFR`: a **zone transfer**, meaning "send me your whole phone book for this domain". A server
    that hands this to strangers is a classic finding.
- **Resolver vs authoritative server.** Your computer normally asks a **resolver** (your router,
  your ISP, `8.8.8.8`), which looks the answer up on the public internet for you. An **authoritative**
  server is the one that actually holds a domain's records. Here the target is authoritative for a
  domain that doesn't exist on the public internet, so the target is the only place the record lives.
- **`dig`** (Domain Information Groper) asks DNS questions and prints the full answer. `nslookup` and
  `host` do the same with less detail. All three are on the AttackBox.

---

## Step 1 — ask the target, not your resolver

```bash
dig @10.x.x.x givemetheflag.com TXT
```

- `dig`: the query tool.
- `@10.x.x.x`: **which server to ask.** This is the whole room. Without it, dig asks whatever
  resolver your machine is configured with.
- `givemetheflag.com`: the name, straight from the room description.
- `TXT`: the record type. Leave it off and dig asks for `A`.

```
;; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 314
;; flags: qr aa; QUERY: 1, ANSWER: 1, AUTHORITY: 0, ADDITIONAL: 0

;; QUESTION SECTION:
;givemetheflag.com.		IN	TXT

;; ANSWER SECTION:
givemetheflag.com.	0	IN	TXT	"flag{[redacted]}"

;; SERVER: 10.x.x.x#53(10.x.x.x) (UDP)
```

Reading it:

- `status: NOERROR`: the question was fine. You'll also meet `NXDOMAIN` ("no such name") and
  `REFUSED` ("not answering you").
- `flags: qr aa`: `qr` means this is a reply. `aa` means **authoritative answer**: the server says
  it owns this domain.
- `ANSWER: 1`: one record came back.
- The answer line: name, **TTL** (time to live: how many seconds a resolver may cache it, here `0`),
  class `IN`, type `TXT`, and the value, which is the flag.
- `(UDP)`: the answer came over UDP port 53, as expected for DNS.

`nslookup` and `host` get the same answer. In both, the last argument is the server to ask:

```bash
nslookup -type=TXT givemetheflag.com 10.x.x.x     # -type=TXT: the record type
host -t TXT givemetheflag.com 10.x.x.x            # -t TXT: the record type
```

```
givemetheflag.com	text = "flag{[redacted]}"
givemetheflag.com descriptive text "flag{[redacted]}"
```

---

## Step 2 — prove it isn't an echo

Getting a flag-shaped string back isn't proof on its own. A server that answers every question with
the same string would look exactly like this. So check with questions whose answers you can predict.

### Ask for an A record

```bash
dig @10.x.x.x givemetheflag.com          # no type, so dig asks for A
```

```
;givemetheflag.com.		IN	A
givemetheflag.com.	0	IN	TXT	"flag{[redacted]}"
```

The **question** says `A` and the **answer** says `TXT`. A real DNS server never answers a different
type from the one asked. This one is hand-written to hand out the flag for any question about this
name (MX gives the same TXT too). So the "special type of request" in the room text doesn't need a
rare record type. A plain `dig @server givemetheflag.com` already returns the flag.

### Ask about names that can't have a flag

```bash
dig @10.x.x.x nonexistent.givemetheflag.com
dig @10.x.x.x example.com
```

Both come back `status: NOERROR`, `ANSWER: 0`. So the server **did** reply, which proves the channel
works, and it did **not** send the flag. The flag answer is tied to `givemetheflag.com` itself.
That's what rules out the echo. (A proper server would say `NXDOMAIN` for a name that doesn't exist.
An empty `NOERROR` is called **NODATA**, and it's one more sign this is a toy responder.)

### Ask without the `@`

```bash
dig givemetheflag.com TXT +time=3 +tries=1
#   +time=3   wait 3 seconds per attempt (the default is 5)
#   +tries=1  send the question once
```

```
;; ->>HEADER<<- opcode: QUERY, status: NXDOMAIN, id: 3313
;; SERVER: 192.168.1.1#53(192.168.1.1) (UDP)
```

The question went to my own router (`192.168.1.1`), which asked the public internet, and the public
internet says the domain doesn't exist. **If you forget the `@`, this is what you see**, and it looks
like the room is broken.

---

## Step 3 — the doors that are shut

A zone transfer would dump every record in one go, so it's worth one try:

```bash
dig @10.x.x.x givemetheflag.com AXFR
```

```
;; Connection to 10.x.x.x#53(10.x.x.x) for givemetheflag.com failed: connection refused.
```

AXFR always uses **TCP**, and "connection refused" means nothing listens on TCP port 53. A port scan
confirms it:

```bash
nmap -Pn -sT -p53 10.x.x.x
#   -Pn    don't ping first; scan even if the host ignores pings
#   -sT    TCP connect scan: a full handshake; needs no root
#   -p53   only port 53
```

```
53/tcp closed domain
```

So the server is UDP only, and there's no zone transfer to be had. (A UDP scan, `-sU`, needs root.
You don't need it here: the dig answers already prove UDP 53 is open.)

---

## Wrong turns

**1. A shell loop that printed nothing.** One of my first checks was a loop like
`for q in "givemetheflag.com TXT"; do dig @10.x.x.x $q | grep ...; done`. It printed nothing at all.
The shell was **zsh**, and unlike bash, zsh doesn't split an unquoted `$q` on spaces. So dig was asked
about a single name, literally `givemetheflag.com TXT` with a space in it, and it timed out. The
`grep` then filtered away the timeout message, which is the part that would have explained it. Under
bash, the identical loop prints the flag.
*Rule:* pass the name and the type as separate quoted arguments (`dig @s "$name" "$type"`), and don't
pipe a command into `grep` until you've seen it work once unfiltered.

**2. Taking the hint too literally.** "Only responds to a special type of request" made me plan a
sweep of unusual record types (MX, AAAA, HINFO, numeric types) and CHAOS-class queries. But the
very first round of plain A, NS, SOA and TXT questions had already returned the flag.
*Rule:* when you already have the answer, prove it with controls (Step 2) before chasing the hint
into a bigger search.

**3. A paraphrased error.** My first notes said the `ANY` query "timed out". Re-running it showed
`connection refused` every time, through dig, `dig ... TYPE255`, `dig ... +ignore` and nslookup, while
MX and TXT queries right before and after were answered. My first explanation was that a truncated
UDP answer made dig retry over TCP, which is closed. `+ignore` stops that retry and the error
didn't change, so that explanation is wrong. The likely remaining cause is that the server answers
`ANY` with an ICMP "port unreachable", which a UDP socket reports as "refused". Settling it needs a
packet capture (`sudo tcpdump -ni tun0 udp port 53`), and since it's off the path to the flag, I've
left it **open**.
*Rule:* copy the tool's exact error. "Timeout" and "refused" point at different causes.

**4. A capture that ate its own file.** I saved two commands into one file with a helper that wrote
to `/dev/stdout` inside a block already redirected to that file. Each `> /dev/stdout` re-opened the
file and truncated it, so the second command wiped the first one's output.
*Rule:* one command, one evidence file.

---

## What to take away for the exam

- `dig @SERVER NAME TYPE` is the shape of every DNS question you'll ask a target. The `@` decides who
  answers.
- Read the header before the answer: `status`, the `aa` flag, and the `ANSWER:` count tell you
  whether you're looking at a real reply.
- Always pair a positive result with a negative control: a name that shouldn't answer, from the
  same server, in the same session.
- Try AXFR on any DNS server you find. Here it was refused, but on other boxes it hands you every
  hostname at once.
