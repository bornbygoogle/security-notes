---
description: "TryHackMe Trusted By Default — a blue-team Splunk investigation, not an exploit box. Three log sources (IIS web logs, Windows Security events, Zeek network logs) are already indexed; you answer a ten-question chain by writing SPL and using each answer as the pivot into the next. A lone POST to a status page → a service account's batch logon → an IT account adding that service account to a file-server admin group on the DC → the service account logging into the file server over RDP → one sustained TLS/CredSSP RDP session hiding among a month of reset probes. Every SPL query, every Windows EventCode and logon type, and the way you tell a real session from a scan — all explained for someone who has never opened Splunk. Answers redacted."
---

# Trusted By Default — following one attacker across three log sources in Splunk

**TryHackMe · challenge: Trusted By Default · Splunk "Search & Reporting", evidence pre-indexed**

> **The ten answers are redacted** in this write-up (`[redacted]` for account names, IP addresses,
> the URI, the group name and the byte count). Everything that teaches stays: every SPL query, every
> Windows Event ID, the logon-type meanings, and the reasoning that turns one clue into the next. The
> answer strings themselves teach nothing — printing them just hands the room's solution to the next
> person, who learns most by running the queries themselves.

## What kind of room this is

Most TryHackMe challenges hand you a machine and you break in. This one is the opposite. There is
**no target to hack** — instead you are the **analyst after the fact**. A breach already happened,
and every log that recorded it has been loaded into **Splunk**.

Splunk is a **SIEM** — Security Information and Event Management — which is a fancy way of saying
"a search engine for logs." You feed it log files from lots of machines, it indexes every line, and
then you ask it questions in its own query language, **SPL** (Search Processing Language). The whole
challenge is: open the search bar, write queries, and reconstruct what the attacker did.

The room gives you five hints, and they are worth taking literally:

- *Start broad enough to compare normal and abnormal activity.*
- *Inspect the returned fields before adding filters.*
- *Use the value recovered in one question as the pivot for the next.*
- *Use source-specific endpoint fields instead of Splunk's ingestion `host` field.*
- *Use decimal bytes for an exact transfer total unless a question requests another unit.*

The second one — **look at the fields the data gives you before you start filtering** — is the
single most important habit in log analysis. If you guess a field name that doesn't exist, your
search returns nothing, and "nothing" looks exactly like "the attacker wasn't here." Read first,
filter second.

The incident happened on **11 August 2026**. That date is our anchor for every query.

---

## 0. Getting oriented — what is even in this Splunk?

Before searching for anything specific, ask Splunk what data it holds. In SPL, a command that starts
with a leading pipe `|` is a **generating command** — it produces a table out of Splunk's own
metadata rather than searching events. `eventcount` counts events per index:

```spl
| eventcount summarize=false index=* index=_*
```

- `index=*` means "every normal index"; `index=_*` adds the internal ones (Splunk stores its own
  logs in indexes whose names start with an underscore). Listing both means nothing is hidden from
  us.
- `summarize=false` gives one row per index instead of a single total.

