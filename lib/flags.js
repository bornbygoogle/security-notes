/**
 * Flag dictionary for the command tooltips.
 *
 * Scope came from the corpus, not from memory: on 2026-08-23 every built page
 * under content/pt1-course was walked for <code class="nextra-code"> blocks —
 * 157 fenced blocks, 366 lines, 210 flag tokens, 123 distinct (command, flag)
 * pairs. Everything the course actually types is explained here; the test file
 * pins that list so a new lesson using an unexplained flag fails CI.
 *
 * Pure data + pure functions. No React, no DOM, no IO.
 */

/** Tools that are the same program under a different name. */
const ALIASES = {
  netexec: 'nxc',
  crackmapexec: 'nxc',
  cme: 'nxc',
  'impacket-getnpusers': 'impacket-getnpusers',
  python: 'python3',
  fuff: 'ffuf'
}

/**
 * Flags whose meaning is stable enough across tools to answer when the
 * specific tool has no entry. Deliberately tiny — a wrong tooltip teaches a
 * wrong exam answer, so anything ambiguous lives in a per-tool table instead.
 */
const SHARED = {
  '-h': 'Print the help text and exit. The fastest way to check a flag you half-remember.',
  '--help': 'Print the help text and exit. The fastest way to check a flag you half-remember.',
  '-v': 'Verbose — print more about what the tool is doing. Add more v’s for more noise.',
  '-o': 'Write the output to a file instead of only to the screen. Save every scan; you will need it for the report.',
  '-q': 'Quiet — suppress the banner and progress chatter, leaving just the results.'
}

