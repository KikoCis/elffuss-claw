#!/usr/bin/env bash
# Sincroniza el core compartido (repo elffuss) a web/js/. Ejecuta tras clonar
# el core al lado, o cuando el core cambie. Los archivos quedan vendorizados
# (este repo es autocontenido: clona y abre, sin build).
#
# Antes copiaba a ciegas, y un cambio hecho aquí que el core no tenía se perdía
# en silencio en la siguiente sincronización (pasó con la parada del proveedor
# API, y context.js, mind.js y otros llevan tiempo distintos). Ahora compara el
# CÓDIGO de cada fichero, sin comentarios (el core los tiene en inglés): si es
# el mismo, lo copia; si no, NO lo pisa, lo dice y termina con error. Puede ser
# que el core vaya por delante (entonces --force) o que aquí haya algo que el
# core no tiene (entonces hay que llevarlo al core antes).
#
#   ./sync-core.sh [ruta/al/core] [--force]
set -euo pipefail
cd "$(dirname "$0")"
FORCE=0; CORE=../elffuss/core
for a in "$@"; do if [ "$a" = "--force" ]; then FORCE=1; else CORE="$a"; fi; done
[ -d "$CORE" ] || { echo "No encuentro el core en $CORE (clona github.com/KikoCis/elffuss al lado)"; exit 1; }

# ¿Mismo código, sin contar comentarios ni líneas en blanco? (sale 0 si sí)
mismo_codigo() {
  python3 -I - "$1" "$2" <<'PY'
import sys
REGEX_PREV = set('(,=:[!&|?{};+-*%<>~^')
ANTES_DE_REGEX = ('return', 'typeof', 'case', 'do', 'else', 'in', 'of', 'void', 'yield', 'await')
def codigo(src):
    out, i, n, ultimo, palabra = [], 0, len(src), '', ''
    while i < n:
        c, sig = src[i], src[i + 1] if i + 1 < n else ''
        if c == '/' and sig == '/':
            j = src.find('\n', i); i = n if j < 0 else j; continue
        if c == '/' and sig == '*':
            j = src.find('*/', i + 2); i = n if j < 0 else j + 2; continue
        if c in '"\'':
            j = i + 1
            while j < n and src[j] != c and src[j] != '\n':
                j += 2 if src[j] == '\\' else 1
            out.append(src[i:j + 1]); ultimo = c; i = j + 1; continue
        if c == '`':
            j, prof = i + 1, 0
            while j < n:
                if src[j] == '\\': j += 2; continue
                if src[j] == '$' and j + 1 < n and src[j + 1] == '{': prof += 1; j += 2; continue
                if src[j] == '}' and prof: prof -= 1; j += 1; continue
                if src[j] == '`' and not prof: break
                j += 1
            out.append(src[i:j + 1]); ultimo = '`'; i = j + 1; continue
        if c == '/' and (ultimo == '' or ultimo in REGEX_PREV or palabra in ANTES_DE_REGEX):
            j, clase = i + 1, False
            while j < n and src[j] != '\n':
                if src[j] == '\\': j += 2; continue
                if src[j] == '[': clase = True
                elif src[j] == ']': clase = False
                elif src[j] == '/' and not clase: break
                j += 1
            j += 1
            while j < n and src[j].isalpha(): j += 1
            out.append(src[i:j]); ultimo = '/'; i = j; continue
        out.append(c)
        if not c.isspace():
            ultimo = c
            palabra = (palabra + c) if (c.isalnum() or c in '_$') else ''
        elif palabra:
            pass
        i += 1
    return [l.rstrip() for l in ''.join(out).split('\n') if l.strip()]
a, b = (open(p, encoding='utf-8').read() for p in sys.argv[1:3])
sys.exit(0 if codigo(a) == codigo(b) else 1)
PY
}

distintos=()
for f in context.js embed.js skills.js md.js splash-gl.js ceo.js mind.js humanize.js telemetry.js providers/api.js; do
  if [ "$FORCE" = 0 ] && [ -f "web/js/$f" ] && ! mismo_codigo "$CORE/$f" "web/js/$f"; then
    distintos+=("$f"); continue
  fi
  cp "$CORE/$f" "web/js/$f"
done
if [ ${#distintos[@]} -gt 0 ]; then
  echo "⚠️  No sincronizados: su código aquí no es el del core (comentarios aparte):"
  for f in "${distintos[@]}"; do echo "    web/js/$f"; done
  echo "   Si aquí hay algo que el core no tiene, llévalo antes al core; si es el core el que va por delante, ./sync-core.sh --force."
  exit 1
fi
echo "✳ core sincronizado desde $CORE"
