#!/usr/bin/env python3
"""Erzeugt pc-programm/update.json (Version, Hinweise, SHA-256 je Datei) für die Programm-Aktualisierung.
Aufruf nach jeder Änderung am PC-Programm:  python3 pc-programm/tools/manifest.py"""
import hashlib, json, os, re, sys

base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = os.path.join(base, 'Quellcode')
prog = open(os.path.join(src, 'src', 'Program.cs'), encoding='utf-8').read()
version = re.search(r'public const string Version = "([0-9.]+)";', prog).group(1)
hinweise = open(os.path.join(base, 'hinweise.txt'), encoding='utf-8').read().strip()
files = {}
for root, dirs, names in os.walk(src):
    dirs[:] = sorted(d for d in dirs if d != 'build')
    for n in sorted(names):
        full = os.path.join(root, n)
        rel = os.path.relpath(full, src).replace(os.sep, '/')
        files[rel] = hashlib.sha256(open(full, 'rb').read()).hexdigest()
out = {'app': 'APOLOGEA Kollektionsverwaltung', 'version': version, 'hinweise': hinweise, 'files': files}
open(os.path.join(base, 'update.json'), 'w', encoding='utf-8').write(json.dumps(out, ensure_ascii=False, indent=1) + '\n')
print(f'update.json: Version {version}, {len(files)} Dateien')