export const FLAGS = {
  // ── Recon ──────────────────────────────────────────────────────────────
  nmap: {
    '-sV': 'Version detection. Probes each open port and asks the service what it is, so 8080 becomes “Apache Tomcat 9.0.30” instead of just “open”. Version strings are what you feed to searchsploit.',
    '-sC': 'Run the default NSE script set (equivalent to --script=default). Cheap extra detail: SMB shares, HTTP titles, anonymous FTP. Safe to run on the exam.',
    '-sS': 'SYN “half-open” scan. Sends SYN, reads the reply, never completes the handshake. The default when you have root, and quieter than a full connect.',
    '-sT': 'Full TCP connect scan. Completes the three-way handshake, so it is louder and slower — but it is what you get without root, and the only thing that works through a SOCKS proxy.',
    '-sU': 'UDP scan. Slow, because closed UDP ports answer with nothing and nmap must wait out the timeout. Worth it for 53, 161 (SNMP) and 69 (TFTP).',
    '-Pn': 'Skip host discovery — treat the target as up and scan it anyway. Needed constantly on HTB/THM boxes that drop ICMP; without it nmap reports “host seems down” and scans nothing.',
    '-p': 'Scan only these ports. Takes a list (22,80,445) or a range (1-1000). Narrow the second scan to what the first one found.',
    '-p-': 'Scan all 65535 TCP ports, not just nmap’s top 1000. Slow, but this is where the odd high port hides — the one the default scan silently misses.',
    '-T4': 'Timing template 4 (“aggressive”). Shortens the timeouts and probe delays. Fine on a lab network; back off to -T2 on anything real or flaky.',
    '-oN': 'Write normal, human-readable output to a file. Use -oA instead to get normal, greppable and XML in one go.',
    '-oA': 'Write all three output formats (normal, greppable, XML) using one basename. The habit that saves you re-scanning.',
    '--top-ports': 'Scan the N most common ports by frequency, e.g. --top-ports 100. A quick first sweep before committing to -p-.',
    '--min-rate': 'Send at least this many packets per second. --min-rate 1000 turns a 20-minute -p- into a couple of minutes; too high and you start dropping results.',
    '--script': 'Run specific NSE scripts, e.g. --script smb-vuln-*. The category names (vuln, safe, auth) also work.',
    '-A': 'Aggressive: -sV, -sC, OS detection and traceroute at once. Convenient, noisy, and slow — prefer -sC -sV when you care.'
  },
  masscan: {
    '-p': 'Ports to scan, e.g. -p1-65535. masscan is for finding what is open fast; hand the result to nmap for detail.',
    '--rate': 'Packets per second. The whole point of masscan — but it is a UDP-style blind blaster, so high rates lose results.'
  },

  // ── Web content discovery ──────────────────────────────────────────────
  ffuf: {
    '-u': 'Target URL with FUZZ marking where the wordlist goes: -u http://target/FUZZ for directories, or put FUZZ in a header or parameter instead.',
    '-w': 'Wordlist. Pair it with a name to fuzz two spots at once: -w list.txt:FUZZ1.',
    '-mc': 'Match these HTTP status codes, e.g. -mc 200,301,302. ffuf defaults to matching 200-299,301,302,307,401,403.',
    '-fc': 'Filter *out* these status codes. Use when the app answers 200 to everything and 404 means nothing.',
    '-fs': 'Filter out responses of this exact byte size. The standard fix for a soft-404 page that returns 200 with a constant body.',
    '-fw': 'Filter out responses with this word count. Same idea as -fs when the soft-404 length wobbles.',
    '-e': 'Append these extensions to every word, e.g. -e .php,.txt,.bak.',
    '-H': 'Add a header, e.g. -H "Cookie: session=…" to fuzz an authenticated area, or -H "Host: FUZZ.target" for vhosts.',
    '-o': 'Write results to a file. Combine with -of json for something you can parse.',
    '-recursion': 'Descend into directories that are found. Cap it with -recursion-depth or you will fuzz forever.',
    '-t': 'Number of concurrent threads. Default 40; lower it when the target starts throwing 502s.'
  },
  gobuster: {
    '-u': 'Target URL. Unlike ffuf there is no FUZZ marker — the mode (dir, dns, vhost) decides where words go.',
    '-w': 'Wordlist to use.',
    '-x': 'Extensions to append to each word, e.g. -x php,txt,bak.',
    '-t': 'Concurrent threads. Default 10, which is conservative.',
    '-k': 'Skip TLS certificate verification. Needed for the self-signed certs you meet on lab boxes.'
  },
  feroxbuster: {
    '-u': 'Target URL to start from. feroxbuster recurses by default, unlike gobuster.',
    '-w': 'Wordlist to use.',
    '-x': 'Extensions to append to each word.'
  },

  // ── Web exploitation ───────────────────────────────────────────────────
  sqlmap: {
    '-u': 'Target URL including the parameter you suspect, e.g. -u "http://t/item?id=1".',
    '-r': 'Read the whole request from a saved file — the Burp “Copy to file” output. The right way to hit a POST or an authenticated endpoint; beats reconstructing headers by hand.',
    '-p': 'Test only this parameter instead of every one sqlmap can find.',
    '-D': 'Work inside this database name.',
    '-T': 'Work on this table.',
    '-C': 'Restrict to these columns — useful when you only want username,password.',
    '--dbs': 'Enumerate the database names available to the injected user.',
    '--tables': 'List the tables, normally with -D to pick the database.',
    '--columns': 'List the columns of the chosen table.',
    '--dump': 'Extract the rows. With -D and -T it dumps one table; alone it will try to dump everything, which is slow and loud.',
    '--batch': 'Answer every interactive prompt with the default. Makes runs repeatable and scriptable — always use it once you know what you are doing.',
    '--level': 'How many places to test (1-5): higher also tries cookies, headers and the User-Agent.',
    '--risk': 'How dangerous the payloads may be (1-3). Level 3 includes OR-based updates that can change data — never on a live target.',
    '--os-shell': 'Try to turn the injection into an OS command shell. Needs high privileges and stacked queries or file-write access.',
    '--technique': 'Restrict to specific injection techniques, e.g. --technique=BEU (boolean, error, union).'
  },
  hydra: {
    '-l': 'A single username to try.',
    '-L': 'A file of usernames.',
    '-p': 'A single password to try.',
    '-P': 'A password list. -l with -P (one user, many passwords) is the normal shape; the reverse is password spraying.',
    '-s': 'Non-default port for the service.',
    '-t': 'Parallel tasks. Default 16; drop to 4 on SSH or you will trip the rate limit and lock accounts.',
    '-f': 'Stop as soon as a valid pair is found.',
    '-vV': 'Show every attempt as it goes. Useful to confirm hydra is actually hitting the right form field.'
  },
  hashcat: {
    '-m': 'Hash mode — the number that tells hashcat what kind of hash it is. 0 = MD5, 1000 = NTLM, 1800 = sha512crypt, 13100 = Kerberoast TGS-REP. Getting this wrong is the usual reason nothing cracks.',
    '-a': 'Attack mode. 0 = straight wordlist, 3 = brute-force mask, 6/7 = hybrid.',
    '-r': 'Apply a rule file to mutate each word, e.g. best64.rule. Turns a 14M wordlist into a much larger effective one.',
    '--force': 'Run even though hashcat is unhappy about the OpenCL/driver setup. Routinely needed inside a VM — it is a warning override, not a speed flag.',
    '--show': 'Print already-cracked hashes from the pot file instead of cracking again.',
    '-o': 'Write cracked results to this file.'
  },
  john: {
    '--wordlist': 'Wordlist to try, e.g. --wordlist=/usr/share/wordlists/rockyou.txt.',
    '--format': 'Force the hash format when John guesses wrong, e.g. --format=NT.',
    '--show': 'Display the passwords John has already cracked for this file.'
  },
  curl: {
    '-A': 'Set the User-Agent string. Some apps branch on it, and some filters only block the default curl one.',
    '-L': 'Follow redirects. Without it you see the 302 and nothing else.',
    '-o': 'Save the body to a file.',
    '-O': 'Save the body using the remote filename.',
    '-i': 'Include the response headers in the output — often where the interesting thing is.',
    '-I': 'Send a HEAD request: headers only, no body.',
    '-k': 'Ignore certificate errors. Expected on lab boxes with self-signed certs.',
    '-X': 'Set the HTTP method, e.g. -X PUT.',
    '-d': 'Send this body as a POST. Implies a POST unless -X says otherwise.',
    '-H': 'Add a request header, e.g. -H "Authorization: Bearer …".',
    '-b': 'Send cookies, either inline (-b "s=abc") or from a file.',
    '-s': 'Silent — no progress meter. Pair with -S so real errors still print.'
  },
  wget: {
    '-m': 'Mirror: recursive, timestamped, infinite depth. The one-flag way to pull a whole site down for offline review.',
    '-r': 'Recursive download.',
    '-O': 'Write to this filename; -O- sends it to stdout.',
    '--no-check-certificate': 'Ignore TLS certificate errors.'
  },

  // ── SMB / Windows / Active Directory ───────────────────────────────────
  nxc: {
    '-u': 'Username, or a file of usernames.',
    '-p': 'Password, or a file of passwords. nxc sprays the full cross-product, so watch the lockout policy first.',
    '-d': 'Domain name to authenticate against.',
    '-H': 'Authenticate with an NTLM hash instead of a password — pass-the-hash. Accepts LM:NT or just the NT half.',
    '-k': 'Use Kerberos authentication rather than NTLM.',
    '--local-auth': 'Authenticate against the machine’s local SAM instead of the domain. How you test a local admin password reused across hosts.',
    '--shares': 'List the SMB shares and show your READ/WRITE access on each. The single most useful nxc call.',
    '--users': 'Enumerate domain users.',
    '--groups': 'Enumerate domain groups.',
    '--sam': 'Dump the local SAM hashes. Needs local admin on the target.',
    '--lsa': 'Dump LSA secrets — cached credentials and service account passwords. Needs local admin.',
    '--ntds': 'Dump the whole NTDS.dit domain hash database. Domain Admin only; this is the end of the box.',
    '--pass-pol': 'Read the password policy: lockout threshold and observation window. Do this *before* spraying.',
    '--kerberoasting': 'Request TGS tickets for every service account with an SPN and write them out for hashcat mode 13100.',
    '--asreproast': 'Find accounts with Kerberos pre-authentication disabled and grab their AS-REP hashes — crackable with hashcat mode 18200, no password needed.',
    '-x': 'Run this command through cmd on the target.',
    '-M': 'Load an nxc module, e.g. -M spider_plus.'
  },
  smbclient: {
    '-L': 'List the shares on the host rather than connecting to one.',
    '-N': 'No password — try a null session. Combined with -L this is the classic anonymous share enumeration.',
    '-U': 'Username to authenticate as. Use -U "" for an explicit empty user.',
    '-c': 'Run these smbclient commands non-interactively, e.g. -c "get flag.txt".'
  },
  smbmap: {
    '-H': 'Target host to enumerate shares on.',
    '-u': 'Username to authenticate as; use a null string for an anonymous check.',
    '-p': 'Password, or an NTLM hash to pass instead of one.',
    '-d': 'Domain to authenticate against, when the host is domain-joined.',
    '-R': 'Recurse into the shares and list their contents, not just the share names.'
  },
  'enum4linux-ng': {
    '-A': 'Do everything: users, groups, shares, password policy, OS info, RID cycling. The standard first shot at an SMB host.',
    '-u': 'Username for an authenticated run.',
    '-p': 'Password for an authenticated run.'
  },
  'evil-winrm': {
    '-i': 'Target IP. WinRM is TCP 5985 (HTTP) or 5986 (HTTPS).',
    '-u': 'Username to log in as. The account needs to be in Remote Management Users.',
    '-p': 'Password for that account. Use -H instead if all you have is the hash.',
    '-H': 'NTLM hash instead of a password — pass-the-hash straight into a shell.',
    '-s': 'Local directory of PowerShell scripts to make available for upload.',
    '-c': 'Certificate to use for certificate-based auth.'
  },
  ldapsearch: {
    '-x': 'Simple authentication instead of SASL. What you almost always want against AD.',
    '-H': 'LDAP URI of the server, e.g. -H ldap://10.10.10.1.',
    '-b': 'Search base — where in the tree to start, e.g. -b "DC=corp,DC=local".',
    '-D': 'Bind DN: the identity you authenticate as, e.g. -D "corp\\\\jdoe".',
    '-w': 'Bind password on the command line. -W prompts instead, which keeps it out of your shell history.',
    '-s': 'Search scope: base, one or sub.',
    '-LLL': 'Trim the LDIF output — no comments, no version line. Much easier to read.'
  },
  'impacket-getnpusers': {
    '-dc-ip': 'IP of the domain controller to talk to, when the domain name will not resolve for you.',
    '-usersfile': 'File of usernames to test for AS-REP roasting — you do not need credentials for this, only names.',
    '-no-pass': 'Do not prompt for a password. The point of AS-REP roasting: pre-auth is disabled, so none is needed.',
    '-format': 'Output format for the hash: -format hashcat gives you something mode 18200 accepts directly.',
    '-outputfile': 'Write the hashes to this file.',
    '-request': 'Actually request the tickets rather than only listing the vulnerable accounts.'
  },
  'impacket-getuserspns': {
    '-dc-ip': 'IP of the domain controller.',
    '-request': 'Request the TGS tickets for each SPN found — this is what produces the Kerberoast hashes.',
    '-outputfile': 'Write the TGS hashes here, ready for hashcat -m 13100.',
    '-no-pass': 'Skip the password prompt.',
    '-hashes': 'Authenticate with LMHASH:NTHASH instead of a password.'
  },
  'impacket-secretsdump': {
    '-just-dc': 'Pull only the domain credentials (NTDS.dit) via DRSUAPI replication — the DCSync attack. Needs replication rights.',
    '-just-dc-user': 'DCSync a single account, e.g. -just-dc-user krbtgt for a golden ticket.',
    '-hashes': 'Authenticate with LMHASH:NTHASH rather than a password.',
    '-dc-ip': 'IP of the domain controller.',
    '-no-pass': 'Skip the password prompt — for use with -k or -hashes.'
  },
  'impacket-psexec': {
    '-hashes': 'Pass-the-hash as LMHASH:NTHASH instead of typing a password.',
    '-dc-ip': 'IP of the domain controller.',
    '-k': 'Use Kerberos, reading the ticket from $KRB5CCNAME.',
    '-no-pass': 'Skip the password prompt, for -k or -hashes.'
  },
  'impacket-wmiexec': {
    '-hashes': 'Pass-the-hash as LMHASH:NTHASH.',
    '-k': 'Use Kerberos authentication from the ccache.',
    '-no-pass': 'Skip the password prompt.'
  },
  'bloodhound-python': {
    '-u': 'Username to collect as.',
    '-p': 'Password for that user.',
    '-d': 'Domain to enumerate, e.g. -d corp.local.',
    '-ns': 'Nameserver to use — set this to the domain controller, or the lookups fail.',
    '-c': 'Collection method: -c All is the usual choice; -c DCOnly is quieter.',
    '--zip': 'Bundle the JSON output into a single zip, which is what you drag into the BloodHound UI.',
    '-dc': 'Explicit domain controller hostname.'
  },
  net: {
    '-U': 'Username for the operation.',
    '-S': 'Server to talk to.'
  },

  // ── Other services ─────────────────────────────────────────────────────
  snmpwalk: {
    '-c': 'Community string — SNMP’s password. Try public and private first; they are the defaults nobody changes.',
    '-v2c': 'Use SNMP version 2c. Version 1 and 2c send the community string in cleartext; v3 is the one with real auth.',
    '-v1': 'Use SNMP version 1.',
    '-v3': 'Use SNMP version 3, which actually has usernames and encryption.'
  },
  nc: {
    '-l': 'Listen instead of connecting.',
    '-lvnp': 'The reverse-shell listener cluster: listen, verbose, no DNS lookups, and the port follows. Written as one token out of habit — nc -lvnp 4444.',
    '-e': 'Execute this program and wire it to the socket. Missing from most modern nc builds precisely because it hands out shells.',
    '-n': 'No DNS resolution — do not stall on a reverse lookup.',
    '-p': 'Port to listen on or connect to. Pick 443 or 53 when egress is filtered.',
    '-v': 'Verbose: print the connection as it arrives, which is how you know your shell landed.'
  },
  ssh: {
    '-L': 'Local port forward: -L 8080:127.0.0.1:80 makes the target’s loopback port 80 reachable on your 8080. For services bound to localhost.',
    '-R': 'Remote port forward — opens a port on the target that tunnels back to you.',
    '-D': 'Dynamic forward: a SOCKS proxy on this local port. Point proxychains at it and reach the whole internal network.',
    '-N': 'Do not run a remote command — just hold the tunnel open.',
    '-f': 'Background itself once the tunnel is up.',
    '-i': 'Private key file to authenticate with.',
    '-p': 'Non-default SSH port on the target.'
  },
  chisel: {
    '--reverse': 'Let clients ask the server to open reverse tunnels. Set on the server you run; without it the client’s R: request is refused.',
    '-p': 'Port the chisel server listens on.',
    '--socks5': 'Expose a SOCKS5 proxy over the tunnel — the usual pivot shape.'
  },
  proxychains: {
    '-q': 'Quiet: drop the per-connection chain chatter that otherwise buries the tool’s own output.'
  },
  openvpn: {
    '--config': 'The .ovpn profile to connect with.',
    '--daemon': 'Run in the background instead of holding the terminal.'
  },
  certutil: {
    '-urlcache': 'Windows’ accidental downloader. With -f and -split it fetches a URL to disk — a LOLBIN for getting tools onto a box with no curl.',
    '-f': 'Force: overwrite and bypass the cache, so you get the current file rather than a stale one.',
    '-decode': 'Decode a base64 file — the other half of the “no file transfer” workaround.'
  },
  'stty': {
    '-echo': 'Stop the terminal echoing what you type. Half of the reverse-shell TTY upgrade dance: stty raw -echo; fg.',
    'raw': 'Pass keystrokes through untouched so Ctrl-C reaches the remote shell instead of killing your listener.'
  },

  // ── Local enumeration / privesc ────────────────────────────────────────
  find: {
    '-perm': 'Match on permission bits. -perm -4000 finds SUID binaries — the first thing to check for Linux privesc.',
    '-type': 'Restrict to a file type: f for regular files, d for directories, l for symlinks.',
    '-exec': 'Run a command on each match. Ends with \\; for one call per file, or + to batch them.',
    '-quit': 'Stop at the first match. Handy when you only need to know whether something exists.',
    '-name': 'Match the filename, wildcards allowed: -name "*.conf".',
    '-user': 'Match files owned by this user.',
    '-writable': 'Match files you can write to — the shortcut to finding a hijackable script.'
  },
  grep: {
    '-r': 'Recurse into directories.',
    '-i': 'Case-insensitive match.',
    '-n': 'Print line numbers with the match.',
    '-rin': 'Recursive, case-insensitive, with line numbers. The habitual cluster for hunting a password across /var/www.',
    '-E': 'Extended regex — +, ?, | work without backslashes.',
    '-l': 'Print only the names of matching files.',
    '-v': 'Invert: show the lines that do *not* match.'
  },
  ls: {
    '-l': 'Long listing: permissions, owner, size, mtime.',
    '-a': 'Include dotfiles. Where .ssh, .bash_history and .git hide.',
    '-la': 'Long listing including dotfiles — the reflex combination.',
    '-R': 'Recurse into subdirectories.'
  },
  uname: {
    '-a': 'Everything: kernel name, hostname, kernel release, version, architecture. The release number is what you check against known kernel exploits.',
    '-r': 'Kernel release only.'
  },
  mkdir: {
    '-p': 'Create parent directories as needed, and do not error if it already exists. Makes the command safe to re-run.'
  },
  head: {
    '-n': 'Show this many lines from the top.'
  },
  tail: {
    '-n': 'Show this many lines from the end.',
    '-f': 'Follow the file as it grows — for watching a log while you trigger the bug.'
  },
  ping: {
    '-c': 'Stop after this many packets. Without it ping runs forever, which matters when you are piping it into a command-injection payload.'
  },
  ip: {
    '-4': 'Restrict the output to IPv4.',
    '-br': 'Brief, one-line-per-interface output. ip -br a is much easier to read than the full dump.'
  },
  bash: {
    '-c': 'Run this string as a command and exit. How you pass a one-liner through something that only takes a program name.',
    '-i': 'Interactive shell — needed for the /dev/tcp reverse-shell one-liner to behave like a terminal.',
    '-p': 'Keep the effective UID. On a SUID-root bash this is what actually gives you the root shell — without -p bash drops the privilege.'
  },
  python3: {
    '-c': 'Run this string as a program. The pty.spawn shell upgrade lives here.',
    '-m': 'Run a library module as a script, e.g. -m http.server 8000 to serve the current directory.'
  },
  echo: {
    '-n': 'No trailing newline. Matters when you are piping into base64 or a hash — the newline changes the digest.',
    '-e': 'Interpret backslash escapes like \\n and \\x41.',
    '-a': 'Not a real echo flag — if you meant a literal string starting with -a, put it after --.'
  },
  openssl: {
    '-salt': 'Add a salt when encrypting. On by default; passwd -salt fixes it so the output is reproducible.',
    '-1': 'Produce an MD5-crypt hash — the format /etc/shadow accepts on older Linux, used when you inject a user into a writable shadow file.',
    '-6': 'Produce a SHA-512 crypt hash, the modern /etc/shadow format.'
  },
  arp: {
    '-a': 'Print the ARP cache: which IPs this host has recently talked to. A free map of neighbours when you are deciding where to pivot.'
  },
  apt: {
    '-y': 'Answer yes to every prompt so the install runs unattended.'
  },
  'docker-compose': {
    '-f': 'Use this compose file instead of ./docker-compose.yml.',
    '-d': 'Detached — run the containers in the background.'
  },

  // ── PowerShell / PowerView ─────────────────────────────────────────────
  'set-domainuserpassword': {
    '-Identity': 'The account whose password you are changing.',
    '-AccountPassword': 'The new password, as a SecureString.',
    '-AsPlainText': 'Tell ConvertTo-SecureString the input is plain text rather than an encrypted blob.',
    '-Force': 'Confirm you meant -AsPlainText. PowerShell refuses without it.'
  }
}