The indexes that matter here (ignoring Splunk's internal `_audit`, `_internal`, etc.):

| index | events | what it is |
|---|---|---|
| `web` | 882 | IIS web-server logs (the public-facing portal) |
| `wineventlog` | 35,336 | Windows Security event logs (logons, group changes) |
| `network` | 16,756 | Zeek network-connection logs (who talked to whom) |
| `sysmon` | 101,369 | Sysmon endpoint telemetry (process/detail level) |

Three log sources, three different views of the same attack: what happened over **HTTP**, what
happened inside **Windows**, and what happened on the **wire**. The skill this room teaches is
stitching those three together into one timeline.

> A note on running the queries: this Splunk was **Splunk Free**, which has no real login — any
> password works for the `admin` user. That is a lab convenience and not part of the lesson, so I
> won't dwell on it. Everything below is plain SPL you type into the search bar.

---

## 1 & 2 — The first unusual request (index `web`)

**Question 1:** the unusual POST at the start of the incident — what URI path?
**Question 2:** which source IP sent it?

### Read the fields first

A **web log** records every HTTP request a browser (or a script) made to the server. These are
**IIS** logs (Microsoft's web server) in W3C format. Before filtering, look at what fields Splunk
pulled out of them:

```spl
search index=web | head 1 | transpose | fields column
```

- `head 1` takes one event; `transpose` flips it so each field becomes a row; then we list the
  field names. This is the "inspect the returned fields" hint in action.

The useful fields turn out to be `cs_method` (the HTTP method — GET, POST…), `cs_uri_stem` (the
path, e.g. `/something.aspx`), `cs_uri_query` (the `?...` query string), `c_ip` (the **client** — who
made the request), `s_ip` (the **server** that answered), and `sc_status` (the HTTP status code).

### Why POST, and why "unusual"

HTTP has several **methods** (verbs). A **GET** asks for a page; a **POST** *submits data to* the
server. Normal browsing is almost all GETs. A POST that shows up where you'd only expect GETs —
say, to a read-only *status* page — is worth a hard look, because submitting data is how you'd drive
a web shell or send a command.

So, the broad query the first hint asks for — every POST in the whole dataset:

```spl
search index=web cs_method=POST
| eval t=strftime(_time,"%F %T")
| table t c_ip cs_uri_stem cs_uri_query sc_status cs_User_Agent
| sort t
```

- `eval t=strftime(_time,...)` turns Splunk's internal timestamp into a readable
  `YYYY-MM-DD HH:MM:SS` string.
- `table` picks the columns to show; `sort t` orders them by time.

**There is exactly one POST in the entire `web` index.** One. It lands on the incident date, it hits
a read-only *status* page that every other request only ever **GET**s (those other hits are a
health-check with a wholesome-looking user-agent), and this one carries a *"Remote-Support"*
user-agent instead. A single POST to a status endpoint is the start of the incident.

From that one event we read straight off:

- **Q1 — the URI path** = `[redacted]` (an `.aspx` path under the portal; matches the room's `/******/******.****` mask).
- **Q2 — the source IP** = `[redacted]` (call it **ATTACKER_IP** from here on — it is the pivot for the whole investigation).

We also note the **server**'s IP (`s_ip`) — that is the web server, and we'll need its Windows name
in a second.

---

## 3 & 4 — Correlating with a Windows logon (index `wineventlog`)

**Question 3:** on the web server **AUR-WEB01**, which non-system account got a **batch logon**
shortly before that request?
**Question 4:** what logon **type** was it?

### A word on Windows logon events

Every time an account authenticates to a Windows machine, the Security log writes **Event ID 4624**
("An account was successfully logged on"). Crucially, each 4624 has a **LogonType** number saying
*how* they logged on. The ones you need to know:

| LogonType | Meaning |
|---|---|
| 2 | Interactive — someone typing at the physical keyboard |
| 3 | Network — accessing the machine over the network (a file share, etc.) |
| 4 | **Batch** — a scheduled/automated task running as that account |
| 5 | Service — a Windows service starting |
| 10 | **RemoteInteractive** — an **RDP** (Remote Desktop) session |

A **batch** logon (type 4) means "this account was used to run an automated job." For an
application's *service account*, that's how the app's background work shows up.

### Which field says which computer?

Here the fourth hint bites. Splunk tags every event with a `host` field — but that is *Splunk's*
idea of where the log came from, and on a forwarded log it can be misleading. The reliable answer is
in the event's own fields. These logs are XML Windows events, so they expose `TargetUserName`,
`TargetDomainName`, `LogonType`, `WorkstationName`, `IpAddress`, and so on. I confirmed the machine
using both the per-event `host` **and** the event's `WorkstationName`, and they agreed.

The query — successful logons, batch type, on the web server, on the incident day:

```spl
search index=wineventlog EventCode=4624 LogonType=4 (host=*WEB01* OR WorkstationName=*WEB01*)
| eval t=strftime(_time,"%F %T")
| search t="2026-08-11*"
| table t host LogonType TargetUserName TargetDomainName WorkstationName IpAddress
| sort t
```

- `EventCode=4624` is the successful-logon event; `LogonType=4` narrows to batch.
- `search t="2026-08-11*"` filters to the incident day *after* formatting the time — I did the time
  filtering inside SPL because this Splunk's export path was picky about absolute time ranges. The
  effect is the same as setting the time picker to 11 Aug.

One row comes back: about **a minute before** the malicious POST, a **service account** (its name
begins `svc-`) logs on with a **batch** logon on AUR-WEB01. That is the application's own identity
being driven by whatever the attacker planted.

- **Q3 — the account** = `[redacted]` (a `svc-…` service account; call it **SVC_ACCT**).
- **Q4 — the logon type** = `[redacted]` (it is the **batch** type from the table above).

---

## 5 & 6 — The privilege escalation on the Domain Controller

**Question 5:** after the web activity, a group-membership change involving the *Portal Application
Service* account — which **privileged group** was modified?
**Question 6:** which **user** made the change?

### Group-change events

When someone is **added to a security group** in Active Directory, the Domain Controller logs it.
The three Event IDs to know:

| Event ID | Meaning |
|---|---|
| 4728 | A member was added to a security-enabled **global** group |
| 4732 | …to a **local** group |
| 4756 | …to a **universal** group |

These events carry the **group** name, the **member** who was added, and — importantly — the
**`SubjectUserName`**, which is *who performed the change*. That last field is what answers Q6.

```spl
search index=wineventlog (EventCode=4728 OR EventCode=4732 OR EventCode=4756)
| eval t=strftime(_time,"%F %T")
| search t="2026-08-11*"
| table t EventCode host GroupName TargetUserName MemberName SubjectUserName
| sort t
```

One event on the incident day matches, and it is a **4728** (added to a global group), on the
**Domain Controller** (AUR-DC01), just **twelve seconds after** the malicious POST:

- The **member added** is `CN=Portal Application Service,OU=Service Accounts,…` — the app's service
  account (the same `svc-…` identity from Q3).
- The **group** it was added to is a privileged **file-server admins** group — call it
  **FS_ADMIN_GROUP**. Its name matches the room's 8-character-ish mask and, tellingly, points at the
  file server we're about to visit.
- The **`SubjectUserName`** — the account that made the change — is an **IT-style username** of the
  form `first-initial.surname`. Either that account is compromised, or it's the insider. Either way,
  it is the answer to Q6.

- **Q5 — the group** = `[redacted]` (**FS_ADMIN_GROUP**).
- **Q6 — the user who did it** = `[redacted]` (matches the room's `*.**` mask — an `x.yy` username).

This is the escalation: an app service account that had no business being a file-server admin gets
quietly added to that group, seconds after the web server was touched.

---

## 7 & 8 — The service account lands on the file server

**Question 7:** in the short window after the group change, on the **file server**, which
non-built-in account produced **both** network and remote-interactive logons?
**Question 8:** what LogonType number is the remote-interactive one?

The file server is **AUR-FS01**. Now that **SVC_ACCT** is a file-server admin, does it actually use
that access? Group the file server's successful logons by account and by the set of logon types each
account produced:

```spl
search index=wineventlog EventCode=4624 host=*FS*
| eval t=strftime(_time,"%F %T")
| search t="2026-08-11*"
| stats count values(LogonType) as types min(t) as first max(t) as last by TargetUserName host
| sort TargetUserName
```

- `stats … by TargetUserName` collapses each account into one row.
- `values(LogonType) as types` lists the distinct logon types that account used — so we can see at a
  glance who logged on in more than one way.

Most rows are Windows plumbing — `SYSTEM`, `LOCAL SERVICE`, `NETWORK SERVICE`, machine accounts
(`AUR-FS01$`), and the `DWM-`/`UMFD-` desktop accounts. **One** account is a real, non-built-in user,
and its `types` column shows **both** `3` (network) **and** `10` (remote-interactive) — and it is our
**SVC_ACCT** again, active between roughly 09:15 and 09:17. A service account signing in over RDP is
already suspicious; a service account that was made a file-server admin ninety seconds earlier and
then RDPs in is the attack.

- **Q7 — the account** = `[redacted]` (the same **SVC_ACCT**).
- **Q8 — the remote-interactive LogonType** = `[redacted]` (the RDP type — the `10` from the table).

---

## 9 & 10 — The RDP session on the wire (index `network`)

**Question 9:** pivoting on **ATTACKER_IP**, which **destination IP** holds the *sustained* RDP
connection (as opposed to the connections that were immediately reset)?
**Question 10:** what `resp_bytes` value did that connection return?

### Zeek connection logs

The `network` index is **Zeek** data. Zeek watches raw traffic and writes one summary record per
connection: who connected to whom, on what port, for how long, how many bytes each way, and how the
connection ended. Its fields include `src`, `src_port`, `dest`, `dest_port`, `service`, `proto`,
`duration`, `orig_bytes`, `resp_bytes`, and `conn_state`.

`conn_state` is the key to this question. It is Zeek's summary of the TCP handshake:

| conn_state | Meaning |
|---|---|
| `S0` | Connection attempt seen, **no reply** |
| `REJ` | Connection **rejected** |
| `RSTO` / `RSTR` | Reset — but data may have flowed first |
| `SF` | Normal establishment **and** teardown |

**RDP** (Remote Desktop) runs on TCP port **3389**. Pivot on the attacker's IP and look at every
3389 connection it made:

```spl
search index=network src=ATTACKER_IP (dest_port=3389 OR service=rdp)
| eval t=strftime(_time,"%F %T")
| table t src_port dest dest_port service conn_state duration orig_bytes resp_bytes uid
| sort t
```

(Substitute the real **ATTACKER_IP** from Q2. Note the source field is `src`, not the `src_ip` you
might have guessed — again, read the fields.)

The result is a story on its own. Spread across **weeks**, the attacker's IP repeatedly touches port
3389 on two hosts, and almost every one of those records is `S0` or `RSTO` with **0 bytes** and a
duration of basically zero — these are **probes/scans**: knock on the RDP door, get nothing, move on.

Then, on the incident day, **one** connection is completely different:

- `service=ssl`, meaning a real TLS/RDP negotiation happened (RDP wraps itself in TLS).
- `conn_state=RSTR` with a **duration of ~17.5 seconds** — a real session that ran, then reset.
- **thousands of bytes each way** — `orig_bytes` in the tens of thousands, `resp_bytes` well into six
  figures.

That is the sustained session, and its **destination** is the file server (**AUR-FS01**). Everything
else on 3389 was noise; this is the hands-on-keyboard access. Pulling the full record for that one
connection's `uid` even shows the RDP **username** embedded in the Zeek record — and it is our
**SVC_ACCT**, closing the loop: the same identity seen in the Windows logs is the one on the wire.

- **Q9 — the destination IP** = `[redacted]` (the file server; matches the `**.**.***.***` mask).
- **Q10 — `resp_bytes`** = `[redacted]` (a six-figure decimal — the data the file server sent back).

The room says "multiple answer options are accepted" for Q10 because Zeek records two byte counts:
`resp_bytes` (application-layer payload) and `resp_ip_bytes` (including packet headers). The question
asks for `resp_bytes`, and the fifth hint — *use decimal bytes* — tells you not to convert it to KB.

---

## The whole attack in one paragraph

An application **service account** — trusted by default to run the portal — is driven on the web
server (a batch logon), and a single **POST to a status page** from the attacker's IP marks the
hands-on start. Twelve seconds later, an **IT account** on the Domain Controller adds that service
account to a privileged **file-server admins** group. Now over-privileged, the service account
**logs into the file server** — first over the network, then interactively over **RDP** — and a
single **sustained TLS/RDP session** (seventeen seconds, six figures of returned data) carries the
actual access, hidden inside a month of meaningless port-3389 scans. No zero-day, no exploit: every
hop is a **standing trust** — a service account, a batch logon, a default group path — used exactly
as designed and entirely against its owner. That is why the room is called *Trusted By Default*.

## What this room teaches

- **Read the fields before you filter.** `src` vs `src_ip`, `TargetUserName` vs `host` — a wrong
  field name returns an empty result that lies to you.
- **One clue is the pivot for the next.** The POST's source IP drove the RDP hunt; the service
  account name tied the web server, the DC, the file server and the wire together.
- **Know your Event IDs and logon types.** 4624 + LogonType (4 batch, 3 network, 10 RDP), and 4728
  for a global-group add with its `SubjectUserName` telling you *who did it*.
- **A single record can hide in plain sight.** The real RDP session was one row among dozens of
  identical-looking scans; `conn_state`, `duration` and `resp_bytes` are what separate a session from
  a knock.

> **Verification note.** Every answer here was read directly out of the indexed logs and the times
> line up into one tight chain (09:15:28 → 09:17:25), with the service account appearing independently
> in both the Windows logs and the Zeek RDP record. The values are evidence-backed; whether the
> platform marks each box green is for the solver to confirm by submitting.
