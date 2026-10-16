import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { IS_WINDOWS } from './paths.js';
import { UserError } from './util.js';

/**
 * Anbindung an die offizielle Claude-Code-Kommandozeile („claude“), die du selbst installiert und
 * mit deinem Claude-Konto angemeldet hast. Das Programm nutzt dabei ausschließlich den Druckmodus
 * (`claude -p`) mit eng begrenzten Werkzeugen. Es liest keine Anmeldedaten von Claude aus.
 *
 * Der Prompt wird über die Standardeingabe übergeben (keine Probleme mit Anführungszeichen unter Windows).
 */

let resolved = null;

function candidatePaths() {
  const home = os.homedir();
  const list = [];
  if (process.env.APOLOGEA_CLAUDE_PATH) list.push(process.env.APOLOGEA_CLAUDE_PATH);
  if (IS_WINDOWS) {
    list.push(path.join(home, '.local', 'bin', 'claude.exe'));
    if (process.env.APPDATA) list.push(path.join(process.env.APPDATA, 'npm', 'claude.cmd'));
    if (process.env.LOCALAPPDATA) list.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'claude', 'claude.exe'));
  } else {
    list.push(path.join(home, '.local', 'bin', 'claude'), '/usr/local/bin/claude', '/opt/homebrew/bin/claude');
  }
  return list;
}

function whereClaude() {
  return new Promise((resolve) => {
    execFile(IS_WINDOWS ? 'where.exe' : 'which', ['claude'], { windowsHide: true, timeout: 10_000 }, (err, stdout) => {
      if (err) return resolve(null);
      const lines = String(stdout).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      // .exe bevorzugen, dann .cmd
      resolve(lines.find((l) => /\.exe$/i.test(l)) || lines.find((l) => /\.cmd$/i.test(l)) || lines[0] || null);
    });
  });
}

export async function findClaude() {
  if (process.env.APOLOGEA_CLAUDE_PATH && fs.existsSync(process.env.APOLOGEA_CLAUDE_PATH)) return process.env.APOLOGEA_CLAUDE_PATH;
  if (resolved && fs.existsSync(resolved)) return resolved;
  const found = (await whereClaude()) || candidatePaths().find((p) => { try { return fs.statSync(p).isFile(); } catch { return false; } });
  resolved = found || null;
  return resolved;
}

function quoteCmdArg(a) {
  if (/^[\w.:/=@+-]+$/.test(a)) return a;
  return '"' + String(a).replace(/(["^&|<>%!])/g, '^$1') + '"';
}

/** Startet claude mit Argumenten; Eingabe über stdin. */
export async function runClaude(args, { input = '', timeoutMs = 600_000, onLine } = {}) {
  const exe = await findClaude();
  if (!exe) throw new UserError('Claude Code wurde auf diesem PC nicht gefunden. Installation: https://code.claude.com – danach einmal „claude“ starten und anmelden.', { status: 412, code: 'claude_missing' });
  let cmd = exe;
  let argv = args;
  const opts = { windowsHide: true, env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: 'apologea-studio' } };
  // Arbeitsordner: der interne Datenordner (kein Benutzer- oder Projektordner).
  try { const { DIRS } = await import('./paths.js'); opts.cwd = DIRS.internal; } catch { /* Standard */ }
  if (IS_WINDOWS && /\.(cmd|bat)$/i.test(exe)) {
    cmd = process.env.ComSpec || 'cmd.exe';
    argv = ['/d', '/s', '/c', `"${[quoteCmdArg(exe), ...args.map(quoteCmdArg)].join(' ')}"`];
    opts.windowsVerbatimArguments = true;
  }
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, argv, opts);
    let stdout = '';
    let stderr = '';
    let buf = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new UserError('Claude Code hat nicht rechtzeitig geantwortet (Zeitüberschreitung).', { status: 504, code: 'timeout' }));
    }, timeoutMs);
    child.stdout.on('data', (d) => {
      stdout += d;
      if (onLine) {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) onLine(line); }
      }
    });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', (err) => { clearTimeout(timer); reject(new UserError('Claude Code konnte nicht gestartet werden: ' + err.message, { status: 500 })); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (onLine && buf.trim()) onLine(buf.trim());
      resolve({ code, stdout, stderr });
    });
    child.stdin.end(input);
  });
}