// Alias entries that just point at another table.
FLAGS['impacket-getnpusers.py'] = FLAGS['impacket-getnpusers']
FLAGS['getnpusers.py'] = FLAGS['impacket-getnpusers']
FLAGS['getuserspns.py'] = FLAGS['impacket-getuserspns']
FLAGS['secretsdump.py'] = FLAGS['impacket-secretsdump']
FLAGS['psexec.py'] = FLAGS['impacket-psexec']
FLAGS['wmiexec.py'] = FLAGS['impacket-wmiexec']
FLAGS['proxychains4'] = FLAGS.proxychains

const FLAG_RE = /^-{1,2}[A-Za-z][A-Za-z0-9?-]*$/

/** True when a token is a flag on its own — never when text is glued to it. */
export function isFlagToken (raw) {
  if (typeof raw !== 'string') return false
  const t = raw.trim()
  // `-p-` is nmap's all-ports flag; allow the single trailing dash, nothing else.
  return FLAG_RE.test(t) || /^-{1,2}[A-Za-z][A-Za-z0-9-]*-$/.test(t)
}

/** Reduce a command word to the key used in FLAGS, or null if it is not one. */
export function normaliseCommand (raw) {
  if (typeof raw !== 'string') return null
  let c = raw.trim()
  if (!c || c.startsWith('-')) return null
  c = c.replace(/^\$\s*/, '') // a shell prompt someone pasted
  c = c.replace(/^\.[/\\]/, '') // ./agent
  c = c.split(/[/\\]/).pop() // /usr/bin/nmap, .\Rubeus.exe
  c = c.replace(/\.(exe|py|sh|ps1)$/i, '')
  if (!c) return null
  c = c.toLowerCase()
  return ALIASES[c] ?? c
}

