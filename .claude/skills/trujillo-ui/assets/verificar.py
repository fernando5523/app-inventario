# -*- coding: utf-8 -*-
"""Revisa una maqueta antes de darla por buena.

    python .claude/skills/trujillo-ui/assets/verificar.py mobile/design/login.html

Chequea lo que se rompe en silencio al editar estos archivos a mano:
etiquetas sin cerrar, ids duplicados, ids que el JS busca y no existen,
tokens CSS declarados que ya nadie usa, colores literales fuera de los
tokens, y la sintaxis del JS (con node, si esta disponible).
Sale con codigo 1 si encuentra algo.
"""
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile

# Paleta legitima: tokens de marca, de app, del lienzo en ambos temas y
# los grises auxiliares del sistema de controles.
COLORES_CONOCIDOS = {
    # marca y app
    "#D82018", "#B81810", "#FDF0EF", "#F8B818",
    "#FFFFFF", "#1C1917", "#6B6560", "#9A938D", "#E3DEDA",
    # lienzo claro / oscuro
    "#F2EEEB", "#26211E", "#6E6660", "#DED7D2",
    "#191614", "#221E1B", "#A79E97", "#332D29",
    # grises auxiliares de los controles
    "#C9C1BB", "#CFC7C1", "#DCD6D2", "#F0ECE9", "#F7F5F4", "#FBFAFA", "#FAF8F7",
    # estados semanticos (pantalla 2: hojas de conteo) - validados con el cliente
    "#0A6B57", "#E7F4EF", "#8A5A05", "#FDF3DC", "#F2EFED", "#EDE9E6", "#FCFBFA",
    # estado "falta" (pantallas 4-7) - contraste verificado: 6.56:1 / 5.63:1
    "#A23B2E", "#FBEAE7",
}


def main():
    if len(sys.argv) < 2:
        sys.exit("Uso: verificar.py <archivo.html>")
    ruta = pathlib.Path(sys.argv[1])
    if not ruta.exists():
        sys.exit("No existe %s" % ruta)

    s = ruta.read_text(encoding="utf-8")
    problemas = []

    # --- etiquetas balanceadas ---
    print("Etiquetas:")
    for t in ("div", "button", "span", "section", "header", "p", "h1", "h3", "script", "style"):
        a = len(re.findall(r"<" + t + r"[ >]", s))
        b = len(re.findall(r"</" + t + r">", s))
        estado = "OK" if a == b else "DESBALANCE"
        if a != b:
            problemas.append("%s: %d abren, %d cierran" % (t, a, b))
        print("  %-8s %3d/%3d  %s" % (t, a, b, estado))

    # --- ids ---
    ids = re.findall(r'id="([^"]+)"', s)
    dup = sorted({i for i in ids if ids.count(i) > 1})
    buscados = set(re.findall(r"\$\('([^']+)'\)", s))
    faltan = sorted(buscados - set(ids))
    print("\nIds:")
    print("  duplicados:", dup or "ninguno")
    print("  que busca el JS y no existen:", faltan or "ninguno")
    if dup:
        problemas.append("ids duplicados: %s" % ", ".join(dup))
    if faltan:
        problemas.append("ids inexistentes: %s" % ", ".join(faltan))

    # --- tokens CSS ---
    decl = set(re.findall(r"(--[a-z-]+):", s))
    uso = set(re.findall(r"var\((--[a-z-]+)\)", s))
    muertos = sorted(decl - uso)
    print("\nTokens CSS declarados y sin usar:", muertos or "ninguno")
    if muertos:
        problemas.append("tokens sin usar: %s" % ", ".join(muertos))

    # --- color explicito en .pantalla (el bug del tema) ---
    bloque = re.search(r"\.pantalla\s*\{[^}]*\}", s)
    if not bloque or "color:" not in bloque.group(0):
        problemas.append(".pantalla no declara `color`: el texto sin color propio "
                         "hereda el del documento y desaparece en tema oscuro")
        print("\n.pantalla declara color: NO  <<< revisar")
    else:
        print("\n.pantalla declara color: si")

    # --- colores literales fuera de la paleta ---
    literales = {c.upper() for c in re.findall(r"#[0-9a-fA-F]{6}", s)}
    fuera = sorted(literales - COLORES_CONOCIDOS)
    if fuera:
        print("\nColores literales fuera de los tokens (revisar si van):")
        for c in fuera:
            print("  ", c)

    # --- sintaxis del JS ---
    print("\nJavaScript:")
    if "<script>" in s and shutil.which("node"):
        js = s[s.index("<script>") + 8: s.index("</script>")]
        tmp = pathlib.Path(tempfile.gettempdir()) / "_verificar_maqueta.js"
        tmp.write_text(js, encoding="utf-8")
        r = subprocess.run(["node", "--check", str(tmp)], capture_output=True, text=True)
        tmp.unlink(missing_ok=True)
        if r.returncode == 0:
            print("  sintaxis OK")
        else:
            problemas.append("error de sintaxis en el JS")
            print("  ERROR:\n", r.stderr.strip())
    else:
        print("  sin <script> o sin node en el PATH: omitido")

    print()
    if problemas:
        print("%d problema(s):" % len(problemas))
        for p in problemas:
            print("  -", p)
        sys.exit(1)
    print("Todo limpio.")


if __name__ == "__main__":
    main()
