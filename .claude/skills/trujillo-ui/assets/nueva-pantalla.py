# -*- coding: utf-8 -*-
"""Genera una maqueta nueva con el sistema de controles Trujillo ya puesto.

    python .claude/skills/trujillo-ui/assets/nueva-pantalla.py conteo \
        --titulo "Conteo de gondola" --numero 3 \
        --bajada "Maqueta funcional del primer conteo."

Escribe mobile/design/<nombre>.html con el CSS y el logo embebidos, asi
el archivo abre solo en el navegador y en el telefono sin servidor.
"""
import argparse
import base64
import pathlib
import sys

AQUI = pathlib.Path(__file__).resolve().parent
RAIZ = AQUI.parents[3]                      # .../app-inventario
LOGO = RAIZ / "mobile" / "assets" / "logo-trujillo.png"
DESTINO = RAIZ / "mobile" / "design"


def main():
    ap = argparse.ArgumentParser(description="Nueva maqueta con los controles Trujillo")
    ap.add_argument("nombre", help="nombre del archivo, sin .html")
    ap.add_argument("--titulo", required=True, help="titulo de la pantalla")
    ap.add_argument("--numero", default="?", help="numero de pantalla (de 7)")
    ap.add_argument("--bajada", default="Maqueta funcional para validar antes de llevarla a React Native.")
    ap.add_argument("--nota", default="Tocá una opción y mirá cómo responde la pantalla.")
    ap.add_argument("--forzar", action="store_true", help="sobrescribir si ya existe")
    args = ap.parse_args()

    salida = DESTINO / (args.nombre + ".html")
    if salida.exists() and not args.forzar:
        sys.exit("Ya existe %s — usá --forzar para sobrescribirlo." % salida)

    if not LOGO.exists():
        sys.exit("Falta el logo en %s" % LOGO)

    css = (AQUI / "controles.css").read_text(encoding="utf-8")
    base = (AQUI / "pantalla-base.html").read_text(encoding="utf-8")
    logo = "data:image/png;base64," + base64.b64encode(LOGO.read_bytes()).decode()

    html = (base
            .replace("__CSS__", css)
            .replace("__LOGO__", logo)
            .replace("__TITULO__", args.titulo)
            .replace("__NUMERO__", str(args.numero))
            .replace("__BAJADA__", args.bajada)
            .replace("__NOTA_VALIDACION__", args.nota))

    DESTINO.mkdir(parents=True, exist_ok=True)
    salida.write_text(html, encoding="utf-8")
    print("Creada: %s (%d bytes)" % (salida, salida.stat().st_size))


if __name__ == "__main__":
    main()