export async function claudeVersion() {
  const r = await runClaude(['--version'], { timeoutMs: 20_000 });
  return r.stdout.trim();
}

/** Liest „claude mcp list“ und sucht den MarketPrint-Eintrag. */
export async function findMcpServer(match = /marketprint/i) {
  const r = await runClaude(['mcp', 'list'], { timeoutMs: 90_000 });
  const lines = r.stdout.split(/\r?\n/).filter((l) => match.test(l));
  return lines.map((line) => {
    const urlMatch = line.match(/https?:\/\/\S+/);
    const statusIdx = line.lastIndexOf(' - ');
    const status = statusIdx > 0 ? line.slice(statusIdx + 3).trim() : '';
    const end = urlMatch ? line.lastIndexOf(': ', urlMatch.index) : line.lastIndexOf(': ');
    const name = (end > 0 ? line.slice(0, end) : line).trim();
    return { name, url: urlMatch ? urlMatch[0] : null, status, connected: /✓|connected|verbunden/i.test(status) && !/fail|✗|needs/i.test(status), raw: line.trim() };
  });
}

/**
 * Führt einen Druckmodus-Lauf mit Ereignisstrom aus und liefert alle Ereignisse.
 * Werkzeuge: nur die ausdrücklich erlaubten (allowedTools); eingebaute Werkzeuge sind abgeschaltet.
 */
export async function streamRun({ prompt, allowedTools = [], builtinTools = [], addDirs = [], model, jsonSchema, timeoutMs }) {
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--no-session-persistence', '--tools', builtinTools.join(',')];
  for (const d of addDirs) args.push('--add-dir', d);
  if (allowedTools.length) args.push('--allowedTools', allowedTools.join(','));
  if (model) args.push('--model', model);
  if (jsonSchema) args.push('--json-schema', JSON.stringify(jsonSchema));
  const events = [];
  const r = await runClaude(args, {
    input: prompt,
    timeoutMs,
    onLine: (line) => { try { events.push(JSON.parse(line)); } catch { /* Nicht-JSON-Zeilen ignorieren */ } },
  });
  const result = events.filter((e) => e.type === 'result').pop() || null;
  if (r.code !== 0 && !result) {
    const hint = /login|auth|logged/i.test(r.stderr) ? ' Bitte „claude“ einmal im Terminal starten und anmelden.' : '';
    throw new UserError(`Claude Code wurde mit Fehler beendet.${hint}`, { status: 502, details: r.stderr.slice(-500) });
  }
  return { events, result, stderr: r.stderr };
}

/** Werkzeugaufrufe + Ergebnisse aus dem Ereignisstrom (Ergebnisse stammen direkt vom MCP-Server). */
export function extractToolCalls(events) {
  const calls = new Map();
  for (const ev of events) {
    const content = ev.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (ev.type === 'assistant' && block.type === 'tool_use') calls.set(block.id, { id: block.id, name: block.name, input: block.input, result: null, isError: false });
      if (ev.type === 'user' && block.type === 'tool_result') {
        const c = calls.get(block.tool_use_id) || { id: block.tool_use_id };
        const text = Array.isArray(block.content) ? block.content.filter((x) => x.type === 'text').map((x) => x.text).join('\n') : String(block.content ?? '');
        c.result = text;
        c.isError = Boolean(block.is_error);
        calls.set(block.tool_use_id, c);
      }
    }
  }
  return [...calls.values()];
}

export function initInfo(events) {
  const init = events.find((e) => e.type === 'system' && e.subtype === 'init');
  return init ? { tools: init.tools || [], mcpServers: init.mcp_servers || [], model: init.model } : null;
}