const WRAPPERS = new Set([
  'sudo',
  'doas',
  'proxychains',
  'proxychains4',
  'time',
  'watch',
  'env'
])

/** Pull the command out of one already-trimmed line, ignoring wrappers. */
function commandOnLine (line) {
  let words = line.trim().split(/\s+/)
  if (words[0] === '$' || words[0] === '#>') words = words.slice(1)
  while (words.length) {
    const w = words[0]
    if (WRAPPERS.has(w.toLowerCase())) {
      words = words.slice(1)
      continue
    }
    // FOO=bar prefixes, e.g. KRB5CCNAME=x.ccache impacket-psexec …
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) {
      words = words.slice(1)
      continue
    }
    break
  }
  return words.length ? normaliseCommand(words[0]) : null
}

/**
 * Given the lines of one code block, say which command owns each line.
 *
 * The corpus scan found 19 lines whose first word was a flag, because ffuf and
 * sqlmap invocations wrap with a trailing backslash. Those inherit from the
 * line above; a blank line or a comment breaks the chain so nothing leaks.
 */
export function attributeCommands (lines) {
  const out = []
  let carried = null
  for (const raw of lines) {
    const line = typeof raw === 'string' ? raw.trim() : ''
    if (!line || line.startsWith('#')) {
      out.push(null)
      carried = null
      continue
    }
    if (line.startsWith('-')) {
      out.push(carried)
      continue
    }
    carried = commandOnLine(line)
    out.push(carried)
  }
  return out
}

/** Look one flag up for one command. Returns {command, flag, text} or null. */
export function lookupFlag (command, flag) {
  if (typeof flag !== 'string') return null
  const f = flag.trim()
  if (!f) return null
  const key = normaliseCommand(command)
  const table = key ? FLAGS[key] : null
  if (table && table[f]) return { command: key, flag: f, text: table[f] }
  if (SHARED[f]) return { command: null, flag: f, text: SHARED[f] }
  return null
}
