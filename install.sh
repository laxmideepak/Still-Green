#!/bin/sh
# Set up Stillgreen and add the `sg-local` command to ~/.local/bin.
# No sudo. Needs Python 3.9 or newer (macOS and most Linux have it).
#
# The first run of ./sg-local makes a private Python environment in .venv
# (inside this folder) and downloads the packages it needs from pypi.org.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
BIN_DIR="${HOME}/.local/bin"
TARGET="${BIN_DIR}/sg-local"

chmod +x "${SCRIPT_DIR}/sg-local"

# Sets up .venv the first time (with progress lines), then prints the version.
if ! VERSION=$("${SCRIPT_DIR}/sg-local" --version); then
    echo >&2
    echo "Stillgreen could not be set up. Read the message above, fix it, and run ./install.sh again." >&2
    exit 1
fi

mkdir -p "${BIN_DIR}"
if [ -e "${TARGET}" ] && [ ! -L "${TARGET}" ]; then
    echo "Refusing to overwrite ${TARGET}; move it aside and run this again." >&2
    exit 1
fi
ln -sfn "${SCRIPT_DIR}/sg-local" "${TARGET}"

echo "Installed ${VERSION}: ${TARGET}"
case ":${PATH}:" in
    *":${BIN_DIR}:"*) ;;
    *) echo "Add ${BIN_DIR} to PATH, for example:"
       echo "  echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.zshrc" ;;
esac

echo
echo "Next:"
echo "  sg-local add"
echo "  sg-local start"
echo "  sg-local status"
